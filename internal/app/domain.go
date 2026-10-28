package app

import (
	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-web-sdk"
)

// defineDomain defines the domain services on g into n, one node per
// domain layer. Domain services are defined in the module's base-layer
// domain packages, one package per layer under domain/, and each node's
// constructor builds its service from the infrastructure nodes it Uses,
// never from Nodes itself. Domain services own no resource and never run,
// so none is a lifecycle participant. A package that does own a resource
// and run belongs in infrastructure.go, if it is built once at startup, or
// reactors.go, if it reacts to an external occurrence for the life of the
// process. The template defines none; which services it composes is the
// application author's decision.
func defineDomain(g *graph.Graph, n *Nodes) {}

// mountAPI builds the API mount, /api, with each domain layer's route group
// mounted into it. Each handler is handed, at the construction site, its
// service and its policy from the config node (cfg.Reads.Limits() for a
// collection read) and the logger for its error writer
// (web.NewErrorWriter(logger, ...)), each read with s.Use from n. The
// template ships the group initialized and empty.
func mountAPI(s *graph.Scope, n *Nodes) *web.Group {
	return web.NewGroup("/api")
}
