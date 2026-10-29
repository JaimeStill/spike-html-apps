package app_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"maps"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-core/reactor"
	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/internal/app"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// This file pins the graph's one structural property the composition root
// owns: the server is alone in the top layer. What that position buys at
// run time — startup in layer order, readiness held until every check
// passes, the server's runtime error watched as Monitored, and the drain in
// reverse layer order — is pinned in go-core's lifecycle tests and
// go-web-sdk's health and server tests, not here. Unlike app_test.go, these
// tests name nodes: they reach the graph through App.Graph and App.Nodes, as
// does the Build-failure case, which substitutes a failing constructor.

// buildAsRun builds a's graph from the roots Run builds from, the config,
// the logger, the broker, the server, and the reactors, plus extra. TestGraph_
// ServerAloneInTopLayer holds these roots to Run's by observing a real Run.
func buildAsRun(t *testing.T, a *app.App, extra ...graph.Ref) *graph.System {
	t.Helper()
	n := a.Nodes()
	roots := append([]graph.Ref{n.Config, n.Logger, n.Broker, n.Server}, n.Reactors...)
	sys, err := a.Graph().Build(append(roots, extra...)...)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	return sys
}

// serverAloneOnTop reports whether the System's last layer holds the server
// node alone, and returns that layer.
func serverAloneOnTop(sys *graph.System, n app.Nodes) ([]graph.Dependency, bool) {
	layers := sys.Layers()
	if len(layers) == 0 {
		return nil, false
	}
	top := layers[len(layers)-1]
	alone := len(top) == 1 &&
		top[0].Name == n.Server.Name() &&
		top[0].Value == any(sys.Get(n.Server))
	return top, alone
}

// The server is the only node in the top layer of the graph Run builds, so
// it starts after every other node and drains first. A node defined above
// it, or beside it at the top, fails here; the second case shows the check
// catches one.
func TestGraph_ServerAloneInTopLayer(t *testing.T) {
	t.Run("as defined", func(t *testing.T) {
		a := newApp(t, configtest.Config(t), io.Discard)

		// Run's own Build, observed, so the Build below inspects the nodes
		// Run reaches rather than a set this test chose.
		ran := map[string]bool{}
		a.Graph().Observe(func(name string) { ran[name] = true })
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if code := a.Run(ctx); code != 0 {
			t.Fatalf("Run = %d, want 0", code)
		}
		ranNames := slices.Sorted(maps.Keys(ran))

		sys := buildAsRun(t, a)
		var built []string
		for _, layer := range sys.Layers() {
			built = append(built, names(layer)...)
		}
		if slices.Sort(built); !slices.Equal(built, ranNames) {
			t.Fatalf("buildAsRun built %v, Run built %v; their roots differ", built, ranNames)
		}
		if top, ok := serverAloneOnTop(sys, a.Nodes()); !ok {
			t.Errorf("top layer = %+v, want the server node alone", names(top))
		}
	})

	t.Run("a node above the server", func(t *testing.T) {
		a := newApp(t, configtest.Config(t), io.Discard)
		n := a.Nodes()
		above := a.Graph().Define("above", func(s *graph.Scope) (*web.Server, error) {
			return s.Use(n.Server), nil
		})
		sys := buildAsRun(t, a, above)
		if top, ok := serverAloneOnTop(sys, n); ok {
			t.Errorf("top layer = %+v, reported the server alone with a node above it", names(top))
		}
	})
}

// A reactor is reached by no Use, so Run builds it as a root, and the
// server orders itself after each reactor, so the server stays alone in the
// top layer above it. The emulator's own reactor, runner, Uses the runs
// node, low in the graph, so it would sit below the server regardless, and
// the test could not fail; the fixture, added through the test-only
// AppendReactor hook, orders itself after the router instead, which puts it
// in the server's layer unless the server orders itself after it. Its
// interval is an hour, so it never ticks while the test runs.
func TestGraph_ServerAboveReactor(t *testing.T) {
	a := newApp(t, configtest.Config(t), io.Discard)
	n := a.Nodes()
	fixture := a.Graph().Define("fixture", func(s *graph.Scope) (*reactor.Reactor[time.Time], error) {
		s.After(n.Router)
		return reactor.New(reactor.Every(time.Hour), func(context.Context, time.Time) error {
			return nil
		}), nil
	})
	app.AppendReactor(a, fixture)

	// Run's own Build, observed, shows Run builds the reactor as a root:
	// no node Uses it, so nothing else would reach it. The context ends
	// before startup, so the Run starts nothing.
	ran := map[string]bool{}
	a.Graph().Observe(func(name string) { ran[name] = true })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := a.Run(ctx); code != 0 {
		t.Fatalf("Run = %d, want 0", code)
	}
	if !ran[fixture.Name()] {
		t.Fatalf("Run built %v, want the reactor %q among them", slices.Sorted(maps.Keys(ran)), fixture.Name())
	}

	sys := buildAsRun(t, a)
	if top, ok := serverAloneOnTop(sys, a.Nodes()); !ok {
		t.Errorf("top layer = %+v, want the server node alone above the reactor", names(top))
	}
	if r, s := layerOf(sys, fixture.Name()), layerOf(sys, n.Server.Name()); r < 0 || r >= s {
		t.Errorf("reactor in layer %d, server in layer %d; want the reactor below the server", r, s)
	}
}

// layerOf returns the index of the layer holding the node named name, or -1.
func layerOf(sys *graph.System, name string) int {
	for i, layer := range sys.Layers() {
		for _, d := range layer {
			if d.Name == name {
				return i
			}
		}
	}
	return -1
}

// names lists the layer's node names.
func names(layer []graph.Dependency) []string {
	out := make([]string, len(layer))
	for i, d := range layer {
		out[i] = d.Name
	}
	return out
}

// A constructor's error fails Run's Build: Run returns 1 and logs the
// failure, labelled with the failing node's name, through a logger of its
// own, since the node that failed may be the logger itself. Nothing reports
// ready.
func TestRun_BuildFailureExitsOne(t *testing.T) {
	var log syncBuffer
	a := newApp(t, configtest.Config(t), &log)
	a.Graph().Replace(a.Nodes().Logger, func(*graph.Scope) (*slog.Logger, error) {
		return nil, errors.New("logger unavailable")
	})

	// Cancelled up front, so a Build that wrongly succeeds drains at once
	// and fails the exit-code check instead of hanging.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := a.Run(ctx); code != 1 {
		t.Errorf("Run = %d, want 1", code)
	}
	out := log.String()
	failure := regexp.MustCompile(`msg="service failed" error="[^"]*logger[^"]*logger unavailable`)
	if !failure.MatchString(out) {
		t.Errorf("log = %q, want a service failure naming the logger node and its error", out)
	}
	if strings.Contains(out, "server ready") {
		t.Errorf("log = %q, want no ready record", out)
	}
}
