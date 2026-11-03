// mise run consumers' comparisons, apart from the network so the unit tier tests them offline
// (test/unit/consumers.test.ts): a tree read from disk, an installed package's tree against its
// tag's, file for file and byte for byte, and its manifest's version against its tag.
// Adapted from spike-html-packages (dd28725): scripts/installed.sh, its matches_tag, in
// TypeScript, each difference named rather than diffed.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** A tree: each file's path, relative to its root with / between its parts, to its bytes. */
export type Tree = Map<string, Buffer>;

/** Reads every file below `root` into a tree, leaving out each entry, a file or a directory and
 * all it holds, whose path relative to the root is one `skip` names. A symbolic link is read as
 * the file it names. */
export function readTree(root: string, skip: readonly string[] = []): Tree {
  const tree: Tree = new Map();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (skip.includes(path)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${path}/`);
      else tree.set(path, readFileSync(full));
    }
  };
  walk(root, "");
  return tree;
}

/** How an installed tree differs from its tag's, each list sorted: the tag's files it lacks, the
 * files it holds the tag doesn't, and the files both hold whose bytes differ. */
export interface TreeDifference {
  missing: string[];
  extra: string[];
  differing: string[];
}

/** The installed tree against the tag's. */
export function compareTrees(tag: Tree, installed: Tree): TreeDifference {
  const missing = [...tag.keys()].filter((path) => !installed.has(path));
  const extra = [...installed.keys()].filter((path) => !tag.has(path));
  const differing = [...tag.keys()].filter((path) => {
    const bytes = installed.get(path);
    return bytes !== undefined && !bytes.equals(tag.get(path)!);
  });
  return { missing: missing.sort(), extra: extra.sort(), differing: differing.sort() };
}

/** Whether the difference is none. */
export const equal = ({ missing, extra, differing }: TreeDifference): boolean =>
  missing.length + extra.length + differing.length === 0;

/** The difference in words, each kind with up to three of its paths: "" when the trees are
 * equal. */
export function describeDifference(difference: TreeDifference): string {
  const named = (paths: string[]) =>
    paths.slice(0, 3).join(", ") + (paths.length > 3 ? `, and ${paths.length - 3} more` : "");
  return (["missing", "extra", "differing"] as const)
    .filter((kind) => difference[kind].length > 0)
    .map((kind) => `${difference[kind].length} ${kind} (${named(difference[kind])})`)
    .join("; ");
}

/** Why the installed manifest's text isn't the tag's package, or null when it is: its name the
 * package's and its version the tag's, v<version>. */
export function versionMismatch(manifest: string, name: string, tag: string): string | null {
  let parsed: { name?: unknown; version?: unknown };
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return "its package.json isn't JSON";
  }
  if (parsed.name !== name) return `its package.json names ${String(parsed.name)}, not ${name}`;
  if (`v${String(parsed.version)}` !== tag) {
    return `its version is ${String(parsed.version)}, not ${tag.slice(1)}`;
  }
  return null;
}
