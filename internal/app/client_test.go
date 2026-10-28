package app_test

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests pin how the composition root serves the pipeline app: at
// the app block's mount, a prefix or the root, beside the API, the admin
// mount, and the probes, with the shell's config built from the
// configuration. The handler's own contract, the shell, the assets, and the
// misses, is the sdk package's.

// shellConfig is the config the shell writes, as the app reads it.
type shellConfig struct {
	APIBase string `json:"apiBase"`
	NATS    struct {
		URL    string `json:"url"`
		Stream string `json:"stream"`
		Token  string `json:"token"`
	} `json:"nats"`
}

var (
	baseHref      = regexp.MustCompile(`<base href="([^"]*)">`)
	configContent = regexp.MustCompile(`(?s)<script type="application/json" id="app-config">(.*?)</script>`)
)

// isShell reports whether body is the app's shell.
func isShell(body string) bool {
	return strings.Contains(body, `<script type="module" src="assets/main-test.js">`)
}

// isProblem reports whether a response is a problem document with status.
func isProblem(code int, header http.Header, status int) bool {
	return code == status && header.Get("Content-Type") == web.ProblemMediaType
}

// The app at a prefix, the default /app, and at the root. Under either, the
// shell answers at the mount and at a deep link under it with the mount as
// its base and the configuration's API base, public WebSocket URL, stream,
// and token; the asset answers as one; and the probes, the API, and a miss
// inside the API and admin mounts answer as they do without the app.
func TestClient_Mounts(t *testing.T) {
	cases := []struct {
		mount, href string
		// outside is a path beyond the app's mount and every other one: the
		// router's own 404 under a prefix, the shell at the root.
		outside string
		shell   bool
	}{
		{mount: "/app", href: "/app/", outside: "/elsewhere", shell: false},
		{mount: "/", href: "/", outside: "/elsewhere", shell: true},
	}
	for _, tc := range cases {
		t.Run(tc.mount, func(t *testing.T) {
			cfg := configtest.Config(t)
			cfg.App.Mount = tc.mount
			r := start(t, cfg)
			addr := waitForReady(t, r.log)

			for _, path := range []string{tc.href, tc.href + "runs/42"} {
				code, header, body := get(t, addr, path)
				if code != http.StatusOK || !isShell(body) {
					t.Fatalf("GET %s = %d %q, want the shell", path, code, body)
				}
				if cc := header.Get("Cache-Control"); cc != "no-cache" {
					t.Errorf("GET %s Cache-Control = %q, want no-cache", path, cc)
				}
				if m := baseHref.FindStringSubmatch(body); m == nil || m[1] != tc.href {
					t.Errorf("GET %s base href = %v, want %q", path, m, tc.href)
				}
				m := configContent.FindStringSubmatch(body)
				if m == nil {
					t.Fatalf("GET %s: no config element in %q", path, body)
				}
				var got shellConfig
				if err := json.Unmarshal([]byte(m[1]), &got); err != nil {
					t.Fatalf("decode the config %q: %v", m[1], err)
				}
				if got.APIBase != "/api" ||
					got.NATS.URL != cfg.NATS.WebSocket.PublicURL ||
					got.NATS.Stream != cfg.NATS.Stream ||
					got.NATS.Token != configtest.Token {
					t.Errorf("config = %+v, want /api and the nats block's %s, %s, and token", got, cfg.NATS.WebSocket.PublicURL, cfg.NATS.Stream)
				}
			}

			asset := tc.href + "assets/main-test.js"
			if code, header, body := get(t, addr, asset); code != http.StatusOK || body != "export {}" ||
				header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
				t.Errorf("GET %s = %d %q, Cache-Control %q; want the immutable asset", asset, code, body, header.Get("Cache-Control"))
			}
			if code, header, _ := get(t, addr, tc.href+"assets/gone.js"); !isProblem(code, header, http.StatusNotFound) {
				t.Errorf("GET %sassets/gone.js = %d %s, want a 404 problem", tc.href, code, header.Get("Content-Type"))
			}

			for _, probe := range []string{web.HealthPath, web.ReadyPath} {
				if code, _, body := get(t, addr, probe); code != http.StatusOK || isShell(body) {
					t.Errorf("GET %s = %d %q, want the probe", probe, code, body)
				}
			}
			if code, header, body := get(t, addr, "/api/documents"); code != http.StatusOK ||
				!strings.HasPrefix(header.Get("Content-Type"), "application/json") {
				t.Errorf("GET /api/documents = %d %s %q, want the API's list", code, header.Get("Content-Type"), body)
			}
			for _, miss := range []string{"/api/nothing", "/admin/nothing"} {
				if code, header, _ := get(t, addr, miss); !isProblem(code, header, http.StatusNotFound) {
					t.Errorf("GET %s = %d %s, want its mount's 404 problem, not the shell", miss, code, header.Get("Content-Type"))
				}
			}

			code, header, body := get(t, addr, tc.outside)
			if tc.shell != isShell(body) {
				t.Errorf("GET %s = %d %q, want the shell: %t", tc.outside, code, body, tc.shell)
			}
			if !tc.shell && !isProblem(code, header, http.StatusNotFound) {
				t.Errorf("GET %s = %d %s, want the router's 404 problem", tc.outside, code, header.Get("Content-Type"))
			}
		})
	}
}

// A build with no manifest fails the client node, so the Build fails: Run
// returns 1 and logs the failure naming the node and the missing manifest,
// and never reports ready. This is the binary built with no web build.
func TestClient_MissingBuildFailsRun(t *testing.T) {
	var log syncBuffer
	a := newApp(t, configtest.Config(t), &log)
	withMemoryBroker(a)
	a.Graph().Replace(a.Nodes().Dist, func(*graph.Scope) (fs.FS, error) {
		return fstest.MapFS{".gitkeep": {}}, nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := a.Run(ctx); code != 1 {
		t.Errorf("Run = %d, want 1", code)
	}
	out := log.String()
	failure := regexp.MustCompile(`msg="service failed" error="[^"]*client[^"]*\.vite/manifest\.json`)
	if !failure.MatchString(out) {
		t.Errorf("log = %q, want a service failure naming the client node and the manifest", out)
	}
	if strings.Contains(out, "server ready") {
		t.Errorf("log = %q, want no ready record", out)
	}
}
