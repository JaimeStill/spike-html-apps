# Conventions

This note lists the development principles, design conventions, and process conventions the
spike's repositories follow, for experiment.html's intake to adopt. Each item gives the rule, why
it holds, and the release or commit area that proves it.

## Development principles

- **Fix a defect at its source.** Once a defect's source is known, fix and release it there,
  never work around it in a consumer. A workaround leaves the defect for every other consumer.
  *Proven:* foundation v0.2.1 and v0.2.3 (keys in shadow roots), v0.2.2 (`formatBytes`);
  components v0.4.0 (`sl-composer`'s `send()`), v0.7.0 (the artifact viewer's header, the stage
  timeline's reason, the entry's status tone), v0.9.0 and v0.9.1 (the chat thread's following),
  v0.10.0 (the search results' total and live region), v0.10.1 (`sl-pagination`'s page field),
  v0.10.2 (`sl-event-log`'s lines); sdk v0.3.0 (text bodies), v0.4.0 (a typed error for a cursor
  the stream never gave out); tooling v0.3.0 (any server); the emulator's failure, hold, and
  rich-reply seams.
- **Keep native behavior.** Use the browser's elements and behavior as they are, and never patch
  them. A patch drifts from the browser and from what users and assistive technology expect.
  *Proven:* foundation v0.3.0 (native `progress`'s track left as Chrome draws it); components
  v0.8.0 (a PDF in an iframe, in the browser's viewer); `sl-drawer` (an `<aside>` and a
  `<dialog>`, no hand-detected scrim click).
- **Adopt an ecosystem solution first, and declare what it relies on.** A maintained package
  costs less than one the project keeps. Declare a dependency the package imports without
  declaring, since pnpm resolves it only through its hidden hoist. A niche case gets no upstream
  issue. *Proven:* the root's vite-plugin-standard-css-modules in place of its own `sheets()`
  plugin, and rolldown declared at the version Vite resolves.
- **Show data as stored.** Format a value from its own text; never parse it and print it again.
  Parsing reorders integer-like keys, rewrites number literals (`1.0`, `1e3`, integers past
  2^53), and drops duplicate keys. *Proven:* components v0.8.0 (`formatJson` keeps key order,
  literals, and duplicates, and leaves subtrees past depth 64 as written, so output stays near the
  input's size); sdk v0.3.0 (a call reads a body as text, `{ as: "text" }`).
- **Render natively whatever the browser can.** Show native types first, then any content that
  is text, and "can't be shown" only for binary content. *Proven:* components v0.8.0
  (`sl-artifact-viewer`: PDF, image, audio, and video from a Blob; SVG, XML, and unknown UTF-8
  types as text).
- **A test that can't fail is a defect.** Show each new test failing against the defect it
  guards, and have reviewers look for tests that pass regardless. Such a test gives confidence it
  hasn't earned. *Proven:* components v0.7.0 through v0.9.0 (the stage timeline's reason tests,
  the artifact viewer's and chat thread's tests rewritten to claim only what the browser shows).
- **Fix a flaky test at its race.** Reproduce it under load, name the cause, and fix the race.
  Add no sleep or retry; change an assertion only to state what the system guarantees. A
  loosened test hides the race. *Proven:* the root's upload tests (chosen files kept until the
  test process exits, 20/20 under load), `TestNATS_TokenRequired` (asserts the refused
  handshake, not one error string), and the stage tests, which hold a run at a stage with the
  emulator's hold rule rather than read it mid-way on time (acae7fd).
- **Sample what the page paints, from its first frame.** A test that records a view's states
  samples them on animation frames, from a script added ahead of the app's, and waits on its own
  record before the next step. A wait through the DevTools protocol runs ahead of the frames, so
  a record started late or read early misses states, and a DOM observer sees states no frame
  paints. *Proven:* the root's document-moves case (bdae1db, 0 of 40 failing under load, from 9)
  and stage timelines (dd85c7b, 0 of 64, from 2).
- **Respect supply-chain cooldowns.** Hold a dependency inside pnpm's minimum release age and
  record the hold; never exclude it from the cooldown. The cooldown is the defense against a
  compromised release. *Proven:* eslint 10.14.0 and globals 17.14.0, held across the layers.
- **Measure size at the end.** Measure the whole bundle's gzip and brotli size at the end of a
  session, comparable to peer libraries' published sizes (Material Web's 72.1 kB gzip for
  `all.js` with Lit), rather than failing commits on a budget. A whole-bundle figure compares
  with what peers publish; a per-file budget doesn't. *Proven:* components v0.8.0 removed its budget
  check, and the foundation and the sdk removed theirs (their PRs #9 and #7).
- **Keep palettes as published.** Make no contrast adjustments to a recorded palette. The
  palettes are proven usable as terminal themes, where every hue is text on the backgrounds.
  *Proven:* foundation v0.3.0.
- **Verify accessibility; don't assume it.** Read accessible names from the browser's
  accessibility tree; move focus off a control that turns disabled; keep a focus outline inside a
  scroll container's clip with `scroll-padding`; give a landmark one heading; state a status in
  text, with color as a second cue. *Proven:* the root's browser tier (Chrome's accessibility
  tree); components v0.5.0 (`sl-entry`'s accessible name), v0.6.0 and v0.6.1 (`sl-drawer`'s one
  heading, its scroll padding, the dropzone's Cancel focus room), v0.7.0 (status tone), v0.9.0
  (`sl-composer` after Stop).
- **Secure the rendering boundary.** Give an object URL only to content whose type and subtype
  are each an HTTP token, and type the URL's bytes by that essence. Never give text a URL, and
  show text/html and SVG as source, since each could run script in the app's origin. Weigh a
  sandbox by testing it in the browser, not by assumption: Chrome refuses to render a PDF in any
  sandboxed iframe, and the PDF's URL can only carry `application/pdf`, so its iframe has none.
  *Proven:* components v0.8.0 (`sl-artifact-viewer`).

## Design conventions

- **Two color hooks, declared by no profile.** `--interaction-color` (default `--blue`) marks
  what you can act on; `--accent-color` (default `--magenta`) marks what is current, active, or in
  progress. A page sets either on any subtree, per palette if it wants. *Proven:* foundation
  v0.3.0; components v0.6.0.
- **Status hues by name.** Complete is green, failed red, incomplete orange, and active the
  accent, in the tone vocabulary `active`, `complete`, `incomplete`, `failed`. The same meaning
  takes the same hue in every component. *Proven:* components v0.7.0 (`sl-entry`'s
  `status-tone`).
- **An app's own text takes `--font-ui`.** The app's light-DOM text then matches the
  components'. *Proven:* the root's workspace (slice 13).
- **Components own their headings.** A contained surface's heading is `--text-l`, a section's
  size, not the page's. The app then needs no heading of its own beside the component's.
  *Proven:* components v0.6.0 and v0.6.1 (`sl-drawer`).
- **Breakpoints are minimum widths.** A component docks at its `dock` width and wider, and is a
  drawer below it (`(width < dock)`). The app sets no off-by-one width such as `47.99rem`.
  *Proven:* components v0.6.0.
- **The responsive drawer.** It is an `<aside>` landmark when docked, and below `dock` a
  full-viewport modal `<dialog>` with its own Close button; slotted content is never re-parented.
  Moving content would lose its state and listeners. *Proven:* components v0.5.0 and v0.6.0
  (`sl-drawer`).
- **Name attributes as the platform does.** An opt-out boolean is named `no-…` (`no-header`, as
  `novalidate`), so its absence is the default. State attributes are reflected. A data item's
  fields are snake_case, as the API sends them (`content_type`, `failed_at`); an element's
  properties are camelCase (`failedAt`, `statusTone`). *Proven:* components v0.7.0.
- **Honor markup attributes as native elements honor theirs.** An attribute in the markup takes
  effect as the page loads. *Proven:* `sl-drawer`'s `open`, which opens the drawer below `dock`.

## Process conventions

- **Accept UI work by screenshot review, slice by slice.** The architect reviews each UI slice's
  screenshots (light and dark, wide and narrow, full page) before the next slice starts. Problems
  surface while they are one slice deep. *Proven:* the pipeline app's slices 13 to 18 and its
  walkthrough, whose reviews released foundation v0.2.2 and components v0.5.0 through v0.10.2.
- **Release a layer at a checkpoint brief the architect accepts.** "Accept" covers every brief
  open at the time. A tag is never changed or re-cut, so each one waits for the architect. *Proven:*
  every layer release from tooling v0.3.0 on.
- **Version in 0.x by the CHANGELOG.** A release with anything Added or any break is a minor;
  otherwise it is a patch. Each CHANGELOG follows Keep a Changelog, keeps an empty
  `[Unreleased]`, and dates each release in UTC. *Proven:* every layer's CHANGELOG; UTC dates
  from components v0.9.1 (c70e715).
- **Release only what changes the pack.** A change to tests or dev tooling alone gets no
  CHANGELOG entry, no version bump, and no tag; it merges to main. The CHANGELOG records what
  consumers install. *Proven:* the foundation's and the sdk's budget removals (their PRs #9 and
  #7); the toolchain bumps and TypeScript tests across the layers in the tooling task.
- **Emulator test seams are configuration or exact-text commands.** A failed run is
  configuration (`EMULATOR_RUNS_FAIL`), and so is a run held at a stage (`EMULATOR_RUNS_HOLD`),
  which makes a partial state exact; a chat message of exactly `/fail` or `/rich` takes a
  scripted path. None is client API, so the client tests against the real API alone. A test of a
  live advance opens its page and waits until it is ready before it starts the run, so every
  stage event arrives while the page watches. *Proven:* the emulator's `run` and `conversation`
  domains (3b833b7); the root's deep-link, reload, and live stage tests (acae7fd).
- **A screenshot page stands alone.** A page that shows documents ensures them by name through
  the emulator's search and uploads only those missing. Then `--page` captures any page alone, a
  full run uploads the documents it did before, and the empty states stay empty. *Proven:* the
  root's walkthrough description (5ac876c).
- **Read the reference repositories; never write them.** A defect found in one becomes a finding
  for its own goal. The references are other goals' evidence. *Proven:* the keys defect, ported
  from spike-html-packages-foundation's `src/keys.ts`.

## Candidates for later

These are not built:

- A lazily expanded JSON tree component, for JSON deeper than `formatJson`'s depth.
- Status role tokens (success, danger, warning) and a token for the focus outline's offset, which
  spike-html-apps-components' `context/foundation-candidates.md` stages for a later foundation
  minor.
