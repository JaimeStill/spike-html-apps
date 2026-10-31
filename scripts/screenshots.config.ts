// The pipeline app's captures for the tooling's screenshot bin (spike-html-apps-screenshots): the
// side pane's documents in each state, docked at 1280px and in the drawer at 375px, light and
// dark, over an emulator the start function boots for the run. A first cut, which slice 18's mise run screenshots extends: until then, build the
// app (mise run build:app) and run the bin with BROWSER_EXECUTABLE naming chrome-headless-shell:
//
//   BROWSER_EXECUTABLE=$(mise which chrome-headless-shell) \
//     pnpm exec spike-html-apps-screenshots scripts/screenshots.config.ts --output directory
//
// The start function builds cmd/server, embedding the app's build, into a temporary directory and
// boots it on free loopback ports, as test/browser/support/emulator.ts does, its stages a second
// apart so a capture finds runs mid-way, and its upload limit 2 MB so a larger file is refused.
// The states run in order, each in a fresh tab, light then dark, against the one emulator: the
// empty state first, before any upload, and each later state adding the documents it shows, so
// a dark capture lists the documents its light one uploaded too.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";
import { freePort, start } from "@jaimestill/spike-html-apps-tooling/process.js";
import type { Description, Step } from "@jaimestill/spike-html-apps-tooling/screenshots.js";

import {
  choose,
  entriesShown,
  listReady,
  PAGINATION,
  throttle,
} from "../test/browser/support/documents.ts";

/** The repository root, where the emulator reads config.json. */
const root = join(import.meta.dirname, "..");

/** The emulator's origin once start has booted it. */
let origin = "";

/** Uploads a text document through the API, as another client would. */
async function upload(name: string, text = "a document's text") {
  const response = await fetch(`${origin}/api/documents?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: text,
  });
  if (response.status !== 201) throw new Error(`upload ${name}: ${response.status}`);
  return (await response.json()) as { id: string };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Focuses the element the expression names, with focus emulated so its ring shows. */
async function focus(page: Page, element: string) {
  await page.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.evaluate(`(${element}).focus({ focusVisible: true })`);
}

/** The list's last entry's button, the newest document's on the last page, as a page
 * expression. */
const LAST_ENTRY =
  "[...document.querySelector('pipeline-documents sl-document-list').shadowRoot.querySelectorAll('sl-entry')].at(-1).shadowRoot.querySelector('button')";

/** Waits for the list's first page. */
const ready: Step = async (page) => {
  await listReady(page);
};

/** Uploads three files from the page, paced as a slow link would: the small ones done and
 * listed, the large one under way, its cancel focused. */
const uploading: Step = async (page) => {
  await listReady(page);
  await throttle(page, 200_000);
  await choose(page, [
    { name: "quarterly-report.pdf", size: 1_500_000 },
    { name: "notes.txt", text: "meeting notes" },
    { name: "brand-guide.md", text: "# Brand guide" },
  ]);
  await until(
    page,
    `document.querySelector("pipeline-documents").uploads.filter((u) => u.state === "done").length === 2`,
  );
  await until(page, `document.querySelector("pipeline-documents").uploads[0].sent > 400000`);
  await focus(
    page,
    "document.querySelector('pipeline-documents sl-upload-dropzone').shadowRoot.querySelector('button.cancel')",
  );
};

/** Three runs uploaded a second apart by another client, so the list shows them at its end mid-way,
 * live; the newest's entry focused, which scrolls the pane to them. */
const live: Step = async (page) => {
  await listReady(page);
  const listed = await page.evaluate(
    "document.querySelector('pipeline-documents sl-document-list').shadowRoot.querySelectorAll('li').length",
  );
  await upload("contract-2026.txt");
  await wait(2_500);
  await upload("onboarding-checklist.txt");
  await wait(1_200);
  await upload("glossary.txt");
  await entriesShown(page, listed + 3);
  await wait(300);
  await focus(page, LAST_ENTRY);
  await page.evaluate(`(${LAST_ENTRY}).scrollIntoView({ block: "end" })`);
};

/** A file over the emulator's 2 MB limit, refused, beside one that fits. */
const failure: Step = async (page) => {
  await listReady(page);
  await choose(page, [
    { name: "scan-archive.tiff", size: 3_000_000 },
    { name: "summary.txt", text: "fits" },
  ]);
  await until(
    page,
    `document.querySelector("pipeline-documents").uploads.every((u) => u.state !== "uploading")`,
  );
};

/** The docked pane at its full width: an upload from the page under way above the list, and on
 * the list's last page, the newest documents, runs a second apart advancing live. */
const docked: Step = async (page) => {
  await listReady(page);
  await throttle(page, 150_000);
  await choose(page, [{ name: "annual-review-2026.pdf", size: 1_200_000 }]);
  await upload("vendor-agreement.txt");
  await wait(1_500);
  await upload("release-notes.md");
  await wait(300);
  // Next page, until there is none: the last page, which holds the newest documents.
  for (;;) {
    const next = await page.evaluate(`(() => {
      const next = ${PAGINATION}.querySelector('button[aria-label="Next page"]');
      if (!next || next.disabled) return false;
      next.click();
      return true;
    })()`);
    if (!next) break;
    await wait(200);
    await listReady(page);
  }
  await until(page, `document.querySelector("pipeline-documents").uploads[0].sent > 400000`);
};

/** The drawer, as a page expression. */
const DRAWER = "document.querySelector('pipeline-workspace sl-drawer')";

/** Opens the drawer, and waits out its slide. */
async function showDrawer(page: Page) {
  await page.evaluate(`${DRAWER}.show()`);
  await until(page, `${DRAWER}.shadowRoot.querySelector("dialog")?.matches(":modal")`);
  await wait(400);
}

/** The narrow main view, the drawer closed: the documents button's badge counts an upload under
 * way behind it. */
const narrowBadge: Step = async (page) => {
  await listReady(page);
  await throttle(page, 100_000);
  await choose(page, [{ name: "field-photos.zip", size: 1_500_000 }]);
  await until(page, `document.querySelector("pipeline-documents").uploads[0].sent > 200000`);
  await until(page, `document.querySelector(".workspace-documents .workspace-badge")`);
};

/** The drawer open over the narrow view, its list of the documents so far. */
const narrowList: Step = async (page) => {
  await listReady(page);
  await showDrawer(page);
};

/** The drawer open mid-upload, the long name wrapping in the narrow pane. */
const narrowUploading: Step = async (page) => {
  await listReady(page);
  await showDrawer(page);
  await throttle(page, 100_000);
  await choose(page, [
    { name: "a-long-document-name-that-wraps-in-a-narrow-pane.txt", size: 900_000 },
  ]);
  await until(page, `document.querySelector("pipeline-documents").uploads[0].sent > 300000`);
};

/** A phone's viewport. */
const phone = { width: 375, height: 667 };

const description: Description = {
  pages: [
    {
      name: "documents",
      caption: "Side pane",
      path: "chat",
      states: [
        { name: "empty", caption: "Side pane, empty", full: false, open: ready },
        { name: "uploading", caption: "Side pane, uploading", full: false, open: uploading },
        { name: "live", caption: "Side pane, live statuses", full: false, open: live },
        { name: "failure", caption: "Side pane, an upload refused", full: false, open: failure },
        {
          name: "docked",
          caption: "Side pane, docked at 1280px, live and uploading",
          full: false,
          open: docked,
        },
        {
          name: "narrow-badge",
          caption: "Drawer closed at 375px, an upload counted on its button",
          viewport: phone,
          full: false,
          open: narrowBadge,
        },
        {
          name: "narrow-list",
          caption: "Drawer open at 375px, the list",
          viewport: phone,
          full: false,
          open: narrowList,
        },
        {
          name: "narrow-uploading",
          caption: "Drawer open at 375px, mid-upload",
          viewport: phone,
          full: false,
          open: narrowUploading,
        },
      ],
    },
  ],
  server: async () => {
    const bin = mkdtempSync(join(tmpdir(), "screenshots-emulator."));
    const temp = mkdtempSync(join(tmpdir(), "screenshots-store."));
    try {
      execFileSync("go", ["build", "-o", join(bin, "server"), "./cmd/server"], {
        cwd: root,
        env: { ...process.env, GOWORK: "off", GOTOOLCHAIN: "local" },
        stdio: "inherit",
      });
      const [port, natsPort, wsPort] = [await freePort(), await freePort(), await freePort()];
      origin = `http://127.0.0.1:${port}`;
      const emulator = await start(join(bin, "server"), [], {
        ready: `${origin}/readyz`,
        cwd: root,
        env: {
          TMPDIR: temp,
          EMULATOR_ENV: "",
          EMULATOR_SERVER_HOST: "127.0.0.1",
          EMULATOR_SERVER_PORT: String(port),
          EMULATOR_NATS_TOKEN: "screenshots-token",
          EMULATOR_NATS_PORT: String(natsPort),
          EMULATOR_NATS_WEBSOCKET_HOST: "127.0.0.1",
          EMULATOR_NATS_WEBSOCKET_PORT: String(wsPort),
          EMULATOR_CORS_ALLOWED_ORIGINS: origin,
          EMULATOR_RUNS_STAGE_INTERVAL: "1s",
          EMULATOR_DOCUMENTS_MAX_SIZE: "2000000",
        },
      });
      return {
        origin: `${origin}/app`,
        stop: async () => {
          await emulator.stop();
          rmSync(bin, { recursive: true, force: true });
          rmSync(temp, { recursive: true, force: true });
        },
      };
    } catch (error) {
      rmSync(bin, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
      throw error;
    }
  },
};

export default description;
