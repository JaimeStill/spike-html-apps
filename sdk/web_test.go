package sdk_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/sdk"
)

// build is a Vite build as NewClient reads it: a manifest whose entry
// imports a shared chunk statically and a route dynamically, the entry and
// the shared chunk each pulling in CSS, and a file copied from a public
// directory, which Vite does not hash.
func build() fstest.MapFS {
	return fstest.MapFS{
		".vite/manifest.json": {Data: []byte(`{
			"src/main.ts": {
				"file": "assets/main-abc.js", "src": "src/main.ts", "isEntry": true,
				"css": ["assets/main-abc.css"],
				"imports": ["_shared-def.js"],
				"dynamicImports": ["src/about.ts"]
			},
			"_shared-def.js": {"file": "assets/shared-def.js", "css": ["assets/shared-def.css"]},
			"src/about.ts": {"file": "assets/about-ghi.js", "isDynamicEntry": true, "css": ["assets/about-ghi.css"]}
		}`)},
		"assets/main-abc.js":   {Data: []byte("console.log('main')")},
		"assets/main-abc.css":  {Data: []byte("body{}")},
		"assets/shared-def.js": {Data: []byte("export {}")},
		"assets/about-ghi.js":  {Data: []byte("export {}")},
		"favicon.svg":          {Data: []byte("<svg/>")},
		".gitkeep":             {Data: nil},
	}
}

// pipelineConfig stands in for the shell config the emulator writes.
type pipelineConfig struct {
	APIBase string `json:"apiBase"`
	Token   string `json:"token"`
}

func options(base string) sdk.ClientOptions {
	return sdk.ClientOptions{
		Base:   base,
		Title:  "Pipeline <emulator>",
		Entry:  "src/main.ts",
		Config: pipelineConfig{APIBase: "/api", Token: "t"},
	}
}

// newClient builds the handler over build() at base, failing the test on
// an error.
func newClient(t *testing.T, base string) http.Handler {
	t.Helper()
	h, err := sdk.NewClient(build(), options(base))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return h
}

func serve(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

// assertProblem fails unless rec is status's problem document, its
// instance the given path.
func assertProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, instance string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body %q", rec.Code, status, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != web.ProblemMediaType {
		t.Errorf("Content-Type = %q, want %s", ct, web.ProblemMediaType)
	}
	var p web.Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode problem %q: %v", rec.Body.String(), err)
	}
	if p.Status != status || p.Instance != instance {
		t.Errorf("problem = %+v, want status %d at instance %q", p, status, instance)
	}
}

func TestNewClient_FailsNamingTheProblem(t *testing.T) {
	noManifest := build()
	delete(noManifest, ".vite/manifest.json")
	badManifest := build()
	badManifest[".vite/manifest.json"] = &fstest.MapFile{Data: []byte("{")}

	cases := map[string]struct {
		dist fstest.MapFS
		opts sdk.ClientOptions
		want string
	}{
		"missing manifest": {noManifest, options("/app"), ".vite/manifest.json"},
		"corrupt manifest": {badManifest, options("/app"), "decode the build's manifest"},
		"missing entry":    {build(), sdk.ClientOptions{Base: "/app", Entry: "src/index.ts"}, `no entry "src/index.ts"`},
		"relative base":    {build(), sdk.ClientOptions{Base: "app", Entry: "src/main.ts"}, `base "app"`},
		"empty base":       {build(), sdk.ClientOptions{Entry: "src/main.ts"}, `base ""`},
		"double slash":     {build(), sdk.ClientOptions{Base: "//", Entry: "src/main.ts"}, `base "//"`},
		"unclean base":     {build(), sdk.ClientOptions{Base: "/a/../app", Entry: "src/main.ts"}, `base "/a/../app"`},
		"unencodable":      {build(), sdk.ClientOptions{Base: "/", Entry: "src/main.ts", Config: func() {}}, "encode the config"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h, err := sdk.NewClient(tc.dist, tc.opts)
			if err == nil {
				t.Fatalf("NewClient = %v, nil; want an error naming %q", h, tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want it to name %q", err, tc.want)
			}
		})
	}
}

// The shell, as every client route answers it: the base with its trailing
// slash, the title escaped as text, the CSS of the entry and of the chunk it
// imports statically but not of the dynamic route, a modulepreload for that
// chunk, the config as JSON in its element, and the entry as a module
// script. It is revalidated on every use.
func TestNewClient_Shell(t *testing.T) {
	for base, href := range map[string]string{"/app": "/app/", "/app/": "/app/", "/": "/"} {
		t.Run(base, func(t *testing.T) {
			rec := serve(newClient(t, base), http.MethodGet, "/")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
				t.Errorf("Content-Type = %q, want text/html; charset=utf-8", ct)
			}
			if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
				t.Errorf("Cache-Control = %q, want no-cache", cc)
			}
			body := rec.Body.String()
			for _, want := range []string{
				`<base href="` + href + `">`,
				`<title>Pipeline &lt;emulator&gt;</title>`,
				`<link rel="stylesheet" href="assets/main-abc.css">`,
				`<link rel="stylesheet" href="assets/shared-def.css">`,
				`<link rel="modulepreload" href="assets/shared-def.js">`,
				`<script type="application/json" id="app-config">{"apiBase":"/api","token":"t"}</script>`,
				`<script type="module" src="assets/main-abc.js"></script>`,
			} {
				if !strings.Contains(body, want) {
					t.Errorf("shell lacks %s:\n%s", want, body)
				}
			}
			if strings.Contains(body, "about-ghi") {
				t.Errorf("shell names the dynamic import's files:\n%s", body)
			}
		})
	}
}

// configElement matches the config element's content.
var configElement = regexp.MustCompile(`(?s)<script type="application/json" id="app-config">(.*?)</script>`)

// A config value carrying a closing script tag, a comment opener, and an
// ampersand cannot end the element early: the first </script> after the
// element's opening tag is its own, and its content decodes back to the
// value.
func TestNewClient_ShellEscapesConfig(t *testing.T) {
	hostile := "</script><script>alert(1)</script><!-- & \u2028"
	opts := options("/")
	opts.Config = pipelineConfig{APIBase: hostile}
	h, err := sdk.NewClient(build(), opts)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	body := serve(h, http.MethodGet, "/").Body.String()

	m := configElement.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("no config element in the shell:\n%s", body)
	}
	var got pipelineConfig
	if err := json.Unmarshal([]byte(m[1]), &got); err != nil {
		t.Fatalf("config element %q: %v (the value broke out of the element)", m[1], err)
	}
	if got.APIBase != hostile {
		t.Errorf("config decodes to %q, want %q", got.APIBase, hostile)
	}
	if strings.Count(body, "<script") != 2 {
		t.Errorf("shell holds %d script elements, want 2:\n%s", strings.Count(body, "<script"), body)
	}
}

// Every path that names no file and isn't a missing asset is a client
// route, deep links and trailing slashes included, and answers the shell;
// so does a path that climbs with "..", cleaned inside the build.
func TestNewClient_ClientRoutesAnswerTheShell(t *testing.T) {
	h := newClient(t, "/app")
	want := serve(h, http.MethodGet, "/").Body.String()
	for _, path := range []string{"/about", "/runs/42/stages", "/about/", "/../../etc/passwd/x"} {
		rec := serve(h, http.MethodGet, path)
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Errorf("GET %s = %d %q, want the shell", path, rec.Code, rec.Body.String())
		}
	}
}

// A hashed asset answers its bytes, typed by extension, cached for a year
// as immutable; a build file Vite does not hash is revalidated instead.
func TestNewClient_Assets(t *testing.T) {
	h := newClient(t, "/app")
	cases := []struct{ path, body, ctype, cache string }{
		{"/assets/main-abc.js", "console.log('main')", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"},
		{"/assets/main-abc.css", "body{}", "text/css; charset=utf-8", "public, max-age=31536000, immutable"},
		{"/favicon.svg", "<svg/>", "image/svg+xml", "no-cache"},
	}
	for _, tc := range cases {
		rec := serve(h, http.MethodGet, tc.path)
		if rec.Code != http.StatusOK || rec.Body.String() != tc.body {
			t.Errorf("GET %s = %d %q, want 200 %q", tc.path, rec.Code, rec.Body.String(), tc.body)
		}
		if ct := rec.Header().Get("Content-Type"); ct != tc.ctype {
			t.Errorf("GET %s Content-Type = %q, want %q", tc.path, ct, tc.ctype)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != tc.cache {
			t.Errorf("GET %s Cache-Control = %q, want %q", tc.path, cc, tc.cache)
		}
	}
}

// A missing asset is a 404 problem, never the shell: a path under the
// hashed directory, a path with an extension, the manifest and every other
// dotfile, which exist but are never served. The instance names the path
// the browser asked for, the base included.
func TestNewClient_MissingAssetIsNotFound(t *testing.T) {
	h := newClient(t, "/app")
	for _, path := range []string{
		"/assets/main-old.js",
		"/assets/nested/route",
		"/robots.txt",
		"/runs/report.pdf",
		"/.vite/manifest.json",
		"/.gitkeep",
	} {
		t.Run(path, func(t *testing.T) {
			assertProblem(t, serve(h, http.MethodGet, path), http.StatusNotFound, "/app"+path)
		})
	}
}

// At the root the instance is the path itself.
func TestNewClient_MissingAssetAtTheRoot(t *testing.T) {
	assertProblem(t, serve(newClient(t, "/"), http.MethodGet, "/assets/gone.js"), http.StatusNotFound, "/assets/gone.js")
}

// HEAD answers the GET's status and headers with no body, for the shell
// and an asset alike.
func TestNewClient_Head(t *testing.T) {
	h := newClient(t, "/app")
	for _, path := range []string{"/about", "/assets/main-abc.js"} {
		get, head := serve(h, http.MethodGet, path), serve(h, http.MethodHead, path)
		if head.Code != http.StatusOK || head.Body.Len() != 0 {
			t.Errorf("HEAD %s = %d with %d body bytes, want 200 and none", path, head.Code, head.Body.Len())
		}
		for _, name := range []string{"Content-Type", "Content-Length", "Cache-Control"} {
			if g, hd := get.Header().Get(name), head.Header().Get(name); hd == "" || g != hd {
				t.Errorf("HEAD %s %s = %q, want the GET's %q", path, name, hd, g)
			}
		}
	}
}

// Any method but GET and HEAD is a 405 problem naming the two it takes.
func TestNewClient_OtherMethodsAreNotAllowed(t *testing.T) {
	h := newClient(t, "/app")
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions} {
		rec := serve(h, method, "/assets/main-abc.js")
		assertProblem(t, rec, http.StatusMethodNotAllowed, "/app/assets/main-abc.js")
		if allow := rec.Header().Get("Allow"); allow != "GET, HEAD" {
			t.Errorf("%s Allow = %q, want GET, HEAD", method, allow)
		}
	}
}

// Mounted under a prefix, the handler sees the stripped path; the bare
// prefix arrives empty and is redirected to the base with its trailing
// slash, its query kept.
func TestNewClient_UnderAPrefix(t *testing.T) {
	mounted := web.NewHandlerModule("/app", newClient(t, "/app"))

	rec := serve(mounted, http.MethodGet, "/app?x=1")
	if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != "/app/?x=1" {
		t.Errorf("GET /app = %d to %q, want 301 to /app/?x=1", rec.Code, rec.Header().Get("Location"))
	}
	if rec := serve(mounted, http.MethodGet, "/app/runs/1"); !strings.Contains(rec.Body.String(), `<base href="/app/">`) {
		t.Errorf("GET /app/runs/1 = %d %q, want the shell", rec.Code, rec.Body.String())
	}
	rec = serve(mounted, http.MethodGet, "/app/assets/main-abc.js")
	if body, _ := io.ReadAll(rec.Body); string(body) != "console.log('main')" {
		t.Errorf("GET /app/assets/main-abc.js = %d %q, want the asset", rec.Code, body)
	}
}
