package app

import "github.com/standards-lab/go-core/graph"

// AppendReactor appends r to a's Nodes.Reactors, as defineReactors does for
// a reactor it defines, so a test can add a fixture reactor the template
// itself does not define. It must be called before Run: newServer and Run
// read the reactors when Run builds, and App.Nodes returns a copy no test
// can append to.
func AppendReactor(a *App, r graph.Ref) {
	a.nodes.Reactors = append(a.nodes.Reactors, r)
}
