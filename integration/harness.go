package integration

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/standards-lab/go-core/process/processtest"
	"github.com/standards-lab/go-web-sdk/webtest"
)

// Dist is the pipeline app's build directory, relative to the module root;
// the binary embeds what it holds when it is compiled.
const Dist = "apps/pipeline/dist"

// manifest is the build's manifest, in Dist.
const manifest = ".vite/manifest.json"

// Main is the suite's TestMain: it builds cmd/server once, with the race
// detector so the service runs under it too, runs the tests, and removes
// the build. The binary embeds the pipeline app's build, without which it
// refuses to start, so Main first fails the suite, naming the task that
// writes the build, when there is none: test:integration depends on
// build:app, and a bare go test needs it run first.
func Main(m *testing.M) {
	root, err := moduleRoot()
	if err == nil {
		_, err = os.Stat(filepath.Join(root, Dist, manifest))
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "integration: no pipeline app build (run mise run build:app): %v\n", err)
		os.Exit(1)
	}
	processtest.Main(m, "./cmd/server")
}

// moduleRoot is the directory of the module's go.mod.
func moduleRoot() (string, error) {
	out, err := exec.Command("go", "env", "GOMOD").Output()
	if err != nil {
		return "", fmt.Errorf("locate module root: %w", err)
	}
	return filepath.Dir(strings.TrimSpace(string(out))), nil
}

// Manifest returns the pipeline app build's manifest, decoded, as the
// binary embedded it: each entry's source path to its output file.
func Manifest(t testing.TB) map[string]struct {
	File string `json:"file"`
} {
	t.Helper()
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, Dist, manifest))
	if err != nil {
		t.Fatalf("read the build's manifest: %v", err)
	}
	var m map[string]struct {
		File string `json:"file"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("decode the build's manifest: %v", err)
	}
	return m
}

// BuildWithoutApp compiles cmd/server as a checkout with no web build would,
// into a directory the test removes, and returns its path. A go build
// overlay deletes every file in Dist but its committed .gitkeep, so the
// embed sees only the placeholder; the build directory itself is never
// touched, and the suite's other processes, compiled by Main, keep the
// build.
func BuildWithoutApp(t testing.TB) string {
	t.Helper()
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	dist := filepath.Join(root, Dist)
	replace := map[string]string{}
	err = filepath.WalkDir(dist, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() == ".gitkeep" {
			return err
		}
		replace[path] = ""
		return nil
	})
	if err != nil {
		t.Fatalf("list the build: %v", err)
	}
	dir := t.TempDir()
	overlay, err := json.Marshal(map[string]any{"Replace": replace})
	if err != nil {
		t.Fatal(err)
	}
	overlayPath := filepath.Join(dir, "overlay.json")
	if err := os.WriteFile(overlayPath, overlay, 0o600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "server")
	build := exec.Command("go", "build", "-overlay", overlayPath, "-o", binary, "./cmd/server")
	build.Dir = root
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build cmd/server without the app: %v\n%s", err, out)
	}
	return binary
}

// RunBinary runs binary, one BuildWithoutApp returned, to its exit with
// opts on reserved loopback ports, in the module root as Main's processes
// run, and returns its exit code and its combined output. It fails the test
// if the binary is still running after processtest.Failsafe.
func RunBinary(t testing.TB, binary string, opts Options) (int, string) {
	t.Helper()
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{addr: loopback(t), nats: loopback(t), ws: loopback(t)}
	cmd := exec.Command(binary)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), s.environment(opts)...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Start(); err != nil {
		t.Fatalf("start %s: %v", binary, err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err = <-done:
	case <-time.After(processtest.Failsafe):
		_ = cmd.Process.Kill()
		t.Fatalf("%s still running after %s, killed (%v):\n%s", binary, processtest.Failsafe, <-done, out.String())
	}
	var exit *exec.ExitError
	if err != nil && !errors.As(err, &exit) {
		t.Fatalf("run %s: %v", binary, err)
	}
	return cmd.ProcessState.ExitCode(), out.String()
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
