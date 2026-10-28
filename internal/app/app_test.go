package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	libconfig "github.com/standards-lab/go-core/config"
	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-messaging"
	"github.com/standards-lab/go-messaging/memory"
	"github.com/standards-lab/go-web-sdk"
	mw "github.com/standards-lab/go-web-sdk/middleware"

	"github.com/JaimeStill/spike-html-apps/internal/app"
	"github.com/JaimeStill/spike-html-apps/internal/config"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests drive the composition root from outside: New builds it, Run
// serves it, the log's ready record is the ready signal, and HTTP is the
// only probe. They name no node and no layer, so they hold the process's
// behavior across a change to how New describes it, but for the one seam
// the unit tier composes through: start replaces the broker node's
// constructor with go-messaging's in-memory broker, so no test here starts
// the embedded NATS server or reaches the network beyond loopback HTTP. The
// binary, and the integration tier that runs it, compose the embedded
// server and its JetStream broker.

// failsafe bounds every wait for an event that should occur, so a broken
// composition fails the test instead of hanging it.
const failsafe = 2 * time.Second

// syncBuffer serializes writes so the app's logging goroutines and the
// test's reads stay race-free.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// readyRecord matches the ready record's message and its addr attribute in
// the text log format.
var readyRecord = regexp.MustCompile(`msg="server ready" addr=(\S+)`)

// waitForReady polls the log for the ready record and returns the address
// it names.
func waitForReady(t *testing.T, buf *syncBuffer) string {
	t.Helper()
	deadline := time.Now().Add(failsafe)
	for time.Now().Before(deadline) {
		if m := readyRecord.FindStringSubmatch(buf.String()); m != nil {
			return m[1]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for the server to become ready; log: %q", buf.String())
	return ""
}

// running is one App under Run: its log, the in-memory broker it publishes
// through, the cancel that drains it, and the channel Run's exit code
// arrives on.
type running struct {
	log    *syncBuffer
	broker *memory.Broker
	cancel context.CancelFunc
	done   chan int
}

// fixtureBuild is a minimal Vite build of the pipeline app, as NewClient
// reads it: the manifest naming the app's entry, and the entry's script.
// The unit tier serves it in place of the embedded build, which holds only
// its placeholder until mise run build:app writes one.
func fixtureBuild() fstest.MapFS {
	return fstest.MapFS{
		".vite/manifest.json": {Data: []byte(`{"src/main.ts": {"file": "assets/main-test.js", "isEntry": true}}`)},
		"assets/main-test.js": {Data: []byte("export {}")},
	}
}

// newApp is app.New with the dist node replaced by [fixtureBuild], so the
// pipeline app's handler builds whether or not the app has been built.
func newApp(t *testing.T, cfg *config.Config, w io.Writer) *app.App {
	t.Helper()
	a := app.New(cfg, w)
	a.Graph().Replace(a.Nodes().Dist, func(*graph.Scope) (fs.FS, error) {
		return fixtureBuild(), nil
	})
	return a
}

// start builds an App from cfg over the in-memory broker and runs it in the
// background. The cleanup cancels it, so a test that fails early leaves no
// server behind.
func start(t *testing.T, cfg *config.Config) *running {
	t.Helper()
	buf := &syncBuffer{}
	a := newApp(t, cfg, buf)
	broker := withMemoryBroker(a)
	ctx, cancel := context.WithCancel(context.Background())
	r := &running{log: buf, broker: broker, cancel: cancel, done: make(chan int, 1)}
	go func() { r.done <- a.Run(ctx) }()
	t.Cleanup(cancel)
	return r
}

// withMemoryBroker replaces a's broker node with a fresh in-memory broker,
// before Run, and returns it. The replacement Uses no node, so the graph
// holds no embedded NATS server.
func withMemoryBroker(a *app.App) *memory.Broker {
	b := memory.New()
	a.Graph().Replace(a.Nodes().Broker, func(*graph.Scope) (messaging.Broker, error) {
		return b, nil
	})
	return b
}

// exit waits for Run to return and gives its exit code.
func (r *running) exit(t *testing.T) int {
	t.Helper()
	select {
	case code := <-r.done:
		return code
	case <-time.After(failsafe):
		t.Fatalf("timed out waiting for Run to return; log: %q", r.log.String())
		return -1
	}
}

// client disables keep-alives so no idle connection outlives its request and
// delays the server's drain.
var client = &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}

// get returns the status code, response header, and body of a GET against
// the running app.
func get(t *testing.T, addr, path string) (int, http.Header, string) {
	t.Helper()
	resp, err := client.Get(fmt.Sprintf("http://%s%s", addr, path))
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s body: %v", path, err)
	}
	return resp.StatusCode, resp.Header, string(body)
}

// assertProbeHeaders pins the headers both probes answer with.
func assertProbeHeaders(t *testing.T, path string, header http.Header) {
	t.Helper()
	if got := header.Get("Content-Type"); got != "application/json" {
		t.Errorf("GET %s Content-Type = %q, want application/json", path, got)
	}
	if got := header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("GET %s Cache-Control = %q, want no-store", path, got)
	}
	if header.Get(mw.RequestIDHeader) == "" {
		t.Errorf("GET %s carries no %s response header; RequestID is not wired", path, mw.RequestIDHeader)
	}
}

// The baseline composition end to end. New assembles the process from the
// package's build points. Run serves the probes, the request logger from
// the middleware stack records the traffic, and a cancel drains to exit 0
// with the stop record.
func TestRun_ServesProbesThenDrains(t *testing.T) {
	r := start(t, configtest.Config(t))
	addr := waitForReady(t, r.log)

	if code, _, _ := get(t, addr, web.HealthPath); code != http.StatusOK {
		t.Errorf("GET %s = %d, want 200", web.HealthPath, code)
	}
	if code, _, _ := get(t, addr, web.ReadyPath); code != http.StatusOK {
		t.Errorf("GET %s = %d, want 200", web.ReadyPath, code)
	}

	r.cancel()
	if code := r.exit(t); code != 0 {
		t.Errorf("Run = %d, want 0; log: %q", code, r.log.String())
	}

	out := r.log.String()
	if !strings.Contains(out, `msg="server stopped"`) {
		t.Error("log carries no stop record after the drain")
	}
	if !strings.Contains(out, "url.path="+web.HealthPath) {
		t.Error("log has no probe request record; the middleware stack is not wired")
	}
}

// The liveness probe's whole contract: 200, a JSON body of exactly
// {"status":"ok"}, never cached, and stamped with a request ID.
func TestRun_HealthzContract(t *testing.T) {
	r := start(t, configtest.Config(t))
	addr := waitForReady(t, r.log)

	code, header, body := get(t, addr, web.HealthPath)
	if code != http.StatusOK {
		t.Errorf("GET %s = %d, want 200", web.HealthPath, code)
	}
	assertProbeHeaders(t, web.HealthPath, header)
	if got := strings.TrimSpace(body); got != `{"status":"ok"}` {
		t.Errorf("GET %s body = %q, want {\"status\":\"ok\"}", web.HealthPath, got)
	}
}

// The readiness probe's whole contract: 200, status "ready", and exactly
// the checks of the unit tier's composition, all ready: the lifecycle
// coordinator's and the runner reactor's, in that order. The in-memory
// broker has no Ready and the composition no embedded server, so neither
// joins; the binary's nats and broker checks are the integration tier's. A
// check appearing, going missing, or being renamed fails here.
func TestRun_ReadyzContract(t *testing.T) {
	r := start(t, configtest.Config(t))
	addr := waitForReady(t, r.log)

	code, header, body := get(t, addr, web.ReadyPath)
	if code != http.StatusOK {
		t.Errorf("GET %s = %d, want 200", web.ReadyPath, code)
	}
	assertProbeHeaders(t, web.ReadyPath, header)

	type check struct {
		Name  string `json:"name"`
		Ready bool   `json:"ready"`
	}
	var got struct {
		Status string  `json:"status"`
		Checks []check `json:"checks"`
	}
	dec := json.NewDecoder(strings.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&got); err != nil {
		t.Fatalf("decode %s body %q: %v", web.ReadyPath, body, err)
	}
	if got.Status != "ready" {
		t.Errorf("readiness status = %q, want ready", got.Status)
	}
	want := []check{{Name: "lifecycle", Ready: true}, {Name: "runner", Ready: true}}
	if !slices.Equal(got.Checks, want) {
		t.Errorf("readiness checks = %+v, want exactly %+v", got.Checks, want)
	}
}

// The ready record fires once the server has bound, once, and names the
// address it bound: the configured host with the kernel's port in place of
// the requested 0. That address answers the readiness probe.
func TestRun_ReadyRecordNamesBoundAddr(t *testing.T) {
	r := start(t, configtest.Config(t))
	addr := waitForReady(t, r.log)

	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("ready addr %q: %v", addr, err)
	}
	if host != "127.0.0.1" {
		t.Errorf("ready addr host = %q, want the configured 127.0.0.1", host)
	}
	if p, err := strconv.Atoi(port); err != nil || p == 0 {
		t.Errorf("ready addr port = %q, want the bound nonzero port", port)
	}
	if code, _, _ := get(t, addr, web.ReadyPath); code != http.StatusOK {
		t.Errorf("GET %s at the logged addr = %d, want 200", web.ReadyPath, code)
	}
	if n := len(readyRecord.FindAllString(r.log.String(), -1)); n != 1 {
		t.Errorf("ready records = %d, want 1", n)
	}
}

// A port another listener holds fails startup: Run returns 1, the failure
// is logged as a startup error naming the server, and the server never
// reports ready.
func TestRun_TakenPortFailsStartup(t *testing.T) {
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("hold a port: %v", err)
	}
	defer func() { _ = held.Close() }()

	cfg := configtest.Config(t)
	cfg.Server.Port = new(held.Addr().(*net.TCPAddr).Port)

	r := start(t, cfg)
	if code := r.exit(t); code != 1 {
		t.Errorf("Run = %d, want 1", code)
	}

	out := r.log.String()
	failure := regexp.MustCompile(`msg="service failed" error="[^"]*startup:[^"]*server`)
	if !failure.MatchString(out) {
		t.Errorf("log = %q, want a startup error naming server", out)
	}
	if strings.Contains(out, "server ready") {
		t.Errorf("log = %q, want no ready record", out)
	}
}

// The shutdown timeout bounds the drain. A connection that has sent part
// of a request is active, so a graceful drain would wait on it; past the
// timeout Run gives up, returns 1, and does so promptly.
func TestRun_ShutdownBoundedByTimeout(t *testing.T) {
	const timeout = 200 * time.Millisecond
	const margin = 500 * time.Millisecond

	cfg := configtest.Config(t)
	cfg.ShutdownTimeout = libconfig.Duration(timeout)

	r := start(t, cfg)
	addr := waitForReady(t, r.log)

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer func() { _ = conn.Close() }()
	// An unterminated header block: the server reads it and waits for the
	// rest, holding the connection active.
	if _, err := io.WriteString(conn, "GET "+web.HealthPath+" HTTP/1.1\r\nHost: stall\r\n"); err != nil {
		t.Fatalf("write partial request: %v", err)
	}
	// Give the server a moment to read the bytes and mark the connection
	// active before the drain starts.
	time.Sleep(50 * time.Millisecond)

	began := time.Now()
	r.cancel()
	code := r.exit(t)
	elapsed := time.Since(began)

	if code != 1 {
		t.Errorf("Run = %d, want 1 when the drain outlives the timeout; log: %q", code, r.log.String())
	}
	if elapsed > timeout+margin {
		t.Errorf("Run returned after %s, want within %s of the %s timeout", elapsed, margin, timeout)
	}
}

// An App runs once. Run reports a Build or lifecycle failure as an exit
// code, but a second Run is a programming error and panics.
func TestRun_TwicePanics(t *testing.T) {
	buf := &syncBuffer{}
	a := newApp(t, configtest.Config(t), buf)
	withMemoryBroker(a)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := a.Run(ctx); code != 0 {
		t.Fatalf("first Run = %d, want 0", code)
	}

	defer func() {
		if recover() == nil {
			t.Error("a second Run did not panic")
		}
	}()
	_ = a.Run(ctx)
}
