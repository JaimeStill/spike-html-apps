// The pipeline app's captures for the tooling's screenshot bin (spike-html-apps-screenshots): the
// side pane's documents in each state, docked at 1280px and at 768px, the stacking width, and in
// the drawer at 375px, and a run failed; and the document view, a run under way, complete with a
// Markdown artifact, a JSON artifact, a PDF, an image, a binary of a type the viewer doesn't
// know, a run failed, and not found, docked at 1280×1200 and at 375px, full-page (--page
// document); light and dark, over an emulator the start function boots for the run. Headless
// Chrome has no PDF viewer, so the PDF state's frame is blank there; a real Chrome renders its
// one page. A first cut, which slice 18's mise run screenshots extends: until then, build the app
// (mise run build:app) and run the bin with BROWSER_EXECUTABLE naming chrome-headless-shell:
//
//   BROWSER_EXECUTABLE=$(mise which chrome-headless-shell) \
//     pnpm exec spike-html-apps-screenshots scripts/screenshots.config.ts --output directory
//
// The start function builds cmd/server, embedding the app's build, into a temporary directory and
// boots it on free loopback ports, as test/browser/support/emulator.ts does, its stages a second
// apart so a capture finds runs mid-way, its upload limit 2 MB so a larger file is refused, and
// its fail rule failing a document named fail-at-… at extraction, so a capture shows a failed run.
// The states run in order, each in a fresh tab, light then dark, against the one emulator: the
// empty state first, before any upload, and each later state adding the documents it shows, so
// a dark capture lists the documents its light one uploaded too.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

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
import { summaryPdf } from "../test/browser/support/media.ts";

/** The repository root, where the emulator reads config.json. */
const root = join(import.meta.dirname, "..");

/** The emulator's origin once start has booted it. */
let origin = "";

/** Uploads a document through the API, as another client would, a text one by default. */
async function upload(
  name: string,
  text: string | Uint8Array<ArrayBuffer> = "a document's text",
  type = "text/plain",
) {
  const response = await fetch(`${origin}/api/documents?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": type },
    body: text,
  });
  if (response.status !== 201) throw new Error(`upload ${name}: ${response.status}`);
  return (await response.json()) as { id: string; run_id: string };
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

/** Turns the list to its last page, which holds the newest documents: Next, until there is none. */
async function lastPage(page: Page) {
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
}

/** The document whose run the fail rule fails at extraction, uploaded with one whose run
 * completes after it, by the first state that shows it, and waited on until the API reads its run
 * failed. */
let failing: Promise<string> | undefined;
const failedDocument = () =>
  (failing ??= (async () => {
    const { id, run_id } = await upload("fail-at-extraction.txt", "a scan the extractor rejects");
    await upload("intake-form.txt", "a form the extractor reads");
    for (;;) {
      const response = await fetch(`${origin}/api/runs/${run_id}`);
      if (((await response.json()) as { status: string }).status === "failed") return id;
      await wait(100);
    }
  })());

/** The failed document's entry's button, as a page expression; undefined while the page shown
 * doesn't list it. */
const FAILED_ENTRY =
  "[...document.querySelector('pipeline-documents sl-document-list').shadowRoot.querySelectorAll('sl-entry')].find((entry) => entry.item?.name === 'fail-at-extraction.txt')?.shadowRoot.querySelector('button')";

/** A run failed at extraction, its entry focused on the page that lists it, beside the run
 * uploaded after it, still under way. */
const listFailed: Step = async (page) => {
  await listReady(page);
  await failedDocument();
  // Next page, until the page shown lists it.
  while (!(await page.evaluate(`Boolean(${FAILED_ENTRY})`))) {
    await page.evaluate(`${PAGINATION}.querySelector('button[aria-label="Next page"]').click()`);
    await wait(200);
    await listReady(page);
  }
  await until(
    page,
    `(${FAILED_ENTRY}).getRootNode().querySelector('.status').textContent.startsWith('failed')`,
  );
  await focus(page, FAILED_ENTRY);
  await page.evaluate(`(${FAILED_ENTRY}).scrollIntoView({ block: "end" })`);
};

/** The docked pane at its full width: an upload from the page under way above the list, and on
 * the list's last page, the newest documents, runs a second apart advancing live, the first of
 * them chosen, its entry the selected one and its view in the main pane. */
const docked: Step = async (page) => {
  await listReady(page);
  await throttle(page, 150_000);
  await choose(page, [{ name: "annual-review-2026.pdf", size: 1_200_000 }]);
  await upload("vendor-agreement.txt");
  await wait(1_500);
  await upload("release-notes.md");
  await wait(300);
  await lastPage(page);
  await page.evaluate(`[
    ...document.querySelector('pipeline-documents sl-document-list').shadowRoot.querySelectorAll('sl-entry'),
  ].find((entry) => entry.shadowRoot.querySelector('.name').textContent === 'vendor-agreement.txt')
    .shadowRoot.querySelector('button').click()`);
  await until(
    page,
    `document.querySelector('main')?.firstElementChild?.localName === 'pipeline-document'`,
  );
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

/** The Markdown document the complete state shows. */
const GUIDE = `# Onboarding guide

Welcome to the pipeline. Each document you upload passes through **five stages**, and its
content shows here once it is stored.

## Before you start

- Read the [style notes](https://example.com/style) once.
- Keep each upload under *32 MB*.
- Name files so the list sorts them: \`2026-q3-report.md\`.

## Stages

| Stage | What it does |
| --- | --- |
| upload | stores the bytes |
| metadata | reads the name and type |
| extraction | pulls out the text |

\`\`\`sh
curl -X POST "$API/documents?name=notes.txt" --data-binary @notes.txt
\`\`\`

> A run that stalls shows its last stage in progress until it moves again.
`;

/** The JSON document the JSON state shows. */
const SETTINGS = JSON.stringify({
  pipeline: {
    name: "intake",
    stages: ["upload", "metadata", "extraction", "chunks", "embeddings"],
  },
  limits: { max_size: 33554432, page_size: 20 },
  retention: { days: 30, archive: true },
});

/** A PNG, `width` by `height`, of a diagonal gradient from teal to violet, made here so the
 * image state needs no file. */
function gradientPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace.
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      rows.set(
        [Math.round(20 + 120 * t), Math.round(160 - 100 * t), Math.round(150 + 90 * t)],
        y * (1 + width * 3) + 1 + x * 3,
      );
    }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** The complete states' documents, each one's id by its key: uploaded by the document view's
 * first state, after the side pane's states, whose lists they would join, and waited on until
 * their runs, a second a stage, are done. */
let seeding: Promise<Record<string, string>> | undefined;
const seeded = () =>
  (seeding ??= (async () => {
    const ids = {
      guide: (await upload("onboarding-guide.md", GUIDE, "text/markdown")).id,
      settings: (await upload("pipeline-settings.json", SETTINGS, "application/json")).id,
      scan: (await upload("signed-contract.pdf", summaryPdf(), "application/pdf")).id,
      photo: (await upload("site-photo.png", gradientPng(480, 320), "image/png")).id,
      archive: (
        await upload(
          "sensor-dump.bin",
          Uint8Array.from({ length: 512 }, (_, i) => (i * 37) % 256),
          "application/octet-stream",
        )
      ).id,
    };
    await wait(5_500);
    return ids;
  })());

/** Navigates the page to the document's view and waits for its stages and its content. */
async function showDocument(page: Page, id: string) {
  await listReady(page);
  await page.evaluate(`navigation.navigate("documents/${id}").finished.then(() => true)`);
  await until(
    page,
    `(() => {
      const view = document.querySelector("pipeline-document");
      return view?.getAttribute("document") === ${JSON.stringify(id)} && !view.hasAttribute("aria-busy") &&
        (view.querySelector("h1")?.textContent === "Document not found" ||
          view.querySelector("sl-artifact-viewer")?.state === "ready");
    })()`,
  );
  await wait(200);
}

/** A run under way: a document uploaded as the state opens, shown with its third stage active. */
const documentLive: Step = async (page) => {
  void seeded();
  const { id } = await upload(
    "field-report.md",
    "# Field report\n\nNotes from the site visit.",
    "text/markdown",
  );
  await showDocument(page, id);
  await until(
    page,
    `document.querySelector("pipeline-document sl-stage-timeline")?.shadowRoot.querySelector("li.active[data-name=extraction]")`,
  );
  await wait(300);
};

const documentMarkdown: Step = async (page) => showDocument(page, (await seeded()).guide);
const documentJson: Step = async (page) => showDocument(page, (await seeded()).settings);
const documentPdf: Step = async (page) => showDocument(page, (await seeded()).scan);
const documentImage: Step = async (page) => {
  await showDocument(page, (await seeded()).photo);
  await page.evaluate(
    `document.querySelector("pipeline-document sl-artifact-viewer").shadowRoot.querySelector("img").decode().then(() => true)`,
  );
};
const documentBinary: Step = async (page) => showDocument(page, (await seeded()).archive);
const documentFailed: Step = async (page) => showDocument(page, await failedDocument());
const documentMissing: Step = (page) => showDocument(page, "01900000-0000-7000-8000-000000000000");

/** The document view's states, each docked at 1280×1200 and at 375×667, captured full-page, so the
 * content below the fold shows too. Docked, the workspace's panes scroll inside a frame the
 * viewport's height, so a full-page capture is only the viewport: the docked states take a taller
 * one, which shows a short artifact whole and a long one's start. */
const documentStates = [
  { name: "live", caption: "a run under way", open: documentLive },
  { name: "markdown", caption: "complete, a Markdown artifact", open: documentMarkdown },
  { name: "json", caption: "a JSON artifact", open: documentJson },
  { name: "pdf", caption: "a PDF, blank in headless Chrome", open: documentPdf },
  { name: "image", caption: "a PNG image", open: documentImage },
  { name: "binary", caption: "a binary it can't show", open: documentBinary },
  { name: "failed", caption: "a run failed at extraction", open: documentFailed },
  { name: "missing", caption: "not found", open: documentMissing },
].flatMap(({ name, caption, open }) => [
  {
    name: `docked-${name}`,
    caption: `Document view, docked at 1280×1200, ${caption}`,
    viewport: { width: 1280, height: 1200 },
    full: true,
    open,
  },
  {
    name: `narrow-${name}`,
    caption: `Document view at 375px, ${caption}`,
    viewport: phone,
    full: true,
    open,
  },
]);

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
          name: "boundary",
          caption: "Side pane, docked at 768px, the stacking width",
          viewport: { width: 768, height: 1024 },
          full: false,
          open: ready,
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
        { name: "failed", caption: "Side pane, a run failed", full: false, open: listFailed },
      ],
    },
    {
      name: "document",
      caption: "Document view",
      path: "chat",
      states: documentStates,
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
          EMULATOR_RUNS_FAIL: "fail-at-*:extraction",
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
