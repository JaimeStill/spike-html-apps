# spike-html-apps

A spike for the Standards Lab reference architecture. It settles what a client application on
experiment.html's stack looks like, and builds the UI primitives spike-ai-pipeline's capstone
needs, live over a minimal Go pipeline emulator. The repository is managed with the marathon
workflow; start from `context/README.md`.

- **Standards:** `STANDARDS.md`, with pointers into the architecture repository.
- **Check:** `mise run check`: shellcheck. The layers task grows it to spike-html-conventions'
  check plus the Go steps.
- **Currency:** `mise run currency`: every mise tool pinned behind its latest.
- **Goals:** this spike's tasks live in the coordinator's roadmap,
  `standards-lab/context/roadmap.toml`, under `experiment.html.spike-html-apps`. Its goal record
  is `context/goals/experiment.html.spike-html-apps.md`.
- **Repositories:** the root and three layer repositories, spike-html-apps-foundation,
  -components, and -sdk, which the layers task creates; the coordinator's `[workspace.paths]`
  locates them.
- **References:** the repositories this spike reads are listed in `context/README.md`. The spike
  reads them and never writes to them.
