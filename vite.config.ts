// The pipeline app's build (mise run build:app): apps/pipeline/src/main.ts into
// apps/pipeline/dist/, with a manifest the server reads to name the entry's script. The base is
// relative, so the build is served under any mount: the shell's <base href> is the one place the
// mount's prefix is written, and every asset and chunk resolves against it. The server writes the
// HTML, so the entry is the module itself, not an index.html: the manifest's "src/main.ts" names
// its script. root is relative to the working directory, the repository's root under mise; the
// input and outDir are relative to root.

import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/pipeline",
  base: "./",
  build: {
    outDir: "dist",
    manifest: true,
    // Top-level await in main.ts, which every browser the router needs supports.
    target: "es2024",
    rolldownOptions: { input: "src/main.ts" },
  },
});
