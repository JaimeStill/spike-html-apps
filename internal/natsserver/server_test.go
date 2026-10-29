package natsserver_test

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"github.com/standards-lab/go-core/process/processtest"

	"github.com/JaimeStill/spike-html-apps/internal/natsserver"
)

// These tests start the embedded server on reserved loopback ports, which
// is local and reads no network. Each points TMPDIR at its own directory,
// so the store the server creates there, and its removal, are observable.
// A reserved port is released before the server binds it, and the check's
// other tiers reserve and bind loopback ports concurrently, so each start
// goes through boot, which starts again on fresh ports when the bind loses
// that race.

const token = "test-token"

// options returns Options on freshly reserved loopback ports with the test
// token and the given allowed origins.
func options(t *testing.T, origins ...string) natsserver.Options {
	t.Helper()
	return natsserver.Options{
		Token:          token,
		Port:           processtest.FreePort(t),
		WebSocketHost:  "127.0.0.1",
		WebSocketPort:  processtest.FreePort(t),
		AllowedOrigins: origins,
	}
}

// tmp points TMPDIR at a fresh directory and returns it.
func tmp(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	return dir
}

// bootAttempts bounds boot's starts.
const bootAttempts = 5

// boot starts the server fresh returns, each Start bounded at 5s. A Start
// that fails because a listener's port is taken, which errors.Is matches to
// syscall.EADDRINUSE, starts the next server fresh returns, on ports it
// reserves anew, up to bootAttempts in all; any other failure returns at
// once. It returns the last server, the number of starts, and the last
// Start's error.
func boot(fresh func() *natsserver.Server) (*natsserver.Server, int, error) {
	for attempt := 1; ; attempt++ {
		s := fresh()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := s.Start(ctx)
		cancel()
		if err == nil || !errors.Is(err, syscall.EADDRINUSE) || attempt == bootAttempts {
			return s, attempt, err
		}
	}
}

// start boots a server on freshly reserved options with origins, shuts it
// down at cleanup, and returns it with the options it started on.
func start(t *testing.T, origins ...string) (*natsserver.Server, natsserver.Options) {
	t.Helper()
	var opts natsserver.Options
	s, _, err := boot(func() *natsserver.Server {
		opts = options(t, origins...)
		return natsserver.New(opts, slog.New(slog.DiscardHandler))
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
	return s, opts
}

// connect dials url with the nats.go client, presenting tok when it is set,
// and closes the connection on success.
func connect(url, tok string) error {
	opts := []natsgo.Option{natsgo.Timeout(2 * time.Second), natsgo.NoReconnect()}
	if tok != "" {
		opts = append(opts, natsgo.Token(tok))
	}
	nc, err := natsgo.Connect(url, opts...)
	if err != nil {
		return err
	}
	nc.Close()
	return nil
}

// upgrade sends a WebSocket upgrade to addr with the given Origin header,
// none when origin is empty, and returns the response's status code.
func upgrade(t *testing.T, addr, origin string) int {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))

	req, err := http.NewRequest(http.MethodGet, "http://"+addr+"/", nil)
	if err != nil {
		t.Fatalf("new upgrade request: %v", err)
	}
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	req.Header.Set("Sec-WebSocket-Version", "13")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if err := req.Write(conn); err != nil {
		t.Fatalf("write upgrade request: %v", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		t.Fatalf("read upgrade response: %v", err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func wsAddr(opts natsserver.Options) string {
	return net.JoinHostPort(opts.WebSocketHost, strconv.Itoa(opts.WebSocketPort))
}

// Both listeners require the token: with it a client connects, and with
// none, or another, it is refused, on the core protocol and over WebSocket
// alike.
func TestServer_TokenRequiredOnBothListeners(t *testing.T) {
	tmp(t)
	_, opts := start(t)

	urls := map[string]string{
		"client":    fmt.Sprintf("nats://127.0.0.1:%d", opts.Port),
		"websocket": "ws://" + wsAddr(opts),
	}
	for listener, url := range urls {
		if err := connect(url, token); err != nil {
			t.Errorf("%s: connect with the token: %v", listener, err)
		}
		for name, tok := range map[string]string{"no token": "", "wrong token": "other"} {
			err := connect(url, tok)
			if !errors.Is(err, natsgo.ErrAuthorization) {
				t.Errorf("%s: connect with %s = %v, want an authorization violation", listener, name, err)
			}
		}
	}
}

// The client listener binds loopback only: the port is unreachable on any
// of the machine's other addresses.
func TestServer_ClientListenerLoopbackOnly(t *testing.T) {
	tmp(t)
	_, opts := start(t)

	addrs, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatalf("interface addrs: %v", err)
	}
	var other net.IP
	for _, a := range addrs {
		if ip, ok := a.(*net.IPNet); ok && !ip.IP.IsLoopback() && ip.IP.To4() != nil {
			other = ip.IP
			break
		}
	}
	if other == nil {
		t.Skip("no non-loopback IPv4 address to dial")
	}
	addr := net.JoinHostPort(other.String(), strconv.Itoa(opts.Port))
	if conn, err := net.DialTimeout("tcp", addr, time.Second); err == nil {
		_ = conn.Close()
		t.Errorf("dial %s succeeded, want the client listener on loopback only", addr)
	}
}

// With origins configured, the WebSocket listener upgrades a listed origin
// and refuses any other; an upgrade with no Origin, a dedicated client
// rather than a browser, is accepted.
func TestServer_WebSocketAllowedOrigins(t *testing.T) {
	tmp(t)
	_, opts := start(t, "http://localhost:5173")
	addr := wsAddr(opts)

	for origin, want := range map[string]int{
		"http://localhost:5173": http.StatusSwitchingProtocols,
		"https://evil.example":  http.StatusForbidden,
		"http://localhost:5174": http.StatusForbidden,
		"":                      http.StatusSwitchingProtocols,
	} {
		if got := upgrade(t, addr, origin); got != want {
			t.Errorf("upgrade from origin %q = %d, want %d", origin, got, want)
		}
	}
}

// With no origins configured, which nats-server alone would read as any
// origin, the WebSocket listener refuses every cross-origin upgrade; one
// with no Origin is still accepted.
func TestServer_WebSocketNoOriginsRefusesCrossOrigin(t *testing.T) {
	tmp(t)
	_, opts := start(t)
	addr := wsAddr(opts)

	for origin, want := range map[string]int{
		"http://localhost:5173": http.StatusForbidden,
		"https://evil.example":  http.StatusForbidden,
		"":                      http.StatusSwitchingProtocols,
	} {
		if got := upgrade(t, addr, origin); got != want {
			t.Errorf("upgrade from origin %q = %d, want %d", origin, got, want)
		}
	}
}

// Start creates the store directory under TMPDIR and readies the server;
// Shutdown stops it and removes the store, leaving TMPDIR as it was.
func TestServer_StoreLifecycle(t *testing.T) {
	dir := tmp(t)
	s, _, err := boot(func() *natsserver.Server {
		s := natsserver.New(options(t), slog.New(slog.DiscardHandler))
		if s.Ready() || s.Store() != "" {
			t.Errorf("before Start: Ready = %v, Store = %q, want false and none", s.Ready(), s.Store())
		}
		return s
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !s.Ready() {
		t.Error("Ready = false after Start")
	}
	if info, err := os.Stat(s.Store()); err != nil || !info.IsDir() {
		t.Fatalf("store %q after Start: %v, want a directory", s.Store(), err)
	}

	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if s.Ready() {
		t.Error("Ready = true after Shutdown")
	}
	if _, err := os.Stat(s.Store()); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("store %q after Shutdown: %v, want it removed", s.Store(), err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("TMPDIR holds %d entries after Shutdown, want none", len(entries))
	}
}

// A server starts once; a Shutdown before Start does nothing.
func TestServer_StartsOnce(t *testing.T) {
	tmp(t)
	s, _, err := boot(func() *natsserver.Server {
		s := natsserver.New(options(t), slog.New(slog.DiscardHandler))
		if err := s.Shutdown(context.Background()); err != nil {
			t.Errorf("Shutdown before Start: %v", err)
		}
		return s
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = s.Shutdown(context.Background()) }()
	if err := s.Start(context.Background()); !errors.Is(err, natsserver.ErrStarted) {
		t.Errorf("second Start = %v, want ErrStarted", err)
	}
}

// A listener port another socket holds fails Start promptly with
// nats-server's report, an error errors.Is matches to syscall.EADDRINUSE,
// which is how boot tells a taken port from any other failure, not after
// the wait's bound, and the failed Start leaves no store behind.
func TestServer_TakenPortFailsStart(t *testing.T) {
	for _, listener := range []string{"client", "websocket"} {
		t.Run(listener, func(t *testing.T) {
			dir := tmp(t)
			held, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatalf("hold a port: %v", err)
			}
			defer func() { _ = held.Close() }()
			opts := options(t)
			port := held.Addr().(*net.TCPAddr).Port
			if listener == "client" {
				opts.Port = port
			} else {
				opts.WebSocketPort = port
			}

			s := natsserver.New(opts, slog.New(slog.DiscardHandler))
			began := time.Now()
			err = s.Start(context.Background())
			if err == nil {
				_ = s.Shutdown(context.Background())
				t.Fatal("Start succeeded on a held port")
			}
			if !errors.Is(err, syscall.EADDRINUSE) {
				t.Errorf("Start = %v, want an error matching syscall.EADDRINUSE", err)
			}
			if elapsed := time.Since(began); elapsed > 3*time.Second {
				t.Errorf("Start failed after %s, want promptly", elapsed)
			}
			if s.Ready() {
				t.Error("Ready = true after a failed Start")
			}
			if entries, _ := os.ReadDir(dir); len(entries) != 0 {
				t.Errorf("TMPDIR holds %d entries after a failed Start, want none", len(entries))
			}
		})
	}
}

// boot starts again, on freshly reserved ports, when a Start fails because
// a reserved port was taken before the server bound it: with the first
// start's listener port held, the second start succeeds on another.
func TestBoot_RetriesTakenPort(t *testing.T) {
	for _, listener := range []string{"client", "websocket"} {
		t.Run(listener, func(t *testing.T) {
			tmp(t)
			held, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatalf("hold a port: %v", err)
			}
			defer func() { _ = held.Close() }()
			port := held.Addr().(*net.TCPAddr).Port

			// The first start's options name the held port, as though
			// another process bound it after options reserved it.
			var opts natsserver.Options
			first := true
			s, attempts, err := boot(func() *natsserver.Server {
				opts = options(t)
				switch {
				case first && listener == "client":
					opts.Port = port
				case first:
					opts.WebSocketPort = port
				}
				first = false
				return natsserver.New(opts, slog.New(slog.DiscardHandler))
			})
			if err != nil {
				t.Fatalf("boot = %v after %d starts, want a start on fresh ports", err, attempts)
			}
			t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
			if attempts != 2 {
				t.Errorf("boot started %d times, want 2: the held port, then fresh ones", attempts)
			}
			if err := connect(fmt.Sprintf("nats://127.0.0.1:%d", opts.Port), token); err != nil {
				t.Errorf("connect to the booted server: %v", err)
			}
		})
	}
}

// boot starts once when Start fails for any reason but a taken port: with
// TMPDIR missing, the store cannot be created, and boot returns that
// failure from its first start.
func TestBoot_OtherFailureNotRetried(t *testing.T) {
	t.Setenv("TMPDIR", filepath.Join(t.TempDir(), "missing"))
	_, attempts, err := boot(func() *natsserver.Server {
		return natsserver.New(options(t), slog.New(slog.DiscardHandler))
	})
	if err == nil {
		t.Fatal("boot succeeded with no TMPDIR, want the store's failure")
	}
	if attempts != 1 {
		t.Errorf("boot started %d times on %v, want 1", attempts, err)
	}
}
