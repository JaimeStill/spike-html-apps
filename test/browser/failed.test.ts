// A failed run in the binary's build, end to end: the emulator boots with a fail rule
// (EMULATOR_RUNS_FAIL, fail-at-*:extraction), so a document named fail-at-extraction.txt runs
// its upload and metadata stages and fails at extraction, its third. Uploaded through the
// dropzone beside a document no rule matches, its list entry and its document view reach failed
// live, with no reload, the view's status line naming the stage and its timeline's failed stage
// showing when and why, while the other run completes; the list's entries take their states' tones,
// red failed and green complete; the event log shows the failure as an event of its own, its data
// naming the stage and why. A deep link to the failed document, and a reload of it, show the same
// at once, the failure's time the run's. Each case boots its own emulator, so its store starts
// empty, and opens its own page, so its sessionStorage starts empty.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { LOG, logged, mounted, openWith, reload } from "./support/app.ts";
import {
  choose,
  clickAt,
  entries,
  entriesShown,
  entryOf,
  listReady,
  uploads,
} from "./support/documents.ts";
import { liveStageInterval, stageNames, start } from "./support/emulator.ts";
import type { Emulator, Run } from "./support/emulator.ts";

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

/** The fail rule the cases boot with: a document named fail-at-… fails at extraction. */
const rule = "fail-at-*:extraction";

/** The document that fails, and the one beside it that completes. */
const failing = "fail-at-extraction.txt";
const passing = "notes.txt";

/** The reason the emulator gives a run its rule failed. */
const reason = `emulated failure: the document's name matches the fail rule "${rule}"`;

/** The status line the document view shows for the failed run; the reason is the timeline's. */
const failedStatus = "Failed at stage 3 of 5, extraction";

/** Starts the case's emulator with the fail rule, its stages `interval` apart. */
async function boot(interval = "100ms"): Promise<Emulator> {
  emulator = await start({
    env: { EMULATOR_RUNS_FAIL: rule, EMULATOR_RUNS_STAGE_INTERVAL: interval },
  });
  return emulator;
}

/** Opens the app at the path on the case's emulator, resolving once the list is ready. */
async function open(path: string): Promise<Page> {
  const page = await openWith(
    browser,
    `${emulator!.origin}${emulator!.base}${path}`,
    async () => {},
  );
  pages.push(page);
  await listReady(page);
  return page;
}

/** The view, as a page expression. */
const VIEW = "document.querySelector('pipeline-document')";

/** The timeline's shadow root, as a page expression. */
const TIMELINE = `${VIEW}?.querySelector('sl-stage-timeline')?.shadowRoot`;

/** The timeline's states as a string of the stages' initials (p, a, c, f), as a page expression;
 * empty while it shows none. */
const SHOWN = `[...(${TIMELINE}?.querySelectorAll("li") ?? [])]
  .map((li) => ["pending", "active", "complete", "failed"].find((s) => li.classList.contains(s))?.[0] ?? "?")
  .join("")`;

/** The timeline of a run failed at extraction: two complete, one failed, two pending. */
const FAILED = "ccfpp";

/** Records, inside the page, the timeline's states each time they change, every animation frame,
 * into `window.timeline`, from whenever a timeline shows; and marks the window, so a reload would
 * show. It samples frames, as document.test.ts's WATCH does, so only what a person sees is
 * recorded, and a case waits on the record, never on the DOM ahead of it. */
const WATCH = `void (window.timeline = [], window.unreloaded = true, (function sample() {
  const shown = ${SHOWN};
  if (shown && window.timeline.at(-1) !== shown) window.timeline.push(shown);
  requestAnimationFrame(sample);
})())`;

/** The view's status line's text, its whitespace collapsed. */
const runStatus = (page: Page): Promise<string> =>
  page.evaluate(`${VIEW}.querySelector(".document-run").textContent.replace(/\\s+/g, " ").trim()`);

/** The color `css` computes to on a span in the page, as getComputedStyle reports it. */
const colorOf = (page: Page, css: string): Promise<string> =>
  page.evaluate(`(() => {
    const probe = document.createElement("span");
    probe.style.color = ${JSON.stringify(css)};
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  })()`);

/** Resolves to the run once the API reads it failed. */
async function failedRun(runId: string): Promise<Run> {
  for (;;) {
    const run = await emulator!.run(runId);
    if (run.status === "failed") return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Asserts the view shows the failed run: the timeline failed at extraction, its failed stage's
 * label in the failure's hue, its failure time shown (the run's `failedAt`, when given) and its
 * reason under it, and the status line naming the stage, in the same hue, the reason not
 * repeated. */
async function assertFailedView(page: Page, failedAt?: string) {
  assert.equal(await page.evaluate(SHOWN), FAILED);
  const red = await colorOf(page, "var(--red)");
  assert.equal(
    await page.evaluate(`getComputedStyle(${TIMELINE}.querySelector("li.failed .label")).color`),
    red,
    "the failed stage's label in the failure's hue",
  );
  assert.equal(
    await page.evaluate(`${TIMELINE}.querySelector("li.failed .label .shown").textContent`),
    "Failed",
  );
  const time: string | null = await page.evaluate(
    `${TIMELINE}.querySelector("li.failed time")?.getAttribute("datetime") ?? null`,
  );
  assert.ok(time !== null, "the failed stage shows when it failed");
  if (failedAt) assert.equal(time, new Date(failedAt).toISOString(), "the run's failure time");
  assert.equal(
    await page.evaluate(`${TIMELINE}.querySelector("li.failed .reason")?.textContent ?? null`),
    reason,
    "the failed stage shows why",
  );
  assert.equal(await runStatus(page), failedStatus);
  assert.equal(
    await page.evaluate(`getComputedStyle(${VIEW}.querySelector(".document-run")).color`),
    red,
    "the status line in the failure's hue",
  );
}

/** The color the list's entry for the document named shows its status in. */
const toneOf = (page: Page, name: string): Promise<string> =>
  page.evaluate(`(() => {
    const entry = [...document.querySelector("pipeline-documents sl-document-list").shadowRoot.querySelectorAll("sl-entry")]
      .find((e) => e.item?.name === ${JSON.stringify(name)});
    return getComputedStyle(entry.shadowRoot.querySelector(".status")).color;
  })()`);

/** The status the list shows for the document named. */
const statusOf = async (page: Page, name: string) =>
  (await entries(page)).find((entry) => entry.name === name)?.status;

/** Resolves once the list shows the document named with the status. */
const listed = (page: Page, name: string, status: string, timeout?: number) =>
  until(
    page,
    `[...document.querySelector("pipeline-documents sl-document-list").shadowRoot.querySelectorAll("sl-entry")]
      .some((e) => e.item?.name === ${JSON.stringify(name)} &&
        e.shadowRoot.querySelector(".status").textContent === ${JSON.stringify(status)})`,
    timeout,
  );

describe("a run that fails", () => {
  test("reaches failed live in the list and the document view, beside one that completes", async (t) => {
    // Stages liveStageInterval apart, so the entries are listed and the view is open before the
    // run fails at its third; its comment says why.
    await boot(liveStageInterval);
    const page = await open("chat");
    // The record starts before the uploads, so the timeline is sampled from its first frame: a
    // sampler started once the view showed began behind a run that may have moved on.
    await page.evaluate(WATCH);
    await choose(page, [
      { name: failing, text: "this one fails" },
      { name: passing, text: "this one completes" },
    ]);
    // Both uploads finish, then both documents are listed.
    await until(
      page,
      `document.querySelector("pipeline-documents").uploads.every((u) => u.state !== "uploading")`,
    );
    assert.deepEqual(
      (await uploads(page)).map(({ name, state }) => ({ name, state })),
      [failing, passing].map((name) => ({ name, state: "done" })),
    );
    await entriesShown(page, 2);
    await clickAt(page, entryOf(failing));
    await mounted(page, "pipeline-document");
    await until(page, `${TIMELINE}?.querySelectorAll("li").length === ${stageNames.length}`);

    await until(page, `window.timeline.at(-1) === ${JSON.stringify(FAILED)}`, 10_000);
    const seen: string[] = await page.evaluate("window.timeline");
    t.diagnostic(seen.join(" → "));
    assert.ok(seen.length >= 2 && !seen[0].includes("f"), `failed live: ${seen.join(", ")}`);
    assert.equal(seen.at(-1), FAILED);
    await assertFailedView(page);

    // The list's entry failed too, at its third stage of five; the other run completes.
    await listed(page, failing, "failed 3/5");
    await listed(page, passing, "complete 5/5", 10_000);
    assert.equal(await statusOf(page, failing), "failed 3/5", "nothing un-fails it");
    assert.equal(await toneOf(page, failing), await colorOf(page, "var(--red)"), "failed in red");
    assert.equal(
      await toneOf(page, passing),
      await colorOf(page, "var(--green)"),
      "complete in green",
    );
    assert.equal(await runStatus(page), failedStatus);
    assert.equal(await page.evaluate("window.unreloaded"), true, "the page never reloaded");

    // The event log shows the failure as an event of its own, after the two stages it completed,
    // and no stage event for the stage it failed at, or after.
    await page.evaluate(`navigation.navigate(".").finished.then(() => true)`);
    await mounted(page, "pipeline-log");
    await until(
      page,
      `[...(${LOG}?.querySelectorAll("li.event .type") ?? [])].some((type) => type.textContent === "emulator.run.failed")`,
    );
    const shown = await logged(page);
    for (const event of shown)
      t.diagnostic(`${event.type} ${event.subject} ${JSON.stringify(event.data)}`);
    const failures = shown.filter((event) => event.type === "emulator.run.failed");
    assert.equal(failures.length, 1, "one failure event");
    const [failure] = failures;
    assert.deepEqual(failure.data, {
      stage: "extraction",
      position: 3,
      stage_count: 5,
      document_id: (failure.data as { document_id: string }).document_id,
      reason,
    });
    assert.ok(!Number.isNaN(Date.parse(failure.time ?? "")), `the failure's time: ${failure.time}`);
    const stagesOfFailed = shown
      .filter((event) => event.subject === failure.subject && event.type === "emulator.run.stage")
      .map((event) => (event.data as { stage: string }).stage);
    assert.deepEqual(stagesOfFailed, ["upload", "metadata"]);
    assert.ok(
      shown.indexOf(failure) >
        shown.findLastIndex((event) => event.subject === failure.subject && event !== failure),
      "the failure after its run's stages",
    );
  });

  test("shows failed at once by a deep link, and after a reload", async () => {
    await boot();
    const doc = await emulator!.upload(failing);
    const run = await failedRun(doc.run_id);
    assert.deepEqual(
      run.stages.map(({ state }) => state),
      ["complete", "complete", "failed", "pending", "pending"],
    );
    const failedAt = run.stages[2].failed_at!;
    assert.equal(run.stages[2].reason, reason);
    const page = await open(`documents/${doc.id}`);
    await until(page, `(${SHOWN}) === ${JSON.stringify(FAILED)}`);
    await assertFailedView(page, failedAt);
    await listed(page, failing, "failed 3/5");
    assert.equal(await toneOf(page, failing), await colorOf(page, "var(--red)"));

    await reload(page);
    await listReady(page);
    await until(page, `(${SHOWN}) === ${JSON.stringify(FAILED)}`);
    await assertFailedView(page, failedAt);
    assert.equal(await statusOf(page, failing), "failed 3/5");
  });
});
