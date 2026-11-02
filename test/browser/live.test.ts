// The sdk's NATS adapter, live, in the pipeline app the binary serves: the app's one feed reads the
// emulator's stream over the embedded server's WebSocket listener through natsSequence with the
// shell's static token, and the event log shows its deliveries through sl-event-log, with no read
// of its own: the stream holds one consumer, the feed's, however the views change. Each case boots
// its own emulator, so its stream starts empty and its cursors at 1, and opens its own page, so its
// sessionStorage starts empty; each event the log shows is printed. A page whose shell the test
// changes, or whose origin it varies, is served through a proxy (support/proxy.ts), a real loopback
// answer the browser's Local Network Access checks let reach the listener.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import type { TestContext } from "node:test";

import { launch } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { click, LOG_STATUS, logged, loggedOnce, mounted, openWith, reload } from "./support/app.ts";
import type { Logged } from "./support/app.ts";
import { entriesShown, LIST } from "./support/documents.ts";
import { stageNames, start, token } from "./support/emulator.ts";
import type { Emulator, StartOptions, UploadedDocument } from "./support/emulator.ts";
import { publishEvent, streamState } from "./support/nats.ts";
import { proxy } from "./support/proxy.ts";

/** The stage event's type, the default prefix's run.stage. */
const stageType = "emulator.run.stage";

/** The sessionStorage key the log keeps its last cursor under (apps/pipeline/src/log.ts). */
const cursorKey = "pipeline-log.cursor";

/** The stored cursor, as a page expression. */
const STORED = `sessionStorage.getItem(${JSON.stringify(cursorKey)})`;

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

/** Prints each event, and asserts the events are the run's five stage events in order, each
 * with a time, and no two of them one event. */
function assertRun(t: TestContext, shown: Logged[], doc: UploadedDocument) {
  for (const event of shown)
    t.diagnostic(`${event.type} ${event.id} ${JSON.stringify(event.data)}`);
  assert.deepEqual(
    shown.map((event) => ({ ...event, time: undefined, id: undefined, source: undefined })),
    stageNames.map((stage, i) => ({
      type: stageType,
      time: undefined,
      id: undefined,
      source: undefined,
      subject: doc.run_id,
      data: { stage, position: i + 1, stage_count: stageNames.length, document_id: doc.id },
    })),
  );
  for (const event of shown)
    assert.ok(!Number.isNaN(Date.parse(event.time ?? "")), `time ${event.time}`);
  assertDistinct(shown);
}

/** Asserts no two events shown are one: CloudEvents makes an event's source and id unique. */
function assertDistinct(shown: Logged[]) {
  const keys = shown.map(({ source, id }) => `${source} ${id}`);
  assert.equal(new Set(keys).size, keys.length, `distinct events: ${keys.join(", ")}`);
}

/** Uploads a document and resolves to it once its run is complete. */
async function uploadRun(name: string) {
  const doc = await emulator.upload(name);
  await emulator.complete(doc.run_id);
  return doc;
}

describe("a read with no cursor", () => {
  test("shows the kept events from the oldest, then each upload's stage events live, in order", async (t) => {
    await boot();
    const kept = await uploadRun("kept.txt");
    const page = await openLog();
    await page.evaluate("void (window.unreloaded = true)");
    const live = await uploadRun("live.txt");
    const shown = await loggedOnce(page, 10);
    assertRun(t, shown.slice(0, 5), kept);
    assertRun(t, shown.slice(5), live);
    assertDistinct(shown);
    assert.equal(await page.evaluate("window.unreloaded"), true, "the page never reloaded");
    assert.equal(await page.evaluate(STORED), "10", "the cursor of the last event shown");
    assert.equal(
      await page.evaluate(LOG_STATUS),
      "Following the run events live, from the oldest the stream keeps.",
    );
  });
});

describe("the one sequence", () => {
  test("reads the stream once, for the log, the list, and the document view alike", async (t) => {
    await boot();
    const sockets: string[] = [];
    const page = await openLog(emulator.origin, async (page) => {
      page.on("Network.webSocketCreated", ({ url }: { url: string }) => sockets.push(url));
      await page.cdp("Network.enable");
    });
    const doc = await emulator.upload("one-read.txt");
    // The list's entry and the log follow the run from the same deliveries, live.
    await entriesShown(page, 1);
    await emulator.complete(doc.run_id);
    assertRun(t, await loggedOnce(page, 5), doc);
    await until(
      page,
      `${LIST}.querySelector("sl-entry")?.shadowRoot.querySelector(".status")?.textContent === "complete 5/5"`,
    );
    const consumers = async () =>
      (await streamState({ port: emulator.natsPort, token })).consumer_count;
    t.diagnostic(`consumers ${await consumers()}, sockets ${sockets.join(" ")}`);
    assert.equal(await consumers(), 1, "the feed's read alone, with the log mounted");

    // The document view and the log again, in and out: each follows the feed, and opens no read.
    await page.evaluate(`navigation.navigate("documents/${doc.id}").finished.then(() => true)`);
    await mounted(page, "pipeline-document");
    await click(page, "Event log");
    await mounted(page, "pipeline-log");
    assertRun(t, await loggedOnce(page, 5), doc);
    assert.equal(await consumers(), 1, "the feed's read alone, after the views changed");
    assert.deepEqual(sockets, [emulator.wsURL + "/"], "one connection");
  });
});

describe("a read resumed from the last cursor", () => {
  test("after a reload, continues with no gap and no duplicate", async (t) => {
    await boot();
    const page = await openLog();
    const first = await uploadRun("first.txt");
    assertRun(t, await loggedOnce(page, 5), first);
    assert.equal(await page.evaluate(STORED), "5");

    // The chat view replaces the log; the next run's events are delivered while the log isn't
    // shown, so they move no cursor, and the reload loads a new document, which keeps only the
    // stored cursor.
    await click(page, "Chat");
    await mounted(page, "pipeline-chat");
    const second = await uploadRun("second.txt");
    await reload(page);
    await mounted(page, "pipeline-chat");
    assert.equal(await page.evaluate(STORED), "5");

    // The feed's read starts after the stored cursor: the log shows the second run whole, and
    // nothing of the first, then a third live.
    await click(page, "Event log");
    await mounted(page, "pipeline-log");
    assertRun(t, await loggedOnce(page, 5), second);
    assert.equal(
      await page.evaluate(LOG_STATUS),
      "Following the run events live, after the last one this tab showed.",
    );
    const third = await uploadRun("third.txt");
    const shown = await loggedOnce(page, 10);
    assertRun(t, shown.slice(5), third);
    assert.equal(shown.length, 10);
    assertDistinct(shown);
    assert.equal(await page.evaluate(STORED), "15");

    // A reload on the log itself: the log opens empty, and the next run follows the third.
    await reload(page);
    await mounted(page, "pipeline-log");
    const fourth = await uploadRun("fourth.txt");
    const resumed = await loggedOnce(page, 5);
    assertRun(t, resumed, fourth);
    assert.equal((await logged(page)).length, 5);
    assert.equal(await page.evaluate(STORED), "20");
  });

  test("restarts at once from the oldest event on a cursor the stream never gave out", async (t) => {
    await boot();
    const sockets: string[] = [];
    const kept = await uploadRun("restarted.txt");
    // The cursor of an emulator before this one, whose stream reached further.
    const page = await openLog(emulator.origin, async (page) => {
      page.on("Network.webSocketCreated", ({ url }: { url: string }) => sockets.push(url));
      await page.cdp("Network.enable");
      await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: `sessionStorage.setItem(${JSON.stringify(cursorKey)}, "99")`,
      });
    });
    await page.evaluate("void (window.unreloaded = true)");

    // The feed forgets the cursor and reads from the oldest event, with no reload, and the status
    // line says so quietly, as no failure.
    assertRun(t, await loggedOnce(page, 5), kept);
    t.diagnostic(await page.evaluate(LOG_STATUS));
    assert.equal(
      await page.evaluate(LOG_STATUS),
      "The stream restarted; following the run events live, from the oldest it keeps.",
    );
    assert.equal(
      await page.evaluate("document.querySelector('pipeline-log .log-status.paused')"),
      null,
    );
    assert.equal(await page.evaluate(STORED), "5");

    // The read is live: the next upload's events follow, and the list's entry follows its run.
    const live = await emulator.upload("live.txt");
    await entriesShown(page, 2);
    await emulator.complete(live.run_id);
    const shown = await loggedOnce(page, 10);
    assertRun(t, shown.slice(5), live);
    assertDistinct(shown);
    await until(
      page,
      `[...${LIST}.querySelectorAll("sl-entry")].find((e) => e.item?.name === "live.txt")?.shadowRoot.querySelector(".status")?.textContent === "complete 5/5"`,
    );
    assert.equal(await page.evaluate("document.querySelector('.documents-live')"), null);
    assert.equal(await page.evaluate(STORED), "10");
    assert.equal(await page.evaluate("window.unreloaded"), true, "the page never reloaded");
    const { consumer_count } = await streamState({ port: emulator.natsPort, token });
    assert.equal(consumer_count, 1, "the feed's one read");
    assert.deepEqual(sockets, [emulator.wsURL + "/"], "one connection");
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

    // The feed reads the run's types alone: the run's five events, at cursors 2 to 6, and not the
    // other.
    const page = await openLog();
    assertRun(t, await loggedOnce(page, 5), doc);
    assert.equal((await logged(page)).length, 5);
    assert.equal(await page.evaluate(STORED), "6");
  });
});

describe("a wrong token", () => {
  test("pauses the read, which delivers no event, and says why", async (t) => {
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
    await until(page, `(${LOG_STATUS})?.startsWith("Live events paused")`);
    t.diagnostic(await page.evaluate(LOG_STATUS));
    assert.equal(
      await page.evaluate(LOG_STATUS),
      "Live events paused: the NATS server refused the token, and its refresh gave none. Reconnecting…",
    );
    assert.deepEqual(await logged(page), []);
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
    await until(refused, `(${LOG_STATUS})?.startsWith("Live events paused")`);
    assert.equal(await probe(refused), "refused");
    const status = await refused.evaluate(LOG_STATUS);
    t.diagnostic(`${other.origin}: ${status}`);
    for (const outcome of refusals) t.diagnostic(`${other.origin}: handshake ${outcome}`);
    assert.equal(status, "Live events paused: ConnectionError. Reconnecting…");
    assert.deepEqual(await logged(refused), []);
    assert.ok(refusals.length >= 2, "the feed's and the probe's handshakes");
    for (const outcome of refusals) {
      assert.equal(outcome, "Error during WebSocket handshake: Unexpected response code: 403");
    }

    // From the emulator's own origin, the one the list names.
    const upgrades: (number | string)[] = [];
    const allowed = await openRecorded(emulator.origin, upgrades);
    assertRun(t, await loggedOnce(allowed, 5), doc);
    assert.equal(await probe(allowed), "open");
    for (const outcome of upgrades) t.diagnostic(`${emulator.origin}: handshake ${outcome}`);
    assert.deepEqual(upgrades, [101, 101]);
  });
});
