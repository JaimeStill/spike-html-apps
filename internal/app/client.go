package app

import (
	"io/fs"
	"net/http"

	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/apps/pipeline"
	"github.com/JaimeStill/spike-html-apps/sdk"
)

// clientTitle is the pipeline app's page title.
const clientTitle = "Pipeline emulator"

// clientConfig is the configuration the pipeline app's shell writes into
// its #app-config element, the AppConfig the app reads at start
// (apps/pipeline/src/config.ts): where the API is, and how to reach the
// event stream over the embedded NATS server's WebSocket listener with its
// static token. Every member is written; the browser reads it, so it holds
// nothing the browser may not see.
type clientConfig struct {
	// APIBase is the API mount, an absolute path the app resolves against
	// the page's origin.
	APIBase string           `json:"apiBase"`
	NATS    clientNATSConfig `json:"nats"`
}

type clientNATSConfig struct {
	URL    string `json:"url"`
	Stream string `json:"stream"`
	Token  string `json:"token"`
}

// defineClient defines the pipeline app on g into n: the build it is
// served from, the embedded apps/pipeline/dist, as its own node so the unit
// tier can Replace it with a fixture build, and the handler that serves it.
// It constructs nothing.
func defineClient(g *graph.Graph, n *Nodes) {
	n.Dist = g.Define("dist", func(*graph.Scope) (fs.FS, error) {
		return pipeline.Dist(), nil
	})
	n.Client = g.Define("client", newClient(n))
}

// newClient constructs the pipeline app's handler over the dist node's
// build, at the app block's mount, with the shell's config from the config
// node: the API mount, and the nats block's public WebSocket URL, stream,
// and token. A build with no manifest, or one without the app's entry,
// fails here, so the Build fails and the service refuses to start, naming
// the problem.
func newClient(n *Nodes) func(*graph.Scope) (http.Handler, error) {
	return func(s *graph.Scope) (http.Handler, error) {
		cfg := s.Use(n.Config)
		return sdk.NewClient(s.Use(n.Dist), sdk.ClientOptions{
			Base:  cfg.App.Mount,
			Title: clientTitle,
			Entry: pipeline.Entry,
			Config: clientConfig{
				APIBase: apiMount,
				NATS: clientNATSConfig{
					URL:    cfg.NATS.WebSocket.PublicURL,
					Stream: cfg.NATS.Stream,
					Token:  cfg.NATS.Token,
				},
			},
		})
	}
}

// mountClient mounts the client node's handler on router at the app block's
// mount. Under a prefix it is a handler module, which strips the prefix and
// takes the longest-prefix match like every other module. At the root,
// where go-web-sdk takes no module, it is the router's not-found handler,
// so it answers only a request no module and no native route claims: the
// API, the admin mount, and the probes answer as before. Neither way runs
// middleware of its own; the router's stack wraps it.
func mountClient(router *web.Router, s *graph.Scope, n *Nodes) {
	client := s.Use(n.Client)
	if mount := s.Use(n.Config).App; mount.AtRoot() {
		router.SetNotFound(client)
	} else {
		router.Mount(web.NewHandlerModule(mount.Mount, client))
	}
}
