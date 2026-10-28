package app

import (
	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-web-sdk"
	mw "github.com/standards-lab/go-web-sdk/middleware"

	"github.com/JaimeStill/spike-html-apps/sdk"
)

// middleware declares the router-level stack, outermost first. It reads
// infrastructure nodes only: request logging, and cross-cutting concerns
// like it, need infrastructure primitives, not domain services. A
// middleware that has to reach a domain service is domain logic, and
// belongs in a route or a reactor instead.
//
// RequestID runs ahead of RequestLogger, so the log record carries the
// request id. Recoverer turns a handler's panic into a logged 500, which
// RequestLogger records with its status; it works on either side of
// RequestLogger, and the template places it inside. A
// BodyLimit, when a service adds one, goes ahead of RequestLogger and
// Recoverer; the chain order in go-web-sdk's middleware package
// documentation states why.
//
// CORS runs inside RequestLogger, so a preflight it answers, which never
// reaches a route, still leaves a record with its request id, and ahead of
// every mount, so it answers the preflight for any path, the probes' and an
// unrouted one's included, before a route's method matching could refuse
// the OPTIONS. Its origins are the config node's cors block, the one list the
// service admits browser clients from.
func middleware(s *graph.Scope, n *Nodes) []web.Middleware {
	logger := s.Use(n.Logger)
	return []web.Middleware{
		mw.RequestID(),
		mw.RequestLogger(logger),
		sdk.CORS(s.Use(n.Config).CORS.AllowedOrigins),
		mw.Recoverer(logger),
	}
}
