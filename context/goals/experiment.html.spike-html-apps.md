# goal · experiment.html.spike-html-apps

- **State:** building
- **Task:** emulator
- **Branch:** emulator

## Tasks

1. [x] layers
2. [x] foundation
3. [x] sdk
4. [ ] emulator
5. [ ] primitives
6. [ ] pipeline
7. [ ] answer

## Task brief · experiment.html.spike-html-apps · emulator

**Problem.** The client layers exist (sdk v0.2.0, components v0.2.0), but nothing live runs
behind them. The NATS adapter has never read a stream the emulator publishes, NewClient is only a
proposal, and the primitives and pipeline tasks have no backend to compose against. This task
builds the pipeline emulator as one Go binary from go-web-sdk-template template/v0.13.0, all state
in memory: four domains, embedded nats-server publishing through go-messaging, a scripted Open
Responses stream that spike-ai-pipeline-client can consume, CORS for the external client, and the
serving half with a minimal pipeline app. It then proves the adapter and NewClient live in a
browser (evidence 3 and 4).

**Behaviors**

Service
1. The emulator is one binary composed on go-core's graph and lifecycle. It's configured through
   the template's layered files and environment variables, under the emulator's own prefix. It
   answers the template's liveness and readiness probes, and readiness includes the embedded
   NATS server, the broker, and the stage reactor. An interrupt drains it and exits 0. All state
   lives in memory and is gone on restart.
2. The template's integration tier boots the built binary on reserved ports and passes as part
   of the check. It covers boot, both probes, and the drain. Once the drain finishes, the
   embedded server's store directory no longer exists.

Embedded NATS
3. The emulator starts nats-server in-process with JetStream, on a store directory it creates at
   start and removes at shutdown. The core client listener binds loopback only. The WebSocket
   listener runs without TLS on its configured host and port.
4. Every listener requires the one static token from the emulator's configuration. A connection
   with no token, or another token, is refused on either listener.
5. The WebSocket listener accepts an upgrade only from an origin on the configured
   allowed-origins list, the same list CORS uses. Any other origin is refused.
6. go-messaging's nats broker owns the event stream and provisions it on the embedded server
   with the token. The emulator isn't ready until the server accepts connections and the broker
   is connected.

Documents and runs
7. An upload is a raw body: the file's bytes, its own Content-Type, a Content-Length, and its
   name as a query parameter. It's accepted up to a configured size limit that is checked before
   any byte is read. A body over the limit answers 413, one with no length 411, and a malformed
   Content-Type 415, each as an RFC 9457 problem. A missing name is a 400 problem. A success
   answers 201 with the document's id, name, content type, size, and creation time.
8. Documents can be listed in go-web-sdk's page envelope and read by id, and their content reads
   back with the content type they were uploaded with. An unknown id is a 404 problem.
9. Each accepted upload starts a run for its document. The run passes through upload, metadata,
   extraction, chunks, and embeddings, one stage per configured interval. Runs can be listed and
   read by id, with each stage's state and completion time.
10. Each completed stage publishes one CloudEvent through the broker. All stage events share one
    type under the configured prefix. The subject is the run's id, the source names the emulator
    instance, and the JSON data names the stage, its position, the stage count, and the
    document's id. One go-core reactor, nudged when a run starts, advances every run whose next
    stage is due. It drains at shutdown, and nothing publishes after the broker stops.

Search
11. A search with a query matches it case-insensitively against document names and the content
    of text-like documents (text/*, JSON, and any +json type). It answers a page of matches,
    each with the document's id, its name, and a snippet around the first match. A missing or
    empty query is a 400 problem.

Conversations and the chat stream
12. Conversations can be created, listed, and read by id with their history, an ordered list of
    Open Responses message items (user input, assistant output). Posting a user message answers
    the scripted reply as a stream and adds the user's message to the history. Once the reply
    completes, the assistant's message is added too.
13. The reply stream is text/event-stream. Each event's event field equals its body's type,
    sequence_number rises from 0, and no event carries an id. The sequence is:
    - response.created (in_progress, no output)
    - output_item.added for one assistant message
    - content_part.added
    - output_text deltas, paced on a timer
    - output_text.done
    - content_part.done
    - output_item.done, carrying the whole item
    - response.completed, carrying the full response: completed status, an output that is
      exactly that item, and usage

    Item ids stay the same throughout, and no [DONE] follows.
14. A client that aborts mid-reply ends the stream on the server. The cut-off reply is never
    added to the history.
15. The failure path is deliberate. A user message whose text is exactly the documented trigger
    string streams part of a reply. The stream then ends with Open Responses' error event and
    response.failed, whose response holds the partial output. The history keeps the user's
    message and no assistant message. Only that exact input causes the failure. No run, stage,
    timer, or other scripted reply produces it, and the normal walkthrough never hits it.
16. A stateless POST to the API's responses route takes an Open Responses create-response body
    with stream true. It answers the same scripted reply, from the same stream writer, and keeps
    no state. If the last user input is the trigger string, it takes the deliberate failure path.
    A body without stream true, or one that doesn't parse, is a 400 problem.
17. spike-ai-pipeline-client v0.4.0's GenerateStream, using format/responses pointed at the
    emulator, yields its events with no error. Folded by its Accumulator, they give a completed
    response whose one message text is the script's. With the trigger input, the stream ends with
    the error event and response.failed.

CORS
18. The spike's sdk package provides a CORS middleware over rs/cors: a web.Middleware configured
    with the allowed-origins list and mounted router-wide.
    - A preflight from an allowed origin is answered with the API's methods and the
      Authorization and Content-Type request headers. That includes the preflight a cross-origin
      upload with progress sends.
    - A request from an allowed origin gets Access-Control-Allow-Origin with Vary: Origin.
    - A disallowed origin gets no CORS headers.
    - Same-origin requests are unchanged.

Serving half
19. NewClient takes an app's build (an fs.FS) and options: base path, title, manifest entry, and
    a config value. It reads Vite's manifest once and fails, naming the problem, when the manifest
    or the entry is missing.
20. Every GET or HEAD path that isn't an asset answers the shell. The shell writes
    `<base href>` at the base path, the title, the config value as JSON in a
    `<script type="application/json">`, and the manifest's entry as a module script with its
    CSS. An asset answers its embedded bytes with
    `Cache-Control: public, max-age=31536000, immutable`. A missing asset is a 404 problem,
    never the shell. Any other method is a 405 problem.
21. The app's mount is configuration. Under a prefix such as /app, NewClient mounts as a handler
    module. At the root, it's the router's not-found handler. Either way, the API, the admin
    mount, and the probes answer as before.
22. The shell's config value carries the API base, the NATS WebSocket URL, the stream name, and
    the static token.
23. The Go steps compile with no web build. A binary built without the app's build output refuses
    to start, logging the missing manifest and exiting 1.

The pipeline app and live cases
24. The pipeline app is minimal: two routes, built by Vite with a relative base and embedded in
    the binary. It reads the shell's config, and its token provider hands the static token to sdk
    v0.2.0's NATS adapter, which it installs by tag. It shows each run's stage events as text as
    they arrive.
25. One build serves at /app and at the root. Under each mount, Vite's base, the shell's
    `<base href>`, and the router's base agree: assets load, a deep link and a reload reach the
    router, and back and forward move between routes.
26. The adapter's live cases run in the browser against the binary:
    - A read with no cursor yields an upload's stage events in order. They're decoded from
      go-messaging's binary content mode, with the data parsed as JSON.
    - A read resumed from the last cursor after a reload continues with no gap and no duplicate.
    - A type filter limits the read.
    - A wrong token fails the read.
    - A page from a disallowed origin can't connect.
27. Two emulator instances run side by side on distinct ports, each with its own NATS listeners
    and store. Neither instance's events reach the other's stream.

Repository
28. The root's currency reads its github: tag dependencies and its Go requirements, alongside its
    mise and package pins. go.mod names go 1.27.3, the version the pipeline client's module
    requires. The README pins spike-ai-pipeline-client at v0.4.0.

**Test seams.** The emulator's HTTP API and its NATS WebSocket listener, reached as a client
reaches them:
- The Go unit tier drives the composed router hermetically, with go-messaging's memory broker in
  place of NATS.
- The integration tier boots the built binary.
- The browser tier loads the embedded pipeline app from the built binary in pinned
  chrome-headless-shell, and reads live through the sdk's NATS adapter.

**Slices**
1. **Upgrade spike-html-apps-sdk:** node 26.12.1 → 26.13.0, pnpm 12.15.0 → 12.16.1.
   - Done when the sdk's currency exits 0 and its check passes.
   - It merges with no version change, so no tag.
2. **Upgrade the root:** node 26.13.0, pnpm 12.16.1, and eslint-plugin-boundaries
   7.3.0 → 7.4.0. Then remove the 11 typescript-eslint 8.72.1 age exclusions.
   - Drop any @boundaries/elements age exclusion pnpm writes.
   - If 7.4.0's dot-file fix changes them, adapt the .well-known and ..x tree cases.
   - Done when the root's currency exits 0 and its check passes.
3. **The service (1, 2):** the template generated with gonew and moved into the root.
   - It replaces the stand-in go.mod, the go task, .golangci.yml, and currency's go.mod scans.
   - It keeps the root's Go and golangci-lint pins and its Node half.
   - The template's CI is dropped, the environment prefix is renamed, and the integration tier
     joins the check.
   - Demo: serve, both probes answer, an interrupt drains, and the check passes with the
     integration tier.
4. **CORS (18):** the sdk package's rs/cors middleware and the allowed-origins setting.
   - Demo: curl preflights from an allowed origin and a disallowed one.
5. **Embedded NATS (3–6, and 2's store case):** the server, the token on both listeners,
   WebSocket origins from the same list, and the owning broker.
   - Demo: readyz lists the server and the broker.
   - Demo: a WebSocket connect succeeds with the token and fails without it.
   - Demo: the store is gone after the drain.
6. **Documents and runs (7–10):** upload, list, read, and content; runs and their stages; the
   reactor; stage events published.
   - The unit tier runs on the memory broker, the integration tier on NATS.
   - Demo: curl an upload, then read the run's stages and the stream's events.
7. **Search (11).**
   - Demo: upload two files and search for a word in one of them.
8. **Conversations and the stream (12–17):** the conversation resource and its history, the one
   stream writer, abort, the deliberate trigger, the stateless responses route, and the
   pipeline client's test import (go directive 1.27.3, README pin v0.4.0).
   - The first go get of v0.4.0 needs the network, since the proxy may not list the tag yet.
     The install step says so.
   - Demo: curl -N on a conversation message and on the trigger.
   - Demo: go test shows GenerateStream folding both.
9. **The app build (24's build, 28's currency):** Vite in the root with a relative base, the
   minimal pipeline app, sdk v0.2.0 by tag with its @nats-io peers, currency reading github:
   tags, and the ESLint app tier and Prettier ignores following the layout.
   - Demo: the build's manifest and output; lint and types pass over the app.
10. **The serving half (19–23):** NewClient in the sdk package, the committed build placeholder
    under an all: embed, mounting at a prefix or the root, and the shell config.
    - Demo: the built app served at /app and then at the root, each loaded in a browser.
    - Demo: a binary without a build refuses to start.
11. **The browser tier and live cases (25–27):** chrome-headless-shell pinned in mise and
    currency, the browser tier adapted from the sdk's and run in the check, base agreement at
    both mounts, the adapter's live cases, and two instances.
    - Demo: the tier's run, with live reads printed.

**Out of scope.** These belong to other tasks or goals:
- The external client and its cross-origin calls (pipeline task).
- The primitives, any Lit component in the app, and the brotli budget (primitives task).
- Screenshots and design review: the minimal app isn't a UI task.
- Real auth, persistence, real inference, Firefox, and WebKit (evidence 9).
- Structured content mode, reasoning and function-call items, and non-streamed responses.
- CORS in go-web-sdk (v1.middleware), and NewClient's move to go-web-service and go-web-sdk
  (v1.client).

**Door.** Two-way. The root releases nothing, and the sdk's upgrade slice merges without a tag.
If the live cases find a defect in the sdk, BUILD escalates instead of fixing it in place. The
escalation's answer then adds the fix and its exact release (`spike-html-apps-sdk` v0.2.1, a
one-way door) to this brief.

**Release.** None.

## Progress

slices 10/11 committed · standards — · spec — · editor —

## Decisions

- setup: scope widened by the architect: beyond what a client application looks like, the spike
  builds the UI primitives spike-ai-pipeline's capstone needs and proves the layers stay clean at
  scale, live over a backend; it doesn't exercise the capstone's backend. GitHub Pages stays with
  spike-html-hosting.
- setup: the evidence is the ten items in `context/README.md`, "The evidence".
- setup: quality at every layer, judged as a finished product. STANDARDS.md carries the design
  bar; each layer's browser tier captures screenshots per state and profile; the foundation,
  primitives, and pipeline tasks put them in their session briefs, and the architect's acceptance
  is the design review.
- setup: three layer repositories, spike-html-apps-foundation, -components, and -sdk, releasing
  `@jaimestill/spike-html-apps-<layer>` from v0.1.0, copied from spike-html-packages' tags with
  provenance; not directories, since the capstone may depend only on published versions. The
  components peer the foundation at its current minor.
- setup: a primitive goes to components when it takes its data as its own properties with no
  domain type; the wiring stays in the app.
- setup: the Go serving half is proven in the spike's own `sdk` package, on go-web-sdk v0.15.2
  and go-core v0.10.0, not in go-web-service, which the spike never writes.
- setup: the backend is a minimal emulator, one Go binary from go-web-sdk-template
  template/v0.13.0 with all state in memory and four domains (documents, runs, conversations,
  search); no Postgres, Azurite, compose, outbox, JWT, or integration tier. Rejected: the
  capstone's compose stack, as premature engineering for a client spike.
- setup: live sync over NATS over WebSocket, with nats-server embedded in the emulator
  (JetStream, a temporary store directory for go-messaging's file-storage stream) and published
  through go-messaging's nats provider. SSE stays the fallback if embedding proves costly.
- setup: one static NATS token from the emulator's config, handed out by the SDK's token
  provider; real auth is a recorded gap.
- setup: the event-sequence interface resumes by the JetStream stream sequence as an opaque
  cursor. The NATS-over-WebSocket adapter is an sdk subpath with @nats-io/nats-core and
  @nats-io/jetstream as optional peers; its live cases run in the root against the emulator, and
  the sdk repository tests the interface with a fake.
- setup: the chat stream is a scripted Open Responses stream over HTTP; folding it into items
  lives in the pipeline app's domain tier. The chat thread's item property is a structural subset
  of Open Responses 2026-04-24 items.
- setup: eight new components (chat thread, composer, upload dropzone, stage timeline, event log,
  search results, artifact viewer for text, JSON, and Markdown, document list) beside the status
  badge, entry, and pagination; no embedding-space panel, toast, or image viewer.
- setup: theming ports spike-html-design v0.7.0's profiles, preferences module, and theme menu,
  the menu's sheet moved to a .css file.
- setup: shortcuts are single keys only, for critical operations, never chords: `/` search, `?`
  help, `t` theme menu, Escape cancel or close; Enter sends and Shift+Enter breaks a line in the
  composer. The app owns the key table; no component binds a key.
- setup: herald is a frame of reference only; no herald configuration is measured or ported.
- setup: the pipeline app is a demonstration; the capstone's UI lives in spike-ai-pipeline's root.
- setup: kind code; `mise run check` = shellcheck, grown by the layers task to
  spike-html-conventions' check plus gofmt, go vet, go test -race, and golangci-lint.
  `mise run currency` over the mise pins, extended to package dependencies and go.mod. No gate,
  no CI on the root.
- setup: spike-ai-pipeline is pinned at main 315ccec, after client-core merged, and
  spike-ai-pipeline-client at v0.1.0.
- setup: the capstone's gates were corrected in the coordinator: it waits on spike-model-engines,
  spike-model-layout, spike-model-gateway, spike-ai-pipeline's own tasks, and spike-html-apps, not
  on either experiment's intake.

- layers: the three layer repositories are created after this brief's approval: init commit,
  public, Apache-2.0, and the source layers' main ruleset. Every other file lands through a `layers`
  pull request.
- layers: each layer is staged and released in sequence (foundation, components, sdk). A repo
  exists and installs by tag before the next repo builds on it. No dependency on an earlier
  spike's repositories and no alias: the components resolve
  `github:JaimeStill/spike-html-apps-foundation#v0.1.0`.
- layers: one task with a staged release checkpoint per layer, decided by the architect. At each
  checkpoint the architect accepts that layer's checkpoint brief, which authorizes its publish,
  merge, and CI-cut release. This is a deliberate exception to the single session-brief gate.
  Rejected: splitting `layers` into three tasks, as too many sessions for a light setup.
- layers: each layer ships 0.1.0 with a `[0.1.0]` CHANGELOG section, and release.yml is copied
  with names changed and pins current. Rejected: a CHANGELOG guard, and shipping at 0.0.0.
- layers: the root's Go is one module at the root, `github.com/JaimeStill/spike-html-apps`, whose
  first package is the doc-only `sdk` package, as go-web-service stages `sdk/`.
- layers: the root's Go check is go-web-sdk-template template/v0.13.0's seven steps with its
  `.golangci.yml`.
- layers: the root uses pnpm alone; other package managers are the answer task's evidence 9.
- layers: the root's browser tier waits for its first real subject, the emulator's live cases.
- layers: the brotli budget is set in the primitives task, from a baseline where all three layers
  hold real content.
- layers: each copied file carries one provenance line, which names the immediate source; that
  source keeps the earlier chain. "Adapted from" marks any change beyond the line itself. The
  three layers' STANDARDS.md and the root's state the rule.
- layers: the components' release test fails when the foundation devDependency points at another
  repository or a fork.
- layers: the root's apps live at `apps/<name>/`. An app may import only its own files and the
  three layer packages, so Lit isn't in the ESLint table; the pipeline task adds it if an app
  imports Lit directly.
- layers: the root's go.mod names the minor, `go 1.27`, as the template writes it, and mise pins
  Go 1.27.3. The root sets `GOWORK=off` and `GOTOOLCHAIN=local`.
- layers: the root's Go steps keep the template's `-tags integration`, though the root has no
  integration tier yet, so an integration suite compiles and lints when one comes.
- layers: the root's STANDARDS.md doesn't adopt the layers' "one script or command per mise task"
  rule or their 2–4-line header bar; the `go` task keeps the template's form.
- layers: every repository excludes typescript-eslint 8.72.1 from pnpm's minimum release age until
  the release ages; the next currency pass removes the entries. Done for the foundation and the
  components by the foundation task.
- layers: the components keep the copied `8ch` and `4ch` widths. They size content rather than
  space it, so the token rule doesn't apply. Superseded for the entry's 8ch kind column by
  foundation, escalation 4; the 4ch stands.
- layers: the root's package currency scan doesn't read `github:` tag dependencies. The first task
  that makes the root depend on a layer by tag teaches it to, as spike-html-conventions'
  `scripts/currency.sh` does.
- layers: the emulator task checks whether the github.com/standards-lab Go modules need
  GOPRIVATE.
- layers: some declaration headers in the foundation and sdk still say "spike-html-apps implements
  it"; the foundation and sdk tasks rewrite them. Done for the foundation by the foundation task.

- plan: the emulator task generates go-web-sdk-template template/v0.13.0 with gonew into scratch
  and moves it to the root, replacing the layers stand-in (go.mod, the go mise task,
  .golangci.yml, currency's go.mod scan) with the template's own; `sdk/` and the Node half stay
  the spike's.
- plan: an app embeds its build as herald's `app` package does: `//go:embed` reaches only its own
  directory and below, so each `apps/<name>/` holds a Go file beside its `dist/` that hands the
  embed.FS to `sdk.NewClient`. The emulator task settles the layout with the pipeline app in
  view, and the ESLint app tier and Prettier ignores follow it.

- foundation: the formatters' runtime is src/format.ts, whose emitted declaration must match
  foundation v0.1.0's handwritten format.d.ts, kept as a test fixture. Rejected: a handwritten
  format.js.
- foundation: formatDuration rounds to whole seconds and prints zero seconds at zero and under one
  second. Rejected: milliseconds as a fifth unit.
- foundation: formatRelative uses fixed 30-day months and 365-day years, with weeks. Rejected:
  calendar-aware differences, which need Temporal (esnext-only, no Safari support).
- foundation: the profiles follow v0.7.0's split: page.css and register.js carry only the
  defaults, and the full entry, page-full.css with register-full.js, carries the rest. Escalation 1
  makes the full entry an aggregator of profile units.
- foundation: the theme menu's sheet is a .css file that the lazy menu module imports as a CSS
  module script and adopts in the layer foundation.theme-menu, which both page entries name after
  foundation.utilities. Rejected: linking it from page.css on every page.
- foundation: every page-wide name moves to this spike: the preferences storage key, the registry
  symbol, and the keys symbol and storage key are each "spike-html-apps-foundation.<name>".
  Rejected: keeping spike-html-design's names, and the spike-wide "spike-html-apps." prefix, which
  stays free for the sdk and the apps (architect).
- foundation: the menu keeps v0.7.0's in-dialog keys (T saves, Escape cancels, j/k and h/l beside
  the arrows), scoped to the modal.
- foundation: the menu's tag is sl-theme-menu, with the components' prefix.
- foundation: the screenshot matrix is 12 profiles per state, 4 colors × light and dark at the
  defaults plus compact and sans × light and dark: the foundation captures the tools page, keys
  help, and the menu at a wide and a narrow viewport (48), and each component one specimen page
  holding all its states (36). Rejected: the full 32-profile product.
- foundation: screenshots come from a separate `mise run screenshots` per layer, which renders
  them into a mktemp directory and shows them inline with kitty icat. They are never committed,
  and check never runs the task. Rejected: committed PNGs, and captures inside check.
- foundation: the architect reviews the screenshots and the code behind them before accepting the
  checkpoint brief and the session brief.
- foundation: the checkpoint is staged: accepting the foundation's brief authorizes its merge and
  the v0.2.0 tag before any components slice. The components release v0.2.0 in this task, peering
  ^0.2.0 and installing #v0.2.0.
- foundation: the entry component uses the foundation's formatBytes and formatDateTime in place of
  its own.
- foundation: the foundation's TypeScript lib moves to es2025 for Intl.DurationFormat, which
  Safari 16.4 and Chrome 129 support.
- foundation: eslint-plugin-boundaries stays at 7.3.0. 7.4.0 was published 2026-10-27T15:27Z,
  after round 1, and is younger than pnpm's minimum release age until 2026-10-28T15:27Z;
  excluding it would bring back the kind of entry the upgrade slice removed. The next currency
  pass takes it, reading its v7.4.0 upgrade notes on `node:`-prefixed built-ins and extglobs.
- foundation: the formatters' demo is its own page, demo/format.html, because the browser tier
  compares every element on tools.html against v0.7.0 (implementer, slice 2).
- foundation: formatBytes scales by the absolute value, and formatDate and formatDateTime let a
  caller's dateStyle or timeStyle replace only the default it names (implementer, slice 2).
- foundation: the profile comparison scopes a profile's attribute under a root whose facet tokens
  are set to a sentinel, so a dropped token that equals the default's value still fails
  (implementer, slice 4).
- foundation: the profiles demo is its own page, demo/profiles.html, framing tools.html, since the
  comparison asserts no profile attribute inside tools.html (implementer, slice 4).
- foundation: the menu's demo is its own page, demo/theme.html, on page-full.css (implementer,
  slice 5).
- foundation: the menu module loads through a static import() as keys-help does, and a failed load
  is forgotten so the next open retries. v0.7.0's CDN-timing flash cases weren't ported
  (implementer, slice 5).
- foundation: each built-in profile is a unit, a sheet plus its own registration module at
  ./profiles/<facet>/<name>, as v0.7.0 named them. page-full.css and register-full are simple
  aggregators of the built-in units and define nothing a profile needs. Rejected: dropping the
  bundle, and the internal ./baseline/tokens path as public (architect, escalation 1).
- foundation: the unit sheets move from src/baseline/tokens/<facet>/ to src/profiles/<facet>/, so
  the existing ./*.css and ./*.js wildcards map the public paths and the exports map is unchanged;
  the facets' contract sheets stay in baseline/tokens/ (implementer, slice 6).
- foundation: v0.7.0's conformance module is ported and covers space and type as well as color,
  so a supported extension seam is fully demonstrated (architect, escalation 1).
- foundation: the conformance module imports nothing at runtime, keeping its own copy of FACETS
  and reading the registry's store by its symbol. v0.7.0's CDN case becomes a cross-origin case
  served from a second loopback origin (implementer, slice 7).
- foundation: the extension proof is Noctis, in a standalone repository: Hibernus is the light
  half and Obscuro the dark half of one "noctis" profile, attributed as the built-in profiles
  are. Rejected: a test fixture inside the foundation (architect, escalation 1).
- foundation: spike-html-apps-noctis ships the color profile only, and the foundation's own
  fixtures prove the space and type rules. The repository is public and Apache-2.0 with the
  layers' ruleset, releases v0.1.0 by tag, and builds in this task after the foundation's
  checkpoint (escalation 2).
- foundation: the space and type conformance rules are the structural five (tokens, facet-only,
  layer, specificity, registered) plus one derived rule each: space's scale ascends from its base,
  and type's steps ascend and its stacks resolve to families (escalation 2).
- foundation: `mise run screenshots` applies each profile itself: every capture points the page's
  first stylesheet link at page-full.css and sets the four attributes on its root, so no demo page
  changes. `--keep` leaves the captures' directory in place (implementer, slice 8).
- foundation: the screenshot review's four defects are fixed in the demo pages only: page gutters
  and section spacing in a demo layout layer, demo/demo.css, the scroller sized to whole lines,
  and keys help's Close inside a <footer>. The sheets match v0.7.0, which leaves page layout to
  the consumer. Rejected: layout utilities in the foundation before v0.2.0 (escalation 3).
- foundation: the foundation's code and tests name no dependent, per
  principles/downward-dependencies (standards review).
- foundation: the screenshots task runs with mise's `raw = true`. With dependencies, mise pipes
  the task's output through its prefixer, so the script saw no terminal and showed no images.
- foundation: the release workflow cuts the tag on main once the version changes, so SHIP checks
  the CI-cut tag and its release rather than pushing one. v0.2.0's tag sits on the release commit,
  whose tree is the pack and whose parent is the merge commit.
- foundation: the foundation's PR merged before its own PR checks had registered: `gh pr checks
  --watch` reported none, and a pipe hid the exit code. Main's CI on the merge commit then passed.
  Later merges wait for a PR's checks to register.
- foundation: noctis maps by role where Noctis's own swatches don't fit the contract: Obscuro's
  --bg-1 is input.background, because its sideBar is darker than its editor; both borders come from
  the guide lines, because Noctis's *.border swatches are transparent or equal a surface; --orange
  is ansiBrightYellow and --purple the NUMBER token color, since there's no ANSI slot for either;
  Hibernus's --yellow is the CONSTANT token color, because its ansiYellow is an orange. Contrast
  is recorded, never corrected (implementer, slice 10).
- foundation: noctis needs no ESLint plugins beyond recommended, so it holds nothing at 7.3.0
  (implementer, slice 9).
- foundation: the four component style defects the specimen captures showed are fixed in this
  task, before components v0.2.0 is tagged: the entry's kind column is sized to its longest kind,
  the entry gets an even meta-row rhythm and a fair name share at narrow widths, pagination's
  labels stay on one line, and its step buttons keep their own height. Supersedes the layers
  decision keeping 8ch for the kind column (escalation 4).
- foundation: noctis's Hibernus focus outline (--blue, just under 3:1) and --border-2 (1.9:1) are
  recorded, never corrected. A profile sets only its sixteen color tokens, and a page that needs
  more sets the foundation's --interaction-color itself (standards review).
- foundation: noctis's Hibernus red, green, and cyan move from their ANSI slots to the
  highest-contrast same-hue upstream swatches: list.errorForeground #c9481d (4.37:1),
  gitDecoration.addedResourceForeground #009456 (3.6:1), and textBlockQuote.border #00899e
  (3.82:1). Orange, blue, and magenta have no better upstream swatch and stay, recorded.
  Rejected: keeping the ANSI mapping, and darkening values, which would leave upstream and break
  "recorded, never corrected" (escalation 5).
- foundation: the entry's kind column is a fixed 9ch, not max-content, since each entry is its own
  shadow-root grid and max-content would misalign names across a list (implementer, escalation 4).
- foundation: the entry's narrow layout is an intrinsic wrapping layout, not a container query:
  the entry sizes to its content in any parent, and the status wraps below only when space runs
  short. Rejected: requiring a definite inline size from the host, and an intrinsic-size
  fallback, which could overflow a narrow flex row (escalation 6).
- foundation: the entry's sizes match the old formatter up to 999 GB. From 1 TB they scale to TB
  and PB, as formatBytes is specified (behavior 2), and the components' CHANGELOG says so rather
  than "unchanged" (spec review).
- foundation: the entry's clock and size never break, and its date may break at its own spaces but
  never inside a word, so the entry stays inside its box down to 16rem, its documented minimum.
  Below that the 9ch kind column leaves the clock and the status no room. Whole dates overflowed
  by 16–25px at 14rem. 14rem was chosen first, but it overflowed by 3px on the CI runner, whose
  monospace font is wider (session, after the components spec re-review; PR #2's check).
- foundation: the components' screenshots are captured in tiles of at most 1200px, cut at section
  or state tops, and shown with icat `--fit=both`. Full-height pages, up to 6457px, left the
  architect's terminal stuck below the image (architect's review).
- foundation: the components' screenshots default to one short sequence, each page in light and
  dark at flexoki, regular, and mono. `--palette <name>`, `--space <name>`, and `--type <name>`
  each pick that facet's profile for the run, so a reviewer runs compact or sans as its own short
  sequence. `--all` keeps the full 12-profile matrix (architect, escalation 7).
- foundation: shipped. foundation v0.2.0 (PR #2, release commit d7efb8e), noctis v0.1.0 (PR #1,
  release commit 2fdc0cd), components v0.2.0 (PR #2, release commit d31b110), each cut by its
  release workflow on merge to main with CI green.

- sdk: the runtime is TypeScript sources whose emitted declarations are checked against v0.1.0's
  handwritten ones, kept as test fixtures. Rejected: handwritten .js.
- sdk: v0.2.0 takes additions and three breaks, since nothing installs v0.1.0: start() and query()
  return promises, the base falls back to `<base href>`, and Client gains the required stream and
  upload (escalation 1). The fixture comparison expects a listed set of differences. Rejected:
  freezing the declarations, and additions only.
- sdk: the router is tested in a browser tier adapted from the foundation's. Rejected: a
  Navigation API fake in Node.
- sdk: a route that can't be shown is handled by its cause and its navigation's initiator. A path
  nothing matches mounts notFound. A failed load on a user's or another script's navigation, or on
  start(), mounts the error element at the committed URL, and the navigation reports
  navigateerror; navigate() loads first and on failure rejects with nothing changed. Rejected:
  notFound for failed loads, the error element everywhere, and keeping the previous element.
  Precommit handlers aren't Baseline.
- sdk: a problem document with no title gets "HTTP <status>", and any other failing response
  becomes a problem titled with its status text, or "HTTP <status>" when that is empty. Rejected:
  Go's "status code N" phrase.
- sdk: CloudEvent is the sdk's own type-only declaration. Rejected: the cloudevents 10.0.0
  package, which brings ajv, uuid, json-bigint, and polyfills.
- sdk: an event sequence is read as an async iterable of deliveries. Rejected: subscribe(callback).
- sdk: a read with no cursor starts at the oldest kept event. Rejected: starting at new events.
- sdk: the adapter is tested against nats-server pinned in mise, revising the setup decision that
  the sdk tests the interface with a fake; its live cases against the emulator stay in the root.
  Rejected: a nats.js fake; a container, which brings Docker, an image pull, and the network into
  the check; and deferring the tests to the emulator task.
- sdk: the in-memory sequence is test-only. Rejected: a public subpath.
- sdk: upload with progress, over XMLHttpRequest, ships in v0.2.0. Rejected: a later sdk release.
- sdk: the streamed response ships in v0.2.0. Rejected: a later release, and the app calling fetch
  itself.
- sdk: Service needs no type change, since upload and stream fit Endpoint (the planner's
  correction to D1).
- sdk: the sdk parses event streams with its own parser. Rejected: eventsource-parser 4.1.3, a
  runtime dependency.
- sdk: the tests' publisher is JavaScript writing go-messaging nats/v0.2.0's binary content mode.
  Rejected: publishing through go-messaging from Go.
- sdk: the adapter decodes an event's data by its datacontenttype, and data that doesn't decode
  ends the read with an error naming the event's id. Rejected: delivering the raw bytes.
- sdk: some choices had no alternative: the base is the option, else `<base href>`, else "/"; a
  failed route with no error option empties the outlet; the adapter reads binary content mode
  only; currency covers the nats-server pin; and boundaries 7.4.0 is installed only once its
  release age clears.
- sdk: a request body that JSON can't encode is a fifth client-made problem,
  urn:standards-lab:problem:encode, with status 0 and nothing sent. Rejected: widening :network's
  doc, and letting the call reject (escalation 1, standards review).
- sdk: Client's new required stream and upload are a third break, listed in the CHANGELOG.
  Rejected: optional members, which every app would have to check (escalation 1).
- sdk: the router leaves reloads to the browser, which picks up a new build and clears bad state.
  Rejected: intercepting a reload and remounting in place (escalation 1, spec review).
- sdk: the emitted declarations keep `.ts` relative specifiers, as the foundation's do and
  STANDARDS.md states, and a consumer typecheck proves they resolve. Rejected: `.js` specifiers in
  the sources (escalation 1, spec review).
- sdk: a NATS cursor past the stream's last sequence fails the read. Only a read with a cursor
  requests the stream info that checks it (spec review, 3a60dac).
- sdk: upload takes a `progress(sent, total)` option, called with 0 as each send starts, a retry's
  included, and with the total once the whole body is sent, and a `method`, POST by default or
  PUT (implementer, slice 6).
- sdk: the router treats a navigation to the mounted pathname as a query-only change, keeping the
  element, focus, and scroll. Each mount commits only while it is the latest, so a slow load never
  replaces a later navigation's element. navigate() and query() reject before start(), since
  nothing would intercept them and the browser would load the page (implementer, slice 5).
- sdk: the NATS adapter's reads share one connection, opened by the first read and reopened by a
  read after it is lost. A read's types are its consumer's filter subjects, and the adapter also
  matches each event's type against them exactly, so a type holding a NATS wildcard can't widen
  the read. Across a server restart the connection reconnects within nats-core's defaults (10
  attempts, 2 s apart) and each read resumes with no gap or duplicate; the path where the
  connection is lost for good, failing every read, is untested. A message that isn't a CloudEvent
  in binary content mode ends the read with an error (implementer, slice 8).
- sdk: Cursor is a branded string, so it serializes as a string and tsc refuses any string a
  sequence didn't give out. CloudEvent holds its extension attributes in their own `extensions`
  member, so none can shadow a context attribute and tsc still refuses a misspelled one
  (implementer, slice 7).
- sdk: package.json's exports list the six public subpaths by name, in place of the `./*.js`
  pattern, so the internal event-stream parser isn't importable (implementer, slice 9).
- sdk: a body that can't be encoded is the encode problem even when the call's signal has
  aborted, since the encoding fails before anything is sent (implementer, afa7b8b).
- sdk: pnpm writes a minimumReleaseAgeExclude entry on its own for a dependency younger than the
  release age, unless minimumReleaseAgeStrict is set. Upgrading to eslint-plugin-boundaries 7.4.0
  pulled in @boundaries/elements 3.3.0, published 96 s after the plugin, and pnpm wrote an
  exclusion for it; the entry was removed and the install rerun once the age cleared. The other
  repositories' boundaries upgrades check for the same entry (implementer, slice 1).
- sdk: the root still pins eslint-plugin-boundaries 7.3.0 and holds the typescript-eslint 8.72.1
  age exclusions. The emulator task's upgrade slice takes 7.4.0, checking for pnpm's own
  @boundaries/elements entry, and removes the exclusions.
- sdk: the emulator embeds nats-server as the Go module nats-server/v2, which the root's currency
  keeps current, separately from the sdk's mise pin of nats-server 2.15.2.
- sdk: a cross-origin upload with progress sends a CORS preflight, because the progress listener
  on xhr.upload forces one, so the external client's uploads (pipeline task) need the emulator's
  CORS to answer it.
- sdk: shipped. sdk v0.2.0 (PR #2, merge 6c06200, release commit 6d5fb1c), cut by its release
  workflow on merge to main with CI green.
- emulator: spike-html-apps-sdk joins the task, so an sdk defect the adapter's live cases find is
  fixed in this task. Any sdk release is added by escalation, never planned. Rejected: keeping the
  task to the root.
- emulator: one static token on every embedded NATS listener. The broker passes it in its URL,
  since go-messaging's nats.Config has no credentials field. Rejected: a token on the WebSocket
  listener only.
- emulator: the NATS WebSocket listener accepts only the CORS allowed-origins list, one setting
  for both. Rejected: any origin.
- emulator: the browser gets the NATS WebSocket URL, stream, and token from the config value
  NewClient writes into the shell. Rejected: an emulator endpoint.
- emulator: an embedded app builds with a relative Vite base, so one build serves under any
  mount, with `<base href>` as the single source. Rejected: an absolute base per prefix.
- emulator: an app at the server's root mounts as Router.SetNotFound. Rejected:
  Router.Handle("/") on the native mux.
- emulator: this task starts apps/pipeline/ as a minimal app for the pipeline task to grow.
  Rejected: a test-only fixture app.
- emulator: an app's build directory holds a committed placeholder under an all: embed, so the Go
  steps compile without a web build, and a binary without a build refuses to start. Rejected:
  running the Vite build in check before the Go steps.
- emulator: the live cases run in a root browser tier in pinned chrome-headless-shell. Rejected:
  Node's test runner.
- emulator: the template's integration package stays and runs in check. This revises the setup
  decision "no integration tier", which rejected the compose stack this tier doesn't need. Domain
  tests stay hermetic on the memory broker. Rejected: dropping it.
- emulator: CORS is rs/cors wrapped as a web.Middleware in the spike's sdk package, as
  go-web-sdk's middleware-sourcing note names it. Rejected: hand-written CORS. jub0bs/cors was
  also weighed: stricter by construction and actively tagged, but with a tenth of the adoption.
  It's left for v1.middleware to evaluate.
- emulator: one go-core reactor, nudged when a run starts, advances every due stage. Rejected: a
  timer per run.
- emulator: every stage publishes one CloudEvent type, with the run as the subject and the stage
  in data. Rejected: one type per stage.
- emulator: conversations keep their history in memory. Rejected: a stateless conversation stream.
- emulator: an upload is a raw body read by ReadUpload, one file per request, with the name as a
  query parameter. herald's multipart path was compared: its ParseMultipartForm limit is a memory
  threshold that never caps the body. Rejected: multipart FormData.
- emulator: the scripted reply is one assistant message item streamed as output_text deltas,
  ending at response.completed with no [DONE]. Rejected: a reasoning item ahead of it.
- emulator: the scripted failure (the error event, then response.failed) happens only on a
  deliberately triggered fixed input, never as part of the simulated sequence (architect).
  Rejected: no failure path.
- emulator: a stateless POST `<base>/responses` serves the same scripted stream from one writer,
  proven by spike-ai-pipeline-client v0.4.0's GenerateStream in the Go tests. go.mod's go
  directive goes from 1.27 to 1.27.3, revising the layers decision. Rejected: mirroring the
  spec's JSON without the client.
- emulator: the README's spike-ai-pipeline-client pin moves from v0.1.0 to v0.4.0, and the
  architect keeps it current as that spike progresses.
- emulator: the standards-lab Go modules are public on proxy.golang.org, so the root needs no
  GOPRIVATE.

## Pending edits

- v1.client: `NewClient`, proven in spike-html-apps' `sdk` package, moves to go-web-service's
  `sdk/` and then go-web-sdk; the answer task fills in the result.
- v1.middleware: the CORS middleware measured for an external client; the answer task fills in
  what it needed.
- standards-lab `context/ai-strategy.md`, the capstone bullet: the capstone's UI builds on the
  spike-html-apps layer tags and the SDK's event-sequence interface; the answer task names the
  tags.
- standards-lab `context/roadmap.toml`, the spike-ai-pipeline summary: the same clause.
- standards-lab `context/roadmap.toml`, the `layers` task's summary: the task releases v0.1.0 of
  each layer, at a staged checkpoint per layer.
- standards-lab `context/roadmap.toml`, the `foundation` task's summary: in place of "Releases
  foundation v0.1.0, with components following its minor", it names the profile units,
  conformance for color, space, and type, and the releases: foundation v0.2.0, components v0.2.0
  on the foundation's formatters and peering `^0.2.0`, and the extension repository
  spike-html-apps-noctis at v0.1.0.
- standards-lab `context/roadmap.toml`, the `sdk` task's summary: "tested against a fake" becomes
  "tested against a pinned nats-server", and in place of "Releases sdk v0.1.0" it names upload
  with progress and the streamed response on the client, the router's change event and failure
  handling, and the release of sdk v0.2.0 (layers released v0.1.0).
- standards-lab `context/roadmap.toml`: the primitives task sets each layer's brotli budget
  (evidence 7).
- standards-lab `context/roadmap.toml`, the `emulator` task's `repos`: add spike-html-apps-sdk,
  so a defect the adapter's live cases find is fixed in that task.
- standards-lab `context/html-artifacts.md`, "Experiment: spike-html-apps", the live-transport
  bullet: the sdk proves the adapter against a pinned nats-server, and the emulator proves it end
  to end.
- standards-lab `context/roadmap.toml`: add spike-html-apps-noctis to the goal's `repos` and to
  the `foundation` task's `repos`.
- standards-lab `references.toml`: add spike-html-apps-foundation, -components, -sdk, and -noctis.
- standards-lab `.claude/marathon.toml` `[workspace.paths]`: spike-html-apps-noctis =
  "~/experiments/spike-html-apps-noctis".
- v1.middleware, facts for the answer task: rs/cors's latest tag is v1.11.1 (2024-08) while
  main stays active, with #220 (credentialed wildcard) and #222 (malformed origins) open;
  jub0bs/cors is the alternative to weigh; herald's CORS middleware (`HERALD_CORS_*`) is prior
  art.
- go-messaging backlog candidate: `nats.Config` has no credentials field, so an authenticated
  server's token rides in the URL, and `Start`'s error prints that URL.
