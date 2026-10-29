// Package config declares the service's layered configuration.
//
//   - [Config] is the root: the library capability blocks (log, server),
//     the service-owned read policy, and the shutdown timeout. The timeout
//     comes from go-core's lifecycle.Config, embedded by value and untagged,
//     so shutdown_timeout is a top-level key, and Config.Config is the block
//     the composition root hands the lifecycle Coordinator. Its Merge and
//     Finalize delegate to each block's own.
//   - [ReadsConfig] is the service-owned read policy, with its own Merge and
//     Finalize; its Limits method hands the policy to a handler as
//     web.Limits. [ReadsEnv] records the environment-variable names its
//     Finalize read.
//   - [CORSConfig] is the cross-origin policy, the one list of browser
//     origins the HTTP router and the NATS WebSocket listener admit.
//   - [NATSConfig] configures the embedded NATS server (the token both its
//     listeners require, the loopback client port, and the WebSocket
//     listener's address) and the stream its owning broker provisions;
//     [NATSConfig.Broker] derives that broker's go-messaging configuration.
//     [NATSEnv] records the environment-variable names its Finalize read.
//   - [DocumentsConfig] is the document store's upload limit, with
//     [DocumentsEnv].
//   - [RunsConfig] is the emulated pipeline's stage interval and the
//     instance name its stage events are sourced from
//     ([RunsConfig.Source]), with [RunsEnv].
//   - [ConversationsConfig] is the pace of the scripted replies' text
//     deltas, with [ConversationsEnv].
//   - [AppConfig] is where the pipeline app is served, a prefix or the
//     root, with [AppEnv]; [NATSWebSocketConfig.PublicURL] is the WebSocket
//     URL the app's shell hands the browser.
//   - [Load] reads the layered files, decoding each strictly, and finalizes
//     the result under the service's env prefix.
//
// The unexported envPrefix const, "emulator", is the single place the
// environment namespace is named.
package config
