// Package natsserver runs nats-server in-process, as the emulator's event
// transport, as a go-core lifecycle component.
//
// The package exports:
//
//   - [Options], the server's listeners, credential, and allowed origins
//   - [Server], built cold by [New], with [Server.Start], [Server.Ready],
//     [Server.Shutdown], and [Server.Err], so the lifecycle Coordinator
//     starts it, reports it on the readiness probe, drains it, and watches
//     it with no registration; and [Server.Store], the JetStream store
//     directory of a started server
//
// # Listeners
//
// A started server has two listeners. The core client listener binds
// 127.0.0.1 only: the emulator's own broker connects there. The WebSocket
// listener, the one browsers reach, binds its configured host and port
// without TLS; nats-server's WebSocket options carry no http.Handler, so it
// is a port of its own beside the HTTP server's. Both require the one static
// token: a connection with no token, or another, is refused on either.
//
// # Origins
//
// The WebSocket listener accepts an upgrade only from an origin on
// [Options].AllowedOrigins. nats-server reads an empty list as any origin,
// so an empty list is mapped to its same-origin check instead: the upgrade's
// Origin must be the listener's own, which serves no page, so no
// cross-origin upgrade is accepted. An upgrade with no Origin header is a
// dedicated client, not a browser, and is accepted under either setting, as
// RFC 6455 has it; the token still applies.
//
// # Store
//
// The server runs JetStream on file storage, in a directory [Server.Start]
// creates with os.MkdirTemp and [Server.Shutdown] removes once the server
// has stopped. Start logs the directory with the listeners' addresses.
package natsserver
