// Package app is the composition root. It describes the service as one
// go-core dependency graph, and each architecture layer has one file, which
// defines the layer's nodes in its define function and owns its mount, so
// the layer files are the architecture's layer list:
//
//   - infrastructure.go: defineInfrastructure, the configuration and the
//     services the application is composed on: the logger, and the event
//     transport, the embedded nats-server and the broker that owns its
//     stream;
//   - admin.go: defineAdmin, the administrative services, and their /admin
//     mount;
//   - domain.go: defineDomain, the domain services, runs, documents, and
//     search, and their /api mount;
//   - reactors.go: defineReactors, the process-lifetime entry points an
//     occurrence drives, each a node whose value is a go-core
//     reactor.Reactor: runner, which advances the runs;
//   - server.go: defineServer, the request edge: the readiness the probes
//     report, the router, and the server;
//   - routes.go: the list of mounts;
//   - middleware.go: the router-level middleware stack, outermost first.
//
// [Nodes] holds one handle per node, the single description of what the
// service is composed of: each define function fills its own part of one
// Nodes value, and its constructors read the lower layers' nodes from it
// with Use. [App] is the described process. [New] is the cold start: it
// describes the graph, layer by layer, lowest first, constructs nothing,
// and cannot fail. [App.Graph] and [App.Nodes] publish the graph and its
// handles, so a caller can Observe or Replace a node before Run. The unit
// tier Replaces the broker node, whose type is go-messaging's Broker
// interface, with the in-memory broker, which Uses no node, so its graph
// holds no embedded server; the binary composes the embedded server and its
// JetStream broker. [App.Run]
// is the hot start plus shutdown: it builds the graph from the config, the
// logger, the broker, the server, and each reactor as roots, hands the System
// to go-core's lifecycle Coordinator, and returns the process exit code. A constructor's
// error is reported there as the service failing; a wiring mistake panics
// during Build.
//
// What a node takes part in is inferred from its value's methods: a
// lifecycle.Starter or Stopper is started or stopped, a Subsystem is both, a
// ReadyStarter (a Starter that also implements Ready) joins the readiness
// probe, and a Monitored has its runtime error watched. A value with Ready
// but no Start joins no readiness check. Nodes start in layer order and
// drain in reverse. The server orders itself after every reactor, so it is
// alone in the top layer: it starts after every other node and drains first,
// so in-flight requests complete before what they run on closes. The
// service's logger reaches the server, the middleware, and every mount's
// error writer. The probes register on the router's native mux, outside
// every module's middleware, query live on every request through the
// readiness node's value, and report the Coordinator's status under the
// "lifecycle" name, ahead of the nodes' own checks in layer, then
// definition, order.
//
// Routes and reactors are the two ways the running process is entered: a
// caller drives a route, and an occurrence the process receives or
// discovers drives a reactor. A route reads the domain nodes, and a
// reactor may; neither is a domain service itself. Extending the service
// means defining a node in its layer's define function, and appending a
// reactor's node to Nodes.Reactors; the signatures, cmd/server, and
// [App.Run] stay untouched.
package app
