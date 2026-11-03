// The side pane's documents in the binary's build: files chosen or dropped upload with their
// progress to completion and join the list; a cancelled upload leaves no document, and a refused
// one shows its problem's title; each listed run's status advances live as its stages run, with
// no reload; the list pages, its entries reach their document's view, and it survives a reload.
// Each case boots its own emulator, so its store starts empty, and opens its own page, so its
// sessionStorage starts empty.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { mounted, openWith, reload, route } from "./support/app.ts";
import {
  cancelOf,
  choose,
  clickAt,
  drop,
  entries,
  entriesShown,
  entryOf,
  listReady,
  listStatus,
  PAGINATION,
  throttle,
  uploads,
} from "./support/documents.ts";
import { liveStageInterval, stageNames, start } from "./support/emulator.ts";
import { proxy } from "./support/proxy.ts";
import type { Emulator, StartOptions } from "./support/emulator.ts";

let browser: Browser;
/** The case's emulator, which boot() starts. */
let emulator: Emulator | undefined;
const pages: Page[] = [];

before(async () => {
  browser = await launch();
});
/** What a case started beside its emulator, stopped after it in reverse: a proxy. */
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  for (const stop of stops.splice(0).reverse()) await stop();
  await emulator?.stop();
  emulator = undefined;
});
after(async () => {
  await browser?.close();
});

/** Starts the case's emulator with the options. */
async function boot(options?: StartOptions): Promise<Emulator> {
  emulator = await start(options);
  return emulator;
}

/** Opens the app's view at the path on the case's emulator, or at the origin given, resolving once
 * the list is ready. */
async function open(path = "chat", origin = emulator!.origin): Promise<Page> {
  const page = await openWith(browser, `${origin}${emulator!.base}${path}`, async () => {});
  pages.push(page);
  await listReady(page);
  return page;
}

/** The documents the API lists, by name, oldest first. */
async function stored(): Promise<string[]> {
  const response = await fetch(`${emulator!.origin}/api/documents?size=100`);
  const { items } = (await response.json()) as { items: { name: string }[] };
  return items.map((doc) => doc.name);
}

/** Records, inside the page, each upload's bar values as it renders them, every 5 ms, into
 * `window.sampled`, by the upload's name. */
const SAMPLE = `void (window.sampled = {}, setInterval(() => {
  const root = document.querySelector("pipeline-documents sl-upload-dropzone").shadowRoot;
  for (const li of root.querySelectorAll("li.upload")) {
    const bar = li.querySelector("progress");
    const seen = (window.sampled[li.querySelector(".name").textContent] ??= []);
    if (bar && seen.at(-1) !== bar.value) seen.push(bar.value);
  }
}, 5))`;

/** Records, inside the page, each entry's statuses as it renders them, every 5 ms, into
 * `window.statuses`, by the entry's name; and marks the window, so a reload would show. */
const WATCH = `void (window.statuses = {}, window.unreloaded = true, setInterval(() => {
  const root = document.querySelector("pipeline-documents sl-document-list").shadowRoot;
  for (const entry of root.querySelectorAll("sl-entry")) {
    const shown = entry.shadowRoot;
    const seen = (window.statuses[shown.querySelector(".name").textContent] ??= []);
    const status = shown.querySelector(".status").textContent;
    if (seen.at(-1) !== status) seen.push(status);
  }
}, 5))`;

/** A run's statuses as its entry shows them, from its first stage complete to its last. */
const RUN = stageNames.map((_, i) =>
  i + 1 < stageNames.length ? `processing ${i + 1}/${stageNames.length}` : "complete 5/5",
);

/** A finished upload as the dropzone shows it. */
const done = (name: string) => ({
  name,
  state: "done",
  label: "Done",
  message: null,
  sent: null,
  max: null,
});

describe("an upload", () => {
  test("of a chosen file shows its progress to completion, and its document joins the list", async (t) => {
    await boot();
    const page = await open();
    assert.deepEqual(await entries(page), []);
    assert.deepEqual(await listStatus(page), { status: "No documents.", summary: null });

    // DevTools' network conditions pace the page's upload, and its progress events with it, as a
    // 64 kB/s link would: 192 kB in about three seconds, so the bar is sampled on its way.
    await throttle(page, 64_000);
    await page.evaluate(SAMPLE);
    await choose(page, [{ name: "brief.txt", size: 192_000 }]);
    await entriesShown(page, 1);
    const sampled: number[] = (await page.evaluate("window.sampled"))["brief.txt"];
    t.diagnostic(`brief.txt's bar: ${sampled.join(", ")}`);
    assert.ok(sampled.length >= 3, "the bar moved on its way");
    assert.ok(
      sampled.every((value, i) => i === 0 || value > sampled[i - 1]),
      "the bar only rises",
    );
    assert.ok(
      sampled.some((value) => value > 0 && value < 192_000),
      "the bar stood between",
    );
    assert.deepEqual(await uploads(page), [done("brief.txt")]);
    assert.equal((await entries(page))[0].name, "brief.txt");
    assert.deepEqual(await stored(), ["brief.txt"]);
    assert.deepEqual(await listStatus(page), { status: "", summary: "Showing 1–1 of 1" });
  });

  test("of several dropped files shows each one's progress, and each joins the list", async (t) => {
    await boot();
    const page = await open();
    await throttle(page, 128_000);
    await page.evaluate(SAMPLE);
    const names = ["memo.md", "notes.txt", "data.json"];
    await drop(page, [
      { name: names[0], size: 96_000, type: "text/markdown" },
      { name: names[1], size: 64_000, type: "text/plain" },
      { name: names[2], text: '{"a":1}', type: "application/json" },
    ]);
    assert.deepEqual(
      (await uploads(page)).map((upload) => upload.name),
      names,
      "each listed as it starts",
    );
    await entriesShown(page, 3);
    await until(
      page,
      `document.querySelector("pipeline-documents").uploads.every((u) => u.state === "done")`,
    );
    const sampled: Record<string, number[]> = await page.evaluate("window.sampled");
    for (const name of names) t.diagnostic(`${name}'s bar: ${sampled[name]?.join(", ")}`);
    for (const name of names.slice(0, 2)) {
      assert.ok(
        sampled[name].some((value) => value > 0),
        `${name}'s bar rose`,
      );
    }
    assert.deepEqual(await uploads(page), names.map(done));
    // They upload side by side, so they're stored, and listed, in the order each finished.
    assert.deepEqual((await entries(page)).map((entry) => entry.name).sort(), [...names].sort());
    assert.deepEqual(
      (await entries(page)).map((entry) => entry.name),
      await stored(),
    );
  });

  test("cancelled on its way leaves no document", async () => {
    // DevTools' network conditions slow only what the page reports: the body reaches the emulator
    // at once. A proxy that forwards it at 1 MB/s slows the upload itself, so a cancel cuts its
    // body short at the emulator too, as a slow link does.
    const slow = await proxy(() => emulator!.origin, undefined, { rate: 1_000_000 });
    stops.push(slow.stop);
    await boot({ origins: [slow.origin] });
    const page = await open("chat", slow.origin);
    await choose(page, [{ name: "big.bin", size: 8_000_000 }]);
    // Under way, and seconds from its end.
    await until(page, `document.querySelector("pipeline-documents").uploads[0]?.sent > 0`);
    await clickAt(page, cancelOf("big.bin"));
    await until(
      page,
      `document.querySelector("pipeline-documents").uploads[0].state === "cancelled"`,
    );
    assert.deepEqual(await uploads(page), [
      {
        name: "big.bin",
        state: "cancelled",
        label: "Cancelled",
        message: null,
        sent: null,
        max: null,
      },
    ]);
    // The cut-short body is refused and nothing stored; a later upload's refresh lists only it.
    await choose(page, [{ name: "after.txt", text: "after the cancel" }]);
    await entriesShown(page, 1);
    assert.deepEqual(
      (await entries(page)).map((entry) => entry.name),
      ["after.txt"],
    );
    assert.deepEqual(await stored(), ["after.txt"]);
  });

  test("the API refuses shows its problem's title, and leaves no document", async (t) => {
    // The emulator's upload limit, a kilobyte: a larger declared body is refused before it is read.
    await boot({ env: { EMULATOR_DOCUMENTS_MAX_SIZE: "1000" } });
    const refused = await fetch(`${emulator!.origin}/api/documents?name=x`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "a".repeat(4_000),
    });
    const problem = (await refused.json()) as { title: string };
    assert.equal(refused.status, 413);
    t.diagnostic(`the problem's title: ${problem.title}`);

    const page = await open();
    await choose(page, [
      { name: "too-large.txt", size: 4_000 },
      { name: "fits.txt", size: 500 },
    ]);
    await entriesShown(page, 1);
    await until(
      page,
      `document.querySelector("pipeline-documents").uploads.every((u) => u.state !== "uploading")`,
    );
    assert.deepEqual(await uploads(page), [
      {
        name: "too-large.txt",
        state: "failed",
        label: "Failed",
        message: problem.title,
        sent: null,
        max: null,
      },
      done("fits.txt"),
    ]);
    assert.ok(problem.title, "the problem has a title");
    assert.deepEqual(
      (await entries(page)).map((entry) => entry.name),
      ["fits.txt"],
    );
    assert.deepEqual(await stored(), ["fits.txt"]);
  });
});

describe("a listed document's run", () => {
  test("advances live as its stages run, with no reload", async (t) => {
    // Stages liveStageInterval apart, so each entry is listed before its run's second stage
    // completes, and each status is rendered long enough to be seen; its comment says why.
    await boot({ env: { EMULATOR_RUNS_STAGE_INTERVAL: liveStageInterval } });
    const page = await open();
    await page.evaluate(WATCH);

    // One upload from the page, one from another client: both listed, each advancing in place.
    await choose(page, [{ name: "here.txt", text: "from the page" }]);
    await emulator!.upload("elsewhere.txt");
    await until(
      page,
      `["here.txt", "elsewhere.txt"].every((name) => window.statuses[name]?.at(-1) === "complete 5/5")`,
    );
    const statuses: Record<string, string[]> = await page.evaluate("window.statuses");
    for (const [name, seen] of Object.entries(statuses))
      t.diagnostic(`${name}: ${seen.join(" → ")}`);
    // Each entry shows whatever stage its run had reached when it was listed, then each after it.
    for (const name of ["here.txt", "elsewhere.txt"]) {
      const seen = statuses[name];
      assert.ok(seen.length >= 3, `${name} advanced in place: ${seen.join(", ")}`);
      assert.deepEqual(seen, RUN.slice(RUN.indexOf(seen[0])), `${name}'s statuses in order`);
    }
    assert.equal(await page.evaluate("window.unreloaded"), true, "the page never reloaded");
    assert.deepEqual(
      (await entries(page)).map(({ name, status }) => ({ name, status })),
      [
        { name: "here.txt", status: "complete 5/5" },
        { name: "elsewhere.txt", status: "complete 5/5" },
      ],
    );
  });
});

describe("the list", () => {
  test("pages through the documents, by its steps and its size, and keeps its page over a reload", async () => {
    await boot();
    const names = Array.from({ length: 14 }, (_, i) => `doc-${String(i + 1).padStart(2, "0")}.txt`);
    for (const name of names) await emulator!.upload(name);
    const page = await open();
    await entriesShown(page, 12);
    assert.deepEqual(
      (await entries(page)).map((entry) => entry.name),
      names.slice(0, 12),
    );
    assert.deepEqual(await listStatus(page), { status: "", summary: "Showing 1–12 of 14" });

    await clickAt(page, `${PAGINATION}.querySelector('button[aria-label="Next page"]')`);
    await entriesShown(page, 2);
    await listReady(page);
    assert.deepEqual(
      (await entries(page)).map((entry) => entry.name),
      names.slice(12),
    );
    assert.deepEqual(await listStatus(page), { status: "", summary: "Showing 13–14 of 14" });

    // The page survives a reload.
    await reload(page);
    await listReady(page);
    await entriesShown(page, 2);
    assert.deepEqual(
      (await entries(page)).map((entry) => entry.name),
      names.slice(12),
    );

    // A larger size shows them all, on the page that holds the first shown.
    await page.evaluate(`(() => {
      const select = ${PAGINATION}.querySelector("select");
      select.value = "24";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await entriesShown(page, 14);
    assert.deepEqual(await listStatus(page), { status: "", summary: "Showing 1–14 of 14" });
  });

  test("that fails to load says why, and loads on Try again", async () => {
    await boot();
    await emulator!.upload("kept.txt");
    // The page's first listing is answered with a problem; the rest pass through to the emulator.
    const page = await openWith(browser, "about:blank", async (page) => {
      page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) => {
        void page.cdp("Fetch.fulfillRequest", {
          requestId,
          responseCode: 503,
          responseHeaders: [{ name: "content-type", value: "application/problem+json" }],
          body: Buffer.from(
            JSON.stringify({ type: "about:blank", status: 503, title: "Service Unavailable" }),
          ).toString("base64"),
        });
        void page.cdp("Fetch.disable");
      });
      await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/documents?*" }] });
    });
    pages.push(page);
    await page.goto(`${emulator!.origin}${emulator!.base}chat`);
    await until(
      page,
      `document.querySelector("pipeline-documents sl-document-list")?.state === "error"`,
    );
    assert.deepEqual(await listStatus(page), {
      status: "Couldn't load the documents. Service Unavailable",
      summary: null,
    });
    assert.deepEqual(await entries(page), []);
    await clickAt(page, `document.querySelector("pipeline-documents .documents-retry")`);
    await listReady(page);
    await entriesShown(page, 1);
    assert.equal((await entries(page))[0].name, "kept.txt");
    assert.equal(
      await page.evaluate(`document.querySelector("pipeline-documents .documents-retry")`),
      null,
    );
  });

  test("survives a reload, its documents and their runs' statuses read again", async () => {
    await boot();
    const docs = [await emulator!.upload("one.txt"), await emulator!.upload("two.txt")];
    for (const doc of docs) await emulator!.complete(doc.run_id);
    const page = await open();
    await entriesShown(page, 2);
    const shown = [
      { name: "one.txt", status: "complete 5/5", current: false },
      { name: "two.txt", status: "complete 5/5", current: false },
    ];
    await until(
      page,
      `document.querySelector("pipeline-documents").items.every((i) => i.status === "complete 5/5")`,
    );
    assert.deepEqual(await entries(page), shown);
    await reload(page);
    await listReady(page);
    await entriesShown(page, 2);
    assert.deepEqual(await entries(page), shown);
  });

  test("an entry reaches its document's view, and is the selected one there", async () => {
    await boot();
    const doc = await emulator!.upload("target.txt");
    await emulator!.upload("other.txt");
    const page = await open();
    await entriesShown(page, 2);
    await clickAt(page, entryOf("target.txt"));
    await mounted(page, "pipeline-document");
    assert.deepEqual(await route(page), {
      path: `${emulator!.base}documents/${doc.id}`,
      tag: "pipeline-document",
    });
    assert.equal(
      await page.evaluate("document.querySelector('pipeline-document').getAttribute('document')"),
      doc.id,
    );
    await until(
      page,
      `document.querySelector("pipeline-documents sl-document-list").selected === ${JSON.stringify(doc.id)}`,
    );
    assert.deepEqual(
      (await entries(page)).map(({ name, current }) => ({ name, current })),
      [
        { name: "target.txt", current: true },
        { name: "other.txt", current: false },
      ],
    );
    // A deep link to the document marks its entry too.
    await reload(page);
    await listReady(page);
    await until(
      page,
      `document.querySelector("pipeline-documents sl-document-list").selected === ${JSON.stringify(doc.id)}`,
    );
    assert.equal((await entries(page))[0].current, true);
  });
});
