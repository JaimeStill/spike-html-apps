package sdk

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/standards-lab/go-web-sdk"
)

// ManifestPath is where Vite writes its build manifest (build.manifest:
// true) inside the build's output directory.
const ManifestPath = ".vite/manifest.json"

// ConfigElementID is the id of the <script type="application/json"> element
// the shell writes the client's configuration into, the element the client
// reads at start.
const ConfigElementID = "app-config"

// The Cache-Control values the client handler sends. A hashed asset's name
// changes with its content, so a browser may keep it for a year and never
// revalidate it. The shell and a build file Vite did not hash, such as one
// copied from the app's public directory, keep their name across builds, so
// a browser revalidates them on every use: the shell names the current
// build's hashed entry, and a stale one would load the previous build.
const (
	cacheImmutable = "public, max-age=31536000, immutable"
	cacheNoCache   = "no-cache"
)

// ClientOptions configures [NewClient].
type ClientOptions struct {
	// Base is the path the client is served at, as the router mounts it:
	// "/" at the server's root, or a prefix such as "/app", with or without
	// its trailing slash. The shell writes it, with a trailing slash, as its
	// <base href>, against which the build's relative asset URLs (Vite's
	// base "./") and the client's router resolve.
	Base string
	// Title is the shell's <title>.
	Title string
	// Entry is the manifest key of the client's entry, its source path
	// relative to Vite's root, such as "src/main.ts".
	Entry string
	// Config is the value the shell writes, JSON-encoded, as the content of
	// its #app-config element; nil writes null.
	Config any
}

// NewClient returns the handler that serves a client application from its
// Vite build, dist: the build's output directory, holding the manifest at
// [ManifestPath] and the files it names. It reads and checks the manifest
// once, here, and renders the shell once; it fails, naming the problem, when
// Base is malformed, the manifest is missing or unreadable, or it has no
// Entry key.
//
// The handler answers only GET and HEAD; any other method is a 405 problem
// with Allow: GET, HEAD. A request path resolves, after path.Clean, to one
// of three answers:
//
//   - An asset: a file in dist, other than a dotfile or a file under a dot
//     directory (the manifest's .vite/ among them), which are never served.
//     It answers the file's bytes with the Content-Type of its extension. A
//     file under a directory the manifest's files live in (Vite's assets/)
//     is hashed, and is cached as immutable for a year; any other is
//     revalidated on every use (no-cache).
//   - A missing asset: a path under one of those directories, a dotfile
//     path, or a path whose last segment has an extension, with no file
//     behind it. It answers a 404 problem, never the shell, so a stale
//     page's import fails visibly instead of parsing HTML as a module.
//   - A client route: every other path. It answers the shell, so a deep
//     link or a reload reaches the client's router. The shell is HTML,
//     revalidated on every use (no-cache).
//
// Under a prefix, the handler is mounted with go-web-sdk's NewHandlerModule,
// which strips the prefix before the handler sees the path; the bare prefix,
// which the strip leaves empty, is redirected (301) to Base with its
// trailing slash, where relative URLs resolve inside the mount. At the root,
// it is the router's not-found handler, so it answers only what no module
// and no native route claims. Either way the problem's instance is the path
// the browser asked for: Base joined with the path the handler sees.
func NewClient(dist fs.FS, opts ClientOptions) (http.Handler, error) {
	base, err := clientBase(opts.Base)
	if err != nil {
		return nil, err
	}
	manifest, err := readManifest(dist)
	if err != nil {
		return nil, err
	}
	shell, err := renderShell(manifest, base, opts)
	if err != nil {
		return nil, err
	}
	return &client{
		dist:   dist,
		base:   base,
		hashed: manifest.dirs(),
		shell:  shell,
	}, nil
}

// clientBase returns base with exactly one trailing slash, the shell's
// <base href>, or fails when it is not an absolute path.
func clientBase(base string) (string, error) {
	if !strings.HasPrefix(base, "/") {
		return "", fmt.Errorf("sdk: NewClient: base %q must begin with '/'", base)
	}
	// The root is "/" alone; any other base cleans to itself without its
	// one trailing slash, which "//" and "/app//" do not.
	prefix := strings.TrimSuffix(base, "/")
	clean := base == "/" || prefix != "/" && path.Clean(base) == prefix
	if strings.ContainsAny(base, "?#") || !clean {
		return "", fmt.Errorf("sdk: NewClient: base %q must be a clean path with no query or fragment", base)
	}
	return prefix + "/", nil
}

// chunk is one entry of Vite's build manifest: a source module's output
// file, the CSS it pulls in, and the keys of the chunks it imports
// statically. Dynamic imports are left out: the browser loads those when the
// module asks, and the shell names nothing for them.
type chunk struct {
	File    string   `json:"file"`
	CSS     []string `json:"css"`
	Imports []string `json:"imports"`
}

// manifest is Vite's build manifest, keyed by source path.
type manifest map[string]chunk

// readManifest reads and decodes dist's manifest.
func readManifest(dist fs.FS) (manifest, error) {
	data, err := fs.ReadFile(dist, ManifestPath)
	if err != nil {
		return nil, fmt.Errorf("sdk: NewClient: read the build's manifest %s (is the app built?): %w", ManifestPath, err)
	}
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("sdk: NewClient: decode the build's manifest %s: %w", ManifestPath, err)
	}
	return m, nil
}

// dirs returns the directories the manifest's files live in, Vite's
// build.assetsDir: the directories of hashed files.
func (m manifest) dirs() []string {
	var dirs []string
	for _, c := range m {
		for _, f := range append([]string{c.File}, c.CSS...) {
			if d := path.Dir(f); d != "." && !slices.Contains(dirs, d) {
				dirs = append(dirs, d)
			}
		}
	}
	return dirs
}

// entry resolves key's chunk: its file, the files of the chunks it imports
// statically, transitively, for modulepreload links, and the CSS of it and
// every one of those chunks, each once and in import order.
func (m manifest) entry(key string) (file string, preload, css []string, err error) {
	root, ok := m[key]
	if !ok || root.File == "" {
		return "", nil, nil, fmt.Errorf("sdk: NewClient: the build's manifest %s has no entry %q", ManifestPath, key)
	}
	seen := map[string]bool{key: true}
	var walk func(c chunk)
	walk = func(c chunk) {
		for _, f := range c.CSS {
			if !slices.Contains(css, f) {
				css = append(css, f)
			}
		}
		for _, k := range c.Imports {
			if seen[k] {
				continue
			}
			seen[k] = true
			imported := m[k]
			preload = append(preload, imported.File)
			walk(imported)
		}
	}
	walk(root)
	return root.File, preload, css, nil
}

// shellTemplate is the client's HTML shell. html/template escapes the base
// and title as an attribute and as text, and the asset paths as URLs; the
// config arrives as template.JS, already JSON that json.Marshal has escaped
// for HTML (<, >, and & as <, >, and &), so its text can
// never close the script element, and is written as it is. The asset paths
// are relative, resolved against <base href>. The body is empty: the client
// appends its own content.
var shellTemplate = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="{{.Base}}">
<title>{{.Title}}</title>
{{- range .CSS}}
<link rel="stylesheet" href="{{.}}">
{{- end}}
{{- range .Preload}}
<link rel="modulepreload" href="{{.}}">
{{- end}}
<script type="application/json" id="` + ConfigElementID + `">{{.Config}}</script>
<script type="module" src="{{.Entry}}"></script>
</head>
<body></body>
</html>
`))

// renderShell renders the shell for opts against m, once.
func renderShell(m manifest, base string, opts ClientOptions) ([]byte, error) {
	file, preload, css, err := m.entry(opts.Entry)
	if err != nil {
		return nil, err
	}
	config, err := json.Marshal(opts.Config)
	if err != nil {
		return nil, fmt.Errorf("sdk: NewClient: encode the config: %w", err)
	}
	var buf bytes.Buffer
	err = shellTemplate.Execute(&buf, struct {
		Base, Title, Entry string
		CSS, Preload       []string
		Config             template.JS
	}{base, opts.Title, file, css, preload, template.JS(config)})
	if err != nil {
		return nil, fmt.Errorf("sdk: NewClient: render the shell: %w", err)
	}
	return buf.Bytes(), nil
}

// client is NewClient's handler.
type client struct {
	dist   fs.FS
	base   string   // the <base href>, with its trailing slash
	hashed []string // the directories of hashed files
	shell  []byte
}

func (c *client) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		c.problem(w, r, http.StatusMethodNotAllowed, "the client answers only GET and HEAD")
		return
	}
	// Only the bare prefix, stripped by NewHandlerModule, arrives empty.
	if r.URL.Path == "" {
		target := c.base
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}

	// Cleaned as a rooted path, so ".." never climbs out of the build;
	// the root itself, "", is a client route.
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		c.serveShell(w, r)
		return
	}
	hidden := slices.ContainsFunc(strings.Split(name, "/"), func(s string) bool {
		return strings.HasPrefix(s, ".")
	})
	if !hidden {
		if data, err := fs.ReadFile(c.dist, name); err == nil {
			c.serveAsset(w, r, name, data)
			return
		}
	}
	if hidden || c.underHashed(name) || path.Ext(name) != "" {
		c.problem(w, r, http.StatusNotFound, "no asset "+name+" in the client's build")
		return
	}
	c.serveShell(w, r)
}

// underHashed reports whether name lies under a directory of hashed files.
func (c *client) underHashed(name string) bool {
	return slices.ContainsFunc(c.hashed, func(d string) bool {
		return strings.HasPrefix(name, d+"/")
	})
}

// serveShell answers the shell. http.ServeContent writes its Content-Type
// and Content-Length and leaves the body off a HEAD.
func (c *client) serveShell(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", cacheNoCache)
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(c.shell))
}

// serveAsset answers a build file's bytes, typed by its extension (a file
// with an unknown one is sniffed), with Range and HEAD handled by
// http.ServeContent. An embedded file has no modification time, so no
// Last-Modified is sent.
func (c *client) serveAsset(w http.ResponseWriter, r *http.Request, name string, data []byte) {
	cache := cacheNoCache
	if c.underHashed(name) {
		cache = cacheImmutable
	}
	w.Header().Set("Cache-Control", cache)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

// problem writes status's problem, its instance the path the browser asked
// for: the base joined with the path the handler sees, which a prefix
// module has stripped.
func (c *client) problem(w http.ResponseWriter, r *http.Request, status int, detail string) {
	instance := strings.TrimSuffix(c.base, "/") + r.URL.Path
	_ = web.Problem{Status: status, Detail: detail, Instance: instance}.WriteFor(w, r)
}
