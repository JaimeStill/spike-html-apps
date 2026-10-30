// The app tier's import cases as one file tree in the root's shape: a file per forbidden import
// and form, each with the rules that catch it, and the imports an app may make in the same
// layout. apps.test.ts lints it. The root holds no app yet, so the tree is the table's only
// subject: two apps in apps/, the pipeline app and the external client, and the layers below
// them as stub packages in node_modules/.
// Adapted from spike-html-apps-foundation (12f4d53): test/unit/layers-tree.js, its cases replaced
// by the app tier's, in TypeScript.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ESLint } from "eslint";

import { packages } from "../../eslint.config.js";

const root = join(import.meta.dirname, "../..");

/** The root's manifest as it stands, which the tree carries; the tests read its pins. */
export const manifest: { devDependencies: Record<string, string> } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);

const [foundation, components, sdk] = packages;

/** The test tooling, a devDependency the browser tier imports, and never an app. */
const tooling = "@jaimestill/spike-html-apps-tooling";

// The rules a case names: the table, the relative-path rule, and the resolution rule.
export const table = "boundaries/dependencies";
export const relativePackages = "import-x/no-relative-packages";
export const unresolved = "import-x/no-unresolved";
/** The rules the lint flags the tree with. */
export const watched: string[] = [table, relativePackages, unresolved];

/** Files by their path in the tree, each to its source. */
export type Files = Record<string, string>;

/** Cases by their path in the tree, each to its source and the rules that flag it. */
export type Cases = Record<string, { source: string; rules: string[] }>;

/** An edge in each of the four import forms, one file per form, each named for the edge and its
 * form: a side-effect import, a type import, a re-export, and an import(). */
function forms(base: string, specifier: string): Files {
  return {
    [`${base}.ts`]: `import "${specifier}";`,
    [`${base}-type.ts`]: `import type { X } from "${specifier}";`,
    [`${base}-export.ts`]: `export * from "${specifier}";`,
    [`${base}-dynamic.ts`]: `await import("${specifier}");`,
  };
}

/** `files`, each path to its source and the rules that flag it, sorted. */
function by(rules: string[], files: Files): Cases {
  return Object.fromEntries(
    Object.entries(files).map(([path, source]) => [path, { source, rules: [...rules].sort() }]),
  );
}

const app = "apps/pipeline";

// Each file holds one import, named for what it imports.
export const violations: Cases = {
  ...by([table], {
    // Another app, in each form, by a path that climbs out and back in, and from deeper down.
    ...forms(`${app}/forms/client`, "../../client/main.js"),
    [`${app}/client-reentry.ts`]: `import "../../apps/client/main.js";`,
    [`${app}/client-climb.ts`]: `import "./x/../../client/main.js";`,
    [`${app}/a/b/client.ts`]: `import "../../../client/main.js";`,
    // A package the table doesn't name: lit, which only the components import; a devDependency;
    // and a package whose name begins with a layer's, which the table's names must not prefix.
    ...forms(`${app}/forms/lit`, "lit"),
    [`${app}/typescript.ts`]: `import ts from "typescript";`,
    // The test tooling, which only test/ imports.
    ...forms(`${app}/forms/tooling`, `${tooling}/browser.js`),
    [`${app}/foundation-prefix.ts`]: `import "${foundation}x/dom.js";`,
    // A root file outside any app.
    [`${app}/root.ts`]: `import "../../test/unit/x.js";`,
    // apps/ itself, which the bare climb resolves to as its index.
    [`${app}/bare-parent.ts`]: `export * from "..";`,
    // A file directly in apps/, in no app, which imports nothing, a layer neither.
    "apps/index.ts": `export * from "${foundation}/dom.js";`,
  }),
  // A layer by a relative path into node_modules/, rather than by its name.
  ...by([table, relativePackages], {
    [`${app}/foundation-path.ts`]: `import "../../node_modules/${foundation}/index.js";`,
  }),
  // A specifier that names no file.
  ...by([table, unresolved], {
    [`${app}/missing.ts`]: `import "./absent.js";`,
  }),
};

/** `cases`, each path to its source alone. */
export const sources = (cases: Cases): Files =>
  Object.fromEntries(Object.entries(cases).map(([path, { source }]) => [path, source]));

// Every import an app may make, in each form, with names that hold dots, which a rule must tell
// from . and .. segments: each layer by its name, at a subpath, and the app's own files.
export const allowed: Files = {
  [`${app}/main.ts`]: [
    `import { define } from "${foundation}/dom.js";`,
    `import type { X } from "${components}/status-badge.js";`,
    `export * from "${sdk}/client.js";`,
    `await import("${components}/pagination.js");`,
    `import "./views/list.js";`,
  ].join("\n"),
  [`${app}/views/list.ts`]: [
    `import type { X } from "../main.js";`,
    `export { define } from "../main.js";`,
    `await import("../../pipeline/main.js");`,
  ].join("\n"),
  [`${app}/nested/index.ts`]: `import "..";\nexport * from "./";`,
  [`${app}/dotted.ts`]: `import "./..x/y.ts";\nimport "./.well-known/a.ts";`,
  "apps/client/main.ts": [
    `import { define } from "${sdk}/client.js";`,
    `import "${foundation}";`,
    `export const x = define;`,
  ].join("\n"),
};

/** The files the cases import that no case is. */
const targets: Files = {
  [`${app}/index.ts`]: "export {};",
  [`${app}/..x/y.ts`]: "export {};",
  [`${app}/.well-known/a.ts`]: "export {};",
  "test/unit/x.js": "export {};",
};

/** The packages the cases name, as stubs in node_modules/: the layers, lit, typescript, the
 * test tooling, and the foundation's namesake, each a module and its types at every subpath. */
const externals = [...packages, "lit", "typescript", tooling, `${foundation}x`];
const stub = (name: string): Files => ({
  "package.json": JSON.stringify({
    name,
    type: "module",
    exports: {
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./*": { types: "./index.d.ts", default: "./index.js" },
    },
  }),
  "index.js": "export const define = () => {};\nexport default {};",
  "index.d.ts": [
    "export declare const define: () => void;",
    "declare const x: object;",
    "export default x;",
    "export interface X {}",
  ].join("\n"),
});

/** Writes `files` under `dir` with the manifest, the targets, and the externals, so every import
 * but the unresolved case's resolves and the lint judges it. Returns the code files written under
 * apps/. */
export function writeTree(dir: string, files: Files): string[] {
  const written: Files = { ...files, ...targets, "package.json": JSON.stringify(manifest) };
  for (const name of externals) {
    for (const [path, source] of Object.entries(stub(name))) {
      written[join("node_modules", name, path)] = source;
    }
  }
  for (const [path, source] of Object.entries(written)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), `${source}\n`);
  }
  return Object.keys(written).filter((path) => path.startsWith("apps/") && /\.(js|ts)$/.test(path));
}

/** ESLint's JSON report on the tree under `dir`'s apps/. -c takes the root's config, whose
 * patterns then match from the working directory, the tree, and whose plugins load from the
 * root's node_modules. Throws when ESLint doesn't run or exits other than 0 or 1. */
export function lint(dir: string): ESLint.LintResult[] {
  const eslint = join(root, "node_modules", ".bin", "eslint");
  const run = spawnSync(eslint, ["-c", join(root, "eslint.config.js"), "-f", "json", "apps"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (run.error) throw new Error(`eslint didn't run: ${run.error}`);
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(`eslint exited ${run.status}: ${run.stderr}`);
  }
  return JSON.parse(run.stdout);
}
