// The consumer's build: index.html and main.ts into dist/, as a consumer outside the spike builds
// the layers. The layers' components and theme menu adopt their sheets through CSS module scripts,
// which Vite doesn't support, so the consumer takes the plugin as the root's vite.config.ts does,
// with rolldown declared beside it, which the plugin imports without declaring.

import { defineConfig } from "vite";
import { standardCssModules } from "vite-plugin-standard-css-modules";

export default defineConfig({
  plugins: [
    standardCssModules({
      include: ["**/node_modules/@jaimestill/**/*.js"],
      outputMode: "CSSStyleSheet",
    }),
  ],
  build: {
    outDir: "dist",
    // Top-level await in main.ts.
    target: "es2024",
  },
});
