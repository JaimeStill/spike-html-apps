# spike-html-apps

A spike for the Standards Lab reference architecture. It settles what a client application on
experiment.html's stack looks like, and builds the UI primitives spike-ai-pipeline's capstone
needs, live over a minimal Go pipeline emulator. The repository is managed with the marathon
workflow; start from `context/README.md`.

- **Standards:** `STANDARDS.md`, with pointers into the architecture repository.
- **Check:** `mise run check`, after `mise run install`: ESLint (with the app tier's direction
  table over apps/, and its violation tree under `node --test`), Prettier, shellcheck, tsc, and
  go-web-sdk-template's seven Go steps over the root module. It reads no network.
- **Currency:** `mise run currency`: every mise tool, package.json pin, and go.mod go directive
  and direct requirement behind its latest; silent when all are current.
- **Goals:** this spike's tasks live in the coordinator's roadmap,
  `standards-lab/context/roadmap.toml`, under `experiment.html.spike-html-apps`. Its goal record
  is `context/goals/experiment.html.spike-html-apps.md`.
- **Repositories:** the root, the three layer repositories spike-html-apps-foundation,
  -components, and -sdk, and the extension repository spike-html-apps-noctis. Each but the root
  is released by tag; the coordinator's `[workspace.paths]` locates them all.
- **References:** the repositories this spike reads are listed in `context/README.md`. The spike
  reads them and never writes to them.
