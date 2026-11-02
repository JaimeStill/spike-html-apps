// The external client in its Vite build, hosted apart on an origin of its own by a plain static
// server, over emulators booted on reserved loopback ports, each admitting that origin, or not, in
// its CORS and its NATS WebSocket listener: each panel loads its own service's list, uploads with
// progress through a preflighted cross-origin request, searches, and shows its live stage events,
// each from its own emulator; an upload to one service shows its events in that service's panel
// alone; a service that doesn't admit the client's origin fails its own panel with the network
// problem while the other works; and services.json missing, or not a service list, shows the
// client's error naming it. Each case boots its own emulators, so their stores start empty, and
// opens its own page.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { throttle } from "./support/documents.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import {
  choose,
  clickEntry,
  clientError,
  heading,
  host,
  listed,
  listedWith,
  logged,
  loggedFor,
  panelFailed,
  panelReady,
  sample,
  sampled,
  search,
  searched,
  servicesOf,
  timeline,
  uploads,
} from "./support/external.ts";
import type { Host } from "./support/external.ts";

let browser: Browser;
let client: Host;
const emulators: Emulator[] = [];
const pages: Page[] = [];

before(async () => {
  browser = await launch();
  client = await host();
});
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  for (const emulator of emulators.splice(0)) await emulator.stop();
  client.services(undefined);
});
after(async () => {
  await client?.stop();
  await browser?.close();
});

/**
 * Boots an emulator per instance name, each its run events' source /emulator/<name>, admitting the
 * client's origin unless `admits` is false, when it admits only its own. Settled, not all: an
 * emulator that booted is stopped after the case even when another failed.
 */
async function boot(...instances: { name: string; admits?: boolean }[]): Promise<Emulator[]> {
  const booted = await Promise.allSettled(
    instances.map(({ name, admits = true }) =>
      start({
        origins: admits ? [client.origin] : undefined,
        env: { EMULATOR_RUNS_INSTANCE: name },
      }),
    ),
  );
  for (const result of booted) if (result.status === "fulfilled") emulators.push(result.value);
  for (const result of booted) if (result.status === "rejected") throw result.reason;
  return booted.map((result) => (result as PromiseFulfilledResult<Emulator>).value);
}

/** Opens the client on its origin. */
async function open(): Promise<Page> {
  const page = await browser.open(`${client.origin}/`);
  pages.push(page);
  return page;
}

/** Uploads a text document through the emulator's API, as another client would, resolving to it
 * once its run is complete. */
async function uploaded(emulator: Emulator, name: string, text: string) {
  const doc = await emulator.upload(name, { type: "text/plain", body: text });
  await emulator.complete(doc.run_id);
  return doc;
}

/** The run the API lists for the document named, by its id. */
async function runOf(emulator: Emulator, name: string): Promise<string> {
  const response = await fetch(`${emulator.origin}/api/documents?size=100`);
  const { items } = (await response.json()) as { items: { name: string; run_id: string }[] };
  const doc = items.find((item) => item.name === name);
  assert.ok(doc, `${name} stored at ${emulator.origin}`);
  return doc.run_id;
}

describe("the external client's panels", () => {
  test("each load their own service's list, upload with progress, search, and show its live stage events", async (t) => {
    const [a, b] = await boot({ name: "a" }, { name: "b" });
    const alpha = await uploaded(a, "alpha.txt", "the alpha brief");
    const beta = await uploaded(b, "beta.txt", "the beta notes");
    client.services(
      servicesOf([
        ["Service A", a],
        ["Service B", b],
      ]),
    );
    const page = await open();
    await panelReady(page, 0);
    await panelReady(page, 1);
    assert.deepEqual([await heading(page, 0), await heading(page, 1)], ["Service A", "Service B"]);
    assert.deepEqual(await listed(page, 0), ["alpha.txt"]);
    assert.deepEqual(await listed(page, 1), ["beta.txt"]);

    // Each panel's log shows its own service's run's five stage events, read live from the oldest.
    const stage = (source: string, subject: string) =>
      Array(5).fill({ type: "emulator.run.stage", source, subject });
    assert.deepEqual(await loggedFor(page, 0, alpha.run_id, 5), stage("/emulator/a", alpha.run_id));
    assert.deepEqual(await loggedFor(page, 1, beta.run_id, 5), stage("/emulator/b", beta.run_id));

    // An upload through each panel's own dropzone, paced as a 64 kB/s link would pace it, shows its
    // progress on its way, and its document joins its own list, its run complete live.
    await throttle(page, 64_000);
    await sample(page, 0);
    await sample(page, 1);
    await choose(page, 0, "a-upload.txt", 192_000);
    await choose(page, 1, "b-upload.txt", 128_000);
    await listedWith(page, 0, "a-upload.txt", "complete 5/5");
    await listedWith(page, 1, "b-upload.txt", "complete 5/5");
    for (const [index, name, size] of [
      [0, "a-upload.txt", 192_000],
      [1, "b-upload.txt", 128_000],
    ] as const) {
      const bar = await sampled(page, index, name);
      t.diagnostic(`${name}'s bar: ${bar.join(", ")}`);
      assert.ok(
        bar.some((value) => value > 0 && value < size),
        `${name}'s bar stood between`,
      );
      assert.deepEqual(await uploads(page, index), [{ name, state: "done" }]);
    }
    assert.deepEqual(await listed(page, 0), ["alpha.txt", "a-upload.txt"]);
    assert.deepEqual(await listed(page, 1), ["beta.txt", "b-upload.txt"]);
    // Each upload crossed origins carrying Content-Type and Authorization, so its emulator answered
    // the browser's preflight for it.
    for (const emulator of [a, b]) {
      assert.match(
        emulator.output(),
        /http\.request\.method=OPTIONS url\.path=\/api\/documents .*http\.response\.status_code=204/,
      );
    }

    // Each panel searches its own service: the same query finds each one's own upload alone.
    await search(page, 0, "upload");
    await search(page, 1, "upload");
    assert.deepEqual(await searched(page, 0, "upload"), {
      status: "1 match for “upload”",
      names: ["a-upload.txt"],
    });
    assert.deepEqual(await searched(page, 1, "upload"), {
      status: "1 match for “upload”",
      names: ["b-upload.txt"],
    });

    // Each log holds its own two runs' events and nothing from the other service.
    const aUpload = await runOf(a, "a-upload.txt");
    const bUpload = await runOf(b, "b-upload.txt");
    assert.deepEqual(await loggedFor(page, 0, aUpload, 5), [
      ...stage("/emulator/a", alpha.run_id),
      ...stage("/emulator/a", aUpload),
    ]);
    assert.deepEqual(await loggedFor(page, 1, bUpload, 5), [
      ...stage("/emulator/b", beta.run_id),
      ...stage("/emulator/b", bUpload),
    ]);

    // An entry chosen shows its run's stages, complete.
    await clickEntry(page, 0, "alpha.txt");
    await listedWith(page, 0, "alpha.txt", "complete 5/5");
    await until(page, `!!document.querySelector("external-panel sl-stage-timeline")`);
    assert.deepEqual(
      (await timeline(page, 0)).map((s) => s.state),
      ["complete", "complete", "complete", "complete", "complete"],
    );
    assert.deepEqual(await timeline(page, 1), []);
  });

  test("an upload to one service shows its events in that service's panel alone", async () => {
    const [a, b] = await boot({ name: "a" }, { name: "b" });
    client.services(
      servicesOf([
        ["Service A", a],
        ["Service B", b],
      ]),
    );
    const page = await open();
    await panelReady(page, 0);
    await panelReady(page, 1);

    await choose(page, 0, "only-a.txt", 1_000);
    await listedWith(page, 0, "only-a.txt", "complete 5/5");
    const run = await runOf(a, "only-a.txt");
    // B's own run, uploaded after A's completed, so any event of A's bound for B's panel would have
    // arrived ahead of B's own.
    const own = await uploaded(b, "only-b.txt", "b's own");
    await loggedFor(page, 0, run, 5);
    await loggedFor(page, 1, own.run_id, 5);

    const subjects = async (index: number) => (await logged(page, index)).map((e) => e.subject);
    assert.deepEqual(await subjects(0), Array(5).fill(run));
    assert.deepEqual(await subjects(1), Array(5).fill(own.run_id));
    assert.deepEqual(await listed(page, 1), ["only-b.txt"]);
  });

  test("a service that doesn't admit the client's origin fails its own panel with the network problem, and the other works", async () => {
    const [a, c] = await boot({ name: "a" }, { name: "c", admits: false });
    client.services(
      servicesOf([
        ["Service A", a],
        ["Service C", c],
      ]),
    );
    const page = await open();
    assert.deepEqual(await panelFailed(page, 1), {
      heading: "Service C",
      problem: "Network error",
      reason: `Listing Service C's documents at ${c.origin}/api failed: Failed to fetch.`,
    });

    // A works: a document uploaded to it joins its list live and its events reach its log.
    await panelReady(page, 0);
    const doc = await a.upload("still-works.txt");
    await listedWith(page, 0, "still-works.txt", "complete 5/5");
    await loggedFor(page, 0, doc.run_id, 5);
    // C's panel stays failed.
    assert.equal(await page.evaluate(`document.querySelectorAll(".panel-failed").length`), 1);
  });
});

describe("services.json", () => {
  test("missing shows the error naming it", async () => {
    const page = await open();
    assert.equal(
      await clientError(page),
      "The services couldn't be loaded services.json wasn't found (HTTP 404 Not Found).",
    );
    assert.equal(await page.evaluate(`document.querySelectorAll("external-panel").length`), 0);
  });

  test("not JSON shows the error naming it", async () => {
    client.services("{ services: ");
    const page = await open();
    assert.match(
      await clientError(page),
      /^The services couldn't be loaded services\.json isn't JSON \(.+\)\.$/,
    );
  });

  test("not a service list shows the error naming it and what is wrong", async () => {
    client.services(
      JSON.stringify({
        services: [
          { name: "A", apiBase: "http://127.0.0.1:1/api", nats: { url: "ws://127.0.0.1:2" } },
        ],
      }),
    );
    const page = await open();
    assert.equal(
      await clientError(page),
      "The services couldn't be loaded services.json isn't a service list: services[0].nats.stream is not a string with text.",
    );
  });
});
