// The lint the check runs: the recommended rules over the code, and the app-tier direction in
// apps/, by the file each import resolves to. test/unit/apps.test.js runs it over
// test/unit/apps-tree.js's tree.
// Adapted from spike-html-apps-foundation (12f4d53): eslint.config.js, its layer table replaced
// by the app tier's, on spike-html-conventions (a88828a) eslint.config.js's app rows; without the
// CSS module script rule, the declarations rule, and the manifest rules, which the root has no
// source to hold to yet.

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import importX from "eslint-plugin-import-x";
import globals from "globals";
import tseslint from "typescript-eslint";

const code = ["**/*.js", "**/*.ts"];

/** The layers below an app, each a package by name, which an app imports at any subpath. */
export const packages = ["foundation", "components", "sdk"].map(
  (layer) => `@jaimestill/spike-html-apps-${layer}`,
);

// The app tier's table: each app is a directory in apps/, the * its name, which may import its
// own files and the layers below it, and nothing else. An import into an app passes only from the
// same app, so no app imports another; nothing below an app is linted here, since each layer's
// own check holds it to its direction, so nothing imports upward into an app.
export const layers = [{ name: "app", path: "apps/*", may: ["app", ...packages] }];

// The app is an element by its directory, matched from the root (partialMatch false), with a
// second pattern for a file in a directory whose name starts with a dot, which micromatch's **
// never enters, so ./.well-known/ and ./..x/ stay in their app; the row captures the app's
// directory name, which the policy into an app names. A file directly in apps/ is a "loose"
// element with no policy, so it imports nothing.
const elements = [
  ...layers.map(({ name, path }) => ({
    type: name,
    pattern: [path, `${path}/**/.*`],
    partialMatch: false,
    capture: ["app"],
  })),
  { type: "loose", pattern: ["apps"], partialMatch: false },
];

// The rule's default is disallow, and it checks every origin (a package is external) and local
// files no element holds: an import passes only when a policy names its target, its own app,
// captured by the same directory name, or a package the table names, which the rule matches by
// its name, any subpath of it.
const policies = layers.map(({ name, may }) => ({
  from: { element: { type: name } },
  allow: {
    to: may.map((target) =>
      target === name
        ? { element: { type: target, captured: { app: "{{from.element.captured.app}}" } } }
        : { module: { origin: "external", source: target } },
    ),
  },
}));

export default defineConfig([
  // The apps' builds (mise run build:app), which .gitignore lists and ESLint doesn't read.
  globalIgnores(["apps/*/dist/"]),
  { files: code, extends: [js.configs.recommended, tseslint.configs.recommended] },
  { files: code, languageOptions: { globals: globals.browser } },
  // The suite and the config run on node.
  { files: ["test/**", "eslint.config.js"], languageOptions: { globals: globals.node } },
  {
    files: ["apps/**"],
    plugins: { boundaries, "import-x": importX },
    settings: {
      "import/resolver": { typescript: true },
      "import-x/resolver": { typescript: true },
      "boundaries/elements": elements,
    },
    // The rule judges the file an import resolves to, never the specifier's text, and
    // no-unresolved fails a specifier that names no file, so no import passes by naming none;
    // no-relative-packages fails a relative path that reaches a package's files, which would
    // otherwise pass as a local file rather than by the package's name.
    rules: {
      "import-x/no-unresolved": "error",
      "import-x/no-relative-packages": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          checkUnknownLocals: true,
          policies,
        },
      ],
    },
  },
]);
