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
//   - [Load] reads the layered files, decoding each strictly, and finalizes
//     the result under the service's env prefix.
//
// The unexported envPrefix const is the single place a seeded service
// renames its environment namespace.
package config
