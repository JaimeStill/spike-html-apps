# goal · experiment.html.spike-html-apps

- **State:** idle
- **Task:** none
- **Branch:** none

## Tasks

1. [x] layers
2. [ ] foundation
3. [ ] sdk
4. [ ] emulator
5. [ ] primitives
6. [ ] pipeline
7. [ ] answer

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
  the release ages; the next currency pass removes the entries.
- layers: the components keep the copied `8ch` and `4ch` widths. They size content rather than
  space it, so the token rule doesn't apply.
- layers: the root's package currency scan doesn't read `github:` tag dependencies. The first task
  that makes the root depend on a layer by tag teaches it to, as spike-html-conventions'
  `scripts/currency.sh` does.
- layers: the emulator task checks whether the github.com/standards-lab Go modules need
  GOPRIVATE.
- layers: some declaration headers in the foundation and sdk still say "spike-html-apps implements
  it"; the foundation and sdk tasks rewrite them.

- plan: the emulator task generates go-web-sdk-template template/v0.13.0 with gonew into scratch
  and moves it to the root, replacing the layers stand-in (go.mod, the go mise task,
  .golangci.yml, currency's go.mod scan) with the template's own; `sdk/` and the Node half stay
  the spike's.
- plan: an app embeds its build as herald's `app` package does: `//go:embed` reaches only its own
  directory and below, so each `apps/<name>/` holds a Go file beside its `dist/` that hands the
  embed.FS to `sdk.NewClient`. The emulator task settles the layout with the pipeline app in
  view, and the ESLint app tier and Prettier ignores follow it.

## Pending edits

- v1.client: `NewClient`, proven in spike-html-apps' `sdk` package, moves to go-web-service's
  `sdk/` and then go-web-sdk; the answer task fills in the result.
- v1.middleware: the CORS middleware measured for an external client; the answer task fills in
  what it needed.
- standards-lab `context/ai-strategy.md`, the capstone bullet: the capstone's UI builds on the
  spike-html-apps layer tags and the SDK's event-sequence interface; the answer task names the
  tags.
- standards-lab `context/roadmap.toml`, the spike-ai-pipeline summary: the same clause.
- standards-lab `context/roadmap.toml`: the foundation task releases foundation v0.2.0 and the
  sdk task sdk v0.2.0, since layers released v0.1.0 of each. The primitives task sets each
  layer's brotli budget (evidence 7).
- standards-lab `context/roadmap.toml`, the `layers` task's summary: the task releases v0.1.0 of
  each layer, at a staged checkpoint per layer.
- standards-lab `references.toml`: add spike-html-apps-foundation, -components, and -sdk.
