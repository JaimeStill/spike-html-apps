# goal · experiment.html.spike-html-apps

- **State:** idle
- **Task:** none
- **Branch:** none

## Tasks

1. [x] layers
2. [x] foundation
3. [x] sdk
4. [ ] emulator
5. [ ] primitives
6. [ ] pipeline
7. [ ] answer

## Task brief · experiment.html.spike-html-apps · sdk

**Problem.** The sdk is four handwritten declarations with no runtime: nothing routes, calls an
API, or carries a token, and the SDK has no live transport. The emulator, the primitives, and the
pipeline app build on a working client, router, and event sequence, and no later task touches the
sdk. So this task builds them, closes the gaps an audit of v0.1.0's declarations found (uploads
with progress, streamed responses, problem extensions, decoding, the router's change and failure
handling), and releases them together (evidence 1 and 3).

**Behaviors**

API client
1. Each call resolves to a Result and never rejects. A success's data is decoded by content type:
   JSON (application/json or any +json) parsed, text/* a string, any other type a Blob, and no
   body (204, 205, or empty) undefined.
2. A problem document (application/problem+json) keeps every member, extensions included; a
   missing title becomes "HTTP <status>". Any other failing response becomes an "about:blank"
   problem titled with its status text, or "HTTP <status>" when that is empty.
3. Client-made problems have status 0 and fixed titles: urn:standards-lab:problem:network
   ("Network error"), :abort ("Request aborted"), :timeout ("Request timed out"); a 2xx body that
   doesn't decode as its type claims is :decode ("Response not decodable"), carrying the status; a
   body that can't be encoded as JSON is :encode ("Request not encodable"), with nothing sent
   (escalation 1).
4. A path joins under the base with or without a leading "/" (base "/api" + "documents/5" or
   "/documents/5" → /api/documents/5). The base defaults to "/api" and may be an absolute URL on
   another origin. Request options take query parameters and headers.
5. FormData, Blob, ArrayBuffer and views, and URLSearchParams bodies are sent as they are; every
   other body as JSON with content-type application/json.
6. Each call carries `Authorization: Bearer <token>` when the provider has one, and none
   otherwise. On a 401 the client refreshes and retries once; with no new token it returns the
   401's problem. Concurrent 401s share one pending refresh. `anonymous` gives no token and never
   refreshes.
7. upload(path, body, options) sends over XMLHttpRequest, reports progress (bytes sent, total),
   aborts on the signal, and resolves to the same Result, problems, token, and 401 retry as every
   call. A retry restarts the progress.
8. stream(path, body?, options?) sends a POST with a body, else a GET, with Accept:
   text/event-stream. It resolves to a Result before the first event, with any failure up to then
   a problem (behaviors 2, 3, 6). On success the data is an async iterable of server-sent events
   (type, default "message"; data; id when set), parsed by the sdk's own WHATWG event-stream
   parser: BOM; CR, LF, CRLF; comments; multi-line data; a field with no value. The signal ends
   the iteration quietly; a network failure mid-stream throws an error carrying a :network problem.

Router
9. The base is the option, else the pathname of the `<base>` element's href, else "/". Patterns and
   navigate() paths are relative to it.
10. Once started, the router intercepts every same-origin navigation under the base that the
    Navigation API allows (link clicks, back and forward, navigate()), leaving reloads, downloads,
    fragment-only changes, form posts, and anything outside the base to the browser (reloads
    amended by escalation 1). The first
    matching pattern in table order wins; its element replaces the outlet's content with each path
    param as an attribute; current reports pattern, tag, params, and query.
11. A path no pattern matches mounts notFound; with no notFound, the outlet empties and current is
    undefined.
12. A rejecting loader, or a tag undefined once its loader resolves (the error names the tag),
    fails the route. On a navigation the router didn't start (a user's click, back or forward,
    another script's navigation) the URL is already committed: the router mounts the error
    option's element, or empties the outlet, and the Navigation API reports navigateerror. On
    start() it mounts the same way and start() rejects.
13. navigate(path, options) loads the route first. On failure it rejects with the URL, outlet,
    and current unchanged; otherwise it pushes an entry (or replaces with replace) and resolves
    once the element is mounted.
14. start() resolves once the current location's route is mounted. query(changes, options) sets
    parameters (undefined deletes), keeps the rest, replaces the entry by default, and resolves
    once current.query is updated, with the element still mounted. stop() stops intercepting.
15. The router is an EventTarget that dispatches "change" after each mount and query change, with
    current already updated.

Event sequence
16. `./events.js` declares CloudEvent<T> (specversion "1.0", id, source, type; optional subject,
    time, datacontenttype, dataschema, data; extensions in their own member), Cursor (an opaque
    string), and EventSequence, whose read({ after?, types?, signal? }) is an async iterable of
    deliveries (event and cursor), ended by the signal or a break.
17. A read with no cursor starts at the oldest kept event; with a cursor, at the event after it.
    types limits the read to those event types.

NATS adapter
18. `./events/nats.js` connects over WebSocket to the given servers and stream with the token
    provider's token. On an authorization failure it refreshes once and reconnects; with no token,
    the read fails. It reads a JetStream ordered consumer: deliver-all without a cursor, start
    sequence cursor+1 with one. The cursor is the stream sequence as a decimal string; a cursor
    the adapter didn't write fails the read. close() ends every read and the connection.
19. It decodes binary content mode as go-messaging nats/v0.2.0 publishes it: ce-* headers as
    attributes, other ce-* headers as extensions, content-type as datacontenttype. data decodes by
    datacontenttype (JSON parsed, text/* a string, otherwise a Uint8Array); data that doesn't
    parse ends the read with an error naming the event's id.
20. Against the pinned nats-server: the WebSocket transport, a refused token, order and resume
    from a cursor without gap or duplicate across reads, the type filter, decoding, and a server
    restart mid-read resuming after the last delivered event.
21. @nats-io/nats-core and @nats-io/jetstream are optional peers at ^3.4.0. Only `./events/nats.js`
    imports them; every other subpath loads without them.

Package
22. Emitted declarations equal v0.1.0's handwritten ones (kept as fixtures) except an expected
    list of differences: problem extension members; the :decode type; query and headers options;
    upload and stream; the router's error option and "change" event; start() and query()
    returning promises; the base's `<base href>` fallback; the new subpaths; and (escalation 1) the
    :encode type and `.ts` relative specifiers in place of `.js`. A sample domain service
    holding get, list, upload, and stream endpoints satisfies Service unchanged.
23. Every subpath is a .js module with types and default conditions; the pack is the build plus
    package.json, README, and LICENSE.

**Test seams.** The built package, loaded as a consumer loads it. The Node unit tier runs the
client, parser, event sequence, and adapter against a loopback HTTP server and the pinned
nats-server; the browser tier runs the router and upload in pinned chrome-headless-shell.

**Slices**

1. Upgrade: eslint-plugin-boundaries 7.3.0 → 7.4.0; remove the 11 typescript-eslint 8.72.1 age
   exclusions. Done when install, currency, and check pass (after 2026-10-28T15:27:58Z). Adapt the
   layers test's `.well-known` / `..x` cases if 7.4.0's dot-file fix changes them.
2. Runtime build and `anonymous` (behaviors 6's default, 22, 23): TS sources emitting .js and .d.ts,
   v0.1.0 declarations as fixtures, exports with types and default; the "spike-html-apps
   implements it" headers rewritten. Demo: `anonymous` imported from the pack.
3. API client (1–6) and the sample service's get and list. Demo: a script against a loopback
   server printing a success, an untitled problem, and a timeout.
4. Streamed response and parser (8). Demo: a loopback event stream printed event by event.
5. Browser tier adapted from the foundation's v0.2.0 (chrome-headless-shell at its current
   version), and the router (9–15). Demo: links, a deep link, back and forward, a failing loader,
   notFound.
6. Upload with progress (7). Demo: a browser page uploading to a loopback endpoint, progress logged.
7. Event-sequence declarations (16, 17), with a test-only in-memory sequence.
8. NATS adapter (18–21): nats-server v2.15.2 pinned in mise, started by the unit tier with
   WebSocket (no TLS, loopback), JetStream on a temp store, and a token; a JS publisher writing
   go-messaging's binary mode, citing its source. Demo: read, stop, resume from the cursor.
9. Service proof (22's sample); README, STANDARDS.md, context/README no longer "types only",
   optional peers named; version 0.2.0; CHANGELOG [0.2.0] with Changed naming the three breaks.

**Out of scope.** The root's currency (emulator task). The adapter's live cases against the
emulator and go-messaging's encoding end to end (emulator task). Structured content mode.
Performance figures. Real auth and OIDC (v1.auth). View Transitions. Firefox and WebKit
(evidence 9). Screenshots (no UI). The brotli budget (primitives task).

**Door.** One-way for the v0.2.0 tag: the subpath names (`./events.js`, `./events/nats.js`), the
declarations, and the cursor format ship frozen with it. Two-way for the rest.

**Release**
- spike-html-apps-sdk `v0.2.0` (cut by release.yml on merge)

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
