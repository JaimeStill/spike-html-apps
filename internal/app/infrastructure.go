package app

import (
	"io"
	"log/slog"

	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-core/logging"
	"github.com/standards-lab/go-messaging"
	"github.com/standards-lab/go-messaging/nats"

	"github.com/JaimeStill/spike-html-apps/internal/config"
	"github.com/JaimeStill/spike-html-apps/internal/natsserver"
)

// defineInfrastructure defines the infrastructure nodes on g into n: the
// configuration cfg, and the services the application is composed on,
// built from it — the logger, written to w, in the template baseline; a
// database pool, storage, or auth client as a service grows, each its own
// node. It constructs nothing. A service whose value implements
// lifecycle.Subsystem takes part in startup and shutdown through its own
// methods, and its constructor opens nothing: connectivity belongs to its
// Start, so a failed Build leaks no connections.
//
// The emulator's event transport is two nodes: nats, the embedded
// nats-server, and broker, go-messaging's NATS broker, which connects to it
// and owns the event stream. The broker depends on the server, so
// the Coordinator starts the server first and drains the broker first, and
// both join the readiness probe: the service is not ready until the server
// accepts connections and the broker is connected.
//
// The broker node's type is go-messaging's Broker interface, the seam the
// unit tier composes through: it replaces the node's constructor with one
// returning go-messaging's memory.Broker, which Uses no node, so the graph
// it builds holds no embedded server and starts nothing over the network.
// The lifecycle reads a node's participation from its value's methods, so
// the NATS broker still starts, drains, and reports readiness through the
// interface.
func defineInfrastructure(g *graph.Graph, n *Nodes, cfg *config.Config, w io.Writer) {
	n.Config = g.Define("config", func(*graph.Scope) (*config.Config, error) {
		return cfg, nil
	})
	n.Logger = g.Define("logger", newLogger(n, w))
	n.NATS = g.Define("nats", newNATS(n))
	n.Broker = g.Define("broker", newBroker(n))
}

// newLogger constructs the service's logger over w from the config node's
// log block.
func newLogger(n *Nodes, w io.Writer) func(*graph.Scope) (*slog.Logger, error) {
	return func(s *graph.Scope) (*slog.Logger, error) {
		return logging.New(w, s.Use(n.Config).Log), nil
	}
}

// newNATS constructs the embedded server from the config node's nats block,
// its WebSocket listener admitting the cors block's origins, the one list
// the service admits browser clients from. Its Start creates the store and
// binds the listeners.
func newNATS(n *Nodes) func(*graph.Scope) (*natsserver.Server, error) {
	return func(s *graph.Scope) (*natsserver.Server, error) {
		cfg := s.Use(n.Config)
		return natsserver.New(natsserver.Options{
			Token:          cfg.NATS.Token,
			Port:           *cfg.NATS.Port,
			WebSocketHost:  cfg.NATS.WebSocket.Host,
			WebSocketPort:  *cfg.NATS.WebSocket.Port,
			AllowedOrigins: cfg.CORS.AllowedOrigins,
		}, s.Use(n.Logger)), nil
	}
}

// newBroker constructs the broker that owns the stream, from the
// configuration the nats block derives for it: the embedded server's client
// listener with the token as the URL's user. It Uses the server node,
// though it reads no value from it, rather than ordering itself After it:
// the server must be built, and must accept connections before the broker's
// Start connects and provisions the stream, and After alone would build
// neither.
func newBroker(n *Nodes) func(*graph.Scope) (messaging.Broker, error) {
	return func(s *graph.Scope) (messaging.Broker, error) {
		_ = s.Use(n.NATS)
		b, err := nats.New(s.Use(n.Config).NATS.Broker())
		if err != nil {
			return nil, err
		}
		return b, nil
	}
}
