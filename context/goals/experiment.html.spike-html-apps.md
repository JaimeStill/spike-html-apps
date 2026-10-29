# goal · experiment.html.spike-html-apps

- **State:** brief ready
- **Task:** primitives
- **Branch:** primitives

## Tasks

1. [x] layers
2. [x] foundation
3. [x] sdk
4. [x] emulator
5. [ ] primitives
6. [ ] pipeline
7. [ ] answer

## Task brief · experiment.html.spike-html-apps · primitives

**Problem.** The emulator runs live, but the capstone's UI has only three primitives (status
badge, entry, pagination): nothing yet shows a conversation, takes a message, uploads, follows a
run's stages, reads the event stream, searches, views an artifact, or lists documents. Until they
exist the pipeline task has nothing to compose, evidence 5 is unproven, and evidence 7's brotli
budget has no baseline. This task builds eight Lit shadow components in spike-html-apps-components
(chat thread, composer, upload dropzone, stage timeline, event log, search results, artifact
viewer, document list) to one bar, gives the carried-over components plain names, adds a Markdown
renderer on marked's lexer, sets each layer's brotli budget in its own check, and releases
components v0.3.0. Evidence 5, 7 (the budget), and 10.

**Behaviors**

Every component
1. Each of the eight is a Lit shadow component: properties in, events out through the
   foundation's emit (bubbling, composed); no SDK or domain import; each data property a
   structural shape it declares. No component binds a key; Enter, Shift+Enter, Escape, and every
   shortcut belong to the app.
2. In every state, every profile, light and dark, regular and compact: finished; keyboard-operable
   with visible focus; layout-only sheets on the foundation's tokens, native elements keeping
   spike-html-design's styling; brief motion that honours reduced motion; no layout shift as data
   arrives; sizes to content in any parent, shrink-to-fit included; a size, time, or id never
   breaks inside itself.
3. Each has a specimen page: every state labelled, again in a 20rem section, and one instance
   reached by Tab for focus. The browser tier renders each on page-full.css with register-full.js,
   with no error, in the four colors, compact, and sans, light and dark, and checks each facet's
   color, font, and padding reach the shadow root.

Names and package
4. The entry is `sl-entry`, the pagination `sl-pagination`; every tag is `sl-<name>`, every module
   `./<name>.js`; the old tags and modules are gone; the v0.3.0 CHANGELOG lists the rename as a
   break.
5. marked 18.1.2 is the second runtime dependency, pinned exactly as lit is; STANDARDS, the ESLint
   layer table, and the release test admit it, and the release test still rejects a range, a tag,
   or any other dependency. Only modules importing the Markdown renderer load marked: a page
   importing no Markdown-rendering component requests no marked module.
6. The foundation stays peered `^0.2.0` from its v0.2.0 tag. A pattern kept local that more than
   one component shares (motion durations, the visually-hidden rule, …) is recorded in the
   components' context notes under "foundation candidates" (where, why shared, the foundation
   shape it could take), and the goal record gains a pending edit adding a foundation-extension
   entry to the coordinator roadmap's backlog.

Screenshots
7. The screenshot run takes `--page <name>` (repeatable) and `--scheme light|dark`, combining with
   the profile flags. An unknown page prints the registered pages and exits 2 before any capture.
   With neither flag it captures every page in both schemes, as before.

Markdown
8. The renderer turns marked's lexer tokens into Lit templates: headings, paragraphs, emphasis,
   strong, code spans, fenced and indented code, nested ordered and unordered lists, blockquotes,
   rules, links, GFM tables. Raw HTML, block or inline, shows as literal text; no sanitizer, since
   Lit escapes every text value.
9. A link is an anchor only for http, https, mailto, or relative URLs; any other scheme renders
   its text without an anchor. An image token renders as its alt text, never an `<img>`.
10. Partial input renders in place as it grows, with no error: an unclosed fence is a code block of
    what has arrived; a half-built list renders its items so far.

Chat thread
11. Takes a list of items, a structural subset of Open Responses 2026-04-24, rendered in order:
    message parts (`input_text` plain, `output_text` Markdown, `refusal` as a distinct refusal),
    reasoning items, `function_call` (name and arguments), `function_call_output`. Unknown item
    and part types are skipped with no error; no images or audio.
12. An `in_progress` message reads as streaming; as its `output_text` grows the Markdown
    re-renders and content above doesn't move. `incomplete` and `failed` each have a finished
    state.
13. `verbose` false (default) hides reasoning, `function_call`, and `function_call_output`;
    true shows each collapsed in native `<details>`. Messages and refusals always show.
    Display-only.
14. Specimen states, each verbose off and on: empty, an exchange, streaming (open fence; half-built
    list), refusal, incomplete, failed, reasoning and tool calls, an unknown item among known ones,
    long content, narrow.

Composer
15. Multi-line field with a send control: send emits `send {text}` and clears; unavailable while
    empty or whitespace. `busy` swaps send for stop, emitting `stop {}`. `disabled` blocks typing
    and sending. Grows with its text to a bound, then scrolls. Enter does only what the native
    field does.

Upload dropzone
16. Files enter by drop or a keyboard-operable picker, several at once; either emits
    `files-select {files: File[]}`. Dragging over shows a drag-over state.
17. Takes uploads (id, name, size, bytes sent, state: uploading, done, failed with message,
    cancelled); native progress while uploading; an uploading item's cancel emits
    `upload-cancel {id}`; sizes via the foundation's formatters. States: idle, drag-over,
    uploading, done, failed, cancelled, disabled, many files, narrow.

Stage timeline
18. Takes ordered stages (name, position, state pending|active|complete|failed, optional
    completion time); shows state and formatted time; an advancing stage changes in place.
    Display-only. States: all pending, part way, complete, failed, narrow.

Event log
19. Takes events (id, type, source, subject, time, JSON data), shown in order with each one's data
    pretty-printed on demand; new events append without moving those shown. Display-only. States:
    empty, live appending, long, narrow.

Search results
20. Takes a query, matches (id, name, field, snippet), loading and error. The query's
    case-insensitive occurrences in a snippet are marked as text, never parsed HTML. Activating a
    match emits `open {id}`. States: idle, loading, no matches, matches, error, long snippet,
    narrow.

Artifact viewer
21. Takes a name, content type, and content: text/markdown as rendered Markdown (8–10); JSON or
    +json pretty-printed, 2-space, in a `<pre>`; other text types preformatted. Unparseable JSON
    shows raw text in a labelled error state; an unsupported type a labelled state, not bytes;
    loading and error states; long content scrolls within. Display-only.

Document list
22. Composes `sl-entry` and `sl-pagination`, passing the pagination's properties through; adds a
    selected id marked on its entry for assistive technology, and empty, loading, and error states.
    The entry's `open` and the pagination's `page-change` and `page-size-change` reach the list's
    listener unchanged. States: empty, loading, a page, selected, error, last page, narrow.

Budget
23. Each layer's unit tier checks a brotli budget beside its release test: the sum over the
    package's runtime `.js` and `.css` of each file's node:zlib brotli size, dependencies (lit,
    marked) not counted. Over budget fails the check, naming size and budget.
24. Foundation, components, and sdk budgets are each the baseline measured once the eight
    components are built, plus 10%, rounded up to whole KB; the session brief records each.

**Test seams.** The component as a custom element in a page: the browser tier loads `dist/` in
pinned chrome-headless-shell, sets properties, reads the shadow DOM and events on the host. The
renderer through its components and directly through its export in the same tier. The screenshot
command line and each layer's budget test are their own seams.

**Slices**
1. Upgrade spike-html-apps-foundation: node 26.13.0, pnpm 12.16.1, chrome-headless-shell
   156.0.8078.73, eslint-plugin-boundaries 7.4.0; remove any @boundaries/elements age exclusion as
   the sdk did. Done at currency exit 0 and check passing; merges with no tag. (sdk is current.)
2. Upgrade spike-html-apps-components: the same four items and exclusion check.
3. Screenshot control (7). Demo: `--page entry --scheme dark`; an unknown page exits 2 listing pages.
4. Plain names (4). Demo: check passes; old tags absent from `dist/`.
5. The Markdown renderer (5, 8–10). Demo: raw HTML, rejected schemes, partial fences and lists;
   a page without the renderer loads no marked module.
6. Artifact viewer (21) — stop.
7. Chat thread (11–14) — stop, each state verbose off and on.
8. Composer (15) — stop.
9. Upload dropzone (16, 17) — stop.
10. Stage timeline (18) — stop.
11. Event log (19) — stop.
12. Search results (20) — stop.
13. Document list (22) — stop.
14. Budgets (23, 24) across foundation, components, sdk; foundation and sdk merge with no tag.
    Demo: each layer's check, and one over-budget run that fails naming its numbers.
15. Release and foundation candidates (6): components 0.3.0, `[0.3.0]` CHANGELOG (rename, marked,
    eight components); the "foundation candidates" section and the backlog pending edit. Demo:
    the release test on the 0.3.0 pack.

A **stop** (6–13) is a design review: `mise run screenshots --page <component>` at the default
profile, light and dark, plus its passing browser cases; BUILD waits for the architect's
acceptance before the next slice. The session brief carries `--all` for every new page.

**Out of scope.** Wiring to the emulator, the app's key table, and the walkthrough (pipeline
task); a foundation release or any foundation change beyond its upgrade and budget test (a shared
need escalates); SDK changes beyond its budget test; a sanitizer, syntax highlighting, a JSON tree,
images and audio in the thread, an embedding-space panel, toast, image viewer; Firefox and WebKit.

**Door.** One-way for the `v0.3.0` tag only. Everything else is two-way: foundation and sdk merge
with no tag, and the components' branch is revertible before SHIP.

**Release.** spike-html-apps-components `v0.3.0`.

## Progress

slices 15/15 committed · standards done · spec done (no gaps) · editor done

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
  capstone's compose stack, as premature engineering for a client spike. Revised by emulator: the
  template's integration tier stays and runs in check, with no compose stack.
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
  Done by emulator.
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
  Go 1.27.3. The root sets `GOWORK=off` and `GOTOOLCHAIN=local`. Revised by emulator: go.mod names
  `go 1.27.3`, the version spike-ai-pipeline-client v0.4.0 requires.
- layers: the root's Go steps keep the template's `-tags integration`, though the root has no
  integration tier yet, so an integration suite compiles and lints when one comes. Done by
  emulator, whose integration suite carries the tag.
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
  `scripts/currency.sh` does. Done by emulator.
- layers: the emulator task checks whether the github.com/standards-lab Go modules need
  GOPRIVATE. Done by emulator: they don't.
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
  @boundaries/elements entry, and removes the exclusions. Done by emulator.
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
- emulator: the template was generated by hand, as a git archive of go-web-sdk-template's
  template/ with the module path rewritten, because the gonew mise shim couldn't resolve a Go
  version. A generated file carries no provenance line, since it is the template's intended
  output; a file copied by hand carries one.
- emulator: the root keeps its `go` task name. From the template's tasks only `test:integration`
  and `serve` were added. Currency reads the go directive with node, not jq. The template's
  README, LICENSE, and CI were left out.
- emulator: an empty allowed-origins list makes the CORS middleware a pass-through, because rs/cors
  reads an empty list as every origin. The middleware panics on an invalid origin or on no
  methods. Every response carries Vary: Origin. The caller names the methods; the root passes GET,
  HEAD, and POST. A refused preflight is answered 204 with no CORS headers.
- emulator: with an empty origins list, the NATS WebSocket listener uses nats-server's
  SameOrigin check, which refuses every cross-origin upgrade. A client that sends no Origin is
  admitted with the token.
- emulator: the NATS ports are fixed, never 0, because the broker's URL is built before the server
  binds. Outside the process, the store path shows only in the "nats started" log line, which the
  integration and browser tiers read. nats-server logs through the service's logger, with NoSigs.
- emulator: the unit tier replaces the broker node with memory.Broker through
  App.Graph().Replace, so the graph never builds the embedded server.
- emulator: a run's schedule is anchored at its start: stage k is due at start + (k-1) × interval.
  The reactor ticks at a fifth of the interval. A stage's event is published before the stage is
  marked complete, and a failed publish is retried under the same event id, `<runID>.<position>`.
- emulator: document content is served as an attachment, never inline, following go-web-service.
  Inline previews would need a change.
- emulator: each search match carries a `field`, name or content, and a snippet of up to 40 runes
  on each side of the match with U+2026 ellipses. Search scans every document, with no index.
- emulator: POST /messages takes {"text"}. The failure trigger is exactly `/fail`, and the failed
  partial item's status is `incomplete`. Concurrent turns on one conversation aren't serialized.
  Listings carry each conversation's history. A reply lifts its connection's write deadline by
  the script's duration through http.ResponseController.
- emulator: the pipeline app's routes are custom elements, since the sdk router mounts by tag.
  vite.config.ts sits at the repository root, because the app tier forbids importing vite inside
  apps/. The app hardcodes the event type `emulator.run.stage`, since the shell's config carries
  no prefix. The log keeps its last cursor in sessionStorage, and forgets it when a read fails
  before showing anything.
- emulator: NewClient never serves a dotfile, the manifest included. Only files under the
  manifest's directories are cached as immutable; any other file is no-cache. A bare prefix
  redirects (301) to the prefix with its trailing slash. A deep link whose last segment has an
  extension is a 404, not the shell. The shell adds modulepreload links for the entry's static
  imports. `nats.websocket.public_url` is a setting of its own. The app's title is a constant.
- emulator: check builds the app: `test:integration` and `test:browser` depend on `build:app`,
  which writes the gitignored dist/ and then re-creates dist/.gitkeep. The `go` task waits for
  `build:app`, so the Go steps never compile a half-written build.
- emulator: config.local.json allows http://localhost:8080 and http://127.0.0.1:8080, because the
  app's origin and the NATS WebSocket port differ.
- emulator: both harnesses relaunch a boot that failed on a taken reserved port, up to 5 launches,
  and only on address-in-use. The browser tier serves a page whose shell or origin a test changes
  through a loopback proxy, because Chrome's Local Network Access check blocks a page served by
  DevTools Fetch from opening loopback WebSockets.
- emulator: the pipeline app's config requires a non-empty token.
- emulator: go-messaging moved to v0.2.0 and nats.go to v1.55.0 during BUILD, keeping currency
  silent.
- emulator: shipped. The emulator, NewClient, CORS, embedded NATS, the pipeline app's first build, and the root's browser tier merged (spike-html-apps PR, after spike-html-apps-sdk's pin bump merged with no tag); accepted by the architect after running it live.
- primitives: Markdown renders from marked 18.1.2's lexer as Lit templates, with no sanitizer,
  since Lit escapes every text value; the Sanitizer API isn't in Safari 26.2, and DOMPurify adds
  10.5 KB. Rejected: markdown-it (38.6 KB, 6 dependencies), micromark (about 15), and a
  hand-built parser.
- primitives: every tag is a plain `sl-<name>`; sl-entry-lit-shadow and sl-pagination-lit-shadow
  become sl-entry and sl-pagination, a break that v0.3.0's CHANGELOG lists.
- primitives: the chat thread shows message items (input_text as plain text, output_text as
  Markdown re-rendered as deltas arrive, refusal labelled), reasoning, function_call, and
  function_call_output, with no images or audio. It skips unknown item and part types, and the
  system and developer roles. `verbose`, false by default, hides reasoning and tool calls.
- primitives: JSON shows pretty-printed, 2-space, in a `<pre>`. Rejected: a JSON tree.
- primitives: the document list composes sl-entry and sl-pagination, the architect's example of
  compositional layering.
- primitives: the composer sends `send` and `stop`, the upload dropzone `files-select` and
  `upload-cancel`, and the search results `open`; the document list's `open`, `page-change`, and
  `page-size-change` are its parts' own events, bubbling and composed, never re-dispatched. The
  other components send none.
- primitives: no foundation release. Patterns the components share locally go in the components'
  context note `foundation-candidates.md`, for a foundation-extension backlog entry (architect).
- primitives: each component's slice ends at a design-review stop, on the screenshot run's new
  `--page` and `--scheme` flags.
- primitives: the architect added a spike task, `tooling`, for a shared screenshot and
  browser-test tooling package; it reaches the roadmap as a pending edit.
- primitives: each layer's brotli budget lives in its own check, so the foundation and sdk join
  the task's repos. It sums each runtime `.js` and `.css` file's node:zlib brotli size,
  dependencies not counted, against the baseline plus 10%, rounded up to whole KB. Rejected:
  size-limit.
- primitives: a KB is 1,000 B, and each budget is a constant in the layer's release test, raised
  in the commit that needs more. Rejected: a package.json field, since package.json ships in the
  pack and the budget belongs to the check (implementer, slice 14).
- primitives: the artifact viewer is one frame, its name and type a header row; overflow shows
  the browser's own scrollbars, with padding at the scroll's end; it has no default height cap,
  so the consumer sizes it and it scrolls inside. Rejected: scroll shades (architect's review).
- primitives: the browser driver shows scrollbars on every page, so the browser tier and the
  screenshot run paint them as a user's browser does, and the screenshot run grows its viewport to
  the page's height before capturing, since Chromium paints a region's scrollbars only inside the
  viewport (implementer, slice 6).
- primitives: the chat thread is accepted as the starting point; fine tuning waits for the
  capstone, where the primitives are seen together. It is an ordered list of articles, not
  role=log, with no loading or error state of its own (architect's review).
- primitives: the composer's send and stop are one button whose label swaps; typing stays
  allowed while busy; disabled outranks busy; the field clears before `send` (architect's review).
- primitives: each upload row groups its size with its name: a finished row's label sits at its
  end, and an uploading row keeps a full-width bar, with Cancel on the name's line. The specimens'
  fit parents pad their component (architect's review).
- primitives: the upload dropzone doesn't filter a drop by `accept`, which is only a hint to the
  picker; the app validates what arrives by either path (implementer, slice 9).
- primitives: the stage timeline shows absolute times to the second with the full date, is
  vertical at every width, and sorts its steps by position (architect's review).
- primitives: a component with nothing interactive, such as the stage timeline, has no focus
  specimen, and the screenshot run presses no Tab on its page (implementer, slice 10).
- primitives: the event log is role=log, polite, additions only, and follows the newest event
  only when the reader is already at the end. Below 30rem each metadata pair stacks label over
  value; the emulator's ids fit at 20rem as they are (architect's review).
- primitives: the event log keys events by source and id, the pair CloudEvents makes unique, so
  one id from two sources is two events (implementer, slice 11).
- primitives: the search results' matches property is `items`, since `matches` would shadow
  Element.matches(). The query is marked in the name and the snippet code point by code point, as
  the emulator folds case; snippets stay in the UI font (architect's review).
- primitives: a selected document is shown by outlining its entry's frame. Rejected: a bar column
  (architect's review). The carried-over sl-entry is reworked in this task: the name leads over a
  quiet status and kind, the kind opens the meta line in place of a column, and the meta wraps
  between values.
- primitives: sl-entry's `selected` is a visual mark only, and the entry sets no ARIA; the
  consumer says it to assistive technology, as the document list does with `aria-current` on its
  item (implementer, slice 13).
- primitives: a selected entry focused by the keyboard shows the focus ring alone; its frame
  returns when focus leaves (architect's review).
- primitives: sl-pagination gains a `status` slot on its summary's line and exports
  `summaryRange()`, so the document list's status never leaves a blank line under the summary.
- primitives: DocumentItem has the emulator's document fields (`content_type`, `created_at`) with
  a run status beside them, and the document list maps each onto the entry's file. Rejected: the
  entry's own item shape as the list's input (implementer, slice 13).

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
- standards-lab `context/roadmap.toml`, the `primitives` task's summary: name what it built: the
  eight components, the Markdown renderer on marked 18.1.2, the sl-entry and sl-pagination rename,
  each layer's brotli budget in its own check (evidence 7), and the release of components v0.3.0.
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
- v1.client, NewClient's measured shape, for the answer task: `NewClient(dist fs.FS,
  ClientOptions{Base, Title, Entry, Config})`, reading Vite's manifest once. At the root it is
  the router's not-found handler, so it answers only what no module or native route claims;
  under a prefix it is a handler module, and the bare prefix redirects (301) to prefix/. A path
  under the manifest's directories, a dotfile path, or a last segment with an extension, with no
  file behind it, is a 404 problem, never the shell.
- standards-lab `context/roadmap.toml`, the `emulator` task's summary: name what it built: the
  four domains and the stateless responses route, proven with spike-ai-pipeline-client v0.4.0's
  GenerateStream; embedded NATS with the token on both listeners; NewClient and CORS in the
  spike's `sdk` package; the integration tier; and the browser tier in pinned
  chrome-headless-shell, running the adapter's live cases and two instances. The `repos` edit
  above adds spike-html-apps-sdk.
- standards-lab `context/roadmap.toml`, the `primitives` task's `repos`: add
  spike-html-apps-foundation and spike-html-apps-sdk, for each layer's budget test.
- standards-lab `context/roadmap.toml`: add a task `tooling` to experiment.html.spike-html-apps,
  between `primitives` and `pipeline` (the architect's request during primitives): a shared,
  tag-released dev-tooling package for the screenshot utility and the browser tier, with modules
  for the pinned chrome-headless-shell launcher over the pipe, the static server, the profile and
  scheme matrix, tiled capture with Tab-reached focus, and the `--page`/`--scheme`/profile CLI,
  replacing the copies of browser-pipe.js (root, foundation, components, sdk, noctis), server.js
  (foundation, components, sdk, noctis), and screenshots.js (foundation, components, noctis),
  which have drifted (components' screenshots.js 296 lines with --page/--scheme, the
  foundation's 145). A new repository joins the goal's `repos` and `[workspace.paths]`.
- standards-lab `context/roadmap.toml`, backlog: a foundation-extension entry (the architect's
  request during primitives): a later foundation minor that takes the patterns the components
  keep locally, staged from the "Foundation candidates" note in spike-html-apps-components'
  context, among them a control block-size token, status colour tokens, a disabled text-field
  look, a dark-aware `<progress>` track, a "keep whole" rule, ellipsis truncation, the
  scrolling-frame recipe, `formatJson`, and `formatBytes(0)`'s wording.
- primitives baselines, for the answer task (evidence 7): brotli per file, quality 11, text
  mode, KB = 1,000 B: foundation 43,595 B over 39 files, budget 48 KB; components 36,070 B over
  23 files, budget 40 KB; sdk 11,669 B over 7 files, budget 13 KB.
