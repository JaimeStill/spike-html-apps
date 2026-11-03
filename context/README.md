# spike-html-apps

spike-html-apps builds the application SDK spike-html-conventions declared, the foundation's
formatters and spike-html-design's theming, the UI primitives spike-ai-pipeline's capstone needs,
and the Go handler that serves an embedded Vite build. It releases the foundation, components,
and SDK layers by tag from repositories of their own, and composes them into a pipeline app over
a minimal Go pipeline emulator and into an external client over two services, holding the design
to a finished product's bar at every layer. Its answer is evidence for experiment.html's intake on
v1.client's app architecture and on whether an external-client goal follows 1.0, and the
capstone's UI starts from its releases. The spike decides nothing itself; GitHub Pages hosting is
spike-html-hosting's.

The spike is the sub-goal `experiment.html.spike-html-apps` in the coordinator's roadmap,
`standards-lab/context/roadmap.toml`, where its tasks live. Its question is framed in
`standards-lab/context/html-artifacts.md`, under "Experiment: spike-html-apps".

## The question

What does a client application on experiment.html's stack look like, and do its layers hold up
when they compose the capstone's UI primitives, live over a backend?

## The evidence

All ten are built; "The answer" names where each is proven.

1. The SDK runtime: the router (URLPattern and the Navigation API; base, deep link, reload, back
   and forward), the API client (a Result that fails as an RFC 9457 problem, the title filled
   when go-web-sdk omits it; upload with progress; streamed responses), the anonymous token
   provider, and the domain service, whose declarations match sdk v0.1.0's except for the
   additions and breaks sdk v0.2.0's CHANGELOG lists.
2. The foundation's Intl formatters, against foundation v0.1.0's `format.d.ts`.
3. An event-sequence interface in the SDK: an ordered stream of CloudEvents, resumable by an
   opaque cursor (the JetStream stream sequence), with a NATS-over-WebSocket adapter reading an
   ordered consumer, tested against a pinned nats-server in the sdk and live against the
   emulator in the root.
4. The Go serving half, `NewClient`, serving the app at `/app` and at the server's root, with
   Vite's `base`, the shell's `<base href>`, and the router's base agreeing; in the spike's own
   `sdk` package, shaped as go-web-service's `sdk/` stages it.
5. Eleven primitives as Lit shadow components: properties in, events out, no SDK or domain
   import, keyboard-operable, layout-only sheets, no key bound. New: chat thread, composer,
   upload dropzone with progress, stage timeline, event log, search results, artifact viewer
   (text, JSON, Markdown), and document list; carried over: status badge, entry, and pagination.
6. A pipeline app, `apps/pipeline/`, composing them live over the emulator, embedded in its
   binary.
7. The layers clean at scale: zero direction violations, and no layer enforcing a budget. The
   experiment's final review before intake measures the layers as a whole bundle, gzip and
   brotli, against peer libraries' published sizes, and sets the resulting budget (architect).
8. An external client, `apps/external/`, hosted apart, calling two emulator instances
   cross-origin under CORS the spike owns, with a base and token provider for each.
9. Consumption by tag from outside the spike, and the gaps: Firefox and WebKit, real auth, real
   inference, and persistence. The dated table and the gaps are in "The answer", under
   "Consumption by tag" and "The gaps".
10. Quality at every layer, judged as a finished product: the foundation renders
    spike-html-design's native styling and every profile without regression; each component is
    finished in every state and profile, with visible focus, motion that honours reduced motion,
    and no layout shift; the app's full sequence (upload, stages live, chat, search, artifact)
    reads as one product.

## The emulator

One Go binary generated from go-web-sdk-template template/v0.13.0, with all state in memory.
`cmd/server` starts it and `internal/app` composes it. It reads `config.json`, overlaid by
`config.<EMULATOR_ENV>.json`, and environment variables under the `EMULATOR_` prefix. Each of its
four domains is a package under `domain/`, served under `/api`:

- `document` (`/api/documents`): a raw-body upload, its metadata, and its content, served as an
  attachment.
- `run` (`/api/runs`): the stages each upload starts, upload → metadata → extraction → chunks →
  embeddings, one per interval. Each completed stage publishes one `emulator.run.stage`
  CloudEvent. The test seam for a failed run is configuration, `runs.fail` (`EMULATOR_RUNS_FAIL`,
  comma-separated): each rule `<pattern>:<stage>`, a `path.Match` pattern over the uploaded
  document's name, so under `fail-at-*:extraction` an upload named `fail-at-extraction.txt`
  fails there. The run's status reads `failed`, the stage `failed` with `failed_at` and `reason`,
  and in place of that stage's event the run publishes one `emulator.run.failed` CloudEvent (id
  `<run>.failed`), whose data is the stage event's with `reason`; it advances no further. The
  test seam for a run under way is its counterpart, `runs.hold` (`EMULATOR_RUNS_HOLD`), in the
  same rule syntax: under `held-*:extraction` an upload named `held-brief.txt` completes and
  publishes upload and metadata, then stays `running` with extraction the first `pending` stage,
  the one a reader shows under way, for as long as the emulator runs; nothing releases it, and no
  event is published for the held stage. A name both kinds of rule match stops at the earlier of
  their stages, and fails when they name one stage.
- `conversation` (`/api/conversations`, and the stateless `/api/responses`): a scripted Open
  Responses stream. A user message whose text is exactly `/fail` takes the failure path, and one
  exactly `/rich` streams the rich reply: reasoning, a function call with its output, then a
  Markdown message, so the chat thread shows its whole range. Both are test seams, not client
  APIs, and the stateless route takes only `/fail`.
- `search` (`/api/search`): a text match over document names and text-like content.

It embeds nats-server with JetStream, on a temporary store directory because go-messaging's nats
provider creates its stream with file storage. The core client listener binds 127.0.0.1, where
the go-messaging broker that owns the `EMULATOR` stream connects. Browsers reach the WebSocket
listener. Both listeners require one static token (`nats.token`). `cors.allowed_origins` lists
the browser origins allowed to call the emulator, one list for the CORS middleware and the
WebSocket listener. `runs.instance` names the emulator in its stage events' source,
`/emulator/<instance>`, so the events of two emulators are told apart; unset, it is a fresh UUID
per process. The `sdk` package's `NewClient` serves the embedded pipeline app at `/app`, or at
`/` as the router's not-found handler. Its shell loads the app's render-blocking modules ahead of
the entry and hands the browser the API base, the WebSocket URL, the stream, and the token. No
Postgres, blob storage, outbox, or containers: the spike proves the client, not the capstone's
backend.

## The apps

The root's apps live under `apps/`. Each imports only its own files and the three layer packages,
plus Lit, as the app tier's ESLint table enforces.

- `apps/pipeline/`, the pipeline app: a two-pane workspace. The header holds the title, the
  search field, the help button, the theme menu, and below 48rem the documents button. The side
  pane holds the upload dropzone and the document list, in `sl-drawer`, docked at 48rem and wider
  and a modal drawer below it. The main pane shows one routed view: the event log (`/`), the
  chat (`/chat`), the search results (`/search?q=`), or a document's stage timeline and content
  (`/documents/:document`). One NATS read drives the stage timeline, each list entry's run
  status, and the event log. The foundation's full profile registration and preferences load as
  render-blocking modules, so a stored theme is on the root element before first paint.
  `pipeline.go` hands the build to `NewClient`.
- `apps/external/`, the external client: static files Vite builds and no binary embeds. It
  fetches `services.json` relative to its page and gives each listed service a panel with its own
  sdk client, token, NATS read, document list, upload, search, and live stage events. It is
  evidence only, for evidence 8; no implementation is outstanding beyond it.

The mise tasks beside the check:

- `mise run serve` builds the pipeline app and runs the emulator on localhost:8080, the app at
  `/app`.
- `mise run demo` builds both apps and hosts the external client with Vite's preview on
  127.0.0.1:4180, beside two emulators on 8181 and 8182 that admit its origin.
- `mise run screenshots` captures the pipeline app's walkthrough over an emulator it boots, light
  and dark at the default profile. `--page <name>` captures one page, and each page stands alone;
  `--all` captures every built-in profile. The external client's description,
  `scripts/screenshots-external.config.ts`, runs by hand, as its header says.
- `mise run build:app` and `mise run build:external` build each app with Vite.
- `mise run consumers` installs the four layer packages by their tags into a new consumer outside
  the repository, under npm, pnpm, and bun (pinned in mise beside pnpm), builds it with Vite, and
  loads the build in the pinned chrome-headless-shell, printing a dated table. It reads the
  network, so it is never part of the check; "Consumption by tag" records its run.

## Capabilities

- **Layers:** the foundation, components, and SDK repositories, each with its own check and
  released by tag.
- **Size:** no layer enforces a budget; evidence 7 says how the layers are measured.
- **Foundation:** the Intl formatters; spike-html-design's profiles, each a unit of a sheet and a
  registration module that a page or an outside package adds; the stored preference and the theme
  menu; and the conformance check for color, space, and type profiles.
- **Extension:** spike-html-apps-noctis, a color profile that extends the foundation from outside,
  installs it by tag, and passes its conformance check.
- **SDK runtime:** the router, the API client with upload progress and streamed responses, the
  token provider, and the domain service.
- **Event sync:** the event-sequence interface and its NATS-over-WebSocket adapter, which the
  root's browser tier reads live from the emulator.
- **Emulator:** the in-memory pipeline service with embedded NATS, booted as a binary by the
  integration and browser tiers.
- **Serving half:** `NewClient` in the root's `sdk` package, serving one build at a prefix and at
  the root, with its render-blocking modules ahead of the entry.
- **Primitives:** the components layer's twelve Lit shadow components (the capstone's eight new
  primitives, the three carried over, and `sl-drawer`, the responsive drawer), a Markdown renderer
  on marked's lexer, and `formatJson`. Each component has a specimen page of every state, which the
  browser tier renders in every profile, light and dark.
- **Tooling:** spike-html-apps-tooling, the browser driver, page wait, static server, and
  screenshot command that every repository's browser tier and screenshot task run on, taken as a
  devDependency by tag. The tests are TypeScript in every repository, run under Node's type
  stripping.
- **Pipeline app:** the primitives composed live over the emulator, with its shortcuts, theme
  menu, and walkthrough (`mise run screenshots`).
- **External client:** an app hosted apart over two services (`mise run demo`).
- **Test seams:** the emulator's fail and hold rules, and the chat's `/fail` and `/rich`.
- **Conventions:** `conventions.md`, the development principles, design conventions, and process
  conventions the spike's repositories follow, for experiment.html's intake to adopt.

## Path

The tasks, in the order they run; each cites the evidence it proves.

1. `layers`: the three layer repositories, copied from spike-html-packages' tags and each
   released at v0.1.0 with its check, CI, release.yml, and STANDARDS.md; the root's check grown to
   the Node and Go code (evidence 7, 9).
2. `foundation`: the formatters, spike-html-design's profiles as units, preferences, theme menu,
   and conformance check, and the screenshot baseline, released as foundation v0.2.0; the
   components on the foundation's formatters and every profile, with specimen pages, released as
   components v0.2.0; and the extension repository spike-html-apps-noctis, whose color profile
   extends the foundation from outside, by tag, and passes conformance, released as noctis v0.1.0
   (evidence 2, 10).
3. `sdk`: the runtime and the event-sequence interface with its adapter, released as sdk v0.2.0
   (evidence 1, 3).
4. `emulator`: the service, its domains, embedded NATS, the chat stream, `NewClient`, and CORS
   (evidence 3, 4).
5. `primitives`: the eight new components and the Markdown renderer, released as components
   v0.3.0 (evidence 5, 7, 10).
6. `tooling`: spike-html-apps-tooling, released as v0.1.0 and v0.2.0, which the other five
   repositories take in place of their copies of the browser-test and screenshot code, and every
   repository's tests in TypeScript. It proves no evidence; the pipeline task's browser tier and
   screenshot review run on it.
7. `pipeline`: the pipeline app, its shortcuts, the external client, and the full-sequence
   walkthrough, with the layer fixes they needed, released as tooling v0.3.0, foundation v0.2.1
   to v0.3.0, components v0.4.0 to v0.10.2, sdk v0.3.0 and v0.4.0, and noctis v0.1.1 (evidence
   6, 8, 10).
8. `answer`: consumption by tag, the gaps, and the answer (evidence 9).

## Shortcuts

Single keys only, for critical operations, ignored inside text fields, shadow-root fields
included: `/` focuses search, `?` opens the help dialog, `t` opens the theme menu, `d` opens the
documents drawer below its docking width, and Escape cancels a streaming reply or closes a
dialog. The composer sends on Enter and inserts a newline on Shift+Enter. The app owns the key
table; no component binds a key.

## Releases

Each layer repository releases `@jaimestill/spike-html-apps-<layer>` at 0.y.z, by tag, from
v0.1.0. The components depend on the foundation by tag and peer it at its current minor. The
extension repository spike-html-apps-noctis releases `@jaimestill/spike-html-apps-noctis` the same
way, and depends on and peers the foundation as the components do. spike-html-apps-tooling
releases `@jaimestill/spike-html-apps-tooling` the same way, and every other repository takes it
as a devDependency by tag. The root releases nothing.

## References

The spike reads these repositories and never writes to them. Each is a key in the coordinator's
`references.toml`, with its local checkout in `references.local.toml`, except the two running
spike-ai-pipeline repositories, which the roadmap's `path` and `[workspace.paths]` locate:

- `spike-html-design`, at v0.7.0: theming, native element styling, and keys.
- `spike-html-conventions`, at main a88828a: the SDK declarations and the serving-half proposal.
- `spike-html-packages-foundation` v0.1.0, `-components` v0.2.0, and `-sdk` v0.1.0: the layers
  copied.
- `go-web-sdk-template`, at template/v0.13.0: the emulator's starting point.
- `go-web-sdk` v0.15.2, `go-core` v0.10.0, and `go-messaging` v0.2.0: the emulator's
  dependencies.
- `go-web-service`, at 15e0bc3: the `sdk/` staging shape and the composition.
- `spike-ai-pipeline`, at main 315ccec, and `spike-ai-pipeline-client`, at v0.4.0: the
  capstone's evidence and the Open Responses decisions.
- `herald`, at 6fc22b3: a frame of reference only.

## The answer

The question: what does a client application on experiment.html's stack look like, and do its
layers hold up when they compose the capstone's UI primitives, live over a backend? Its answer
bears on v1.client's app architecture and on whether an external-client goal follows 1.0, and the
capstone's UI starts from its releases.

**Three layers released by tag, a foundation, Lit shadow components that take properties and send
events, and an SDK of router, API client, token provider, and a resumable event sequence over NATS
WebSocket, composed by apps of their own files and served by a Go `NewClient`; they hold, live
over the emulator in one app and over two services in an external client.**

1. **The SDK runtime:** the router, the API client with upload progress and streamed responses,
   the token provider, and the domain service. Proven by the sdk's unit tier
   (`test/unit/api.test.ts`, `auth.test.ts`, and `declarations.test.ts` against v0.1.0's
   declarations) and its browser tier (`test/browser/router.test.ts`, `upload.test.ts`), and by
   the root's browser tier, which drives them through both apps. Proven by tests alone.
2. **The foundation's Intl formatters,** against foundation v0.1.0's `format.d.ts`. Proven by the
   foundation's `test/unit/format.test.ts` and `declarations.test.ts`. Proven by tests alone.
3. **The event-sequence interface** and its NATS-over-WebSocket adapter. Proven by the sdk's
   `test/unit/nats.test.ts` against a pinned nats-server (2.15.2) and `events.test.ts`, and live
   against the emulator by the root's `test/browser/live.test.ts`. Proven by tests alone; "NATS
   over WebSocket, for spike-ai-pipeline" below records it for the capstone.
4. **The Go serving half,** `NewClient` in the root's `sdk` package, at `/app` and at the
   server's root. Proven by `sdk/web_test.go`, the integration tier (`integration/`, the app at
   each mount), and the browser tier's `test/browser/base.test.ts`, and running under
   `mise run serve`.
5. **Eleven primitives,** with `sl-drawer` beside them. Proven by the components' browser tier
   (`test/browser/*.test.ts`), which renders each specimen page in every profile, light and dark,
   and seen on the specimen pages (`demo/`, under the components' `mise run demo`).
6. **The pipeline app,** `apps/pipeline/`, composing them live over the emulator. Proven by the
   root's browser tier (`test/browser/`), and running under `mise run serve` and in
   `mise run screenshots`' walkthrough.
7. **The layers clean at scale:** zero direction violations, under the check's ESLint over each
   layer's sources and over `apps/`, whose tables each layer's `test/unit/layers.test.ts` and the
   root's `test/unit/apps.test.ts` prove flag every forbidden import. Size is measured, not
   enforced: at ship, all 12 components with Lit, marked, and their foundation modules, one
   minified file, are 151.0 kB min, 39.2 kB gzip, and 34.5 kB brotli, beside Material Web's
   `all.js` with Lit at 72.1 kB gzip. The primitives task's baselines, brotli per file at quality
   11, text mode, KB = 1,000 B, were foundation 43,595 B over 39 files, components 36,070 B over
   23, and sdk 11,669 B over 7, under budgets of 48, 40, and 13 KB that the pipeline task
   removed (architect). The budget is left to the experiment's final review before intake.
8. **The external client,** `apps/external/`, over two emulators cross-origin under the spike's
   CORS. Proven by `test/browser/external.test.ts` and `instances.test.ts`, with the CORS
   middleware by `sdk/middleware_test.go`, and running under `mise run demo`.
9. **Consumption by tag** from outside the spike, under npm, pnpm, and bun, and the gaps. Proven
   by `mise run consumers`, run on demand since it reads the network, on 2026-11-03 ("Consumption
   by tag", below); the gaps are recorded under "The gaps".
10. **Quality at every layer,** judged as a finished product. Proven by the architect's acceptance
    of the screenshots at each UI task's design review: the foundation's and the components'
    specimen captures, and the pipeline app's walkthrough.

Items 1 to 3 are proven by tests alone. Items 4 to 8 are proven by tests and seen running, item
9 by an on-demand measure, and item 10 by the architect's acceptance.

The spike's conventions, the development principles, design conventions, and process conventions
its repositories follow, are `context/conventions.md`, for experiment.html's intake to adopt. This
answer is evidence for that intake; the spike decides nothing itself.

### NATS over WebSocket, for spike-ai-pipeline

spike-ai-pipeline's capstone weighs NATS over WebSocket against a backend relay on latency,
ordering, auth, ports, and native-tier use (its evidence 15). This is the NATS side as built and
proven here: sdk v0.4.0's `./events.js` interface and its `./events/nats.js` adapter, reading the
emulator's embedded nats-server.

- **Ordering and resume:** each read is one JetStream ordered consumer of its own; with no cursor
  it starts at the oldest event the stream keeps. The cursor is the event's stream sequence, a
  decimal string the caller treats as opaque. A read resumed from the last cursor after a reload
  continues with no gap and no duplicate (`live.test.ts`). A malformed cursor, or one past the
  stream's last event, fails the read with `UnknownCursorError`, and the pipeline app then
  restarts from the oldest event. Across a server restart the connection reconnects within
  nats-core's defaults, 10 attempts 2 s apart, and each read resumes after the last event it
  delivered (`nats.test.ts`). A recreated stream and a connection lost for good are gaps.
- **Auth:** one static token, `nats.token`, required on both listeners. The shell's config hands
  it to the browser, and the token provider gives it to the adapter, which asks for a refresh once
  when the server refuses it; a refused token pauses the read and says why (`live.test.ts`). Real
  auth is a gap.
- **Ports:** the WebSocket listener has a port of its own, 4223 in `config.json`, beside HTTP's
  8080 and the core listener's 4222. Its origin check reads `cors.allowed_origins`, the CORS
  middleware's list, and refuses a page from an origin the list doesn't name (`live.test.ts`).
  Chrome's Local Network Access check blocks a page that DevTools Fetch serves from opening
  loopback WebSockets, so the browser tier serves such pages through a loopback proxy
  (`test/browser/support/proxy.ts`).
- **Native-tier use:** the adapter runs in Node too: the sdk's unit tier reads over WebSocket
  against nats-server, every connection the server holds a WebSocket one. The emulator's own
  broker, go-messaging's nats provider, connects over the core listener on 127.0.0.1 and owns the
  stream.
- **Latency:** not measured. The capstone measures it, against a relay on one backend.
- **Cost:** `./events/nats.js` takes `@nats-io/nats-core` and `@nats-io/jetstream` at `^3.4.0` as
  the sdk's optional peers; every other subpath loads without them.

### Consumption by tag

`mise run consumers` ran on 2026-11-03 (UTC), at commit 2a20b12, with node 26.13.0, npm 12.2.1,
pnpm 12.16.1, bun 1.4.4, and Vite 8.3.5, over foundation v0.3.0, components v0.10.2, sdk v0.4.0,
and noctis v0.1.1. Every row was yes (evidence 9):

| manager | install | version and tree | peers | build | page |
| ------- | ------- | ---------------- | ----- | ----- | ---- |
| npm     | yes     | yes              | yes   | yes   | yes  |
| pnpm    | yes     | yes              | yes   | yes   | yes  |
| bun     | yes     | yes              | yes   | yes   | yes  |

Each manager observed the same, word for word:

- **Version and tree:** each layer installed at its tag's version with the tag's files, compared
  byte for byte: foundation 0.3.0, 62 files; components 0.10.2, 43; sdk 0.4.0, 17; and noctis
  0.1.1, 6.
- **Peers:** the foundation that the components and noctis peer, and the nats-core and jetstream
  that the sdk peers, each resolved to the consumer's own.
- **Build:** Vite 8.3.5's build exits 0, writing 3 files.
- **Page:** all 12 components' tags are defined, each rendering in its shadow root with its
  adopted sheets. The foundation's styling applies: `--bg` is `#fffcf0` and the body's background
  `rgb(255, 252, 240)`, in its system-ui font stack. noctis registers beside flexoki; selected, it
  changes `--bg` to `#f4f6f6`, the body's background to `rgb(244, 246, 246)`, and its text from
  `rgb(16, 15, 15)` to `rgb(0, 86, 97)`. The router mounts `/` in `<main>`; the client reads
  `/api/json` as a success and `/api/problem` as a failure, 422 Unprocessable Entity; and the
  sdk's `events` and `events/nats` entries load.

The guard: npm 12.2.1 refuses git dependencies (EALLOWGIT) unless the consumer's project `.npmrc`
sets `allow-git=root`, under which it installs; pnpm and bun install under their defaults.

### The gaps

Each gap is recorded, not closed, and names who decides it:

- **Firefox 147:** no `blocking="render"` (web-features 3.45.0), which `NewClient`'s shell writes
  on its render-blocking modules (`sdk/web.go`, the shell template), so the stored theme can flash
  before first paint. The experiment.html intake decides, as it decides what the layers graduate
  as and the browsers they support.
- **Safari 26.2 (WebKit):** no CSS module scripts, `import … with { type: "css" }` (web-features
  3.45.0). The layers import their sheets that way, so unbundled consumption fails in Safari; a
  Vite build rewrites them through vite-plugin-standard-css-modules, so the measured consumer path
  works. The experiment.html intake decides, as for Firefox.
- **Neither browser is run:** the browser tier and the tooling speak only the DevTools protocol,
  and Playwright was rejected for the browser tier; both gaps are recorded by named feature, and
  the experiment.html intake decides them.
- **Real auth:** one static token, handed to the browser in the shell's config. The broker's token
  rides in its URL, since go-messaging's `nats.Config` has no credentials field, and the broker's
  `Start` error prints that URL. v1.auth decides; the credentials field is the backlog goal
  `nats-credentials`.
- **Real inference:** a scripted Open Responses stream ("The emulator"). The capstone decides.
- **Persistence:** all state in memory. The capstone's backend decides.
- **A recreated stream:** a stored cursor at or below the new stream's last event resumes partway
  in, undetected; the NATS adapter detects only a malformed cursor or one past the last event. The
  capstone's backend decides.
- **A connection lost for good:** the NATS adapter reconnects across a server restart within
  nats-core's defaults, and each read resumes with no gap or duplicate; a connection lost for
  good, failing every read, is untested. The capstone decides, as the adapter's first real
  consumer.
- **The live stage tests' margin:** "advances live" and the failed run's live case boot their
  emulators with stages 1.5 s apart, and rely on that margin to catch each state. The architect
  accepted the margin as the limit of watching a live advance through the real API; a
  broker-level seam stays ruled out. It closes with the spike, as a property of its test harness.
