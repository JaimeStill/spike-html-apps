// The side pane's documents in the drawer, in the binary's build. At 375px and 480px, at or below
// the app's stacking width, the drawer is closed as the page loads; the header's documents button
// opens it modally, focus on its Close, and Close and Escape close it, focus back on the button;
// d toggles it, and types itself in the search field; choosing an entry navigates and closes it;
// an upload carries on with the drawer closed, the button's badge counting it while in flight, and
// one refused marks the badge until the drawer opens; files dragged onto the window open it. At
// 768px and 1280px it is docked in the side pane: no button, and d does nothing. An upload keeps
// going as the viewport crosses the width back and forth. Each case boots its own emulator and
// opens its own page, with reduced motion, so the drawer opens and closes without its slide.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { mounted, openWith, resize, route } from "./support/app.ts";
import {
  choose,
  clickAt,
  entries,
  entriesShown,
  entryOf,
  listReady,
  throttle,
  uploads,
} from "./support/documents.ts";
import { BUTTON, CLOSE, DRAWER, dragEnter, shown } from "./support/drawer.ts";
import { start } from "./support/emulator.ts";
import type { Emulator, StartOptions } from "./support/emulator.ts";
import { press, pressEscape, pressHelp, pressSlash } from "./support/keys.ts";

let browser: Browser;
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

/** Boots the case's emulator with the options, and opens the chat view at `width`, resolving
 * once the list is ready. */
async function open(width: number, options?: StartOptions): Promise<Page> {
  emulator = await start(options);
  const page = await openWith(browser, "about:blank", async (page) => {
    await resize(page, width);
    await page.cdp("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
  });
  pages.push(page);
  await page.goto(`${emulator.origin}${emulator.base}chat`);
  await listReady(page);
  return page;
}

/** Resolves once the drawer's dialog is open modally, or with `false` once it is closed and the
 * drawer has said so: Escape takes the dialog out of the top layer a task before its close event. */
const modal = (page: Page, open = true): Promise<unknown> =>
  until(
    page,
    open
      ? `${DRAWER}.shadowRoot.querySelector("dialog")?.matches(":modal")`
      : `!${DRAWER}.open && !(${DRAWER}.shadowRoot.querySelector("dialog")?.matches(":modal") ?? false)`,
  );

/** The rows the help dialog lists, by their controls' names, with the dialog closed again. */
async function helpRows(page: Page): Promise<string[]> {
  await pressHelp(page);
  const rows: string[] = await until(
    page,
    `(() => {
      const rows = [...document.querySelectorAll("#help [data-keys-list] button")].map((b) => b.textContent.trim());
      return rows.length > 0 && rows;
    })()`,
  );
  await pressEscape(page);
  await until(page, "!document.querySelector('#help').open");
  return rows;
}

for (const width of [375, 480]) {
  describe(`at ${width}px, the drawer`, () => {
    test("is closed as the page loads, the documents button in the header", async () => {
      const page = await open(width);
      assert.deepEqual(await shown(page), {
        mode: "drawer",
        modal: false,
        focus: "body",
        button: true,
        expanded: "false",
        badges: [],
        said: "",
      });
      // The documents stay connected while the drawer is closed: the list loaded behind it.
      assert.equal(await page.evaluate(`${DRAWER}.open`), false);
    });

    test("opens modally from the button, focus on Close; Close and Escape close it, focus back on the button", async () => {
      const page = await open(width);
      for (const closeBy of ["Close", "Escape"]) {
        await clickAt(page, BUTTON);
        await modal(page);
        const opened = await shown(page);
        assert.equal(opened.focus, "close", `opened for ${closeBy}: focus on Close`);
        assert.equal(opened.expanded, "true");
        assert.equal(
          await page.evaluate(`${CLOSE}.textContent.replace(/\\s+/g, " ").trim()`),
          "Close Documents",
        );
        if (closeBy === "Close") await clickAt(page, CLOSE);
        else await pressEscape(page);
        await modal(page, false);
        const closed = await shown(page);
        assert.equal(closed.focus, "button", `closed by ${closeBy}: focus on the button`);
        assert.equal(closed.expanded, "false");
      }
    });

    test("toggles on d, which the help dialog lists, and which types itself in the search field", async () => {
      const page = await open(width);
      assert.deepEqual(await helpRows(page), ["Search documents", "Documents", "Help", "Theme"]);
      await press(page, "d");
      await modal(page);
      await press(page, "d");
      await modal(page, false);

      await pressSlash(page);
      await press(page, "d");
      assert.equal(await page.evaluate("document.querySelector('input[name=q]').value"), "d");
      const typed = await shown(page);
      assert.deepEqual(
        { modal: typed.modal, focus: typed.focus },
        { modal: false, focus: "search" },
      );
    });

    test("closes as an entry chosen in it reaches its document's view", async () => {
      const page = await open(width);
      const doc = await emulator!.upload("target.txt");
      await emulator!.upload("other.txt");
      await entriesShown(page, 2);
      await clickAt(page, BUTTON);
      await modal(page);
      await clickAt(page, entryOf("target.txt"));
      await mounted(page, "pipeline-document");
      await modal(page, false);
      assert.deepEqual(await route(page), {
        path: `${emulator!.base}documents/${doc.id}`,
        tag: "pipeline-document",
      });
      // The navigation resets focus as it finishes, after the dialog has given it back.
      assert.equal((await shown(page)).focus, "body");
    });

    test("closed, lets an upload carry on, its badge counting it while in flight", async () => {
      const page = await open(width);
      await clickAt(page, BUTTON);
      await modal(page);
      // Paced as a 64 kB/s link would, so the upload is in flight for about three seconds.
      await throttle(page, 64_000);
      await choose(page, [{ name: "brief.txt", size: 192_000 }]);
      await until(page, `document.querySelector("pipeline-documents").uploads[0]?.sent > 0`);
      await pressEscape(page);
      await modal(page, false);
      const flying = await shown(page);
      assert.deepEqual(flying.badges, ["1"]);
      assert.equal(flying.said, "1 upload in progress.");
      assert.equal((await uploads(page))[0].state, "uploading");

      await entriesShown(page, 1);
      await until(page, `${BUTTON}.querySelectorAll(".workspace-badge").length === 0`);
      assert.equal((await uploads(page))[0].state, "done");
      assert.equal((await entries(page))[0].name, "brief.txt");
      assert.equal((await shown(page)).said, "");
    });

    test("closed, marks a refused upload on the badge until it opens", async () => {
      // The emulator's upload limit, a kilobyte: the larger file is refused.
      const page = await open(width, { env: { EMULATOR_DOCUMENTS_MAX_SIZE: "1000" } });
      await choose(page, [{ name: "too-large.txt", size: 4_000 }]);
      await until(
        page,
        `document.querySelector("pipeline-documents").uploads[0]?.state === "failed"`,
      );
      await until(page, `${BUTTON}.querySelector(".workspace-failed")`);
      const marked = await shown(page);
      assert.deepEqual(marked.badges, ["!"]);
      assert.equal(marked.said, "An upload failed.");

      await clickAt(page, BUTTON);
      await modal(page);
      const opened = await shown(page);
      assert.deepEqual(opened.badges, [], "opening clears the mark");
      assert.equal(opened.said, "");
      assert.equal((await uploads(page))[0].state, "failed");
      // Closed again, the failure seen leaves no mark.
      await pressEscape(page);
      await modal(page, false);
      assert.deepEqual((await shown(page)).badges, []);
    });

    test("opens as files are dragged onto the window, and not for a drag of text", async () => {
      const page = await open(width);
      await dragEnter(page, "text");
      assert.equal((await shown(page)).modal, false);
      await dragEnter(page, "file");
      await modal(page);
      // The dropzone is in the open drawer to drop on.
      assert.equal(
        await page.evaluate(
          "document.querySelector('pipeline-documents sl-upload-dropzone').checkVisibility()",
        ),
        true,
      );
    });
  });
}

for (const width of [768, 1280]) {
  describe(`at ${width}px, the drawer`, () => {
    test("is docked in the side pane, with no documents button, and d does nothing", async () => {
      const page = await open(width);
      const docked = await shown(page);
      assert.equal(docked.mode, "docked");
      assert.equal(docked.button, false, "no documents button");
      const side = await page.evaluate(`(() => {
        const side = document.querySelector(".workspace-side").getBoundingClientRect();
        const drawer = ${DRAWER}.getBoundingClientRect();
        return drawer.left >= side.left && drawer.right <= side.right && drawer.height > 0;
      })()`);
      assert.equal(side, true, "the documents sit in the side pane");
      await press(page, "d");
      assert.equal(await page.evaluate(`${DRAWER}.open`), false);
      assert.equal((await shown(page)).modal, false);
      // keys.js lists only a rendered control's keys: d is missing from the help.
      assert.deepEqual(await helpRows(page), ["Search documents", "Help", "Theme"]);
    });
  });
}

describe("an upload", () => {
  test("keeps going as the viewport crosses the stacking width, the documents never re-created", async () => {
    const page = await open(1280);
    await page.evaluate("void (window.documents = document.querySelector('pipeline-documents'))");
    await throttle(page, 48_000);
    await choose(page, [{ name: "resized.txt", size: 192_000 }]);
    await until(page, `document.querySelector("pipeline-documents").uploads[0]?.sent > 0`);
    for (const [width, mode] of [
      [375, "drawer"],
      [1280, "docked"],
      [480, "drawer"],
    ] as const) {
      await resize(page, width);
      await until(page, `${DRAWER}.matches(":state(${mode})")`);
      const now = await shown(page);
      assert.equal(now.modal, false, `${width}: closed`);
      if (mode === "drawer" && (await uploads(page))[0].state === "uploading") {
        assert.deepEqual(now.badges, ["1"], `${width}: the badge counts the upload`);
      }
    }
    await entriesShown(page, 1);
    assert.equal((await uploads(page))[0].state, "done");
    assert.equal(
      await page.evaluate("window.documents === document.querySelector('pipeline-documents')"),
      true,
      "the same element throughout",
    );
    assert.equal((await entries(page))[0].name, "resized.txt");
  });
});
