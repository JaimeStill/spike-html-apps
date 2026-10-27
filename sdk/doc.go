// Package sdk stages the spike's Go serving half: conventions proven here in
// running code before they move outward, to go-web-service's sdk/ and then
// go-web-sdk. The package is flat by design, a staging area meant to empty
// out, and each file is named for the library its contents are bound for.
//
// The package's API, once the emulator task adds it:
//
//   - NewClient (web.go, for go-web-sdk): serves an embedded Vite build at a
//     prefix and at the server's root, with Vite's base, the shell's
//     <base href>, and the router's base agreeing.
package sdk
