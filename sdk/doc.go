// Adapted from go-web-service (15e0bc3): sdk/doc.go, staging the spike's serving half.

// Package sdk stages the spike's Go serving half: conventions proven here in
// running code before they move outward, to go-web-service's sdk/ and then
// go-web-sdk. The package is flat by design, a staging area meant to empty
// out, and each file is named for the library its contents are bound for.
//
// The package's API:
//
//   - NewClient and ClientOptions (web.go, for go-web-sdk): serve a Vite
//     build, read once through its manifest, at a prefix (as a
//     NewHandlerModule) or at the server's root (as the router's not-found
//     handler): the hashed assets cached as immutable, a missing asset a 404
//     problem, and every other path the HTML shell, which writes the base
//     as <base href>, the config as JSON in #app-config, and the entry's
//     module script and CSS. Vite's relative base, the shell's <base href>,
//     and the client router's base agree.
//   - CORS and ValidateOrigin (middleware.go, for go-web-sdk's middleware
//     package): admits cross-origin browser requests from an exact list of
//     origins, for the methods its caller's API serves, over
//     github.com/rs/cors, with no credentials mode and no wildcard.
package sdk
