package integration

import (
	"net"
	"strconv"
	"testing"

	"github.com/standards-lab/go-core/process/processtest"
	"github.com/standards-lab/go-web-sdk/webtest"
)

// Main is the suite's TestMain: it builds cmd/server once, with the race
// detector so the service runs under it too, runs the tests, and removes
// the build.
func Main(m *testing.M) {
	processtest.Main(m, "./cmd/server")
}

// Options shapes one service process. The zero value runs the service on
// the base configuration file and the harness's own variables alone.
type Options struct {
	// Env appends further KEY=VALUE overrides, applied last.
	Env []string
}

// Token is the nats token every service process the harness runs is
// configured with; Options.Env can override it.
const Token = "integration-token"

// Service is one running service process: its address, its embedded NATS
// server's listeners, its captured output, and its exit.
type Service struct {
	*processtest.Process
	addr   string
	nats   string
	ws     string
	client *webtest.Client
}

// Start runs the service with opts and returns once it is live: Launch
// then Ready.
func Start(t testing.TB, opts Options) *Service {
	t.Helper()
	return Launch(t, opts).Ready(t)
}

// Launch runs the service with opts on reserved loopback ports, one for the
// HTTP server and one each for the embedded NATS server's client and
// WebSocket listeners, and returns without waiting, so a test can start
// several processes at once; Ready waits for one.
func Launch(t testing.TB, opts Options) *Service {
	t.Helper()
	addr := loopback(t)
	s := &Service{addr: addr, nats: loopback(t), ws: loopback(t), client: webtest.NewClient("http://" + addr)}
	s.Process = processtest.Launch(t, s.environment(opts)...)
	return s
}

// loopback reserves a loopback port and returns its address.
func loopback(t testing.TB) string {
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(processtest.FreePort(t)))
}

// Ready waits until the service's liveness probe answers, failing the test
// with the captured output if the process exits or the failsafe elapses
// first. The server is alone in the top layer of the service's graph, so a
// live probe means every node beneath it started.
func (s *Service) Ready(t testing.TB) *Service {
	t.Helper()
	s.Await(t, "liveness", func() bool { return webtest.Live(s.URL()) })
	return s
}

// environment composes the service's own variables for the run. EMULATOR_ENV is
// cleared so no overlay applies: the base file and these variables are the
// whole configuration. The ports are the ones Launch reserved, and the nats
// token, which the base file leaves to the environment, is [Token].
func (s *Service) environment(opts Options) []string {
	host, port, _ := net.SplitHostPort(s.addr)
	_, natsPort, _ := net.SplitHostPort(s.nats)
	wsHost, wsPort, _ := net.SplitHostPort(s.ws)
	env := []string{
		"EMULATOR_ENV=",
		"EMULATOR_LOG_LEVEL=debug",
		"EMULATOR_LOG_FORMAT=text",
		"EMULATOR_SERVER_HOST=" + host,
		"EMULATOR_SERVER_PORT=" + port,
		"EMULATOR_NATS_TOKEN=" + Token,
		"EMULATOR_NATS_PORT=" + natsPort,
		"EMULATOR_NATS_WEBSOCKET_HOST=" + wsHost,
		"EMULATOR_NATS_WEBSOCKET_PORT=" + wsPort,
	}
	return append(env, opts.Env...)
}

// Addr is the service's address, host:port.
func (s *Service) Addr() string { return s.addr }

// URL is the service's base URL.
func (s *Service) URL() string { return "http://" + s.addr }

// NATSURL is the embedded NATS server's client listener, as a nats:// URL
// with no credential.
func (s *Service) NATSURL() string { return "nats://" + s.nats }

// WebSocketAddr is the embedded NATS server's WebSocket listener,
// host:port.
func (s *Service) WebSocketAddr() string { return s.ws }

// WebSocketURL is the WebSocket listener as a ws:// URL with no credential.
func (s *Service) WebSocketURL() string { return "ws://" + s.ws }

// Client returns the client bound to the service, one per process so its
// connection is reused across calls.
func (s *Service) Client() *webtest.Client { return s.client }
