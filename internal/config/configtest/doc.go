// Package configtest builds hermetically valid service configuration for
// tests. It is the single place the suites learn what the root config
// requires: when a subsystem's block gains a required field, it is set here
// once and every consuming test adapts.
//
// The package exports:
//
//   - [Config], which returns a finalized root configuration whose
//     composition performs no I/O
package configtest
