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

import { readFile } from "node:fs/promises";

import { defineConfig } from "vite";
import type { Plugin } from "vite";

/** The query a rewritten CSS module script import carries, which sheets() resolves. */
const SHEET = "?sheet";

/** The prefix and suffix of a sheet module's id around the CSS file's path: a virtual module, which
 * no other plugin loads, and whose id ends in .js, never .css, so Vite's CSS plugins never take it
 * for a stylesheet. */
const VIRTUAL = "\0sheet:";
const SUFFIX = ".js";

/** A static import of a CSS module script, as tsc emits one: a default binding, a .css
 * specifier, and the attribute `with { type: "css" }`. */
const CSS_MODULE_SCRIPT =
  /(import\s+[\w$]+\s+from\s+)(["'])([^"']+\.css)\2(\s+with\s*\{\s*type:\s*["']css["']\s*\})/g;

/**
 * CSS module scripts, `import sheet from "./x.css" with { type: "css" }`, which the foundation's
 * theme menu and every component use to adopt their sheets, and which Vite doesn't support: it
 * takes such an import for a plain CSS import, with no default export. The plugin rewrites each
 * one's specifier to carry SHEET, dropping the attribute, and loads it as a module whose default
 * export is a constructed CSSStyleSheet holding the file's text, as the browser's own CSS module
 * script would: a constructed sheet takes no @import, and none of those files holds one.
 */
function sheets(): Plugin {
  return {
    name: "pipeline:css-module-scripts",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[cm]?[jt]s$/.test(id.split("?")[0]) || !code.includes("css")) return null;
      const rewritten = code.replace(
        CSS_MODULE_SCRIPT,
        (_, head, quote, specifier) => `${head}${quote}${specifier}${SHEET}${quote}`,
      );
      return rewritten === code ? null : { code: rewritten, map: null };
    },
    async resolveId(source, importer) {
      if (!source.endsWith(`.css${SHEET}`)) return null;
      const resolved = await this.resolve(source.slice(0, -SHEET.length), importer, {
        skipSelf: true,
      });
      return resolved && VIRTUAL + resolved.id + SUFFIX;
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      const css = await readFile(id.slice(VIRTUAL.length, -SUFFIX.length), "utf8");
      return [
        "const sheet = new CSSStyleSheet();",
        `sheet.replaceSync(${JSON.stringify(css)});`,
        "export default sheet;",
      ].join("\n");
    },
  };
}

export default defineConfig({
  root: "apps/pipeline",
  base: "./",
  plugins: [sheets()],
  build: {
    outDir: "dist",
    manifest: true,
    // Top-level await in main.ts, which every browser the router needs supports.
    target: "es2024",
    rolldownOptions: { input: ["src/main.ts", "src/register.ts", "src/preferences.ts"] },
  },
});
