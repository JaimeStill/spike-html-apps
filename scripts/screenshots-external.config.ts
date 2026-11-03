// The external client's captures for the tooling's screenshot bin (spike-html-apps-screenshots),
// a description of its own beside scripts/screenshots.config.ts: a description has one server,
// and every page's path resolves against its one origin, while the client is hosted on an origin
// of its own, apart from the emulators the pipeline app's description serves its pages from.
// Build the client (mise run build:external), then run the bin with BROWSER_EXECUTABLE naming
// chrome-headless-shell:
//
//   BROWSER_EXECUTABLE=$(mise which chrome-headless-shell) \
//     pnpm exec spike-html-apps-screenshots scripts/screenshots-external.config.ts --output directory
//
// The start function builds cmd/server into a temporary directory and boots three emulators
// through the tooling's process helper, on free loopback ports, their stages a second apart so a
// capture finds runs mid-way: Service A and Service B admit the client's origin, and Service C
// admits only its own. It hosts the client's build with the tooling's static server, and under
// each page's path the services.json that page shows: A and B at the root; A and C under failed/;
// none, a 404, under missing/; text that isn't JSON under malformed/; and one never answered under
// loading/, so the client stays loading. The client fetches services.json relative to its page,
// so each path's page reads its own.
//
// The pages: both panels at 1280px, documents listed and runs live in each, a document's stages
// open in A and a search's matches in B (--page client), and an upload from A's dropzone under
// way, its cancel focused (--page uploading); the same stacked at 375px; a panel failed beside one
// that works (--page failed); and the client loading, and its error for services.json missing and
// not JSON (--page loading, missing, malformed); light and dark.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";
import { freePort, start } from "@jaimestill/spike-html-apps-tooling/process.js";
import type { Started } from "@jaimestill/spike-html-apps-tooling/process.js";
import type {
  DescribedState,
  Description,
  Step,
} from "@jaimestill/spike-html-apps-tooling/screenshots.js";
import { serve } from "@jaimestill/spike-html-apps-tooling/server.js";

/** The repository root, where the emulators read config.json. */
const root = join(import.meta.dirname, "..");

/** The client's build, which build:external writes. */
const dist = join(root, "apps/external/dist");

/** The token every emulator here is configured with. */
const token = "screenshots-token";

/** An emulator start booted: its origin and WebSocket URL. */
interface Booted {
  origin: string;
  wsURL: string;
}

/** The emulators by their instance names, once start has booted them. */
const emulators: Record<string, Booted> = {};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Uploads a text document to the emulator through its API, as another client would. */
async function upload(instance: string, name: string, text = "a document's text") {
  const response = await fetch(
    `${emulators[instance].origin}/api/documents?name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { "content-type": "text/plain" }, body: text },
  );
  if (response.status !== 201) throw new Error(`upload ${name}: ${response.status}`);
}

/** services.json's text for the emulators named, each its panel's name "Service <NAME>". */
const servicesOf = (...instances: string[]) =>
  JSON.stringify({
    services: instances.map((instance) => ({
      name: `Service ${instance.toUpperCase()}`,
      apiBase: `${emulators[instance].origin}/api`,
      nats: { url: emulators[instance].wsURL, stream: "EMULATOR", token },
    })),
  });

/** The panel at `index`, as a page expression. */
const panel = (index: number) => `document.querySelectorAll("external-panel")[${index}]`;

/** Waits for each panel to show its service, or to fail. */
async function panelsSettled(page: Page) {
  await until(
    page,
    `document.querySelectorAll("external-panel").length > 0 && [...document.querySelectorAll("external-panel")].every((p) => p.phase !== "loading" && p.querySelector("sl-document-list")?.state !== "loading")`,
  );
}

/** Focuses the element the expression names, with focus emulated so its ring shows. */
async function focus(page: Page, element: string) {
  await page.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.evaluate(`(${element}).focus({ focusVisible: true })`);
}

/** Opens the newest document's stages in the panel, by its list entry. */
async function openNewest(page: Page, index: number) {
  await page.evaluate(
    `[...${panel(index)}.querySelector("sl-document-list").shadowRoot.querySelectorAll("sl-entry")].at(-1).shadowRoot.querySelector("button").click()`,
  );
  await until(page, `!!${panel(index)}.querySelector("sl-stage-timeline")`);
}

/** Searches the panel for the query and waits for its matches. */
async function search(page: Page, index: number, q: string) {
  await page.evaluate(`(() => {
    const form = ${panel(index)}.querySelector("form.panel-search");
    form.elements.q.value = ${JSON.stringify(q)};
    form.requestSubmit();
  })()`);
  await until(page, `${panel(index)}.querySelector("sl-search-results").state === "ready"`);
}

/** Both panels live: a run under way in each, uploaded by another client, A's newest document's
 * stages open, mid-run, and B's search for "report" answered. */
const live: Step = async (page) => {
  await panelsSettled(page);
  await upload("a", `field-report-${Date.now() % 1000}.txt`, "the field report");
  await upload("b", `quarterly-report-${Date.now() % 1000}.txt`, "the quarterly report");
  await wait(1_600);
  await openNewest(page, 0);
  await search(page, 1, "report");
  await wait(600);
};

/** An upload from A's dropzone under way, paced as a slow link would, its cancel focused. */
const uploading: Step = async (page) => {
  await panelsSettled(page);
  await page.cdp("Network.enable");
  await page.cdp("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 200_000,
  });
  const dir = mkdtempSync(join(tmpdir(), "screenshots-upload."));
  const file = join(dir, "site-survey.pdf");
  writeFileSync(file, Buffer.alloc(1_500_000, 97));
  const zone = `${panel(0)}.querySelector("sl-upload-dropzone").shadowRoot`;
  const { result } = await page.cdp("Runtime.evaluate", {
    expression: `${zone}.querySelector("input[type=file]")`,
  });
  await page.cdp("DOM.setFileInputFiles", { files: [file], objectId: result.objectId });
  await until(page, `${panel(0)}.uploads[0]?.sent > 400000`);
  await focus(page, `${zone}.querySelector("button.cancel")`);
  // The file is read as the body goes out; it stays until the process exits.
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
};

/** A failed panel beside one that works. */
const settled: Step = async (page) => {
  await panelsSettled(page);
  await wait(300);
};

/** The client's error, once it shows. */
const errorShown: Step = async (page) => {
  await until(page, `!!document.querySelector(".client-error")`);
};

/** The client loading, its services.json never answered. */
const loading: Step = async (page) => {
  await until(page, `!!document.querySelector(".client-loading")`);
};

const phone = { width: 375, height: 812 };
const wide = { width: 1280, height: 900 };

/** A state at 1280px and at 375px, each the full page. */
const both = (name: string, caption: string, open: Step): DescribedState[] => [
  { name, caption: `${caption}, 1280px`, viewport: wide, full: true, open },
  { name: `${name}-narrow`, caption: `${caption}, 375px`, viewport: phone, full: true, open },
];

const description: Description = {
  pages: [
    {
      name: "client",
      caption: "External client",
      path: "",
      states: both("client", "Both panels live, a run's stages and a search", live),
    },
    {
      name: "uploading",
      caption: "External client",
      path: "",
      states: both("uploading", "An upload under way in A", uploading),
    },
    {
      name: "failed",
      caption: "External client",
      path: "failed/",
      states: both("failed", "C not admitting the client's origin, beside A", settled),
    },
    {
      name: "loading",
      caption: "External client",
      path: "loading/",
      states: both("loading", "Loading services.json", loading),
    },
    {
      name: "missing",
      caption: "External client",
      path: "missing/",
      states: both("missing", "services.json missing", errorShown),
    },
    {
      name: "malformed",
      caption: "External client",
      path: "malformed/",
      states: both("malformed", "services.json not JSON", errorShown),
    },
  ],
  server: async () => {
    const bin = mkdtempSync(join(tmpdir(), "screenshots-emulator."));
    const started: Started[] = [];
    const stores: string[] = [];
    let client: { origin: string; stop(): Promise<void> } | undefined;
    const stop = async () => {
      await client?.stop();
      for (const emulator of started) await emulator.stop();
      for (const dir of [bin, ...stores]) rmSync(dir, { recursive: true, force: true });
    };
    try {
      execFileSync("go", ["build", "-o", join(bin, "server"), "./cmd/server"], {
        cwd: root,
        env: { ...process.env, GOWORK: "off", GOTOOLCHAIN: "local" },
        stdio: "inherit",
      });
      // The client's origin first: the emulators that admit it are configured with it.
      const layouts: Record<string, string | undefined> = {};
      let held: (() => void)[] = [];
      client = await serve({
        root: dist,
        shell: "index.html",
        handler: (request, response) => {
          const path = request.url!.split("?")[0];
          const [, prefix, rest] = path.match(/^\/(?:(failed|missing|malformed|loading)\/)?(.*)$/)!;
          const layout = prefix ?? "";
          if (rest === "services.json") {
            if (layout === "loading") {
              held.push(() => response.destroy());
              return true;
            }
            const body = layouts[layout];
            if (body === undefined) response.writeHead(404).end();
            else response.writeHead(200, { "content-type": "application/json" }).end(body);
            return true;
          }
          if (!prefix) return false;
          // A layout's page and assets are the build's own, under its prefix.
          const file = join(dist, normalize(`/${rest || "index.html"}`));
          const types: Record<string, string> = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
          };
          const type = types[extname(file)] ?? "text/html";
          const body = extname(file) ? readFileSync(file) : readFileSync(join(dist, "index.html"));
          response.writeHead(200, { "content-type": type }).end(body);
          return true;
        },
      });
      const origin = client.origin;
      const served = client;
      client = {
        origin,
        stop: async () => {
          for (const release of held) release();
          held = [];
          await served.stop();
        },
      };
      for (const [instance, admits] of [
        ["a", true],
        ["b", true],
        ["c", false],
      ] as const) {
        const [port, natsPort, wsPort] = [await freePort(), await freePort(), await freePort()];
        const own = `http://127.0.0.1:${port}`;
        const store = mkdtempSync(join(tmpdir(), "screenshots-store."));
        stores.push(store);
        started.push(
          await start(join(bin, "server"), [], {
            ready: `${own}/readyz`,
            cwd: root,
            env: {
              TMPDIR: store,
              EMULATOR_ENV: "",
              EMULATOR_SERVER_HOST: "127.0.0.1",
              EMULATOR_SERVER_PORT: String(port),
              EMULATOR_NATS_TOKEN: token,
              EMULATOR_NATS_PORT: String(natsPort),
              EMULATOR_NATS_WEBSOCKET_HOST: "127.0.0.1",
              EMULATOR_NATS_WEBSOCKET_PORT: String(wsPort),
              EMULATOR_CORS_ALLOWED_ORIGINS: admits ? origin : own,
              EMULATOR_RUNS_INSTANCE: instance,
              EMULATOR_RUNS_STAGE_INTERVAL: "1s",
            },
          }),
        );
        emulators[instance] = { origin: own, wsURL: `ws://127.0.0.1:${wsPort}` };
      }
      layouts[""] = servicesOf("a", "b");
      layouts.failed = servicesOf("a", "c");
      layouts.malformed = "{ services: ";
      // Documents each service holds before the first capture, their runs complete by then.
      for (const name of ["onboarding-checklist.txt", "glossary.txt"]) await upload("a", name);
      for (const name of ["contract-2026.txt", "brand-guide.md"]) await upload("b", name);
      await upload("c", "unreachable.txt");
      return { origin, stop };
    } catch (error) {
      await stop();
      throw error;
    }
  },
};

export default description;
