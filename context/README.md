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

1. The SDK runtime: the router (URLPattern and the Navigation API; base, deep link, reload, back
   and forward), the API client (a Result that fails as an RFC 9457 problem, the title filled
   when go-web-sdk omits it), the anonymous token provider, and the domain service, against sdk
   v0.1.0's declarations.
2. The foundation's Intl formatters, against foundation v0.1.0's `format.d.ts`.
3. An event-sequence interface in the SDK: an ordered stream of CloudEvents, resumable by an
   opaque cursor (the JetStream stream sequence), with a NATS-over-WebSocket adapter reading an
   ordered consumer.
4. The Go serving half, `NewClient`, serving the app at `/app` and at the server's root, with
   Vite's `base`, the shell's `<base href>`, and the router's base agreeing; in the spike's own
   `sdk` package, shaped as go-web-service's `sdk/` stages it.
5. Eleven primitives as Lit shadow components: properties in, events out, no SDK or domain
   import, keyboard-operable, layout-only sheets, no key bound. New: chat thread, composer,
   upload dropzone with progress, stage timeline, event log, search results, artifact viewer
   (text, JSON, Markdown), and document list; carried over: status badge, entry, and pagination.
6. A pipeline app composing them live over the emulator, embedded in its binary.
7. The layers clean at scale: zero direction violations; each layer within a brotli budget and
   passing its own check.
8. An external client hosted apart, calling two emulator instances cross-origin under CORS the
   spike owns, with a base and token provider for each.
9. Consumption by tag from outside the spike, and the gaps: Firefox and WebKit, real auth, real
   inference, and persistence.
10. Quality at every layer, judged as a finished product: the foundation renders
    spike-html-design's native styling and every profile without regression; each component is
    finished in every state and profile, with visible focus, motion that honours reduced motion,
    and no layout shift; the app's full sequence (upload, stages live, chat, search, artifact)
    reads as one product.

## The emulator

One Go binary generated from go-web-sdk-template template/v0.13.0, with all state in memory. Four
domains: documents (an upload and its metadata), runs (scripted stages on timers, upload →
metadata → extraction → chunks → embeddings, one CloudEvent each), conversations (a scripted Open
Responses stream over HTTP), and search (a text match over uploaded content). It embeds
nats-server with WebSocket and JetStream and publishes through go-messaging's nats provider,
which creates its stream with file storage, so the server takes a temporary store directory. One
static token reaches the browser through the SDK's token provider. No Postgres, blob storage,
outbox, or containers: the spike proves the client, not the capstone's backend.

## Capabilities

- **Layers:** the foundation, components, and SDK repositories, each with its own check and
  released by tag.
- **Foundation:** the Intl formatters; spike-html-design's profiles, each a unit of a sheet and a
  registration module that a page or an outside package adds; the stored preference and the theme
  menu; and the conformance check for color, space, and type profiles.
- **Extension:** spike-html-apps-noctis, a color profile that extends the foundation from outside,
  installs it by tag, and passes its conformance check.
- **SDK runtime:** the router, the API client, the token provider, and the domain service.
- **Event sync:** the event-sequence interface and its NATS-over-WebSocket adapter.
- **Emulator:** the in-memory pipeline service with embedded NATS.
- **Serving half:** `NewClient` at a prefix and at the root.
- **Primitives:** the capstone's UI components, finished in every state and profile.
- **Pipeline app:** the primitives composed live over the emulator, with its shortcuts.
- **External client:** an app hosted apart over two services.

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
5. `primitives`: the eight new components and each layer's brotli budget (evidence 5, 7, 10).
6. `pipeline`: the pipeline app, its shortcuts, the external client, and the full-sequence
   walkthrough (evidence 6, 8, 10).
7. `answer`: consumption by tag, the gaps, and the answer (evidence 9).

## Shortcuts

Single keys only, for critical operations, ignored inside text fields: `/` focuses search, `?`
opens the help dialog, `t` opens the theme menu, and Escape cancels a streaming reply or closes a
dialog. The composer sends on Enter and inserts a newline on Shift+Enter. The app owns the key
table; no component binds a key.

## Releases

Each layer repository releases `@jaimestill/spike-html-apps-<layer>` at 0.y.z, by tag, from
v0.1.0. The components depend on the foundation by tag and peer it at its current minor. The
extension repository spike-html-apps-noctis releases `@jaimestill/spike-html-apps-noctis` the same
way, and depends on and peers the foundation as the components do. The root releases nothing.

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
- `spike-ai-pipeline`, at main 315ccec, and `spike-ai-pipeline-client`, at v0.1.0: the
  capstone's evidence and the Open Responses decisions.
- `herald`, at 6fc22b3: a frame of reference only.

## The answer

Pending: the `answer` task writes it.
