// Focus outlines inside the side pane's scroll, in the binary's build. Focusing a control scrolls
// it into its scroll container, and without scroll padding its border box lands flush with the
// container's edge, where the container's overflow clips the outline the foundation draws outside
// it, --line-m and a 2px offset. Docked, at 1280×800, with an upload in progress and a page of
// entries enough that the side pane scrolls, Tab walks down through the pane's controls, the
// picker, the upload's Cancel, the entries, and the pagination, and Shift+Tab walks back up; at
// each, the control's box grown by its outline's width and offset lies inside the pane's clip box,
// its padding box less the scrollbar's gutter. The main pane's views hold no control yet that its
// scroll could reach.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import type { TestContext } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { openWith, resize } from "./support/app.ts";
import { choose, entriesShown, listReady } from "./support/documents.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import { pressTab } from "./support/keys.ts";
import { proxy } from "./support/proxy.ts";

let browser: Browser;
let emulator: Emulator | undefined;
const pages: Page[] = [];
/** What a case started beside its emulator, stopped after it in reverse: a proxy. */
const stops: (() => Promise<void>)[] = [];

before(async () => {
  browser = await launch();
});
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  for (const stop of stops.splice(0).reverse()) await stop();
  await emulator?.stop();
  emulator = undefined;
});
after(async () => {
  await browser?.close();
});

/** Where focus is, and whether its outline fits the side pane's clip box. */
interface Stop {
  /** Whether focus is in the side pane. */
  inside: boolean;
  /** The control's place among those the walk kept, -1 if it isn't one. */
  index: number;
  /** The focused control, by its accessible label or text, its tag where it has neither. */
  name: string;
  /** How far the outline reaches outside the control's border box: its width and its offset. */
  reach: number;
  /** The side pane's scroll offset. */
  scrollTop: number;
  /** By how much, in px, the grown box passes each edge of the clip box; 0 or less inside. */
  over: { top: number; right: number; bottom: number; left: number };
}

/** Installs, in the page, the measure of each stop: `window.stop()` reads the focused control, the
 * deepest through the shadow roots, against the side pane, and with `keep` keeps it, in
 * `window.walked`; `window.straddle(i, edge)` focuses the kept control before the i-th without
 * scrolling and scrolls the pane until the i-th straddles its top or bottom edge, so the key that
 * reaches it finds it half clipped, the case where the browser's focus scroll brings it flush with
 * that edge (one wholly out of view it centers instead). */
const MEASURE = `void (window.walked = [],
window.stop = (keep) => {
  const side = document.querySelector(".workspace-side");
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  const inside = side.contains(document.activeElement);
  if (inside && keep) window.walked.push(el);
  const style = getComputedStyle(el);
  const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
  const box = el.getBoundingClientRect();
  const pane = side.getBoundingClientRect();
  const clip = {
    top: pane.top + side.clientTop,
    left: pane.left + side.clientLeft,
    bottom: pane.top + side.clientTop + side.clientHeight,
    right: pane.left + side.clientLeft + side.clientWidth,
  };
  // A label's own text, without the options of the select it wraps.
  const label = el.getAttribute("aria-label") ??
    (el.labels?.[0] ? el.labels[0].textContent.replace(el.textContent, "") : el.textContent);
  return {
    inside,
    index: window.walked.indexOf(el),
    name: label.replace(/\\s+/g, " ").trim().slice(0, 40) || el.localName,
    reach,
    scrollTop: side.scrollTop,
    over: {
      top: clip.top - (box.top - reach),
      right: box.right + reach - clip.right,
      bottom: box.bottom + reach - clip.bottom,
      left: clip.left - (box.left - reach),
    },
  };
},
window.straddle = (i, edge) => {
  const side = document.querySelector(".workspace-side");
  window.walked[i - 1].focus({ preventScroll: true });
  const box = window.walked[i].getBoundingClientRect();
  const pane = side.getBoundingClientRect();
  const line = edge === "top" ? pane.top + side.clientTop : pane.top + side.clientTop + side.clientHeight;
  side.scrollTop += box.top + box.height / 2 - line;
})`;

/** Presses Tab, or with `shift` Shift+Tab, and resolves to the stop it reaches, a frame later,
 * time for the focus's scroll to land. */
async function step(page: Page, shift: boolean, keep: boolean): Promise<Stop> {
  await pressTab(page, shift);
  await page.evaluate("new Promise((resolve) => requestAnimationFrame(resolve))");
  return page.evaluate(`window.stop(${keep})`);
}

/** Presses Tab, or Shift+Tab, until focus has entered the side pane and left it again, at most
 * `limit` times, resolving to each stop inside it in the order reached, its control kept. */
async function walk(page: Page, shift: boolean, limit = 80): Promise<Stop[]> {
  await page.evaluate("window.walked = []");
  const stops: Stop[] = [];
  for (let i = 0; i < limit; i++) {
    const stop = await step(page, shift, true);
    if (stop.inside) stops.push(stop);
    else if (stops.length > 0) return stops;
  }
  throw new Error(`focus never left the side pane in ${limit} presses`);
}

/** Walks the kept controls again, one key each, each found half clipped at the edge the walk
 * moves toward, resolving to the stops. */
async function edges(page: Page, shift: boolean, count: number): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let i = 1; i < count; i++) {
    await page.evaluate(`window.straddle(${i}, ${JSON.stringify(shift ? "top" : "bottom")})`);
    stops.push(await step(page, shift, false));
  }
  return stops;
}

/** Subpixel layout: an edge rounds by under half a pixel. */
const EPSILON = 0.5;

/** Asserts each stop's outline lies inside the clip box. */
function fits(t: TestContext, label: string, walked: Stop[]): void {
  for (const stop of walked) {
    t.diagnostic(
      `${label} ${stop.name}: reach ${stop.reach}, scrollTop ${stop.scrollTop}, over ${JSON.stringify(stop.over)}`,
    );
  }
  for (const stop of walked) {
    assert.ok(stop.reach > 0, `${label} ${stop.name}: an outline to fit`);
    for (const [edge, over] of Object.entries(stop.over)) {
      assert.ok(
        over <= EPSILON,
        `${label} ${stop.name}: the outline passes the pane's ${edge} edge by ${over}px`,
      );
    }
  }
}

describe("docked at 1280×800, the side pane", () => {
  test("keeps each focused control's outline inside its scroll, Tab down and Shift+Tab up", async (t) => {
    // A proxy forwarding at 100 kB/s holds an 8 MB upload in progress, its Cancel shown, for the
    // walk's length.
    const slow = await proxy(() => emulator!.origin, undefined, { rate: 100_000 });
    stops.push(slow.stop);
    emulator = await start({ origins: [slow.origin] });
    const names = Array.from({ length: 14 }, (_, i) => `doc-${String(i + 1).padStart(2, "0")}.txt`);
    for (const name of names) await emulator.upload(name);
    const page = await openWith(browser, "about:blank", async (page) => {
      await resize(page, 1280, 800);
    });
    pages.push(page);
    await page.goto(`${slow.origin}${emulator.base}chat`);
    await listReady(page);
    await entriesShown(page, 12);
    await choose(page, [{ name: "big.bin", size: 8_000_000 }]);
    await until(page, `document.querySelector("pipeline-documents").uploads[0]?.sent > 0`);
    assert.equal(
      await page.evaluate(
        `(() => { const side = document.querySelector(".workspace-side"); return side.scrollHeight > side.clientHeight; })()`,
      ),
      true,
      "the side pane scrolls",
    );
    await page.evaluate(MEASURE);

    for (const [direction, shift] of [
      ["down", false],
      ["up", true],
    ] as const) {
      const walked = await walk(page, shift);
      const reached = walked.map((stop) => stop.name);
      for (const control of [
        "Choose files",
        "Cancel big.bin",
        "doc-01.txt",
        "doc-12.txt",
        "Next page",
      ]) {
        assert.ok(
          reached.some((name) => name.includes(control)),
          `${direction}: focus reached ${control}: ${reached.join(", ")}`,
        );
      }
      assert.ok(
        walked.some((stop) => stop.scrollTop > 0),
        `${direction}: the pane scrolled on the way`,
      );
      fits(t, direction, walked);
      const edged = await edges(page, shift, walked.length);
      assert.deepEqual(
        edged.map((stop) => stop.index),
        walked.slice(1).map((_, i) => i + 1),
        `${direction}, at the edge: the same controls`,
      );
      fits(t, `${direction}, at the edge,`, edged);
      // On past the pane's last control, so the next walk starts outside it.
      assert.equal((await step(page, shift, false)).inside, false, `${direction}: out of the pane`);
    }
  });
});
