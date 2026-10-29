package app

import (
	"time"

	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-core/reactor"
)

// defineReactors defines the reactors on g into n: the entry points that
// run for the process lifetime, driven by an occurrence (a subscription, an
// interval, a wake on demand) rather than a caller, the inbound counterpart
// to a route. A reactor often dispatches each occurrence to a domain service
// call, but need not. Each reactor is its own node, a lifecycle participant
// whose constructor Uses the infrastructure nodes for the transport
// connection it owns and the domain nodes it dispatches to, the two halves
// a reactor joins. The node's value is a go-core reactor.Reactor, which
// reactor.New returns over a Source and a handler. The Source is
// reactor.Every for a plain interval, or reactor.Wake for an interval that a
// nudge can also trigger. The reactor.CancelWithin option derives from the
// shutdown timeout how long a drain lets the handling in flight run before
// it cancels it. The lifecycle Coordinator infers from the value's methods that
// the reactor starts with its layer, drains before the nodes it uses, joins
// the readiness probe under its node's name, and ends the run on its
// failure, with no registration here. No node Uses a reactor, so each is
// appended to n.Reactors, which Run builds as roots and the server orders
// itself after.
//
// The emulator runs one: runner, which advances every run whose next stage
// is due.
func defineReactors(g *graph.Graph, n *Nodes) {
	n.Runner = g.Define("runner", newRunner(n))
	n.Reactors = append(n.Reactors, n.Runner)
}

// newRunner constructs the reactor that advances the runs: the runs node's
// Advance over its Ticks, an interval the run layer's Start nudges. It Uses
// the runs node, which Uses the broker node, so it sits above the broker:
// it drains first, its last pass finishing before the broker stops, and
// nothing publishes after it. A pass still running at half the shutdown
// timeout is cancelled.
func newRunner(n *Nodes) func(*graph.Scope) (*reactor.Reactor[time.Time], error) {
	return func(s *graph.Scope) (*reactor.Reactor[time.Time], error) {
		runs := s.Use(n.Runs)
		return reactor.New(runs.Ticks(), runs.Advance,
			reactor.CancelWithin(s.Use(n.Config).ShutdownTimeout.Duration())), nil
	}
}
