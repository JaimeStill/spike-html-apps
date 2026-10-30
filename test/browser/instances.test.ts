// Two emulators side by side, each on ports of its own, with its own embedded NATS listeners and
// JetStream store: an upload to one reaches its own stream and the log of a page on it, and never
// the other's.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { launch } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { lines, linesOnce, mounted, openWith } from "./support/app.ts";
import { start, token } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import { streamState } from "./support/nats.ts";
import type { StreamState } from "./support/nats.ts";

let browser: Browser;
const instances: Emulator[] = [];

before(async () => {
  browser = await launch();
});
after(async () => {
  for (const instance of instances) await instance.stop();
  await browser?.close();
});

/** Opens the app's log on the instance, once it has mounted. */
async function openLog(instance: Emulator): Promise<Page> {
  const page = await openWith(browser, `${instance.origin}${instance.base}`, async () => {});
  await mounted(page, "pipeline-log");
  return page;
}

/** Uploads to the instance, resolving to the document once its run is complete. */
async function uploadRun(instance: Emulator, name: string) {
  const doc = await instance.upload(name);
  await instance.complete(doc.run_id);
  return doc;
}

/** The runs the page's log shows a line of, each by its subject, with its count of lines. */
async function runsShown(page: Page): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const line of await lines(page)) {
    assert.ok(line.event, `an event line: ${JSON.stringify(line)}`);
    counts[line.event.subject] = (counts[line.event.subject] ?? 0) + 1;
  }
  return counts;
}

test("neither instance's events reach the other's stream", async (t) => {
  // Settled, not all: an instance that booted is stopped by after() even when the other failed,
  // so a failed boot fails the case rather than leaving a process that keeps node running.
  const booted = await Promise.allSettled([start(), start()]);
  for (const result of booted) if (result.status === "fulfilled") instances.push(result.value);
  for (const result of booted) if (result.status === "rejected") throw result.reason;
  const [a, b] = instances;
  const ports = [a.origin, a.wsURL, b.origin, b.wsURL].map((url) => new URL(url).port);
  ports.push(String(a.natsPort), String(b.natsPort));
  assert.equal(new Set(ports).size, 6, `distinct ports: ${ports.join(" ")}`);
  assert.ok(a.store() && b.store() && a.store() !== b.store(), `stores ${a.store()}, ${b.store()}`);
  t.diagnostic(`A: ${a.origin} ${a.wsURL} nats ${a.natsPort} store ${a.store()}`);
  t.diagnostic(`B: ${b.origin} ${b.wsURL} nats ${b.natsPort} store ${b.store()}`);

  const [pageA, pageB] = [await openLog(a), await openLog(b)];
  try {
    const docA = await uploadRun(a, "a.txt");
    for (const { text } of await linesOnce(pageA, 5)) t.diagnostic(`A: ${text}`);
    const docB = await uploadRun(b, "b.txt");
    for (const { text } of await linesOnce(pageB, 5)) t.diagnostic(`B: ${text}`);

    // Each stream holds its own run's five events, each from sequence 1, and each log shows them.
    assert.deepEqual(await streamState({ port: a.natsPort, token }).then(counts), [5, 1, 5]);
    assert.deepEqual(await streamState({ port: b.natsPort, token }).then(counts), [5, 1, 5]);
    assert.deepEqual(await runsShown(pageA), { [docA.run_id]: 5 });
    assert.deepEqual(await runsShown(pageB), { [docB.run_id]: 5 });
    assert.deepEqual(
      (await lines(pageB)).map(({ cursor }) => cursor),
      ["1", "2", "3", "4", "5"],
    );
  } finally {
    await pageA.close();
    await pageB.close();
  }
});

/** A stream state's message count and first and last sequences. */
const counts = ({ messages, first_seq, last_seq }: StreamState) => [messages, first_seq, last_seq];
