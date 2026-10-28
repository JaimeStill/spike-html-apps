package app

import (
	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-web-sdk"
)

// defineAdmin defines the administrative services on g into n, one node
// per admin domain: the administrative counterpart of the domain layer,
// each service administering one infrastructure service over the library
// mechanisms it triggers, and reading that service's node with Use. One
// that verifies and corrects the state of the infrastructure it
// administers is a lifecycle participant, its own node, which the domains
// that depend on that state Use. The template defines none; which services
// it composes follows the infrastructure the application adopts.
func defineAdmin(g *graph.Graph, n *Nodes) {}

// mountAdmin builds the admin mount, /admin, with each admin domain's route
// group mounted into it, its service and the logger for its error writer
// read with s.Use from n. The template ships the group initialized and
// empty. In production the mount belongs on its own listener, authenticated
// and unreachable from the public API's network path; that isolation is a
// design constraint the application settles when the first admin service
// arrives.
func mountAdmin(s *graph.Scope, n *Nodes) *web.Group {
	return web.NewGroup("/admin")
}
