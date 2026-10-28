package app_test

import (
	"context"
	"io"
	"maps"
	"slices"
	"testing"

	"github.com/JaimeStill/spike-html-apps/internal/app"
	"github.com/JaimeStill/spike-html-apps/internal/config/configtest"
)

// These tests pin the event transport's place in the graph. They build the
// graph, which constructs every node and starts none, so the embedded
// server never binds; what the server and broker do once started is the
// natsserver package's tests and the integration tier's.

// The broker sits in a layer above the embedded server, so the Coordinator
// starts the server before the broker connects, and drains the broker
// before the server stops.
func TestGraph_BrokerAboveNATS(t *testing.T) {
	a := newApp(t, configtest.Config(t), io.Discard)
	n := a.Nodes()
	sys := buildAsRun(t, a)
	if b, s := layerOf(sys, n.Broker.Name()), layerOf(sys, n.NATS.Name()); s < 0 || b <= s {
		t.Errorf("broker in layer %d, nats in layer %d; want the broker above the server", b, s)
	}
}

// The runner reactor sits in a layer above the broker, so it drains first:
// its last pass finishes before the broker stops, and nothing publishes
// after it.
func TestGraph_RunnerAboveBroker(t *testing.T) {
	a := newApp(t, configtest.Config(t), io.Discard)
	n := a.Nodes()
	sys := buildAsRun(t, a)
	if r, b := layerOf(sys, n.Runner.Name()), layerOf(sys, n.Broker.Name()); b < 0 || r <= b {
		t.Errorf("runner in layer %d, broker in layer %d; want the runner above the broker", r, b)
	}
}

// The unit tier's seam: with the broker node replaced by the in-memory
// broker, Run builds no embedded server, while the graph as New describes
// it does. The first half shows the check can tell the two apart.
func TestGraph_MemoryBrokerDropsEmbeddedServer(t *testing.T) {
	built := func(a *app.App) map[string]bool {
		ran := map[string]bool{}
		a.Graph().Observe(func(name string) { ran[name] = true })
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if code := a.Run(ctx); code != 0 {
			t.Fatalf("Run = %d, want 0", code)
		}
		return ran
	}

	described := newApp(t, configtest.Config(t), io.Discard)
	if ran := built(described); !ran[described.Nodes().NATS.Name()] {
		t.Fatalf("Run as described built %v, want the nats node among them", slices.Sorted(maps.Keys(ran)))
	}

	composed := newApp(t, configtest.Config(t), io.Discard)
	withMemoryBroker(composed)
	if ran := built(composed); ran[composed.Nodes().NATS.Name()] {
		t.Errorf("Run over the memory broker built %v, want no nats node", slices.Sorted(maps.Keys(ran)))
	}
}
