// The external client's build (mise run build:external): apps/external/'s index.html and the
// modules it loads into apps/external/dist/, static files any server hosts. Nothing embeds it: the
// client is hosted apart from the services it calls, on an origin of its own, and reads where they
// are from services.json beside the build at start (apps/external/src/services.ts), so no
// service's address is a build-time value. The base is relative, so the build is hosted under any
// path. root is relative to the working directory, the repository's root under mise; outDir is
// relative to root.
//
// Unlike the pipeline app, whose shell the server writes, the client's page is its own
// index.html, which Vite rewrites to name the entry's built script. Vite drops the script's
// blocking attribute as it rewrites the tag, so renderBlocking puts it back on the built entry:
// the entry imports the foundation's full stylesheet, every built-in profile's registration, and
// the preferences module first, which applies the reader's stored theme choice to the root element
// before first paint, as the pipeline app's render-blocking modules do. The entry has no
// top-level await, so it blocks rendering only until its modules have run, not while it fetches
// services.json.

import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { standardCssModules } from "vite-plugin-standard-css-modules";

/** The built page's entry script, as Vite writes its tag, and the same tag render-blocking. */
const entryTag = '<script type="module" crossorigin src=';
const blockingTag = '<script type="module" blocking="render" crossorigin src=';

/** Marks the built page's one entry script render-blocking; fails the build when the page holds no
 * such tag, or more than one, so a change in how Vite writes it can't pass unnoticed. */
const renderBlocking = (): Plugin => ({
  name: "external:render-blocking",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(page) {
      const found = page.split(entryTag).length - 1;
      if (found !== 1) {
        throw new Error(`external: want one entry tag ${entryTag}… in index.html, found ${found}`);
      }
      return page.replace(entryTag, blockingTag);
    },
  },
});

export default defineConfig({
  root: "apps/external",
  base: "./",
  // CSS module scripts, as vite.config.ts takes them for the pipeline app, for the layers'
  // modules that adopt their sheets.
  plugins: [
    standardCssModules({
      include: ["**/node_modules/@jaimestill/**/*.js"],
      outputMode: "CSSStyleSheet",
    }),
    renderBlocking(),
  ],
  // No public directory: services.json is the host's, never the build's.
  publicDir: false,
  build: {
    outDir: "dist",
    target: "es2024",
  },
  // The demo's host (mise run demo): Vite's preview of the build, on the origin the demo's
  // emulators admit.
  preview: {
    host: "127.0.0.1",
    strictPort: true,
  },
});
