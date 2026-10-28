# Standards

The judgement calls the check can't enforce, one line each, for the standards-reviewer. What
`mise run check` enforces is never restated here. The tasks write the conventions here; they stay
in this spike until experiment.html's intake. Each layer repository's `STANDARDS.md` restates the
ones for its layer.

The architecture pages that apply, in the architecture repository:

- `principles/minimal-footprint.md`
- `principles/rolling-currency.md`
- `principles/independent-releases.md`
- `principles/downward-dependencies.md`
- `principles/composition-root.md`
- `principles/validation-first.md`

## Design

The spikes after spike-html-design proved that the infrastructure works; this one holds the
design to a finished product's bar at every layer.

- spike-html-design v0.7.0 is the visual baseline: native elements keep its styling, and every
  profile renders as it does there.
- A component is finished in every state it can show (empty, loading, streaming, error, long
  content, narrow width) and in every profile, light and dark, regular and compact.
- Focus is always visible, motion is brief and honours reduced motion, and nothing shifts layout
  as data arrives.
- Density, alignment, and spacing come from the foundation's tokens, never a literal.
- A UI task's session brief carries its screenshots per state and profile; the architect's
  acceptance is the design review, and a passing check alone doesn't ship one.
- The pipeline app's full sequence (upload, stages live, chat, search, artifact) reads as one
  product.

## Layers

- A component takes its data as its own properties, emits events, and imports no SDK or domain
  code; wiring lives in the app.
- No component binds a key. The app binds single keys only, for critical operations, never
  chords, and ignores them inside text fields.
- A layer resolves the layer below only through its release tag, as a consumer does.

## Code

- A copied file names its source repository and commit in a provenance line, which reads
  `From|Adapted from <repo> (<commit>): <path>`. It names the immediate source alone; that source
  keeps the earlier lines.
- A file a template generates is the template's output and carries no provenance line; a file
  copied by hand carries one.
- Each file in the root's `sdk` package is named for the library its contents move to, as
  `sdk/doc.go` lists them.
- A test harness relaunches a boot only when it failed on a taken reserved port (address in use);
  any other failure fails the test at once.
