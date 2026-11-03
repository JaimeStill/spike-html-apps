// The side pane's documents in the drawer, in the binary's build. At 375px and 480px, below the
// app's stacking width, 48rem, the drawer is closed as the page loads; the header's documents
// button opens it modally, focus on its Close, and Close and Escape close it, focus back on the
// button; d opens it, and is quiet while it is open, the page's bindings resting under a modal
// dialog, and types itself in the search field; choosing an entry navigates and closes it; an
// upload carries on with the drawer closed, the button's badge counting it while in flight, in the
// accent, and one refused marks the badge until the drawer opens; files dragged onto the window
// open it. At 768px and 1280px it is docked in the side pane: no button, and d does nothing. The
// width itself: 767px is a drawer and 768px docked; in either mode the drawer's heading is the one
// that names the documents, and the search field's hint is "Search" below the width and "Search
// documents" at it, its accessible name "Search documents" throughout. The current view's link
// takes the accent too. An upload keeps going as the viewport crosses the width back and forth.
// At 375px the documents button's badge sits centered on its label's line, as far from its key
// hint as the hint is from the label, the button as tall as Help with and without it.
// Each case boots its own emulator and opens its own page, with reduced motion, so the drawer
// opens and closes without its slide.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { accessibleName, mounted, openWith, resize, route } from "./support/app.ts";
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
 * drawer has said so: Escape takes the dialog out of the top layer a task before its close
 * event. */
const modal = (page: Page, open = true): Promise<unknown> =>
  until(
    page,
    open
      ? `${DRAWER}.shadowRoot.querySelector("dialog")?.matches(":modal")`
      : `!${DRAWER}.open && !(${DRAWER}.shadowRoot.querySelector("dialog")?.matches(":modal") ?? false)`,
  );

/** Resolves after two animation frames, time for a key's binding or a media query to act. */
const frames = (page: Page): Promise<unknown> =>
  page.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
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

    test("opens on d, which the help dialog lists and which is quiet while it is open, and types itself in the search field", async () => {
      const page = await open(width);
      assert.deepEqual(await helpRows(page), ["Search documents", "Documents", "Help", "Theme"]);
      for (const closeBy of ["Close", "Escape"]) {
        await press(page, "d");
        await modal(page);
        // The page's bindings rest while a modal dialog is open: d leaves the drawer open, and so
        // does ?, the help dialog staying shut. Two frames give a binding time to act.
        await press(page, "d");
        await pressHelp(page);
        await frames(page);
        assert.equal((await shown(page)).modal, true, `d again leaves it open, before ${closeBy}`);
        assert.equal(await page.evaluate("document.querySelector('#help').open"), false);
        if (closeBy === "Close") await clickAt(page, CLOSE);
        else await pressEscape(page);
        await modal(page, false);
      }

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

/** The drawer's headings and the documents' own, in the composed tree: each heading's level and
 * text in the drawer's shadow root, and in <pipeline-documents>, its light DOM; and the name the
 * drawer's wrapper, the docked aside or the dialog, takes from its aria-labelledby. */
const HEADINGS = `(() => {
  const root = ${DRAWER}.shadowRoot;
  const read = (scope) =>
    [...scope.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => \`\${h.localName} \${h.textContent.trim()}\`);
  const wrapper = root.querySelector("aside, dialog");
  return {
    wrapper: wrapper.localName,
    names: root.getElementById(wrapper.getAttribute("aria-labelledby"))?.textContent.trim(),
    drawer: read(root),
    documents: read(document.querySelector("pipeline-documents")),
  };
})()`;

/** The search field, as a page expression. */
const SEARCH = "document.querySelector('input[name=q]')";

describe("at the stacking width, 48rem", () => {
  for (const [width, mode] of [
    [767, "drawer"],
    [768, "docked"],
    [375, "drawer"],
    [1280, "docked"],
  ] as const) {
    test(`${width}px is ${mode === "drawer" ? "a drawer" : "docked"}, its one heading naming the documents, the search hint ${mode === "drawer" ? "short" : "full"}`, async () => {
      const page = await open(width);
      const now = await shown(page);
      assert.equal(now.mode, mode);
      assert.equal(now.button, mode === "drawer", "the documents button only as a drawer");
      // Open, as a drawer, so its dialog shows the heading as a reader meets it.
      if (mode === "drawer") {
        await clickAt(page, BUTTON);
        await modal(page);
      }
      assert.deepEqual(await page.evaluate(HEADINGS), {
        wrapper: mode === "drawer" ? "dialog" : "aside",
        names: "Documents",
        drawer: ["h2 Documents"],
        // Under the drawer's h2: the upload's h3, and no heading of the app's naming the whole.
        documents: ["h3 Upload"],
      });
      if (mode === "drawer") {
        await pressEscape(page);
        await modal(page, false);
      }
      assert.equal(
        await page.evaluate(`${SEARCH}.placeholder`),
        mode === "drawer" ? "Search" : "Search documents",
      );
      assert.equal(await accessibleName(page, SEARCH), "Search documents");
    });
  }

  test("the search hint follows the viewport across it, its accessible name unchanged", async () => {
    const page = await open(1280);
    for (const [width, hint] of [
      [767, "Search"],
      [768, "Search documents"],
      [375, "Search"],
      [1280, "Search documents"],
    ] as const) {
      await resize(page, width);
      await until(page, `${SEARCH}.placeholder === ${JSON.stringify(hint)}`);
      assert.equal(await accessibleName(page, SEARCH), "Search documents", `${width}: the name`);
    }
  });
});

/** The color the accent's default resolves to in the workspace, --magenta, and the colors the
 * badge and the current view's link compute: the badge's background, the link's border, its inset
 * line, and its text, with the text's own --fg beside it. */
const ACCENTS = `(() => {
  const ws = document.querySelector("pipeline-workspace");
  const probe = (value) => {
    const el = document.createElement("span");
    el.style.color = value;
    ws.append(el);
    const color = getComputedStyle(el).color;
    el.remove();
    return color;
  };
  const badge = document.querySelector(".workspace-badge:not(.workspace-failed)");
  const link = getComputedStyle(document.querySelector('nav a[aria-current="page"]'));
  return {
    magenta: probe("var(--magenta)"),
    fg: probe("var(--fg)"),
    badge: badge && getComputedStyle(badge).backgroundColor,
    border: link.borderTopColor,
    inset: link.boxShadow,
    text: link.color,
  };
})()`;

/** The header's buttons as laid out: the documents button's label text, key hint, and badge, each
 * one's vertical center and inline edges, its height, and the help button's height. The label is
 * the word alone, by a range over its text, without the whitespace around it. */
const BUTTON_PARTS = `(() => {
  const button = ${BUTTON};
  const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes("Documents"));
  const range = document.createRange();
  const at = text.textContent.indexOf("Documents");
  range.setStart(text, at);
  range.setEnd(text, at + "Documents".length);
  const box = (rect) => ({ center: rect.top + rect.height / 2, start: rect.left, end: rect.right });
  const badge = button.querySelector(".workspace-badge");
  return {
    label: box(range.getBoundingClientRect()),
    kbd: box(button.querySelector("kbd").getBoundingClientRect()),
    badge: badge ? box(badge.getBoundingClientRect()) : null,
    height: button.getBoundingClientRect().height,
    help: document.querySelector("button[commandfor=help]").getBoundingClientRect().height,
  };
})()`;

interface Box {
  center: number;
  start: number;
  end: number;
}

describe("at 375px, the documents button", () => {
  test("centers its badge on the label's line, spaced as its key hint is, its height Help's", async (t) => {
    const page = await open(375);
    const bare: { height: number; help: number } = await page.evaluate(BUTTON_PARTS);
    assert.equal(bare.height, bare.help, "without the badge, as tall as Help");

    await throttle(page, 64_000);
    await choose(page, [{ name: "brief.txt", size: 192_000 }]);
    await until(page, `${BUTTON}.querySelector(".workspace-badge")`);
    const parts: { label: Box; kbd: Box; badge: Box; height: number; help: number } =
      await page.evaluate(BUTTON_PARTS);
    t.diagnostic(JSON.stringify(parts));
    assert.ok(
      Math.abs(parts.badge.center - parts.label.center) <= 0.5,
      `the badge's center ${parts.badge.center} on the label's ${parts.label.center}`,
    );
    assert.ok(
      Math.abs(parts.badge.center - parts.kbd.center) <= 0.5,
      `the badge's center ${parts.badge.center} on the key hint's ${parts.kbd.center}`,
    );
    const hint = parts.kbd.start - parts.label.end;
    const badge = parts.badge.start - parts.kbd.end;
    assert.ok(
      Math.abs(hint - badge) <= 0.5,
      `label to key hint ${hint}, key hint to badge ${badge}`,
    );
    assert.equal(parts.height, parts.help, "with the badge, as tall as Help");
  });
});

describe("the accent", () => {
  test("marks the uploads in flight and the current view's link, and follows --accent-color on the workspace", async () => {
    const page = await open(375);
    // Paced as a 16 kB/s link would, so the upload is in flight for about twelve seconds.
    await throttle(page, 16_000);
    await choose(page, [{ name: "accent.txt", size: 192_000 }]);
    await until(page, `${BUTTON}.querySelector(".workspace-badge")`);
    const before = await page.evaluate(ACCENTS);
    assert.equal(before.badge, before.magenta, "the badge in the accent's default, --magenta");
    assert.equal(before.border, before.magenta, "the link's border in the accent");
    assert.ok(
      before.inset.startsWith(`${before.magenta} 0px 0px 0px `) && before.inset.endsWith(" inset"),
      `the link's inset line in the accent: ${before.inset}`,
    );
    assert.equal(before.text, before.fg, "the link's text in --fg");

    await page.evaluate(
      "document.querySelector('pipeline-workspace').style.setProperty('--accent-color', 'rgb(0, 128, 96)')",
    );
    const after = await page.evaluate(ACCENTS);
    assert.equal(after.badge, "rgb(0, 128, 96)", "the badge follows the hook");
    assert.equal(after.border, "rgb(0, 128, 96)", "the link's border follows the hook");
    assert.match(after.inset, /^rgb\(0, 128, 96\) /, "the link's inset line follows the hook");
    assert.equal((await uploads(page))[0].state, "uploading", "measured while in flight");
  });
});

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
