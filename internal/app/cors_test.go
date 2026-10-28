package app_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// The browser origin these tests admit, a Vite dev server's.
const allowedOrigin = "http://localhost:5173"

// send issues a method request to the running app with the given headers
// and returns its status and response header.
func send(t *testing.T, addr, method, path string, header map[string]string) (int, http.Header) {
	t.Helper()
	req, err := http.NewRequest(method, fmt.Sprintf("http://%s%s", addr, path), nil)
	if err != nil {
		t.Fatalf("new %s %s: %v", method, path, err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode, resp.Header
}

// corsHeaders returns the Access-Control-* headers of h.
func corsHeaders(h http.Header) http.Header {
	out := http.Header{}
	for name, v := range h {
		if strings.HasPrefix(name, "Access-Control-") {
			out[name] = v
		}
	}
	return out
}

// The cors block's origins reach the router-wide middleware: a preflight
// from the allowed origin is admitted for a path no route serves, the
// upload-with-progress preflight's method and headers allowed, and leaves a
// request record; a disallowed origin's preflight is answered bare.
func TestRun_CORSPreflight(t *testing.T) {
	cfg := configtest.Config(t)
	cfg.CORS.AllowedOrigins = []string{allowedOrigin}
	r := start(t, cfg)
	addr := waitForReady(t, r.log)

	const path = "/api/documents"
	preflight := map[string]string{
		"Origin":                         allowedOrigin,
		"Access-Control-Request-Method":  http.MethodPost,
		"Access-Control-Request-Headers": "authorization,content-type",
	}

	code, h := send(t, addr, http.MethodOptions, path, preflight)
	if code != http.StatusNoContent {
		t.Errorf("allowed preflight = %d, want 204", code)
	}
	want := http.Header{
		"Access-Control-Allow-Origin":  {allowedOrigin},
		"Access-Control-Allow-Methods": {http.MethodPost},
		"Access-Control-Allow-Headers": {"authorization,content-type"},
	}
	if got := corsHeaders(h); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("allowed preflight CORS headers = %v, want %v", got, want)
	}
	// The record is written once the response is, so it is waited for.
	record := "http.request.method=OPTIONS url.path=" + path
	deadline := time.Now().Add(failsafe)
	for !strings.Contains(r.log.String(), record) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !strings.Contains(r.log.String(), record) {
		t.Errorf("log has no request record of the preflight; log: %q", r.log.String())
	}

	preflight["Origin"] = "https://evil.example"
	if _, h := send(t, addr, http.MethodOptions, path, preflight); len(corsHeaders(h)) != 0 {
		t.Errorf("disallowed preflight CORS headers = %v, want none", corsHeaders(h))
	}
}

// A request from the allowed origin carries Access-Control-Allow-Origin
// with Vary: Origin; a disallowed origin's, and one with no Origin, are
// served unchanged, with no CORS header.
func TestRun_CORSRequest(t *testing.T) {
	cfg := configtest.Config(t)
	cfg.CORS.AllowedOrigins = []string{allowedOrigin}
	r := start(t, cfg)
	addr := waitForReady(t, r.log)

	code, h := send(t, addr, http.MethodGet, web.HealthPath, map[string]string{"Origin": allowedOrigin})
	if code != http.StatusOK {
		t.Errorf("allowed GET %s = %d, want 200", web.HealthPath, code)
	}
	if got := h.Get("Access-Control-Allow-Origin"); got != allowedOrigin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, allowedOrigin)
	}
	if !strings.Contains(strings.Join(h.Values("Vary"), ","), "Origin") {
		t.Errorf("Vary = %q, want it to list Origin", h.Values("Vary"))
	}

	for name, header := range map[string]map[string]string{
		"disallowed origin": {"Origin": "https://evil.example"},
		"no origin":         nil,
	} {
		code, h := send(t, addr, http.MethodGet, web.HealthPath, header)
		if code != http.StatusOK {
			t.Errorf("%s: GET %s = %d, want 200", name, web.HealthPath, code)
		}
		if got := corsHeaders(h); len(got) != 0 {
			t.Errorf("%s: CORS headers = %v, want none", name, got)
		}
	}
}

// The default configuration admits no origin: the allowed origin of the
// tests above gets no CORS header when the cors block is left empty.
func TestRun_CORSDefaultAdmitsNoOrigin(t *testing.T) {
	r := start(t, configtest.Config(t))
	addr := waitForReady(t, r.log)

	_, h := send(t, addr, http.MethodOptions, "/api/documents", map[string]string{
		"Origin":                        allowedOrigin,
		"Access-Control-Request-Method": http.MethodPost,
	})
	if got := corsHeaders(h); len(got) != 0 {
		t.Errorf("preflight CORS headers = %v, want none", got)
	}
}
