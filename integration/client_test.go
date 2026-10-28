//go:build integration

package integration_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/integration"
)

// fetch GETs url and returns the status, header, and body.
func fetch(t *testing.T, url string) (int, http.Header, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s: %v", url, err)
	}
	return resp.StatusCode, resp.Header, string(body)
}

// The binary serves the pipeline app's real build, the one build:app wrote
// and the binary embedded, at the default /app and at the root: the shell
// names the manifest's entry under the mount's base, the entry answers as
// an immutable JavaScript asset, and the probes still answer.
func TestClient_ServesTheBuild(t *testing.T) {
	entry := integration.Manifest(t)["src/main.ts"].File
	if entry == "" {
		t.Fatal("the build's manifest has no src/main.ts entry")
	}
	for mount, href := range map[string]string{"/app": "/app/", "/": "/"} {
		t.Run(mount, func(t *testing.T) {
			s := integration.Start(t, integration.Options{Env: []string{"EMULATOR_APP_MOUNT=" + mount}})

			code, _, body := fetch(t, s.URL()+href+"about")
			if code != http.StatusOK ||
				!strings.Contains(body, `<base href="`+href+`">`) ||
				!strings.Contains(body, `<script type="module" src="`+entry+`">`) ||
				!strings.Contains(body, `"url":"`+s.WebSocketURL()+`"`) {
				t.Errorf("GET %sabout = %d %q, want the shell at base %s naming %s and the WebSocket URL %s", href, code, body, href, entry, s.WebSocketURL())
			}

			code, header, _ := fetch(t, s.URL()+href+entry)
			if code != http.StatusOK ||
				header.Get("Content-Type") != "text/javascript; charset=utf-8" ||
				header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
				t.Errorf("GET %s%s = %d %s %s, want the immutable JavaScript asset", href, entry, code, header.Get("Content-Type"), header.Get("Cache-Control"))
			}

			if code, _, _ := fetch(t, s.URL()+web.ReadyPath); code != http.StatusOK {
				t.Errorf("GET %s = %d, want 200", web.ReadyPath, code)
			}
			if code := s.Stop(t); code != 0 {
				t.Errorf("exit = %d, want 0:\n%s", code, s.Output())
			}
		})
	}
}

// A binary compiled with no web build, the placeholder alone in the
// embedded directory, refuses to start: it exits 1, logging the failure
// with the missing manifest, and never reports ready.
func TestClient_NoBuildRefusesToStart(t *testing.T) {
	code, out := integration.RunBinary(t, integration.BuildWithoutApp(t), integration.Options{})
	if code != 1 {
		t.Errorf("exit = %d, want 1:\n%s", code, out)
	}
	if !strings.Contains(out, `msg="service failed"`) || !strings.Contains(out, ".vite/manifest.json") {
		t.Errorf("output lacks the failure naming the manifest:\n%s", out)
	}
	if strings.Contains(out, "server ready") {
		t.Errorf("output reports ready:\n%s", out)
	}
}
