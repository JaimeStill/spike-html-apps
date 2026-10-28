// Package integration is the service's integration tier: the harness that
// runs the composed service as the binary and drives it through its
// production seams, and, under the integration build tag, the suite that
// asserts the service's behavior through its API. The harness is built on
// the SDKs' test toolkits, go-core's processtest and go-web-sdk's webtest;
// nothing in the runtime exists for the tests' sake.
//
//   - [Main] is the suite's TestMain: it builds cmd/server once per run,
//     embedding the pipeline app's build in [Dist], and fails naming
//     mise run build:app when there is none; [Manifest] reads that build's
//     manifest.
//   - [BuildWithoutApp] compiles cmd/server as with no web build, and
//     [RunBinary] runs such a binary to its exit.
//   - [Options] holds the EMULATOR_* overrides one service process adds.
//   - [Start] runs the service on a reserved port and returns once it is
//     live; [Launch] returns without waiting, and [Service.Ready] waits.
//   - [Service] is one running process: [Service.Addr], [Service.URL], and
//     [Service.Client] reach it; [Service.NATSURL], [Service.WebSocketAddr],
//     and [Service.WebSocketURL] reach its embedded NATS server, which
//     requires [Token]; and the embedded processtest.Process stops it and
//     reads its output and exit code.
//
// The harness is untagged, so the unit tier type-checks it on every pull
// request; the suite files carry the integration tag.
package integration
