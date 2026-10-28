package natsserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nats-io/nats-server/v2/server"
)

// loopback is the host the client listener binds.
const loopback = "127.0.0.1"

// startWait bounds Start's wait for the listeners when ctx has no deadline.
const startWait = 10 * time.Second

// readyPoll is how long each of Start's readiness checks waits, so a
// cancelled ctx or a listener failure ends the wait promptly.
const readyPoll = 25 * time.Millisecond

// ErrStarted is the failure of a second [Server.Start].
var ErrStarted = errors.New("natsserver: already started")

// Options configures a [Server].
type Options struct {
	// Token is the static credential both listeners require.
	Token string
	// Port is the client listener's port, on 127.0.0.1.
	Port int
	// WebSocketHost and WebSocketPort are the WebSocket listener's address.
	WebSocketHost string
	WebSocketPort int
	// AllowedOrigins lists the origins the WebSocket listener accepts an
	// upgrade from, each as scheme://host[:port]. Empty accepts no
	// cross-origin upgrade.
	AllowedOrigins []string
}

// Server is an embedded nats-server with JetStream.
type Server struct {
	opts     Options
	logger   *slog.Logger
	fatal    chan error
	starting atomic.Bool

	mu    sync.Mutex
	srv   *server.Server
	store string
}

// New returns a server on opts, logging through logger. It does no I/O:
// Start creates the store and binds the listeners.
func New(opts Options, logger *slog.Logger) *Server {
	return &Server{opts: opts, logger: logger, fatal: make(chan error, 1)}
}

// Start creates the store directory, starts the server on it, and waits
// until both listeners accept connections, until ctx's deadline or 10s. A
// listener that cannot bind fails Start with nats-server's report of it. A
// failed Start stops what it started and removes the store, and the server
// can start again. A server starts once: a Start while another is in
// progress or has succeeded fails with [ErrStarted].
func (s *Server) Start(ctx context.Context) (err error) {
	if !s.starting.CompareAndSwap(false, true) {
		return ErrStarted
	}
	defer func() {
		if err != nil {
			s.starting.Store(false)
		}
	}()

	store, err := os.MkdirTemp("", "emulator-nats-*")
	if err != nil {
		return fmt.Errorf("natsserver: store: %w", err)
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(store)
		}
	}()

	srv, err := server.NewServer(s.options(store))
	if err != nil {
		return fmt.Errorf("natsserver: %w", err)
	}
	srv.SetLoggerV2(&logAdapter{logger: s.logger, fatal: s.fatal}, false, false, false)
	srv.Start()
	if err := s.await(ctx, srv); err != nil {
		srv.Shutdown()
		srv.WaitForShutdown()
		return err
	}

	s.mu.Lock()
	s.srv, s.store = srv, store
	s.mu.Unlock()
	s.logger.Info("nats started",
		"client", srv.ClientURL(),
		"websocket", fmt.Sprintf("ws://%s:%d", s.opts.WebSocketHost, s.opts.WebSocketPort),
		"store", store,
	)
	return nil
}

// options builds nats-server's options: JetStream on store, the token on
// the client listener and again on the WebSocket listener, whose own auth
// section overrides the client one, and the origin policy. NoSigs keeps the
// server off the process's signals, which the lifecycle owns.
func (s *Server) options(store string) *server.Options {
	ws := server.WebsocketOpts{
		Host:  s.opts.WebSocketHost,
		Port:  s.opts.WebSocketPort,
		Token: s.opts.Token,
		NoTLS: true,
	}
	if len(s.opts.AllowedOrigins) == 0 {
		// An empty AllowedOrigins is any origin to nats-server; the same
		// origin check admits only the listener's own, which serves no page.
		ws.SameOrigin = true
	} else {
		ws.AllowedOrigins = append([]string{}, s.opts.AllowedOrigins...)
	}
	return &server.Options{
		ServerName:    "emulator",
		Host:          loopback,
		Port:          s.opts.Port,
		Authorization: s.opts.Token,
		JetStream:     true,
		StoreDir:      store,
		NoSigs:        true,
		Websocket:     ws,
	}
}

// await waits until srv's listeners accept connections, failing on ctx's
// end, the wait's bound, or a listener failure srv reports.
func (s *Server) await(ctx context.Context, srv *server.Server) error {
	deadline := time.Now().Add(startWait)
	if d, ok := ctx.Deadline(); ok {
		deadline = d
	}
	for !srv.ReadyForConnections(readyPoll) {
		select {
		case err := <-s.fatal:
			return fmt.Errorf("natsserver: start: %w", err)
		default:
		}
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("natsserver: start: %w", err)
		}
		if time.Now().After(deadline) {
			return errors.New("natsserver: start: listeners not ready")
		}
	}
	return nil
}

// Ready reports whether the server is started and running.
func (s *Server) Ready() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.srv != nil && s.srv.Running()
}

// Err carries a failure the running server reports as fatal, such as a
// listener that stops serving, so the lifecycle Coordinator ends the run.
func (s *Server) Err() <-chan error { return s.fatal }

// Store is the started server's JetStream store directory, or "" before
// Start.
func (s *Server) Store() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store
}

// Shutdown stops the server, closing its connections, and removes the store
// directory once it has stopped. It returns at once for a server that never
// started. When ctx ends first it returns ctx's error, and the store is
// removed when the stop completes.
func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	srv, store := s.srv, s.store
	s.mu.Unlock()
	if srv == nil {
		return nil
	}

	done := make(chan error, 1)
	go func() {
		srv.Shutdown()
		srv.WaitForShutdown()
		done <- os.RemoveAll(store)
	}()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("natsserver: remove store: %w", err)
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("natsserver: shutdown: %w", ctx.Err())
	}
}

// logAdapter writes nats-server's log through the service's logger:
// notices, debug, and traces at debug, warnings at warn, and errors at
// error. A fatal, which nats-server's own logger would exit the process on,
// is logged at error and offered to the Server's fatal channel, where Start
// or the lifecycle Coordinator receives it.
type logAdapter struct {
	logger *slog.Logger
	fatal  chan<- error
}

func (l *logAdapter) Noticef(format string, v ...any) { l.log(slog.LevelDebug, format, v) }
func (l *logAdapter) Warnf(format string, v ...any)   { l.log(slog.LevelWarn, format, v) }
func (l *logAdapter) Errorf(format string, v ...any)  { l.log(slog.LevelError, format, v) }
func (l *logAdapter) Debugf(format string, v ...any)  { l.log(slog.LevelDebug, format, v) }
func (l *logAdapter) Tracef(format string, v ...any)  { l.log(slog.LevelDebug, format, v) }

func (l *logAdapter) Fatalf(format string, v ...any) {
	l.log(slog.LevelError, format, v)
	select {
	case l.fatal <- fmt.Errorf(format, v...):
	default:
	}
}

func (l *logAdapter) log(level slog.Level, format string, v []any) {
	l.logger.Log(context.Background(), level, fmt.Sprintf(format, v...), "component", "nats-server")
}
