// The pipeline app's build (mise run build:app): apps/pipeline/src/'s three inputs into
// apps/pipeline/dist/, with a manifest the server reads to name their scripts and CSS. The base is
// relative, so the build is served under any mount: the shell's <base href> is the one place the
// mount's prefix is written, and every asset and chunk resolves against it. The server writes the
// HTML, so each input is a module itself, not an index.html: the manifest's "src/main.ts" names
// the entry's script, and "src/register.ts" and "src/preferences.ts" the modules the shell loads
// render-blocking ahead of it (apps/pipeline/pipeline.go's RenderBlocking), each its own manifest
// entry so the shell can name it; the modules they share land in shared chunks, so the registry
// they fill and read is one module. root is relative to the working directory, the repository's
// root under mise; the inputs and outDir are relative to root.

import { defineConfig } from "vite";
import { standardCssModules } from "vite-plugin-standard-css-modules";

export default defineConfig({
  root: "apps/pipeline",
  base: "./",
  // CSS module scripts, `import sheet from "./x.css" with { type: "css" }`, which the
  // foundation's theme menu and every component use to adopt their sheets, and which Vite doesn't
  // support. The plugin rewrites each import carrying that attribute to a module whose default
  // export is one constructed CSSStyleSheet per file; a plain `import "./x.css"` carries none, so
  // Vite bundles it as CSS. The sheet's text is the file's ?inline import, so it passes through
  // Vite's CSS pipeline and is minified like the bundled CSS. include names the importers it
  // parses: the layers' modules, the only ones holding CSS module scripts (the app's own CSS is
  // side-effect imports). outputMode pins the CSSStyleSheet the components adopt, never Lit's
  // CSSResult, which the plugin otherwise emits under SSR.
  plugins: [
    standardCssModules({
      include: ["**/node_modules/@jaimestill/**/*.js"],
      outputMode: "CSSStyleSheet",
    }),
  ],
  build: {
    outDir: "dist",
    manifest: true,
    // Top-level await in main.ts, which every browser the router needs supports.
    target: "es2024",
    rolldownOptions: { input: ["src/main.ts", "src/register.ts", "src/preferences.ts"] },
  },
});
