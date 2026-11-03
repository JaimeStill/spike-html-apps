// mise run consumers: the networked measure that the layers are consumed by their tags from outside
// the spike, never run by the check. It installs test/consumers/app/, a new consumer declaring the
// foundation, the components, the sdk with its two NATS peers, and noctis by their git tags, into
// a scratch directory of TMPDIR, outside every spike repository, once each under npm, pnpm, and
// bun, with no lockfile, a fresh cache, and none of the user's own config. Each install is then
// held to the tags: each layer at its tag's version, its files the tag's tree, file for file and
// byte for byte (scripts/consumers/compare.ts), and the peers the components, noctis, and the sdk
// leave to the consumer resolved to the consumer's own. Each is built with Vite, and the build is
// served with spike-html-apps-tooling's server, beside the measure's own JSON and problem paths,
// and loaded in the browser BROWSER_EXECUTABLE names, the pinned chrome-headless-shell.
//
// It prints one dated Markdown table, each row a manager and a measure, yes or no with what it
// observed, and exits 1 when any row is no. It reads the network and writes nothing in the
// repository: the scratch directory, removed when it ends, holds the installs, their caches, and
// the tags' clones.
//
//   BROWSER_EXECUTABLE=$(mise which chrome-headless-shell) node scripts/consumers.ts
//
// Adapted from spike-html-packages (dd28725): scripts/live.js, its dated table of yes and no rows,
// its scratch, and its runner; scripts/consumers.sh, its installs under each manager and npm's
// allow-git guard; and scripts/unconfigured.sh, its emptying of each manager's user config, in
// TypeScript.

import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser } from "@jaimestill/spike-html-apps-tooling/browser.js";
import { serve } from "@jaimestill/spike-html-apps-tooling/server.js";

import {
  compareTrees,
  describeDifference,
  equal,
  readTree,
  versionMismatch,
} from "./consumers/compare.ts";
import type { Tree } from "./consumers/compare.ts";

const template = join(import.meta.dirname, "../test/consumers/app");
const manifest = JSON.parse(readFileSync(join(template, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** A layer: its package name, its repository on GitHub, and its tag, as the template declares
 * it, github:<owner>/<repository>#<tag>, the one place the tags are written. */
interface Layer {
  name: string;
  repository: string;
  tag: string;
}
const layers: Layer[] = Object.entries(manifest.dependencies).flatMap(([name, spec]) => {
  const pin = /^github:([^#]+)#(v\d+\.\d+\.\d+)$/.exec(spec);
  return pin ? [{ name, repository: pin[1], tag: pin[2] }] : [];
});
/** A layer by the last part of its name: foundation, components, sdk, or noctis. */
const layer = (short: string): Layer =>
  layers.find(({ name }) => name.endsWith(`-${short}`)) ??
  (() => {
    throw new Error(`consumers: the template declares no ${short}`);
  })();
const foundation = layer("foundation");

/** The peers each package leaves to the consumer, which must resolve to the consumer's own. */
const peers: [string, string][] = [
  [layer("components").name, foundation.name],
  [layer("noctis").name, foundation.name],
  [layer("sdk").name, "@nats-io/nats-core"],
  [layer("sdk").name, "@nats-io/jetstream"],
];

const managers = ["npm", "pnpm", "bun"] as const;
type Manager = (typeof managers)[number];

const scratch = mkdtempSync(join(tmpdir(), "spike-html-apps-consumers-"));
const cleanup = () => rmSync(scratch, { recursive: true, force: true });
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, () => {
    cleanup();
    process.exit(code);
  });
}

// Each manager's environment with none of the user's own config, so a user-level setting such as
// allow-git can't change what a row reports; the project's own config still applies. npm reads the
// user's ~/.npmrc and the global npmrc, emptied by NPM_CONFIG_USERCONFIG and
// NPM_CONFIG_GLOBALCONFIG; pnpm the user's .npmrc too, and its config in $XDG_CONFIG_HOME/pnpm/;
// bun the user's .npmrc and its .bunfig.toml in $XDG_CONFIG_HOME, each emptied by XDG_CONFIG_HOME.
// Each also reads npm_config_*, pnpm_config_*, and BUN_CONFIG_* settings, which are left out. git
// never prompts for credentials: a repository that isn't public fails.
const empty = join(scratch, "unconfigured");
mkdirSync(join(empty, "config"), { recursive: true });
// Two files: npm refuses one config file loaded as both user and global.
writeFileSync(join(empty, "user-npmrc"), "");
writeFileSync(join(empty, "global-npmrc"), "");
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(npm|pnpm|bun)_config_/i.test(name)),
  ),
  NPM_CONFIG_USERCONFIG: join(empty, "user-npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(empty, "global-npmrc"),
  XDG_CONFIG_HOME: join(empty, "config"),
  GIT_TERMINAL_PROMPT: "0",
};

/** A command's outcome: whether it exited 0, and its output, stdout then stderr, trimmed. */
interface Ran {
  ok: boolean;
  output: string;
}

/** Runs the command in `cwd`, under the unconfigured environment. */
function run(command: string, args: string[], cwd = scratch): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env });
    let [stdout, stderr] = ["", ""];
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ ok: false, output: error.message }));
    child.on("close", (status) =>
      resolve({ ok: status === 0, output: `${stdout}${stderr}`.trim() }),
    );
  });
}

/** The error a failed install names: npm's `npm error code`, pnpm's ERR_PNPM_ code, or else
 * bun's first error line, or the output's last line. */
function errorCode(output: string): string {
  const code = /^npm error code (\S+)$/m.exec(output) ?? /\b(ERR_PNPM_\w+)/.exec(output);
  if (code) return code[1];
  const line = /^error: (.+)$/m.exec(output)?.[1] ?? output.split("\n").at(-1) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** Each manager's install with no lockfile, into a cache of its own in the scratch, so each
 * resolves afresh from the network. pnpm's metadata cache (cacheDir) defaults to the home
 * directory: it goes beside the store. */
const installs: Record<Manager, (cache: string) => string[]> = {
  npm: (cache) => ["install", "--cache", cache, "--no-audit", "--no-fund"],
  pnpm: (cache) => ["install", "--store-dir", cache, `--config.cache-dir=${cache}`],
  bun: (cache) => ["install", "--cache-dir", cache],
};

/** The files each manager adds to an installed package that its tag doesn't hold, left out of the
 * tree comparison: bun's .bun-tag, which names the tag it installed, and any node_modules a
 * manager nests in a package for its dependencies. */
const metadata: Record<Manager, string[]> = {
  npm: ["node_modules"],
  pnpm: ["node_modules"],
  bun: [".bun-tag", "node_modules"],
};

/** npm 12 refuses git dependencies unless allow-git allows them; root allows the ones the
 * project itself declares, as every layer is. */
const npmGuard = "allow-git=root";

/** Copies the template into a new project of the scratch, with the config file's text, if any. */
function project(name: string, npmrc?: string): string {
  const dir = join(scratch, name);
  cpSync(template, dir, { recursive: true });
  if (npmrc !== undefined) writeFileSync(join(dir, ".npmrc"), `${npmrc}\n`);
  return dir;
}

/** Each row's outcome: whether it holds, and what it observed. */
type Outcome = [boolean, string];

/** Runs the measure into an outcome; one that throws is a no, naming the error. */
async function measure(body: () => Outcome | Promise<Outcome>): Promise<Outcome> {
  try {
    return await body();
  } catch (error) {
    return [false, error instanceof Error ? error.message : String(error)];
  }
}

/** Each layer's tree at its tag, from a depth-1 clone into the scratch, its .git left out; a
 * clone that fails is the error, read as each tree row's no. */
const tags = new Map<string, Promise<Tree>>(
  layers.map((each) => [
    each.name,
    (async () => {
      const dir = join(scratch, "tags", basename(each.repository));
      const url = `https://github.com/${each.repository}.git`;
      const clone = await run("git", [
        ...["clone", "--quiet", "--depth", "1", "--branch", each.tag, url, dir],
      ]);
      if (!clone.ok) throw new Error(`can't clone ${each.tag} of ${url}: ${clone.output}`);
      return readTree(dir, [".git"]);
    })(),
  ]),
);
// A failed clone rejects before its row awaits it; the row reads the rejection.
for (const tree of tags.values()) tree.catch(() => undefined);

/** The directory node resolves a package name to from a directory, as Vite does too: the first
 * node_modules holding it, from the directory up, as its real path; undefined when none does. */
function resolveFrom(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (basename(dir) !== "node_modules" && existsSync(candidate)) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/** The number of files below a directory. */
const countFiles = (dir: string): number => readTree(dir).size;

/** A manager's rows, in order: install, version and tree, peers, build, and page. */
const measures = ["install", "version and tree", "peers", "build", "page"] as const;
type Rows = Partial<Record<(typeof measures)[number], Outcome>>;

/** A manager's install of the template, its checks against the tags, and its build; resolves to
 * its rows and the build's directory for the page row, undefined when it built nothing. */
async function installed(manager: Manager, version: string) {
  const rows: Rows = {};
  const dir = project(manager, manager === "npm" ? npmGuard : undefined);
  const cache = join(scratch, "caches", manager);

  // npm without its guard first, in a project of its own, to record whether it refuses.
  let unguarded = "";
  if (manager === "npm") {
    const bare = project("npm-unguarded");
    const without = await run(
      manager,
      installs.npm(join(scratch, "caches", "npm-unguarded")),
      bare,
    );
    unguarded = without.ok
      ? `; without ${npmGuard} it installs too`
      : `; without ${npmGuard} it fails ${errorCode(without.output)}`;
  }
  const install = await run(manager, installs[manager](cache), dir);
  rows.install = install.ok
    ? [
        true,
        `${manager} ${version} exits 0${manager === "npm" ? ` under ${npmGuard}` : " under its defaults"}${unguarded}`,
      ]
    : [false, `${manager} ${version} fails ${errorCode(install.output)}${unguarded}`];
  if (!install.ok) return { rows };

  const modules = join(dir, "node_modules");
  rows["version and tree"] = await measure(async () => {
    const facts: string[] = [];
    let holds = true;
    for (const each of layers) {
      const installedDir = realpathSync(join(modules, each.name));
      const short = each.name.slice(each.name.lastIndexOf("-") + 1);
      const mismatch = versionMismatch(
        readFileSync(join(installedDir, "package.json"), "utf8"),
        each.name,
        each.tag,
      );
      const tag = await tags.get(each.name)!;
      const difference = compareTrees(tag, readTree(installedDir, metadata[manager]));
      holds &&= mismatch === null && equal(difference);
      facts.push(
        mismatch ??
          (equal(difference)
            ? `${short} ${each.tag.slice(1)}, its ${tag.size} files the tag's`
            : `${short} ${each.tag.slice(1)}, its files not the tag's: ${describeDifference(difference)}`),
      );
    }
    return [holds, facts.join("; ")];
  });

  rows.peers = await measure(() => {
    const facts: string[] = [];
    let holds = true;
    for (const [from, peer] of peers) {
      const own = resolveFrom(dir, peer);
      const theirs = resolveFrom(realpathSync(join(modules, from)), peer);
      const one = own !== undefined && theirs === own;
      holds &&= one;
      const [shortFrom, shortPeer] = [from, peer].map((name) => name.split("/")[1]);
      facts.push(
        one
          ? `${shortFrom}'s ${shortPeer} is the consumer's`
          : `${shortFrom}'s ${shortPeer} is ${theirs ?? "unresolved"}, the consumer's ${own ?? "unresolved"}`,
      );
    }
    return [holds, facts.join("; ")];
  });

  const viteVersion = JSON.parse(readFileSync(join(modules, "vite/package.json"), "utf8")).version;
  const build = await run(join(modules, ".bin/vite"), ["build"], dir);
  const dist = join(dir, "dist");
  rows.build = build.ok
    ? [true, `Vite ${viteVersion}'s build exits 0, writing ${countFiles(dist)} files`]
    : [false, `Vite ${viteVersion}'s build fails: ${build.output.split("\n").slice(-3).join(" ")}`];
  return { rows, dist: build.ok ? dist : undefined };
}

/** The measure's own API: a JSON response and an RFC 9457 problem response, which the page's sdk
 * client reads as a success and a failure. */
const answer = { consumer: "json" };
const problem = {
  type: "about:blank",
  title: "Unprocessable Entity",
  status: 422,
  detail: "the measure's problem path",
};

/** What the page shows, read in the page once its components have rendered. */
const shown = `(async () => {
  const consumer = window.consumer;
  const style = (element) => getComputedStyle(element);
  const tags = consumer.tags.map((tag) => {
    const element = document.querySelector(tag);
    const root = element?.shadowRoot;
    return {
      tag,
      defined: customElements.get(tag) !== undefined,
      rendered: !!root?.querySelector("*"),
      sheets: root?.adoptedStyleSheets.length ?? 0,
    };
  });
  const token = (name) => style(document.documentElement).getPropertyValue(name).trim();
  const before = { bg: style(document.body).backgroundColor, fg: style(document.body).color, token: token("--bg") };
  const font = style(document.body).fontFamily;
  document.documentElement.dataset.palette = "noctis";
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const after = { bg: style(document.body).backgroundColor, fg: style(document.body).color, token: token("--bg") };
  return {
    tags,
    before,
    after,
    font,
    colors: consumer.colors,
    route: consumer.route,
    mounted: !!document.querySelector("main > consumer-view"),
    json: consumer.json,
    problem: consumer.problem,
    events: consumer.events,
  };
})()`;

/** The build loaded in the browser, served with the measure's API beside it. */
async function page(browser: Browser, dist: string): Promise<Outcome> {
  const server = await serve({
    root: dist,
    shell: "index.html",
    handler: (request, response) => {
      const path = request.url?.split("?")[0];
      if (path === "/api/json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
        return true;
      }
      if (path === "/api/problem") {
        response.writeHead(problem.status, { "content-type": "application/problem+json" });
        response.end(JSON.stringify(problem));
        return true;
      }
      return false;
    },
  });
  // A blank page first, so the page's exceptions are caught from its first script.
  const tab = await browser.open("about:blank");
  try {
    const thrown: string[] = [];
    await tab.cdp("Runtime.enable");
    tab.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
      thrown.push(exceptionDetails.exception?.description ?? exceptionDetails.text),
    );
    await tab.goto(`${server.origin}/`);
    try {
      await until(
        tab,
        `window.consumer?.tags.every((tag) => document.querySelector(tag)?.shadowRoot?.querySelector("*"))`,
      );
    } catch {
      // Read what the page shows all the same: the rows name what is missing.
    }
    if (thrown.length > 0) return [false, `the page throws: ${thrown.join("; ")}`];
    const seen = await tab.evaluate(`window.consumer ? ${shown} : null`);
    if (seen === null) return [false, "the page sets no window.consumer"];

    type Tag = { tag: string; defined: boolean; rendered: boolean; sheets: number };
    const unrendered = (seen.tags as Tag[]).filter((t) => !t.defined || !t.rendered || !t.sheets);
    const styled = seen.before.token !== "" && seen.before.bg !== "rgba(0, 0, 0, 0)";
    const noctis = seen.colors.includes("noctis");
    const changed = seen.before.token !== seen.after.token && seen.before.bg !== seen.after.bg;
    const routed = seen.route === "/" && seen.mounted;
    const read =
      seen.json.ok === true &&
      seen.json.data?.consumer === answer.consumer &&
      seen.problem.ok === false &&
      seen.problem.problem?.status === problem.status &&
      seen.problem.problem?.title === problem.title;
    const facts = [
      unrendered.length === 0
        ? `all ${seen.tags.length} components' tags defined, each rendering in its shadow root with its adopted sheets`
        : `not rendered: ${unrendered.map((t: Tag) => `${t.tag} (defined ${t.defined}, rendered ${t.rendered}, ${t.sheets} sheets)`).join(", ")}`,
      styled
        ? `the foundation's styling applied: --bg ${seen.before.token}, the body's background ${seen.before.bg} and font ${seen.font}`
        : `the foundation's styling not applied: --bg "${seen.before.token}", the body's background ${seen.before.bg}`,
      `noctis ${noctis ? "registered" : "not registered"} among ${seen.colors.join(", ")}`,
      changed
        ? `selected, it changes --bg to ${seen.after.token} and the body's background to ${seen.after.bg}, its text ${seen.before.fg} to ${seen.after.fg}`
        : `selected, it leaves --bg at ${seen.after.token} and the body's background at ${seen.after.bg}`,
      routed
        ? "the router mounts / in <main>"
        : `the router's route is ${seen.route}, ${seen.mounted ? "" : "nothing "}mounted`,
      read
        ? `the client reads /api/json as a success and /api/problem as a failure, ${problem.status} ${problem.title}`
        : `the client reads /api/json as ${JSON.stringify(seen.json)} and /api/problem as ${JSON.stringify(seen.problem)}`,
      seen.events
        ? "the sdk's events and events/nats entries load"
        : "the sdk's event entries don't load",
    ];
    const holds =
      unrendered.length === 0 && styled && noctis && changed && routed && read && seen.events;
    return [holds, facts.join("; ")];
  } finally {
    await tab.close();
    await server.stop();
  }
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

try {
  const versions = Object.fromEntries(
    await Promise.all(
      managers.map(async (manager) => [manager, (await run(manager, ["--version"])).output]),
    ),
  ) as Record<Manager, string>;
  const results = await Promise.all(
    managers.map((manager) => installed(manager, versions[manager])),
  );

  const browser = await launch();
  try {
    for (const result of results) {
      if (result.rows.build === undefined) continue;
      result.rows.page =
        result.dist === undefined
          ? [false, "its build wrote nothing to load"]
          : await measure(() => page(browser, result.dist!));
    }
  } finally {
    await browser.close();
  }

  let failed = false;
  const lines = managers.flatMap((manager, at) =>
    measures.map((name) => {
      const [holds, observed] = results[at].rows[name] ?? [
        false,
        "not reached: its install failed",
      ];
      failed ||= !holds;
      return `| ${manager} | ${name} | ${holds ? "yes" : "no"}: ${cell(observed)} |`;
    }),
  );
  const date = new Date().toISOString().slice(0, 10);
  const tools = [
    `node ${process.version.slice(1)}`,
    ...managers.map((manager) => `${manager} ${versions[manager]}`),
    `Vite ${manifest.devDependencies.vite}`,
  ].join(", ");
  const tagged = layers.map(({ name, tag }) => `${name.slice(name.lastIndexOf("-") + 1)} ${tag}`);
  console.log(
    [
      `## Consumers, ${date} (UTC)`,
      "",
      `${tools}; ${tagged.join(", ")}`,
      "",
      "| manager | measure | result |",
      "| --- | --- | --- |",
      ...lines,
    ].join("\n"),
  );
  if (failed) process.exitCode = 1;
} finally {
  cleanup();
}
