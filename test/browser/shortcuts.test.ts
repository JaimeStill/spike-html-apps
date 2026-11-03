// The pipeline app's shortcuts, the foundation's keys module over the workspace's data-keys,
// pressed as real keys: / focuses the search field, ? opens the help dialog listing every binding,
// t opens the theme menu, and Escape closes either dialog; inside the search field each of them
// types itself and fires nothing, and Escape leaves the field. So does the chat view's composer,
// whose field sits in <sl-composer>'s shadow root, where the document's listener sees the press
// retargeted to the host: /, ?, and t type themselves there, docked and at 375px, and at 375px
// d, the drawer's binding, does too.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { mounted, openWith, resize } from "./support/app.ts";
import { shown } from "./support/drawer.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import { press, pressEscape, pressHelp, pressSlash } from "./support/keys.ts";

/** The focused element's name and type, and a modal dialog's id or class if one is open. */
const STATE = `(() => {
  const el = document.activeElement;
  const modal = document.querySelector(":modal");
  return {
    focused: el === document.body ? "body" : el.localName + (el.name ? "[name=" + el.name + "]" : ""),
    modal: modal ? (modal.id || modal.className) : null,
  };
})()`;

/** The theme menu's dialog. */
const MENU = "sl-theme-menu dialog";

/** The chat view's composer, and its field in the composer's shadow root. */
const COMPOSER = "document.querySelector('pipeline-chat sl-composer')";
const FIELD = `${COMPOSER}.shadowRoot.querySelector('textarea')`;

/** Where focus is, through the shadow roots: the composer's field, the search field, or another
 * element's tag; and whether the help dialog and the theme menu are open. */
const COMPOSING = `(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return {
    focused: el === ${FIELD} ? "composer" : el?.matches("input[name=q]") ? "search" : el?.localName ?? "body",
    help: document.querySelector("#help").open,
    menu: document.querySelector(${JSON.stringify(MENU)})?.open ?? false,
  };
})()`;

/** Resolves after two animation frames, time for a key's binding to act. */
const frames = (page: Page): Promise<unknown> =>
  page.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );

let browser: Browser;
let emulator: Emulator;
let page: Page;

before(async () => {
  browser = await launch();
  emulator = await start();
});
after(async () => {
  await browser?.close();
  await emulator?.stop();
});

describe("the shortcuts", () => {
  beforeEach(async () => {
    await page?.close();
    page = await openWith(browser, `${emulator.origin}${emulator.base}chat`, async () => {});
    await mounted(page, "pipeline-chat");
  });
  after(async () => {
    await page?.close();
  });

  test("/ focuses the search field", async () => {
    await pressSlash(page);
    assert.deepEqual(await page.evaluate(STATE), { focused: "input[name=q]", modal: null });
    // The press focused the field and typed nothing into it.
    assert.equal(await page.evaluate("document.querySelector('input[name=q]').value"), "");
  });

  test("? opens the help dialog, listing every binding, and Escape closes it", async () => {
    await pressHelp(page);
    await until(page, "document.querySelector('#help').open");
    assert.deepEqual(await page.evaluate(STATE), { focused: "button", modal: "help" });
    // keys.js fills the list as the dialog opens, loading its help module the first time.
    const rows: string[] = await until(
      page,
      `(() => {
        const rows = [...document.querySelectorAll("#help [data-keys-list] button")].map((b) => b.textContent.trim());
        return rows.length > 0 && rows;
      })()`,
    );
    // Each binding once, by its control's name; the dialog's own Close, bound to ? too, isn't
    // listed apart from the Help button's.
    assert.deepEqual(rows, ["Search documents", "Help", "Theme"]);
    assert.deepEqual(
      await page.evaluate(
        "[...document.querySelectorAll('#help [data-keys-list] kbd')].map((k) => k.textContent)",
      ),
      // The help module's own last row, Escape leaving a field, follows the bindings.
      ["/", "?", "T", "Esc"],
    );
    await pressEscape(page);
    await until(page, "!document.querySelector('#help').open");
    assert.equal((await page.evaluate(STATE)).modal, null);
  });

  test("t opens the theme menu, and Escape closes it", async () => {
    await press(page, "t");
    // preferences.js loads the menu's module on the first open.
    await until(page, `document.querySelector(${JSON.stringify(MENU)})?.open`);
    assert.equal((await page.evaluate(STATE)).modal, "theme-menu");
    await pressEscape(page);
    await until(page, `!document.querySelector(${JSON.stringify(MENU)})?.open`);
    assert.equal((await page.evaluate(STATE)).modal, null);
  });

  test("in the search field, /, ?, and t type themselves and fire nothing, and Escape leaves it", async () => {
    await pressSlash(page);
    for (const key of ["?", "t", "/"]) {
      if (key === "?") await pressHelp(page);
      else if (key === "/") await pressSlash(page);
      else await press(page, key);
    }
    assert.equal(await page.evaluate("document.querySelector('input[name=q]').value"), "?t/");
    assert.deepEqual(await page.evaluate(STATE), { focused: "input[name=q]", modal: null });
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(MENU)})`), null);
    await pressEscape(page);
    assert.deepEqual(await page.evaluate(STATE), { focused: "body", modal: null });
    // Out of the field, the keys fire again.
    await pressHelp(page);
    await until(page, "document.querySelector('#help').open");
  });

  test("in the composer, /, ?, and t, and at 375px d, type themselves and fire nothing", async () => {
    await until(page, `${COMPOSER}?.shadowRoot?.querySelector("textarea")`);
    for (const [width, keys] of [
      [null, ["/", "?", "t"]],
      [375, ["/", "?", "t", "d"]],
    ] as const) {
      const at = width ? `at ${width}px` : "docked";
      if (width) {
        await resize(page, width);
        await until(
          page,
          "document.querySelector('pipeline-workspace sl-drawer').matches(':state(docked)') === false",
        );
      }
      await page.evaluate(`(${COMPOSER}.value = "", ${FIELD}.focus())`);
      for (const key of keys) {
        if (key === "?") await pressHelp(page);
        else if (key === "/") await pressSlash(page);
        else await press(page, key);
      }
      await frames(page);
      assert.equal(await page.evaluate(`${COMPOSER}.value`), keys.join(""), `typed, ${at}`);
      assert.deepEqual(
        await page.evaluate(COMPOSING),
        { focused: "composer", help: false, menu: false },
        `nothing fired, ${at}`,
      );
      if (width) assert.equal((await shown(page)).modal, false, "the drawer stayed shut");
    }
  });
});
