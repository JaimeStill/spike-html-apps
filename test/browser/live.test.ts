// The sdk's NATS adapter, live, in the pipeline app the binary serves: the app's log reads the
// emulator's stream over the embedded server's WebSocket listener through natsSequence with the
// shell's static token. Each case boots its own emulator, so its stream starts empty and its
// cursors at 1, and opens its own page, so its sessionStorage starts empty; each event line the
// log shows is printed. A page whose shell the test changes, or whose origin it varies, is
// served through a proxy (support/proxy.ts), a real loopback answer the browser's Local Network
// Access checks let reach the listener.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import type { TestContext } from "node:test";

import { launch } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { click, linesOnce, lines, mounted, openWith, reload } from "./support/app.ts";
import type { Line } from "./support/app.ts";
import { stageNames, start, token } from "./support/emulator.ts";
import type { Emulator, StartOptions, UploadedDocument } from "./support/emulator.ts";
import { publishEvent, streamState } from "./support/nats.ts";
import { proxy } from "./support/proxy.ts";

/** The stage event's type, the default prefix's run.stage. */
const stageType = "emulator.run.stage";

/** The sessionStorage key the log keeps its last cursor under (apps/pipeline/src/log.ts). */
const cursorKey = "pipeline-log.cursor";

let browser: Browser;
/** The case's emulator, which boot() starts. */
let emulator: Emulator;
const pages: Page[] = [];
/** What the case started, stopped after it in reverse: its emulator and any proxy. */
const stops: (() => Promise<void>)[] = [];

before(async () => {
  browser = await launch();
});
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  for (const stop of stops.splice(0).reverse()) await stop();
});
after(async () => {
  await browser?.close();
});

/** Starts the case's emulator with the options. */
async function boot(options?: StartOptions) {
  emulator = await start(options);
  stops.push(emulator.stop);
}

/** Starts a proxy of the case's emulator, rewriting its shell with `rewrite`. */
async function proxyOf(rewrite?: (html: string) => string) {
  const server = await proxy(() => emulator.origin, rewrite);
  stops.push(server.stop);
  return server;
}

/** Opens the app's log at the origin (the emulator's own by default), once it has mounted. */
async function openLog(
  origin = emulator.origin,
  prepare: (page: Page) => Promise<void> = async () => {},
): Promise<Page> {
  const page = await openWith(browser, `${origin}${emulator.base}`, prepare);
  pages.push(page);
  await mounted(page, "pipeline-log");
  return page;
}

/** Prints each line, and asserts the event lines are the run's five stage events in order, at
 * the cursors from `first`. */
function assertRun(
  t: TestContext,
  shown: Line[],
  { doc, first }: { doc: UploadedDocument; first: number },
) {
  for (const line of shown) t.diagnostic(line.text ?? JSON.stringify(line));
  assert.deepEqual(
    shown.map(({ cursor, event }) => ({ cursor, event: { ...event, time: undefined } })),
    stageNames.map((stage, i) => ({
      cursor: String(first + i),
      event: {
        time: undefined,
        type: stageType,
        subject: doc.run_id,
        data: { stage, position: i + 1, stage_count: stageNames.length, document_id: doc.id },
      },
    })),
  );
  // The deepEqual above has held each line to a stage event.
  for (const { event } of shown) assert.ok(!Number.isNaN(Date.parse(event!.time)), event!.time);
}

/** Uploads a document and resolves to it once its run is complete. */
async function uploadRun(name: string) {
  const doc = await emulator.upload(name);
  await emulator.complete(doc.run_id);
  return doc;
}

describe("a read with no cursor", () => {
  test("yields the kept events from the oldest, then each upload's stage events live, in order", async (t) => {
    await boot();
    const kept = await uploadRun("kept.txt");
    const page = await openLog();
    const live = await uploadRun("live.txt");
    const shown = await linesOnce(page, 10);
    assertRun(t, shown.slice(0, 5), { doc: kept, first: 1 });
    assertRun(t, shown.slice(5), { doc: live, first: 6 });
  });
});

describe("a read resumed from the last cursor", () => {
  test("after a reload, continues with no gap and no duplicate", async (t) => {
    await boot();
    const page = await openLog();
    const first = await uploadRun("first.txt");
    assertRun(t, await linesOnce(page, 5), { doc: first, first: 1 });
    assert.equal(await page.evaluate(`sessionStorage.getItem(${JSON.stringify(cursorKey)})`), "5");

    // The about route replaces the log, whose read ends; the next run's events are appended while
    // nothing reads, and the reload loads a new document, which keeps only the stored cursor.
    await click(page, "About");
    await mounted(page, "pipeline-about");
    const second = await uploadRun("second.txt");
    await reload(page);
    await mounted(page, "pipeline-about");
    assert.equal(await page.evaluate(`sessionStorage.getItem(${JSON.stringify(cursorKey)})`), "5");

    // The log's read starts after the stored cursor: the second run whole, then a third live.
    await click(page, "Log");
    await mounted(page, "pipeline-log");
    assertRun(t, await linesOnce(page, 5), { doc: second, first: 6 });
    const third = await uploadRun("third.txt");
    const shown = await linesOnce(page, 10);
    assertRun(t, shown.slice(5), { doc: third, first: 11 });
    assert.equal(shown.length, 10);
  });
});

describe("a type filter", () => {
  test("limits the read to its types", async (t) => {
    await boot();
    // An event of another type, on a subject the stream captures, kept before the run's.
    const ack = await publishEvent({
      port: emulator.natsPort,
      token,
      type: "emulator.run.noted",
      id: "noted-1",
      source: "/browser-tier",
      subject: "elsewhere",
      data: { note: "not a stage" },
    });
    assert.deepEqual(ack, { stream: "EMULATOR", seq: 1 });
    const doc = await uploadRun("filtered.txt");
    const state = await streamState({ port: emulator.natsPort, token });
    assert.equal(state.messages, 6);

    // The log reads stageType alone: the run's five events, at cursors 2 to 6, and not the other.
    const page = await openLog();
    const shown = await linesOnce(page, 5);
    assertRun(t, shown, { doc, first: 2 });
    assert.equal((await lines(page)).length, 5);
  });
});

describe("a wrong token", () => {
  test("fails the read, which delivers no event", async (t) => {
    // The shell, on its way to the page, names a token the server refuses; the proxy's origin is
    // the one the listener accepts, so the token is all that is wrong.
    const rewriting = await proxyOf((html) =>
      html.replace(`"token":"${token}"`, `"token":"not-the-token"`),
    );
    await boot({ origins: [rewriting.origin] });
    await uploadRun("refused.txt");
    const page = await openLog(rewriting.origin);
    assert.match(
      await page.evaluate("document.getElementById('app-config').textContent"),
      /"token":"not-the-token"/,
    );
    const shown = await linesOnce(page, 1);
    for (const line of shown) t.diagnostic(line.error ?? line.text ?? JSON.stringify(line));
    assert.equal(shown.length, 1);
    assert.equal(
      shown[0].error,
      "the event read failed: Error: the NATS server refused the token, and its refresh gave none",
    );
  });
});

describe("the WebSocket listener's origins", () => {
  /** Opens a WebSocket from the page to the listener, resolving to "open" or "refused". */
  const probe = (page: Page): Promise<"open" | "refused"> =>
    page.evaluate(`new Promise((resolve) => {
      const ws = new WebSocket(${JSON.stringify(emulator.wsURL)});
      ws.onopen = () => { ws.close(); resolve("open"); };
      ws.onerror = () => resolve("refused");
    })`);

  /** Opens the log at the origin, recording each WebSocket handshake's outcome in `handshakes`:
   * its status on an upgrade, the browser's error on a refusal. */
  const openRecorded = (origin: string, handshakes: (number | string)[]) =>
    openLog(origin, async (page) => {
      page.on(
        "Network.webSocketHandshakeResponseReceived",
        ({ response }: { response: { status: number } }) => handshakes.push(response.status),
      );
      page.on("Network.webSocketFrameError", ({ errorMessage }: { errorMessage: string }) =>
        handshakes.push(errorMessage),
      );
      await page.cdp("Network.enable");
    });

  test("refuse a page from an origin the list doesn't name, and upgrade one it does", async (t) => {
    // The listener accepts the emulator's own origin alone, its default.
    await boot();
    const doc = await uploadRun("origins.txt");
    const other = await proxyOf();

    // The same app, shell and config, from the proxy's origin, which the list doesn't name.
    const refusals: (number | string)[] = [];
    const refused = await openRecorded(other.origin, refusals);
    const failed = await linesOnce(refused, 1);
    assert.equal(await probe(refused), "refused");
    for (const line of failed) t.diagnostic(`${other.origin}: ${line.error ?? line.text}`);
    for (const outcome of refusals) t.diagnostic(`${other.origin}: handshake ${outcome}`);
    assert.deepEqual(failed, [{ error: "the event read failed: ConnectionError" }]);
    assert.ok(refusals.length >= 2, "the log's and the probe's handshakes");
    for (const outcome of refusals) {
      assert.equal(outcome, "Error during WebSocket handshake: Unexpected response code: 403");
    }

    // From the emulator's own origin, the one the list names.
    const upgrades: (number | string)[] = [];
    const allowed = await openRecorded(emulator.origin, upgrades);
    assertRun(t, await linesOnce(allowed, 5), { doc, first: 1 });
    assert.equal(await probe(allowed), "open");
    for (const outcome of upgrades) t.diagnostic(`${emulator.origin}: handshake ${outcome}`);
    assert.deepEqual(upgrades, [101, 101]);
  });
});
