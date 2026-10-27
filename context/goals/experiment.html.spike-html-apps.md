# goal · experiment.html.spike-html-apps

- **State:** handoff
- **Task:** foundation
- **Branch:** foundation

## Tasks

1. [x] layers
2. [x] foundation
3. [ ] sdk
4. [ ] emulator
5. [ ] primitives
6. [ ] pipeline
7. [ ] answer

## Task brief · experiment.html.spike-html-apps · foundation

**Problem.** The foundation declares five formatters with no runtime. It ships only
spike-html-design v0.7.0's default profiles, with no stored preference and no theme menu, and it
still uses spike-html-design's page-wide names. Every UI task after this one is reviewed per
state and profile, so the profiles, the menu, and a screenshot baseline must exist first
(evidence 2 and 10).

**Behaviors**

1. formatBytes, formatDate, formatDateTime, formatRelative, and formatDuration run. Their emitted
   declaration matches foundation v0.1.0's handwritten one exactly.
2. formatBytes picks the largest base-1000 byte unit (byte to petabyte) that keeps the value at 1
   or more, and passes the caller's other Intl.NumberFormat options through.
3. formatDate defaults to dateStyle "medium". formatDateTime adds timeStyle "short". Each default
   applies only when the caller sets no date or time field, so a caller's year or hour never
   throws.
4. formatRelative uses the largest whole unit from seconds to years. Weeks count, months are 30
   days, years are 365 days, and values are truncated. "Now" is options.now when given.
5. formatDuration splits milliseconds into whole days, hours, minutes, and seconds through
   Intl.DurationFormat, with style "short" by default. Zero, and anything under one second,
   prints zero seconds, never "".
6. The registry symbol, the keys family's symbol and settings key, and the preferences storage
   key are all named "spike-html-apps-foundation.<name>". No "spike-html-design." name remains.
7. Each built-in profile is a unit: its sheet and its own registration module, at the public
   subpaths ./profiles/<facet>/<name>.css and ./profiles/<facet>/<name>.js. A page composes the
   lean page entry with whichever units it links. The full page entry (page-full.css) and its
   registration module (register-full.js) are plain aggregators of the built-in units: they
   import them and define nothing a profile needs in order to register or apply. The lean page
   entry and register.js carry only the defaults.
8. Every profile computes as v0.7.0's does, in light and in dark.
9. Preferences: a stored choice applies before first paint. A profile name the page didn't
   register falls back to that facet's default and stays stored. Blocked storage reads as
   nothing stored and never throws. Another tab's save applies live, except while the menu is
   open.
10. `<sl-theme-menu>` opens on its "--open" invoker command and binds no key. The menu module is
    not fetched before the first open.
11. The menu is a modal native dialog in light DOM. It has a radio row for color, scheme, space,
    and type, and a live preview. Every change applies at once to the preview and the page.
12. Menu keys: T or Save stores once and closes. Escape or Cancel restores what applied when the
    menu opened (or another tab's save) and stores nothing. j/k and the up and down arrows move
    between rows; h/l and the left and right arrows cycle a row. Every key the menu handles stops
    at the dialog. A held T or Escape does nothing, and a backdrop click does nothing.
13. The menu's sheet is a .css file imported as a CSS module script and adopted onto the document
    once, in the layer foundation.theme-menu. That layer comes after foundation.utilities and
    under every consumer layer, and both page entries name it in their order statements. Rows sit
    beside the preview at 48rem and wider, and above it when narrower.
14. `mise run screenshots` covers 12 profiles: 4 colors × light and dark at the defaults, plus
    compact and sans × light and dark. The foundation captures 4 states (tools page, keys help
    open, menu open wide, menu open narrow): 48 captures. The components capture one specimen page
    each (status badge, entry, pagination), with every state on the page, at a narrow width and
    with focus visible: 36 captures. Images render into a temporary directory, are shown inline
    with kitty icat, and are removed on exit. check never runs the task; no screenshot is
    committed.
15. Extension: a profile from outside the package joins exactly as a built-in unit does, by
    linking its sheet after the page entry and importing its registration module. It then
    appears in the theme menu and applies by attribute and by stored choice, with no change to
    the foundation.
16. ./conformance.js exports check(facet, name) and RULES for all three facets, read through
    computed values only. Color has v0.7.0's seven rules. Space and type each have the
    structural rules (tokens, facet-only, layer, specificity, registered) plus one derived rule:
    for space, the nine-step scale ascends strictly from its base; for type, the step scale
    ascends strictly and each font stack resolves to a family. Every built-in profile passes. A
    fixture profile breaking each rule fails by that rule's name.
17. spike-html-apps-noctis, a standalone repository outside the layers, ships one color profile,
    "noctis": Noctis Hibernus as the light half and Noctis Obscuro as the dark half, credited as
    the built-in profiles credit their upstreams. It installs foundation v0.2.0 by tag, and its
    tests prove behavior 15 for noctis and that check("color", "noctis") passes. It releases
    v0.1.0.
18. The components peer the foundation at ^0.2.0 and install it by tag v0.2.0. The entry formats
    size and time with the foundation's formatBytes and formatDateTime, with output unchanged.
    Every existing component case holds under every profile.

**Test seams.** Each layer's built package, loaded as a consumer loads it: the formatter exports
in the unit tier, and the pages, entries, and modules in the pinned headless browser tier.

**Slices**

Foundation:
1. Upgrade: remove the typescript-eslint 8.72.1 age exclusions. The slice is done when install,
   currency, and check pass after 2026-10-27T17:09:43Z.
2. Formatters (behaviors 1–5): the TypeScript lib moves to es2025 for Intl.DurationFormat, the
   "spike-html-apps implements them" header is rewritten, and the README drops "types only".
3. Names (behavior 6).
4. Profiles and the full entry (behavior 8).
5. Preferences, `<sl-theme-menu>`, and the menu (behaviors 9–13).
6. Profile units (behaviors 7 and 15): each built-in profile becomes a sheet plus a registration
   module at ./profiles/<facet>/<name>, and the full entry and register-full become aggregators
   of them. Demo: a page links page.css plus one unit, and the menu lists it.
7. Conformance for color, space, and type (behavior 16), with fixtures that conform and fixtures
   that break each rule.
8. Screenshots (behavior 14, foundation part), version 0.2.0, and a CHANGELOG [0.2.0] section.
   - **CHECKPOINT:** the foundation's checkpoint brief, with its 48 captures. Before asking for
     acceptance, the session stops for the architect's review: it runs `mise run screenshots`
     inline, gives the branch's diff against `main` with the files behind each capture, and
     waits while the architect looks through them. Only after that review does the architect's
     acceptance authorize the merge and the v0.2.0 tag. No later slice starts before the tag
     exists.

Noctis:
9. The repository (behavior 17): created public and Apache-2.0, with an init commit and the
   layers' main ruleset, its check, CI, release.yml, STANDARDS.md, and CHANGELOG, installing
   foundation #v0.2.0.
10. The noctis profile and its extension tests (behaviors 15 and 17), version 0.1.0, and a
    CHANGELOG [0.1.0] section. Demo: a page on page.css plus noctis, with the menu.

Components:
11. Upgrade: remove the age exclusions, and move the foundation install to tag v0.2.0 and the
    peer to ^0.2.0.
12. The entry on the foundation's formatters (behavior 18).
13. Specimen pages and screenshots (behavior 14, components part), version 0.2.0, and a
    CHANGELOG [0.2.0] section. Then the session brief, with its 36 captures and noctis's. The
    same review comes first: `mise run screenshots` inline, the diffs against `main`, and a wait
    for the architect's review before acceptance. Nothing is published, merged, or tagged until
    the architect accepts.

**Out of scope.** The sdk's stale headers, and the root's and sdk's age exclusions (other
repositories). The app's key table and its `t` binding (pipeline task). The eight new components
and the brotli budgets (primitives task). The review script (spike-html-hosting). v0.7.0's
Firefox and WebKit (evidence 9). Pixel diffs and committed screenshots.

**Door.** One-way for the three release tags and the new public repository: a pushed tag reaches
consumers and is never re-cut, and the stored names and ./profiles subpaths it ships are frozen
with it. Two-way for the rest.

**Release**
- spike-html-apps-foundation `v0.2.0` (at the checkpoint)
- spike-html-apps-noctis `v0.1.0` (at the session brief)
- spike-html-apps-components `v0.2.0` (at the session brief)


## Handoff

- Next move: fix the components' failing PR check, then merge components PR #2 (release
  v0.2.0), then publish and merge the root's `foundation` branch.
- Failing check: components CI on PR #2, run 40586651841. "from 20rem down to 14rem, every part of
  the entry keeps inside its button ..." fails in flexoki/regular/mono/light at 14rem:
  brand-guide.pdf overflows its button by 3px. It passes locally; the runner's monospace font
  differs. Proposed fix: make 16rem the documented minimum, where local overflow was 0 with
  margin, and drop 14rem from the case.
- Done: noctis PR #1 merged (4066fdf), v0.1.0 released (tag on release commit 2fdc0cd).
  Foundation v0.2.0 released earlier.

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
  never inside a word, so the entry stays inside its box down to 14rem, its documented minimum.
  Below that the 9ch kind column leaves the clock and the status no room. Whole dates overflowed
  by 16–25px at 14rem (session, after the components spec re-review).
- foundation: the components' screenshots are captured in tiles of at most 1200px, cut at section
  or state tops, and shown with icat `--fit=both`. Full-height pages, up to 6457px, left the
  architect's terminal stuck below the image (architect's review).
- foundation: the components' screenshots default to one short sequence, each page in light and
  dark at flexoki, regular, and mono. `--palette <name>`, `--space <name>`, and `--type <name>`
  each pick that facet's profile for the run, so a reviewer runs compact or sans as its own short
  sequence. `--all` keeps the full 12-profile matrix (architect, escalation 7).

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
- standards-lab `context/roadmap.toml`: the sdk task releases sdk v0.2.0, since layers released
  v0.1.0, and the primitives task sets each layer's brotli budget (evidence 7).
- standards-lab `context/roadmap.toml`: add spike-html-apps-noctis to the goal's `repos` and to
  the `foundation` task's `repos`.
- standards-lab `references.toml`: add spike-html-apps-foundation, -components, -sdk, and -noctis.
- standards-lab `.claude/marathon.toml` `[workspace.paths]`: spike-html-apps-noctis =
  "~/experiments/spike-html-apps-noctis".
