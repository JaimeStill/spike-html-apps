// mise run screenshots' description, which spike-html-apps-tooling's spike-html-apps-screenshots
// reads: the pipeline app's walkthrough, its pages in the order a reader meets them, over an
// emulator the start function boots for the run.
//
// - Upload: the event log, empty before any run (--page log-empty); then the side pane's documents
//   (--page documents), empty, uploading, live statuses, an upload refused, docked at 1280px and
//   at 768px, the stacking width, in the drawer at 375px, closed and open, and a run failed.
// - Stages live: the event log (--page log), runs arriving live, a run's failure event, and the
//   read restarted from the oldest event under a cursor the stream never gave out.
// - Chat (--page chat): empty, the rich reply mid-stream, its reasoning and function call open,
//   the rich reply finished, its Markdown, one stopped, one failed, and a send the network failed.
// - Search (--page search): its prompt, matches with the query marked, none, searching, and a
//   search the network failed.
// - Artifact: the document view (--page document), a run under way, complete with a Markdown
//   artifact, a JSON artifact, a PDF, an image, a binary of a type the viewer doesn't know, a run
//   failed, and not found. Headless Chrome has no PDF viewer, so the PDF state's frame is blank
//   there; a real Chrome renders its one page.
// - The help dialog, opened by ? (--page help), and the theme menu, opened by t (--page theme),
//   each its viewport alone at 1280px and at 375px.
//
// The log's, the chat's, the search's, and the document view's states are docked at 1280×1200 and
// at 375px, full-page. Each state is captured light and dark at the profile the facets give,
// palette, space, and type, flexoki, regular, and mono by default; --all takes every built-in
// profile, each palette at the defaults, then compact and sans at flexoki, as the components'
// description does, each name checked against the foundation's registry, which the app's
// register-full.js fills.
//
// The start function builds nothing: mise run screenshots builds the app (build:app), then
// cmd/server, embedding it, into a temporary directory, and names the binary in EMULATOR_BINARY,
// as test:browser does. The start boots it with the tooling's process helper on free loopback
// ports, the app at /app, its stages a second apart so a capture finds runs mid-way, its upload
// limit 2 MB so a larger file is refused, its fail rule failing a document named fail-at-… at
// extraction, so a capture shows a failed run, its hold rule holding the run under way's
// document, field-report.md, at extraction, so its capture finds that stage active however long
// the capture takes to reach it, and its replies a word every 150 ms, so a capture finds one
// mid-stream.
//
// The states run in order, each in a fresh tab, every profile and scheme of one state before the
// next, against the one emulator: the empty log and the empty side pane first, before any upload,
// and each later state adding the documents it shows, so a later capture lists the documents the
// earlier ones uploaded too, and --all's twelve passes of a state upload twelve times over; the
// states that show the newest documents turn the list to its last page to find them. Each page
// stands alone, as --page runs it: a state that shows documents an earlier page uploads in a full
// run ensures them, found by name through the emulator's search and uploaded only when absent, so
// the search's states find the documents the side pane's uploaded, or upload the two they show,
// and a full run's later pages upload none of what its earlier ones did. The failed run and the document view's complete documents
// are uploaded once a run, by the first state that shows them, whichever page it is on.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";
import { freePort, start } from "@jaimestill/spike-html-apps-tooling/process.js";
import type { Description, Step } from "@jaimestill/spike-html-apps-tooling/screenshots.js";

import { choose, listReady, PAGINATION, throttle } from "../test/browser/support/documents.ts";
import { press, pressHelp } from "../test/browser/support/keys.ts";
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

/** Uploads the document named `name` through the API unless the emulator holds one by that name
 * already, as a run that met it on an earlier page does: found by the search, which matches names,
 * every page of its matches read for one named exactly so. A page run alone so uploads the
 * documents it shows, and a full run, which uploaded them earlier, uploads nothing again. */
async function ensure(...args: Parameters<typeof upload>) {
  const [name] = args;
  for (let page = 1; ; page++) {
    const response = await fetch(
      `${origin}/api/search?q=${encodeURIComponent(name)}&size=100&page=${page}`,
    );
    if (response.status !== 200) throw new Error(`search ${name}: ${response.status}`);
    const found = (await response.json()) as { items: { name: string }[]; more: boolean };
    if (found.items.some((match) => match.name === name)) return;
    if (!found.more) break;
  }
  await upload(...args);
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

/** The name of the shown page's last entry, as a page expression. */
const LAST_NAME = `(${LAST_ENTRY})?.getRootNode().querySelector('.name').textContent`;

/** Turns the list to its last page until that page's last entry is the document named `name`, the
 * newest: however many documents the states before uploaded, as --all's twelve passes of each
 * state upload twelve times over, an upload elsewhere refreshes the last page quietly, or makes
 * the next one. */
async function newest(page: Page, name: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    await lastPage(page);
    if ((await page.evaluate(LAST_NAME)) === name) return;
    if (Date.now() > deadline) throw new Error(`the list's last entry isn't ${name}`);
    await wait(200);
  }
}

/** Three runs uploaded a second apart by another client, so the list shows them at its end mid-way,
 * live; the newest's entry focused, which scrolls the pane to them. */
const live: Step = async (page) => {
  await listReady(page);
  await upload("contract-2026.txt");
  await wait(2_500);
  await upload("onboarding-checklist.txt");
  await wait(1_200);
  await upload("glossary.txt");
  await newest(page, "glossary.txt");
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
 * the list's last page, the newest documents, runs a second apart advancing live, the newest of
 * them chosen, its entry the selected one and its view in the main pane. */
const docked: Step = async (page) => {
  await listReady(page);
  await throttle(page, 150_000);
  await choose(page, [{ name: "annual-review-2026.pdf", size: 1_200_000 }]);
  await upload("vendor-agreement.txt");
  await wait(1_500);
  await upload("release-notes.md");
  await newest(page, "release-notes.md");
  await page.evaluate(`(${LAST_ENTRY}).click()`);
  await until(
    page,
    `document.querySelector('main')?.firstElementChild?.localName === 'pipeline-document'`,
  );
  await until(page, `document.querySelector("pipeline-documents").uploads[0].sent > 400000`);
  // The chosen entry in view, below the earlier passes' documents when the last page is full.
  await page.evaluate(
    `document.querySelector('pipeline-documents sl-document-list').shadowRoot.querySelector('li[aria-current="true"]')?.scrollIntoView({ block: "nearest" })`,
  );
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

/** A run under way: a document uploaded as the state opens, shown with its third stage active,
 * where the hold rule keeps it. */
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

/** The chat view, its composer, and its thread's shadow root, as page expressions. */
const CHAT = "document.querySelector('pipeline-chat')";
const COMPOSER = `${CHAT}?.querySelector('sl-composer')`;
const THREAD = `${CHAT}?.querySelector('sl-chat-thread')?.shadowRoot`;

/** The thread's last item's text, as a page expression. */
const LAST_TEXT = `([...(${THREAD}?.querySelectorAll(".thread > li") ?? [])].at(-1)?.querySelector(".content")?.textContent.trim() ?? "")`;

/** Waits for the composer, then sends the text through it, as Enter does. */
async function chatSend(page: Page, text: string) {
  await until(page, `${COMPOSER}?.shadowRoot?.querySelector("textarea")`);
  await page.evaluate(`(() => {
    const composer = ${COMPOSER};
    composer.value = ${JSON.stringify(text)};
    composer.send();
  })()`);
  await until(page, `${COMPOSER}.busy`);
}

/** Waits until the reply streaming has `words` words. */
const chatWords = (page: Page, words: number) =>
  until(page, `${LAST_TEXT}.split(/\\s+/).filter(Boolean).length >= ${words}`, 15_000);

/** Waits until the composer is idle again, the reply ended: the rich reply streams about 125
 * deltas, some 19 s at 150 ms each. */
const chatIdle = (page: Page) => until(page, `!${COMPOSER}.busy`, 30_000);

/** The thread's verbose item of the type, its details, as a page expression. */
const VERBOSE = (type: string) => `${THREAD}?.querySelector(".thread > li details.${type}")`;

/** The empty conversation, before anything is sent. */
const chatEmpty: Step = async (page) => {
  await until(page, `${COMPOSER}?.shadowRoot?.querySelector("textarea")`);
};

/** The rich reply mid-stream, its function call's arguments growing, the composer busy with its
 * Stop: the reasoning, done, and the call, streaming, opened, as a reader opens them. */
const chatStreaming: Step = async (page) => {
  await chatSend(page, "/rich");
  await until(
    page,
    `${VERBOSE("function_call")}?.querySelector("pre")?.textContent.length > 30`,
    30_000,
  );
  await page.evaluate(
    `${THREAD}.querySelectorAll("details.reasoning, details.function_call").forEach((details) => {
      details.open = true;
    })`,
  );
};

/** The rich reply finished, its Markdown rendered, its reasoning and function call collapsed, the
 * composer's field focused with a draft. */
const chatFinished: Step = async (page) => {
  await chatSend(page, "/rich");
  await chatIdle(page);
  await focus(page, `${COMPOSER}.shadowRoot.querySelector("textarea")`);
  await page.cdp("Input.insertText", { text: "Which documents failed?" });
};

/** A reply the reader stopped part way. */
const chatStopped: Step = async (page) => {
  await chatSend(page, "List every document in the workspace.");
  await chatWords(page, 8);
  await page.evaluate(`${COMPOSER}.shadowRoot.querySelector("button.action").click()`);
  await chatIdle(page);
};

/** A reply the emulator's failure trigger failed. */
const chatFailed: Step = async (page) => {
  await chatSend(page, "/fail");
  await chatIdle(page);
};

/** A send the network failed, its Try again shown: the message's request fails as a lost network
 * does. */
const chatTrouble: Step = async (page) => {
  page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) => {
    void page.cdp("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
    void page.cdp("Fetch.disable");
  });
  await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/messages" }] });
  await chatSend(page, "Are you there?");
  await until(page, `${CHAT}.querySelector(".chat-trouble")`);
};

/** The chat view's states, each docked at 1280×1200 and at 375×667, captured full-page. The
 * mid-stream and finished states send the emulator's rich trigger, /rich, so they show reasoning,
 * a function call and its output, and a Markdown reply; the rest stream its plain prose. */
const chatStates = [
  { name: "empty", caption: "empty", open: chatEmpty },
  {
    name: "streaming",
    caption: "the rich reply mid-stream, its function call's arguments growing",
    open: chatStreaming,
  },
  { name: "finished", caption: "the rich reply finished in Markdown, a draft", open: chatFinished },
  { name: "stopped", caption: "a reply stopped", open: chatStopped },
  { name: "failed", caption: "a reply failed by /fail", open: chatFailed },
  { name: "trouble", caption: "a send the network failed", open: chatTrouble },
].flatMap(({ name, caption, open }) => [
  {
    name: `docked-${name}`,
    caption: `Chat, docked at 1280×1200, ${caption}`,
    viewport: { width: 1280, height: 1200 },
    full: true,
    open,
  },
  {
    name: `narrow-${name}`,
    caption: `Chat at 375px, ${caption}`,
    viewport: phone,
    full: true,
    open,
  },
]);

/** The event log's sl-event-log's shadow root, and its frame, as page expressions. */
const LOG_ROOT = "document.querySelector('pipeline-log sl-event-log')?.shadowRoot";
const LOG_FRAME = `${LOG_ROOT}?.querySelector(".frame")`;

/** Waits until the log's frame shows `count` events or more. */
const logShows = (page: Page, count: number) =>
  until(page, `(${LOG_ROOT}?.querySelectorAll("li.event").length ?? 0) >= ${count}`, 15_000);

/** Scrolls the log's frame to its end, where it follows the newest event. */
const logToEnd = (page: Page) =>
  page.evaluate(`void ((frame) => { frame.scrollTop = frame.scrollHeight; })(${LOG_FRAME})`);

/** The log in a tab before any run: no events yet. */
const logEmpty: Step = async (page) => {
  await until(page, `${LOG_ROOT}?.querySelector(".empty")`);
};

/** The number of events the log shows whose subject is one of the runs, as a page expression. */
const RUN_EVENTS = (runs: string[]) =>
  `document.querySelector("pipeline-log").events.filter((event) => ${JSON.stringify(runs)}.includes(event.subject)).length`;

/** Two runs uploaded a second apart by another client, their stage events arriving live at the
 * log's end, after whatever events it shows already, none when the page runs alone; the newest's
 * data opened as a reader opens it. The runs are new each pass, by design: the state is events
 * arriving. */
const logLive: Step = async (page) => {
  await until(page, `${LOG_ROOT}?.querySelector(".empty, li.event")`);
  await wait(500);
  await logToEnd(page);
  const runs = [(await upload("weekly-summary.txt")).run_id];
  await wait(1_200);
  runs.push((await upload("meeting-minutes.txt")).run_id);
  // Their own events, four of them, both runs' among them: other runs, under way when a full run
  // reaches this state, add events of their own too.
  await until(
    page,
    `${RUN_EVENTS(runs)} >= 4 && ${runs.map((run) => RUN_EVENTS([run]) + " > 0").join(" && ")}`,
    15_000,
  );
  await wait(300);
  await page.evaluate(`void (${LOG_ROOT}.querySelectorAll("li.event details.data") ?? []).forEach(
    (details, i, all) => { details.open = i === all.length - 1; })`);
  await logToEnd(page);
};

/** The failed run's failure event, scrolled to and its data opened. */
const logFailed: Step = async (page) => {
  await failedDocument();
  await until(
    page,
    `[...(${LOG_ROOT}?.querySelectorAll("li.event .type") ?? [])].some((type) => type.textContent === "emulator.run.failed")`,
    15_000,
  );
  await page.evaluate(`(() => {
    const failure = [...${LOG_ROOT}.querySelectorAll("li.event")].find(
      (li) => li.querySelector(".type").textContent === "emulator.run.failed",
    );
    failure.querySelector("details.data").open = true;
    failure.scrollIntoView({ block: "start" });
  })()`);
};

/** The feed restarted: the tab's stored cursor is one the stream never gave out, as after the
 * emulator restarted with a new store, so the feed reads from the oldest event at once and the
 * log's status line says so, quietly, beside the events of the runs the log's earlier states
 * uploaded, however the page runs. The cursor is stored as the reloaded document starts, ahead of
 * the app's modules: stored any sooner, the log, showing the events of those runs, some still under
 * way, would store its own over it before the reload. */
const logRestarted: Step = async (page) => {
  await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `sessionStorage.setItem("pipeline-log.cursor", "999999")`,
  });
  const loaded = new Promise((resolve) => page.on("Page.loadEventFired", resolve));
  await page.cdp("Page.reload");
  await loaded;
  await until(
    page,
    `document.querySelector("pipeline-log .log-status")?.textContent.includes("restarted")`,
    15_000,
  );
  await logShows(page, 1);
  await wait(300);
};

/** The log's states, each docked at 1280×1200 and at 375×667, captured full-page. */
const logStates = (states: { name: string; caption: string; open: Step }[]) =>
  states.flatMap(({ name, caption, open }) => [
    {
      name: `docked-${name}`,
      caption: `Event log, docked at 1280×1200, ${caption}`,
      viewport: { width: 1280, height: 1200 },
      full: true,
      open,
    },
    {
      name: `narrow-${name}`,
      caption: `Event log at 375px, ${caption}`,
      viewport: phone,
      full: true,
      open,
    },
  ]);

/** The search results, as a page expression. */
const RESULTS = "document.querySelector('pipeline-search sl-search-results')";

/** Navigates to the search for `q` and waits for its answer. */
async function search(page: Page, q: string) {
  await page.evaluate(
    `navigation.navigate("search?q=${encodeURIComponent(q)}").finished.then(() => true)`,
  );
  await until(page, `${RESULTS}?.query === ${JSON.stringify(q)} && ${RESULTS}.state !== "loading"`);
  await wait(200);
}

/** The prompt, before any query. */
const searchPrompt: Step = async (page) => {
  await until(page, `${RESULTS}?.shadowRoot?.querySelector(".status .prompt")`);
};

/** The documents the search for "notes" matches, ensured in the order the side pane's states upload
 * them: notes.txt, in its name and its content, as the uploading state chooses it, and
 * release-notes.md, in its name, as the docked state uploads it. */
async function notes() {
  await ensure("notes.txt", "meeting notes");
  await ensure("release-notes.md");
}

/** The matches for "notes", in names and in content, the second match focused. */
const searchMatches: Step = async (page) => {
  await notes();
  await search(page, "notes");
  await focus(page, `${RESULTS}.shadowRoot.querySelectorAll("button.match")[1]`);
};

/** A query no document matches. */
const searchNone: Step = (page) => search(page, "zebra crossing");

/** The search for "onboarding" under way after the matches for "notes", which it cleared at once:
 * the results only its status line, searching, its request held, as a slow link holds it. */
const searchLoading: Step = async (page) => {
  await notes();
  await search(page, "notes");
  await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/search*" }] });
  await page.evaluate(`void navigation.navigate("search?q=onboarding")`);
  await until(page, `${RESULTS}?.state === "loading"`);
};

/** A search the network failed, its Try again focused. */
const searchError: Step = async (page) => {
  page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) => {
    void page.cdp("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
    void page.cdp("Fetch.disable");
  });
  await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/search*" }] });
  await page.evaluate(`void navigation.navigate("search?q=onboarding")`);
  await until(page, `${RESULTS}?.state === "error"`);
  await focus(page, "document.querySelector('.search-retry')");
};

/** The search view's states, each docked at 1280×1200 and at 375×667, captured full-page. */
const searchStates = [
  { name: "prompt", caption: "no query yet", open: searchPrompt },
  { name: "matches", caption: "matches, the query marked, one focused", open: searchMatches },
  { name: "none", caption: "no matches", open: searchNone },
  { name: "loading", caption: "searching, the last matches cleared", open: searchLoading },
  { name: "error", caption: "a search the network failed", open: searchError },
].flatMap(({ name, caption, open }) => [
  {
    name: `docked-${name}`,
    caption: `Search, docked at 1280×1200, ${caption}`,
    viewport: { width: 1280, height: 1200 },
    full: true,
    open,
  },
  {
    name: `narrow-${name}`,
    caption: `Search at 375px, ${caption}`,
    viewport: phone,
    full: true,
    open,
  },
]);

/** The workspace, mounted: the keys module listens once it is. */
const mounted = (page: Page) => until(page, `Boolean(document.querySelector("pipeline-chat"))`);

/** Waits out a dialog's opening animations, its backdrop's among them. */
const opened = (page: Page, dialog: string) =>
  page.evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(dialog)});
    return Promise.all(dialog.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => true);
  })()`);

/** The help dialog, opened by ?, as a reader presses it, its list of every binding filled. */
const helpOpen: Step = async (page) => {
  await mounted(page);
  await pressHelp(page);
  await until(page, `document.querySelector("#help").open`);
  await until(page, `Boolean(document.querySelector("#help [data-keys-list] kbd"))`);
  await opened(page, "#help");
};

/** The theme menu's dialog. */
const MENU = "sl-theme-menu dialog";

/** The theme menu, opened by t, as a reader presses it, each row at the profile applied. */
const themeOpen: Step = async (page) => {
  await mounted(page);
  await press(page, "t");
  await until(page, `document.querySelector(${JSON.stringify(MENU)})?.open`);
  await opened(page, MENU);
};

/** A dialog's states, named by it: its viewport alone, at 1280×800 and at 375×667. */
const dialogStates = (name: string, caption: string, open: Step) => [
  {
    name: `${name}-wide`,
    caption: `${caption} at 1280px`,
    viewport: { width: 1280, height: 800 },
    full: false,
    open,
  },
  { name: `${name}-narrow`, caption: `${caption} at 375px`, viewport: phone, full: false, open },
];

/** The page's registered names, by flag, read from the foundation's store at its well-known
 * global key, as the components' description reads it; its color facet is palette's. */
const REGISTRY = `(() => {
  const store = globalThis[Symbol.for("spike-html-apps-foundation.registry")] ?? {};
  return { palette: store.color ?? [], space: store.space ?? [], type: store.type ?? [] };
})()`;

const description: Description = {
  pages: [
    {
      name: "log-empty",
      caption: "Event log, empty",
      path: "",
      states: logStates([{ name: "empty", caption: "before any run", open: logEmpty }]),
    },
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
      name: "log",
      caption: "Event log",
      path: "",
      states: logStates([
        { name: "live", caption: "runs arriving live, the newest's data open", open: logLive },
        { name: "failed", caption: "a run's failure event, its data open", open: logFailed },
        {
          name: "restarted",
          caption: "the read restarted from the oldest event, said quietly",
          open: logRestarted,
        },
      ]),
    },
    {
      name: "chat",
      caption: "Chat",
      path: "chat",
      states: chatStates,
    },
    {
      name: "search",
      caption: "Search",
      path: "search",
      states: searchStates,
    },
    {
      name: "document",
      caption: "Document view",
      path: "chat",
      states: documentStates,
    },
    {
      name: "help",
      caption: "Help dialog",
      path: "chat",
      states: dialogStates("help", "Help dialog, opened by ?", helpOpen),
    },
    {
      name: "theme",
      caption: "Theme menu",
      path: "chat",
      states: dialogStates("theme", "Theme menu, opened by t", themeOpen),
    },
  ],
  facets: [
    { flag: "palette", attribute: "data-palette", default: "flexoki" },
    { flag: "space", attribute: "data-space", default: "regular" },
    { flag: "type", attribute: "data-type", default: "mono" },
  ],
  all: [
    ...["flexoki", "primer", "catppuccin", "everforest"].map((palette) => ({ palette })),
    { space: "compact" },
    { type: "sans" },
  ],
  profiles: (page) => page.evaluate(REGISTRY),
  server: async () => {
    const binary = process.env.EMULATOR_BINARY;
    if (!binary) {
      throw new Error("EMULATOR_BINARY names no binary: mise run screenshots builds cmd/server");
    }
    const temp = mkdtempSync(join(tmpdir(), "screenshots-store."));
    try {
      const [port, natsPort, wsPort] = [await freePort(), await freePort(), await freePort()];
      origin = `http://127.0.0.1:${port}`;
      const emulator = await start(binary, [], {
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
          EMULATOR_RUNS_HOLD: "field-report.md:extraction",
          EMULATOR_CONVERSATIONS_DELTA_INTERVAL: "150ms",
        },
      });
      return {
        origin: `${origin}/app`,
        stop: async () => {
          await emulator.stop();
          rmSync(temp, { recursive: true, force: true });
        },
      };
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      throw error;
    }
  },
};

export default description;
