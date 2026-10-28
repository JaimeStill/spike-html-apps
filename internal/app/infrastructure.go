package app

import (
	"io"
	"log/slog"

	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-core/logging"

	"github.com/JaimeStill/spike-html-apps/internal/config"
)

// defineInfrastructure defines the infrastructure nodes on g into n: the
// configuration cfg, and the services the application is composed on,
// built from it — the logger, written to w, in the template baseline; a
// database pool, storage, or auth client as a service grows, each its own
// node. It constructs nothing. A service whose value implements
// lifecycle.Subsystem takes part in startup and shutdown through its own
// methods, and its constructor opens nothing: connectivity belongs to its
// Start, so a failed Build leaks no connections.
func defineInfrastructure(g *graph.Graph, n *Nodes, cfg *config.Config, w io.Writer) {
	n.Config = g.Define("config", func(*graph.Scope) (*config.Config, error) {
		return cfg, nil
	})
	n.Logger = g.Define("logger", newLogger(n, w))
}

// newLogger constructs the service's logger over w from the config node's
// log block.
func newLogger(n *Nodes, w io.Writer) func(*graph.Scope) (*slog.Logger, error) {
	return func(s *graph.Scope) (*slog.Logger, error) {
		return logging.New(w, s.Use(n.Config).Log), nil
	}
}
