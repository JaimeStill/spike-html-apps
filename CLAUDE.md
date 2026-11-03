# spike-html-apps

A spike for the Standards Lab reference architecture. It settles what a client application on
experiment.html's stack looks like, and builds the UI primitives spike-ai-pipeline's capstone
needs, live over a minimal Go pipeline emulator. The repository is managed with the marathon
workflow; start from `context/README.md`.

- **Standards:** `STANDARDS.md`, with pointers into the architecture repository.
- **Check:** `mise run check`, after `mise run install`: ESLint (with the app tier's direction
  table over apps/, and its violation tree under `node --test`), Prettier, shellcheck, tsc over
  the sources and over the TypeScript tests (`tsconfig.test.json`), and go-web-sdk-template's
  seven Go steps over the root module. It then builds both apps with Vite (`build:app`,
  `build:external`) and boots the emulator binary on reserved loopback ports for the integration
  tier and for the browser tier, which runs in the pinned chrome-headless-shell and hosts the
  external client on an origin of its own. It reads no network.
- **Apps:** the pipeline app, `apps/pipeline/`, embedded in the emulator binary, and the external
  client, `apps/external/`, static files hosted apart. `mise run serve` runs the emulator with the
  app at `/app`, `mise run demo` hosts the external client beside two emulators, and `mise run
  screenshots` captures the pipeline app's walkthrough (`--page <name>`, `--all`). The apps and
  tasks are described in `context/README.md`, "The apps".
- **Currency:** `mise run currency`: every mise tool, package.json pin, and go.mod go directive
  and direct requirement behind its latest; silent when all are current.
- **Consumers:** `mise run consumers`, outside the check since it reads the network: the layers
  installed by tag into a consumer outside the spike under npm, pnpm, and bun, then built and
  loaded, printing a dated table of yes and no rows. "Consumption by tag" in `context/README.md`
  records its run.
- **Goals:** this spike's tasks live in the coordinator's roadmap,
  `standards-lab/context/roadmap.toml`, under `experiment.html.spike-html-apps`. Its goal record
  is `context/goals/experiment.html.spike-html-apps.md`.
- **Repositories:** the root, the three layer repositories spike-html-apps-foundation,
  -components, and -sdk, the extension repository spike-html-apps-noctis, and
  spike-html-apps-tooling, the browser-test and screenshot tooling the others share. Each but the
  root is released by tag; the coordinator's `[workspace.paths]` locates them all.
- **References:** the repositories this spike reads are listed in `context/README.md`. The spike
  reads them and never writes to them.
