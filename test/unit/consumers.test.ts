// mise run consumers' comparisons (scripts/consumers/compare.ts), offline: small trees written to
// a scratch directory of TMPDIR, removed after, read back and held to a tag's, and manifests held
// to a tag's version.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";

import {
  compareTrees,
  describeDifference,
  equal,
  readTree,
  versionMismatch,
} from "../../scripts/consumers/compare.ts";
import type { Tree } from "../../scripts/consumers/compare.ts";

/** A tag's tree, as a release tag holds a layer's package. */
const tag: Record<string, string> = {
  "package.json": '{ "name": "@scope/layer", "version": "0.2.0" }\n',
  LICENSE: "license\n",
  "dist/a.js": "export const a = 1;\n",
  "dist/a.d.ts": "export declare const a = 1;\n",
  "dist/nested/b.css": ".b {}\n",
};

describe("consumers' tree comparison", () => {
  let scratch: string;
  /** Writes the files under a new directory of the scratch, and returns it. */
  const write = (name: string, files: Record<string, string>): string => {
    const root = join(scratch, name);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };
  let tagTree: Tree;
  before(() => {
    scratch = mkdtempSync(join(tmpdir(), "consumers-"));
    tagTree = readTree(write("tag", tag));
  });
  after(() => rmSync(scratch, { recursive: true, force: true }));

  test("reads every file, nested ones by their relative path", () => {
    assert.deepEqual([...tagTree.keys()].sort(), Object.keys(tag).sort());
    assert.equal(tagTree.get("dist/nested/b.css")?.toString(), ".b {}\n");
  });

  test("an install equal to the tag, file for file, is equal", () => {
    const difference = compareTrees(tagTree, readTree(write("equal", tag)));
    assert.ok(equal(difference));
    assert.equal(describeDifference(difference), "");
  });

  test("an install leaving out a file is missing it", () => {
    const rest = Object.fromEntries(Object.entries(tag).filter(([path]) => path !== "dist/a.d.ts"));
    const difference = compareTrees(tagTree, readTree(write("missing", rest)));
    assert.deepEqual(difference, { missing: ["dist/a.d.ts"], extra: [], differing: [] });
    assert.ok(!equal(difference));
    assert.equal(describeDifference(difference), "1 missing (dist/a.d.ts)");
  });

  test("an install holding a file the tag doesn't has it extra", () => {
    const difference = compareTrees(
      tagTree,
      readTree(write("extra", { ...tag, "dist/c.js": "export {};\n" })),
    );
    assert.deepEqual(difference, { missing: [], extra: ["dist/c.js"], differing: [] });
    assert.ok(!equal(difference));
  });

  test("an install whose file's bytes differ has it differing", () => {
    const difference = compareTrees(
      tagTree,
      readTree(write("differing", { ...tag, "dist/a.js": "export const a = 2;\n" })),
    );
    assert.deepEqual(difference, { missing: [], extra: [], differing: ["dist/a.js"] });
    assert.ok(!equal(difference));
    assert.equal(describeDifference(difference), "1 differing (dist/a.js)");
  });

  test("skip leaves out a manager's metadata file and its nested node_modules", () => {
    const installed = write("metadata", {
      ...tag,
      ".bun-tag": "owner-repo-abc1234",
      "node_modules/lit/index.js": "export {};\n",
    });
    assert.ok(!equal(compareTrees(tagTree, readTree(installed))));
    assert.ok(equal(compareTrees(tagTree, readTree(installed, [".bun-tag", "node_modules"]))));
  });

  test("a difference names at most three paths of a kind, counting the rest", () => {
    const text = describeDifference({
      missing: ["a", "b", "c", "d", "e"],
      extra: [],
      differing: ["f"],
    });
    assert.equal(text, "5 missing (a, b, c, and 2 more); 1 differing (f)");
  });
});

describe("consumers' version check", () => {
  test("the tag's package at the tag's version holds", () => {
    assert.equal(versionMismatch(tag["package.json"], "@scope/layer", "v0.2.0"), null);
  });

  test("a version other than the tag's fails, naming both", () => {
    assert.equal(
      versionMismatch(tag["package.json"], "@scope/layer", "v0.3.0"),
      "its version is 0.2.0, not 0.3.0",
    );
  });

  test("a package other than the layer's fails, naming it", () => {
    assert.equal(
      versionMismatch(tag["package.json"], "@scope/other", "v0.2.0"),
      "its package.json names @scope/layer, not @scope/other",
    );
  });

  test("a manifest that isn't JSON fails", () => {
    assert.equal(versionMismatch("{", "@scope/layer", "v0.2.0"), "its package.json isn't JSON");
  });
});
