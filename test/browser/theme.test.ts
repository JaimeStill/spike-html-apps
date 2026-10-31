// The pipeline app's theme: the menu offers every built-in profile, the full entries'; a choice
// saved there holds across a reload and in a second tab, and follows into an open one; and a
// stored choice is on the root element before first paint, because the shell loads the
// registration and preferences modules render-blocking. The first-paint case holds every module's
// fetch, and the same shell with blocking="render" stripped, served through the proxy, paints the
// defaults first: the case fails without the render-blocking modules.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { mounted, openWith, reload } from "./support/app.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import { press } from "./support/keys.ts";
import { proxy } from "./support/proxy.ts";

/** The foundation's localStorage key for the choice (its preferences.js KEY). */
const KEY = "spike-html-apps-foundation.preferences";

/** A profile other than the default in every facet, and the dark scheme, as stored. */
const CHOICE = { color: "catppuccin", space: "compact", type: "sans", scheme: "dark" };

/** CHOICE as the root element carries it. */
const APPLIED = {
  "data-palette": "catppuccin",
  "data-space": "compact",
  "data-type": "sans",
  "data-scheme": "dark",
};

/** The root element's theme attributes. */
const ROOTED = `Object.fromEntries(["data-palette", "data-space", "data-type", "data-scheme"].map((name) => [name, document.documentElement.getAttribute(name)]))`;

/** The theme menu's dialog. */
const MENU = "sl-theme-menu dialog";

let browser: Browser;
let emulator: Emulator;
const pages: Page[] = [];
const stops: (() => Promise<void>)[] = [];

before(async () => {
  browser = await launch();
  emulator = await start();
});
afterEach(async () => {
  for (const page of pages.splice(0)) {
    await page.evaluate("localStorage.clear()").catch(() => {});
    await page.close();
  }
  for (const stop of stops.splice(0).reverse()) await stop();
});
after(async () => {
  await browser?.close();
  await emulator?.stop();
});

/** Opens the chat view at the origin, the emulator's by default, after `prepare`, once mounted;
 * closed after the test. The chat view reads no stream, so a page on another origin, which the
 * emulator's WebSocket listener doesn't admit, loads it as it does on the emulator's own. */
async function openChat(
  origin = emulator.origin,
  prepare: (page: Page) => Promise<void> = async () => {},
): Promise<Page> {
  const page = await openWith(browser, `${origin}${emulator.base}chat`, prepare);
  pages.push(page);
  await mounted(page, "pipeline-chat");
  return page;
}

/** Opens the menu by its button's key, resolving once its dialog is open. */
async function openMenu(page: Page): Promise<void> {
  await press(page, "t");
  await until(page, `document.querySelector(${JSON.stringify(MENU)})?.open`);
}

/** Picks each of the choice's values in the open menu, then saves it. */
async function choose(page: Page, choice: Record<string, string>): Promise<void> {
  await page.evaluate(`(() => {
    const menu = document.querySelector(${JSON.stringify(MENU)});
    for (const [section, value] of Object.entries(${JSON.stringify(choice)})) {
      menu.querySelector('[data-section="' + section + '"] input[value="' + value + '"]').click();
    }
    menu.querySelector("[data-action=save]").click();
  })()`);
  await until(page, `!document.querySelector(${JSON.stringify(MENU)})?.open`);
}

describe("the theme menu", () => {
  test("offers every built-in profile in each facet, and each scheme", async () => {
    const page = await openChat();
    await openMenu(page);
    const sections = await page.evaluate(`Object.fromEntries(
      [...document.querySelectorAll(${JSON.stringify(MENU)} + " [data-section]")].map((row) => [
        row.dataset.section,
        [...row.querySelectorAll("input")].map((input) => input.value),
      ]),
    )`);
    assert.deepEqual(sections, {
      color: ["flexoki", "primer", "catppuccin", "everforest"],
      scheme: ["system", "light", "dark"],
      space: ["regular", "compact"],
      type: ["mono", "sans"],
    });
  });

  test("a saved choice holds across a reload and in a second tab, and follows into an open one", async () => {
    const page = await openChat();
    await openMenu(page);
    await choose(page, CHOICE);
    assert.deepEqual(await page.evaluate(ROOTED), APPLIED);
    assert.deepEqual(
      JSON.parse(await page.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)),
      CHOICE,
    );

    await reload(page);
    await mounted(page, "pipeline-chat");
    assert.deepEqual(await page.evaluate(ROOTED), APPLIED);

    const second = await openChat();
    assert.deepEqual(await second.evaluate(ROOTED), APPLIED);

    // A save in the first tab reaches the open second one through the storage event.
    await openMenu(page);
    await choose(page, { color: "everforest", scheme: "light" });
    await until(second, `document.documentElement.getAttribute("data-palette") === "everforest"`);
    assert.deepEqual(await second.evaluate(ROOTED), {
      ...APPLIED,
      "data-palette": "everforest",
      "data-scheme": "light",
    });
  });
});

// The first paint, against the moment the stored choice reaches the root. Every module's fetch is
// held DELAY ms, so a module that doesn't block rendering runs after the browser has painted.
// The recorder runs ahead of the shell's own scripts, from Page.addScriptToEvaluateOnNewDocument:
// window.flash records, in ms since navigation, first-paint from a PerformanceObserver and the
// moment data-palette lands from a MutationObserver.
// Adapted from spike-html-apps-foundation (8b12185): test/browser/preferences.test.ts, its flash
// case, and test/fixtures/flash-recorder.js.
describe("the stored choice at first paint", () => {
  const DELAY = 300;

  const RECORDER = `
    window.flash = { paint: null, applied: null };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-paint") window.flash.paint ??= entry.startTime;
      }
    }).observe({ type: "paint", buffered: true });
    new MutationObserver(() => {
      if (document.documentElement.hasAttribute("data-palette")) {
        window.flash.applied ??= performance.now();
      }
    }).observe(document.documentElement, { attributes: true });
  `;

  /** Stores CHOICE on the origin, then loads the chat view there afresh with the recorder
   * installed and every asset script's fetch held, resolving to what the recorder saw and how
   * many of the shell's scripts block rendering. */
  async function flash(
    origin: string,
  ): Promise<{ paint: number; applied: number | null; blocking: number }> {
    const seed = await openChat(origin);
    await seed.evaluate(
      `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(CHOICE))})`,
    );
    const page = await openWith(browser, "about:blank", async (page) => {
      await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
      page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) => {
        setTimeout(() => page.cdp("Fetch.continueRequest", { requestId }).catch(() => {}), DELAY);
      });
      await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/assets/*.js" }] });
    });
    pages.push(page);
    await page.goto(`${origin}${emulator.base}chat`);
    await until(page, "window.flash.paint !== null", 5000);
    await mounted(page, "pipeline-chat");
    assert.deepEqual(await page.evaluate(ROOTED), APPLIED);
    return page.evaluate(
      "({ ...window.flash, blocking: document.querySelectorAll('script[blocking~=render]').length })",
    );
  }

  test("is on the root element before the browser paints", async (t) => {
    const { paint, applied, blocking } = await flash(emulator.origin);
    t.diagnostic(`applied at ${applied} ms, first paint at ${paint} ms`);
    assert.equal(blocking, 2, "the shell's register and preferences modules block rendering");
    assert.notEqual(applied, null);
    assert.ok(applied! <= paint, `applied at ${applied}, after first paint at ${paint}`);
    assert.ok(paint >= DELAY, `first paint at ${paint} didn't wait on the held fetch`);
  });

  test("without blocking=render, the shell paints the defaults first: the case above can fail", async (t) => {
    const plain = await proxy(
      () => emulator.origin,
      (html) => html.replaceAll(' blocking="render"', ""),
    );
    stops.push(plain.stop);
    const { paint, applied, blocking } = await flash(plain.origin);
    t.diagnostic(`applied at ${applied} ms, first paint at ${paint} ms`);
    assert.equal(blocking, 0, "the proxy's shell blocks rendering on nothing");
    assert.ok(
      applied !== null && applied > paint,
      `applied at ${applied}, first paint at ${paint}`,
    );
  });
});
