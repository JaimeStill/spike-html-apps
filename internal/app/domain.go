package app

import (
	"github.com/standards-lab/go-core/graph"
	"github.com/standards-lab/go-web-sdk"

	"github.com/JaimeStill/spike-html-apps/domain/conversation"
	"github.com/JaimeStill/spike-html-apps/domain/document"
	"github.com/JaimeStill/spike-html-apps/domain/run"
	"github.com/JaimeStill/spike-html-apps/domain/search"
)

// defineDomain defines the domain services on g into n, one node per
// domain layer. Domain services are defined in the module's base-layer
// domain packages, one package per layer under domain/, and each node's
// constructor builds its service from the infrastructure nodes it Uses,
// never from Nodes itself. Domain services own no resource and never run,
// so none is a lifecycle participant. A package that does own a resource
// and run belongs in infrastructure.go, if it is built once at startup, or
// reactors.go, if it reacts to an external occurrence for the life of the
// process.
//
// The emulator's four layers are runs, the emulated pipeline runs, which
// publish their stage events through the broker node; documents, the
// uploaded files, each of whose uploads starts a run through the runs
// node; search, which reads the documents node's store; and conversations,
// the scripted replies, which reads only the config node. It constructs
// nothing.
func defineDomain(g *graph.Graph, n *Nodes) {
	n.Runs = g.Define("runs", newRuns(n))
	n.Documents = g.Define("documents", func(s *graph.Scope) (*document.Service, error) {
		return document.New(s.Use(n.Runs)), nil
	})
	n.Search = g.Define("search", func(s *graph.Scope) (*search.Service, error) {
		return search.New(s.Use(n.Documents)), nil
	})
	n.Conversations = g.Define("conversations", newConversations(n))
}

// newConversations constructs the conversation layer from the config
// node's conversations block, its delta interval, with the server block's
// write timeout as the grace a reply's write deadline allows beyond its
// script: a reply lifts its connection's write deadline to cover the whole
// script, so the server's timeout never cuts one off.
func newConversations(n *Nodes) func(*graph.Scope) (*conversation.Service, error) {
	return func(s *graph.Scope) (*conversation.Service, error) {
		cfg := s.Use(n.Config)
		return conversation.New(conversation.Config{
			Interval: cfg.Conversations.DeltaInterval.Duration(),
			Grace:    cfg.Server.WriteTimeout.Duration(),
		})
	}
}

// newRuns constructs the run layer from the config node's runs block, its
// interval and its instance's event source, under the nats block's prefix,
// the namespace of every type the broker publishes, publishing through the
// broker node and logging a failed publish through the logger node.
func newRuns(n *Nodes) func(*graph.Scope) (*run.Service, error) {
	return func(s *graph.Scope) (*run.Service, error) {
		cfg := s.Use(n.Config)
		return run.New(run.Config{
			Interval: cfg.Runs.StageInterval.Duration(),
			Source:   cfg.Runs.Source(),
			Prefix:   cfg.NATS.Prefix,
		}, s.Use(n.Broker), s.Use(n.Logger))
	}
}

// apiMount is the API's mount, which the pipeline app's shell config also
// names as the app's API base.
const apiMount = "/api"

// mountAPI builds the API mount, /api, with each domain layer's route group
// mounted into it, each handed its service, the paging policy from the
// config node, and the logger node for its error writer (the conversation
// layer mounts two groups, its conversations and the stateless responses
// route, which pages nothing); the documents
// group is also handed the transfer its uploads and downloads take, sized
// from the documents block's limit and the server block's rate.
func mountAPI(s *graph.Scope, n *Nodes) *web.Group {
	cfg, logger := s.Use(n.Config), s.Use(n.Logger)
	api := web.NewGroup(apiMount)
	reads := cfg.Reads.Limits()
	api.Mount(document.Routes(s.Use(n.Documents), reads, cfg.Server.Transfer(*cfg.Documents.MaxSize), logger))
	api.Mount(run.Routes(s.Use(n.Runs), reads, logger))
	api.Mount(search.Routes(s.Use(n.Search), reads, logger))
	api.Mount(conversation.Routes(s.Use(n.Conversations), reads, logger))
	api.Mount(conversation.ResponsesRoutes(s.Use(n.Conversations), logger))
	return api
}
