// The document view in the binary's build: a deep link to a document mid-run shows its stages as
// they stand at once, then advances them live to complete with no reload, and a reload mid-run
// does the same; its content shows in the artifact viewer by its type, Markdown, JSON, and text
// fetched as text, a PDF and an image fetched as a Blob and shown natively, and a type the viewer
// doesn't know fetched as a Blob, shown as text when its bytes are and as the can't-be-shown note
// with a download link when they aren't, the viewer without a header of its own and its region
// named; JSON reaches the viewer exactly as stored, and a .json that doesn't parse shows the
// viewer's invalid-JSON note over its text; a content fetch that fails shows its problem's title,
// and Try again loads it; an id no document has shows the view's own not-found state; and moving
// between documents, by the list and by back and forward, swaps the view's document with no
// loading state between, the list's entry following. Each case boots its own emulator, so its
// store starts empty.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { mounted, openWith, reload, route, traverse } from "./support/app.ts";
import { clickAt, entries, entriesShown, entryOf, listReady } from "./support/documents.ts";
import { stageNames, start } from "./support/emulator.ts";
import { summaryPdf } from "./support/media.ts";
import type { Emulator, StartOptions } from "./support/emulator.ts";

let browser: Browser;
/** The case's emulator, which boot() starts. */
let emulator: Emulator | undefined;
const pages: Page[] = [];

before(async () => {
  browser = await launch();
});
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  await emulator?.stop();
  emulator = undefined;
});
after(async () => {
  await browser?.close();
});

async function boot(options?: StartOptions): Promise<Emulator> {
  emulator = await start(options);
  return emulator;
}

/** Opens the app at the path on the case's emulator; `prepare` runs on the blank page first. */
async function open(path: string, prepare: (page: Page) => Promise<void> = async () => {}) {
  const page = await openWith(browser, `${emulator!.origin}${emulator!.base}${path}`, prepare);
  pages.push(page);
  return page;
}

/** The view, as a page expression. */
const VIEW = "document.querySelector('pipeline-document')";

/** The timeline's shadow root, as a page expression. */
const TIMELINE = `${VIEW}?.querySelector('sl-stage-timeline')?.shadowRoot`;

/** The viewer's shadow root, as a page expression. */
const VIEWER = `${VIEW}.querySelector('sl-artifact-viewer').shadowRoot`;

/** The stages the timeline shows, each its name and its state, in order. */
const stages = (page: Page): Promise<{ name: string; state: string }[]> =>
  page.evaluate(`[...${TIMELINE}.querySelectorAll("li")].map((li) => ({
    name: li.dataset.name,
    state: ["pending", "active", "complete", "failed"].find((s) => li.classList.contains(s)),
  }))`);

/** Resolves once the timeline shows its stages. */
const timelineShown = (page: Page) =>
  until(page, `${TIMELINE}?.querySelectorAll("li").length === ${stageNames.length}`);

/** How many of the stages are complete. */
const completeOf = (shown: { state: string }[]) =>
  shown.filter(({ state }) => state === "complete").length;

/** Records, inside the page, the timeline's states each time they change, every 5 ms, into
 * `window.timeline`, each a string of the stages' initials (p, a, c); and marks the window, so a
 * reload would show. */
const WATCH = `void (window.timeline = [], window.unreloaded = true, setInterval(() => {
  const root = ${TIMELINE};
  if (!root) return;
  const shown = [...root.querySelectorAll("li")]
    .map((li) => ["pending", "active", "complete"].find((s) => li.classList.contains(s))?.[0] ?? "?")
    .join("");
  if (shown && window.timeline.at(-1) !== shown) window.timeline.push(shown);
}, 5))`;

/** The timeline's states a run passes through, from its first stage complete: the stages complete
 * so far, then the active one, then those pending. */
const RUN = stageNames.map((_, i) =>
  stageNames.map((__, j) => (j <= i ? "c" : j === i + 1 ? "a" : "p")).join(""),
);

/** Resolves once the run has `count` stages complete, by the API, failing on a run complete. */
async function reached(runId: string, count: number) {
  for (;;) {
    const run = await emulator!.run(runId);
    const done = run.stages.filter((stage) => stage.state === "complete").length;
    if (done >= count) {
      assert.ok(done < stageNames.length, `the run is still mid-way: ${done} complete`);
      return done;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("a document's stages", () => {
  test("by a deep link mid-run, show as they stand at once, then advance live to complete", async (t) => {
    // Stages half a second apart, so the run is mid-way when the page opens.
    await boot({ env: { EMULATOR_RUNS_STAGE_INTERVAL: "500ms" } });
    const doc = await emulator!.upload("brief.md", { type: "text/markdown", body: "# Brief" });
    const before = await reached(doc.run_id, 2);
    const page = await open(`documents/${doc.id}`);
    await timelineShown(page);
    const first = await stages(page);
    t.diagnostic(
      `${before} complete before the page opened; shown at once: ${JSON.stringify(first)}`,
    );
    assert.deepEqual(
      first.map(({ name }) => name),
      stageNames,
    );
    assert.ok(completeOf(first) >= before, "the stages as they stood when the page opened");
    // The stage after the last complete one is the active one, in the accent, from the component.
    assert.equal(first[completeOf(first)].state, "active");
    const color: string = await page.evaluate(
      `getComputedStyle(${TIMELINE}.querySelector("li.active .label")).color`,
    );
    const accent: string = await page.evaluate(`(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--accent-color, var(--magenta))";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })()`);
    assert.equal(color, accent, "the active stage's label in the accent");

    await page.evaluate(WATCH);
    await until(page, `window.timeline.at(-1) === "ccccc"`, 10_000);
    const seen: string[] = await page.evaluate("window.timeline");
    t.diagnostic(seen.join(" → "));
    assert.ok(seen.length >= 2, `the stages advanced in place: ${seen.join(", ")}`);
    assert.deepEqual(seen, RUN.slice(RUN.indexOf(seen[0])), "each state in order, none skipped");
    assert.equal(await page.evaluate("window.unreloaded"), true, "the page never reloaded");
    assert.equal(
      await page.evaluate(`${VIEW}.querySelector(".document-run").textContent.trim()`),
      "Complete: all 5 stages",
    );
    // Every stage complete shows its completion time.
    assert.equal(
      await page.evaluate(`${TIMELINE}.querySelectorAll("li time").length`),
      stageNames.length,
    );
  });

  test("after a reload mid-run, show as they stand at once, then advance live to complete", async () => {
    await boot({ env: { EMULATOR_RUNS_STAGE_INTERVAL: "500ms" } });
    const doc = await emulator!.upload("notes.txt");
    const page = await open(`documents/${doc.id}`);
    await timelineShown(page);
    const before = await reached(doc.run_id, 3);
    await reload(page);
    await timelineShown(page);
    const first = await stages(page);
    assert.ok(completeOf(first) >= before, `${completeOf(first)} shown, ${before} before reload`);
    await page.evaluate(WATCH);
    await until(page, `window.timeline.at(-1) === "ccccc"`, 10_000);
    assert.equal(await page.evaluate("window.unreloaded"), true, "no second reload");
  });
});

/** The documents the artifact cases upload: each one's name, its content type and body. */
const ARTIFACTS = {
  markdown: { name: "guide.md", type: "text/markdown", body: "# Guide\n\nSome *emphasis*." },
  json: {
    name: "config.json",
    type: "application/json",
    body: '{"name":"pipeline","stages":[1,2]}',
  },
  // Odd whitespace and integer-like keys, which a parse and a print would change: the key order
  // (integer-like keys first) and the spacing.
  stored: {
    name: "stored.json",
    type: "application/json",
    body: '{ "b" : 1,\n\t"10": [ 2 ,3 ],   "2":"two" }\n',
  },
  invalid: { name: "broken.json", type: "application/json", body: '{"name": "pipeline",' },
  text: { name: "notes.txt", type: "text/plain", body: "plain notes\nsecond line" },
  pdf: {
    name: "report.pdf",
    type: "application/pdf",
    body: summaryPdf(),
  },
  // A 1x1 PNG, opaque red.
  png: {
    name: "pixel.png",
    type: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  },
  // Every byte value, NUL among them, under a type the viewer doesn't know: binary.
  binary: {
    name: "data.bin",
    type: "application/octet-stream",
    body: Uint8Array.from({ length: 256 }, (_, i) => i),
  },
  // Text under a type the viewer doesn't know: its bytes decide.
  octetText: {
    name: "notes.dat",
    type: "application/octet-stream",
    body: new TextEncoder().encode("text, typed as bytes\nsecond line"),
  },
};

/** What the viewer shows: its state, its rendered Markdown's heading, its region's text, and its
 * note's label and detail. */
const viewer = (
  page: Page,
): Promise<{
  state: string;
  heading: string | null;
  text: string | null;
  label: string | null;
  detail: string | null;
}> =>
  page.evaluate(`(() => {
    const root = ${VIEWER};
    return {
      state: ${VIEW}.querySelector("sl-artifact-viewer").state,
      heading: root.querySelector(".document h1")?.textContent ?? null,
      text: root.querySelector("pre.body")?.textContent ?? null,
      label: root.querySelector(".note .label")?.textContent ?? null,
      detail: root.querySelector(".note .detail")?.textContent ?? null,
    };
  })()`);

/** The viewer's frame as the view sets it: the content the view handed it, a Blob's size in
 * bytes, whether it shows a header of its own, and the names of the regions in its shadow root. */
const viewerFrame = (
  page: Page,
): Promise<{ content: string | { blob: number }; header: boolean; regions: string[] }> =>
  page.evaluate(`(() => {
    const viewer = ${VIEW}.querySelector("sl-artifact-viewer");
    return {
      content: viewer.content instanceof Blob ? { blob: viewer.content.size } : viewer.content,
      header: viewer.shadowRoot.querySelector("header") !== null,
      regions: [...viewer.shadowRoot.querySelectorAll("[role=region]")].map((r) => r.getAttribute("aria-label")),
    };
  })()`);

describe("a document's content", () => {
  test("shows Markdown, JSON, and text as text, and a PDF, an image, and unknown bytes from a Blob", async () => {
    await boot();
    const ids: Record<string, string> = {};
    for (const [kind, { name, type, body }] of Object.entries(ARTIFACTS))
      ids[kind] = (await emulator!.upload(name, { type, body })).id;
    const requested: string[] = [];
    const page = await open(`documents/${ids.markdown}`, async (page) => {
      page.on("Network.requestWillBeSent", ({ request }: { request: { url: string } }) =>
        requested.push(request.url),
      );
      await page.cdp("Network.enable");
    });
    const shows = async (id: string, done: string) => {
      await page.evaluate(
        `navigation.navigate(${JSON.stringify(`documents/${id}`)}).finished.then(() => true)`,
      );
      await until(
        page,
        `${VIEW}?.getAttribute("document") === ${JSON.stringify(id)} && !${VIEW}.hasAttribute("aria-busy") && ${done}`,
      );
    };
    const ready = `${VIEW}?.querySelector("sl-artifact-viewer")?.state === "ready"`;

    await until(page, ready);
    assert.deepEqual(await viewer(page), {
      state: "ready",
      heading: "Guide",
      text: null,
      label: null,
      detail: null,
    });
    // The view's header names the document, so the viewer shows none; its region is still named.
    assert.deepEqual(await viewerFrame(page), {
      content: ARTIFACTS.markdown.body,
      header: false,
      regions: ["guide.md content"],
    });

    await shows(ids.json, ready);
    assert.equal(
      (await viewer(page)).text,
      JSON.stringify({ name: "pipeline", stages: [1, 2] }, null, 2),
    );

    // JSON reaches the viewer as stored, its whitespace and key order as the upload sent them.
    await shows(ids.stored, ready);
    assert.equal((await viewerFrame(page)).content, ARTIFACTS.stored.body);
    assert.equal((await viewer(page)).label, null, "valid JSON shows no note");

    // A .json that doesn't parse shows the viewer's invalid-JSON note over its text as stored,
    // not a problem of the client's decode.
    await shows(ids.invalid, ready);
    const invalid = await viewer(page);
    assert.equal(invalid.label, "Invalid JSON, shown as text.");
    assert.equal(invalid.text, ARTIFACTS.invalid.body);
    assert.deepEqual(await viewerFrame(page), {
      content: ARTIFACTS.invalid.body,
      header: false,
      regions: ["broken.json content"],
    });

    await shows(ids.text, ready);
    assert.equal((await viewer(page)).text, "plain notes\nsecond line");

    // A PDF reaches the viewer as a Blob of its bytes, shown in an iframe from its object URL,
    // named by the document; headless Chrome has no PDF viewer, so its pages aren't asserted.
    await shows(ids.pdf, `${ready} && ${VIEW}.querySelector("h1")?.textContent === "report.pdf"`);
    assert.deepEqual(await viewerFrame(page), {
      content: { blob: ARTIFACTS.pdf.body.length },
      header: false,
      regions: ["report.pdf content"],
    });
    const pdf: { src: string; title: string } | null = await page.evaluate(`(() => {
      const frame = ${VIEWER}.querySelector("iframe");
      return frame && { src: frame.src, title: frame.title };
    })()`);
    assert.ok(pdf?.src.startsWith("blob:"), `the PDF's iframe shows an object URL: ${pdf?.src}`);
    assert.equal(pdf?.title, "report.pdf");
    // The header names the document, its size, type, and upload time.
    const meta: string[] = await page.evaluate(
      `[...${VIEW}.querySelectorAll(".document-meta > span")].map((s) => s.textContent.replace(/\\s+/g, " ").trim())`,
    );
    assert.equal(meta[0], "549 bytes");
    assert.equal(meta[1], "application/pdf");
    assert.match(meta[2], /^Uploaded \w+ \d+, \d{4}/);

    // A PNG shows in an img from its object URL, which decodes to its one pixel.
    await shows(ids.png, `${ready} && ${VIEWER}.querySelector("img") !== null`);
    assert.deepEqual((await viewerFrame(page)).content, { blob: ARTIFACTS.png.body.length });
    const image: { src: string; alt: string; width: number; height: number } = await page.evaluate(
      `(async () => {
        const img = ${VIEWER}.querySelector("img");
        await img.decode();
        return { src: img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight };
      })()`,
    );
    assert.ok(image.src.startsWith("blob:"), `the image shows an object URL: ${image.src}`);
    assert.deepEqual(
      { alt: image.alt, width: image.width, height: image.height },
      {
        alt: "pixel.png",
        width: 1,
        height: 1,
      },
    );

    // Bytes of a type the viewer doesn't know, which aren't text, show its note with a link that
    // downloads them under the document's name.
    await shows(ids.binary, `${ready} && ${VIEWER}.querySelector(".note .label") !== null`);
    assert.deepEqual((await viewerFrame(page)).content, { blob: 256 });
    assert.deepEqual(await viewer(page), {
      state: "ready",
      heading: null,
      text: null,
      label: "This content type can't be shown.",
      detail: "application/octet-stream isn't text.",
    });
    const download: { href: string; download: string; text: string } | null =
      await page.evaluate(`(() => {
        const link = ${VIEWER}.querySelector("a.download");
        return link && { href: link.href, download: link.download, text: link.textContent.trim() };
      })()`);
    assert.ok(
      download?.href.startsWith("blob:"),
      `the download is an object URL: ${download?.href}`,
    );
    assert.equal(download?.download, "data.bin");
    assert.equal(download?.text, "Download data.bin");

    // Text under a type the viewer doesn't know shows as text, its bytes deciding.
    await shows(ids.octetText, `${ready} && ${VIEWER}.querySelector("pre.body") !== null`);
    assert.deepEqual((await viewerFrame(page)).content, {
      blob: ARTIFACTS.octetText.body.length,
    });
    assert.equal((await viewer(page)).text, "text, typed as bytes\nsecond line");

    for (const kind of Object.keys(ARTIFACTS))
      assert.ok(
        requested.some((url) => url.endsWith(`/api/documents/${ids[kind]}/content`)),
        `${kind}'s content fetched`,
      );
  });

  test("that fails to load shows its problem's title, and loads on Try again", async () => {
    await boot();
    const doc = await emulator!.upload("guide.md", ARTIFACTS.markdown);
    // The content's first fetch is answered with a problem; the rest pass through.
    const page = await open(`documents/${doc.id}`, async (page) => {
      page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) => {
        void page.cdp("Fetch.fulfillRequest", {
          requestId,
          responseCode: 503,
          responseHeaders: [{ name: "content-type", value: "application/problem+json" }],
          body: Buffer.from(
            JSON.stringify({ type: "about:blank", status: 503, title: "Storage unavailable" }),
          ).toString("base64"),
        });
        void page.cdp("Fetch.disable");
      });
      await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/content" }] });
    });
    await until(page, `${VIEW}?.querySelector("sl-artifact-viewer")?.state === "error"`);
    const shown = await viewer(page);
    assert.equal(shown.label, "Couldn't load this artifact.");
    assert.equal(shown.detail, "Storage unavailable");
    // The stages show beside the failed content.
    await timelineShown(page);
    await clickAt(page, `${VIEW}.querySelector(".document-retry")`);
    await until(page, `${VIEW}.querySelector("sl-artifact-viewer").state === "ready"`);
    assert.equal((await viewer(page)).heading, "Guide");
    assert.equal(await page.evaluate(`${VIEW}.querySelector(".document-retry")`), null);
  });
});

describe("a document id no document has", () => {
  test("shows the view's own not-found state", async () => {
    await boot();
    await emulator!.upload("kept.txt");
    const missing = "01900000-0000-7000-8000-000000000000";
    const page = await open(`documents/${missing}`);
    await until(page, `${VIEW}?.querySelector("h1")?.textContent === "Document not found"`);
    assert.deepEqual(await route(page), {
      path: `${emulator!.base}documents/${missing}`,
      tag: "pipeline-document",
    });
    assert.equal(await page.evaluate(`${VIEW}.querySelector("code").textContent`), missing);
    assert.equal(await page.evaluate(`${VIEW}.querySelector("sl-stage-timeline")`), null);
    // Its link leads back to the event log.
    await page.evaluate(`${VIEW}.querySelector("a").click()`);
    await mounted(page, "pipeline-log");
  });
});

/** Records, inside the page, each heading the view shows as it changes, every animation frame, into
 * `window.headings`; "" when the main pane shows no view's heading. It samples frames, not the DOM:
 * a move replaces the view's element, and the new one is empty until its first render, a microtask
 * later and before any frame, so only a frame tells what a person sees. */
const HEADINGS = `void (window.headings = [], (function sample() {
  const shown = document.querySelector("main h1")?.textContent ?? "";
  if (window.headings.at(-1) !== shown) window.headings.push(shown);
  requestAnimationFrame(sample);
})())`;

describe("moving between documents", () => {
  test("by the list and by back and forward swaps the view's document with no loading between", async () => {
    await boot();
    const first = await emulator!.upload("first.md", ARTIFACTS.markdown);
    const second = await emulator!.upload("second.txt", ARTIFACTS.text);
    const page = await open(`documents/${first.id}`);
    await listReady(page);
    await entriesShown(page, 2);
    const shows = (name: string) =>
      until(
        page,
        `${VIEW}?.querySelector("h1")?.textContent === ${JSON.stringify(name)} && ${VIEW}.querySelector("sl-artifact-viewer")?.state === "ready" && !${VIEW}.hasAttribute("aria-busy")`,
      );
    const current = async () =>
      (await entries(page)).filter((entry) => entry.current).map((entry) => entry.name);
    await shows("first.md");
    await page.evaluate(HEADINGS);
    // shows reads the DOM, ahead of the frames: on a loaded machine the test reached a document and
    // moved on, or read the record, before a frame had sampled it, and the record came up a heading
    // short. So each move waits as well for a frame to have shown the document it reached.
    const framed = (name: string) =>
      until(page, `window.headings.at(-1) === ${JSON.stringify(name)}`);
    await framed("first.md");

    await clickAt(page, entryOf("second.txt"));
    await shows("second.txt");
    await framed("second.txt");
    assert.equal((await viewer(page)).text, "plain notes\nsecond line");
    assert.deepEqual(await current(), ["second.txt"]);

    await traverse(page, -1);
    await shows("first.md");
    await framed("first.md");
    assert.equal((await viewer(page)).heading, "Guide");
    assert.deepEqual(await current(), ["first.md"]);

    await traverse(page, 1);
    await shows("second.txt");
    await framed("second.txt");
    assert.deepEqual(await current(), ["second.txt"]);
    assert.equal(
      await page.evaluate(`location.pathname.endsWith(${JSON.stringify(second.id)})`),
      true,
    );

    // Each move swapped one document's heading for the next, never an empty or loading frame.
    assert.deepEqual(await page.evaluate("window.headings"), [
      "first.md",
      "second.txt",
      "first.md",
      "second.txt",
    ]);
  });
});
