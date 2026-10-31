// The pipeline app's workspace in the binary's build, at /app and at the root: each view of the
// main pane reached by a deep link, by a reload, and by back and forward, with the frame around it
// in place; the About route gone; and the panes side by side when wide, stacked below 48rem.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { click, mounted, openWith, reload, route, traverse } from "./support/app.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";

let browser: Browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** A view of the main pane: its path relative to the base, the tag the router mounts there, and
 * an expression true in the page once the view shows its state. */
interface View {
  path: string;
  tag: string;
  shows: string;
}

/** The frame is in place: the header's title, search field, help and theme buttons, and the
 * theme menu; the side pane's navigation, upload, and documents; and the main pane, the outlet. */
const FRAMED = `(() => {
  const ws = document.querySelector("pipeline-workspace");
  return !!ws && [
    "header .workspace-title", "header input[type=search][name=q][data-keys='/']",
    "header button[commandfor=help][data-keys='?']", "header button[commandfor=theme][data-keys=t]",
    "header sl-theme-menu#theme", "aside nav", "aside #upload-heading", "aside #documents-heading",
    "main.workspace-main",
  ].every((selector) => ws.querySelector(selector));
})()`;

/** The search field's value. */
const FIELD = "document.querySelector('input[name=q]').value";

const VIEWS: View[] = [
  {
    path: "",
    tag: "pipeline-log",
    shows: "document.querySelector('pipeline-log h1')?.textContent === 'Event log'",
  },
  {
    path: "chat",
    tag: "pipeline-chat",
    shows: "document.querySelector('pipeline-chat h1')?.textContent === 'Chat'",
  },
  {
    path: "search?q=brief",
    tag: "pipeline-search",
    shows: `document.querySelector('pipeline-search [data-query]')?.textContent === 'brief' && ${FIELD} === 'brief'`,
  },
  {
    path: "documents/doc-1",
    tag: "pipeline-document",
    shows:
      "document.querySelector('pipeline-document')?.getAttribute('document') === 'doc-1' && document.querySelector('pipeline-document code')?.textContent === 'doc-1'",
  },
];

/** Resolves once the router has mounted the view's tag and the view shows its state, failing
 * naming the view otherwise; asserts the location's path and query and the frame. */
async function reached(page: Page, base: string, view: View): Promise<void> {
  await mounted(page, view.tag);
  const [path, search = ""] = view.path.split("?");
  assert.deepEqual(await route(page), { path: `${base}${path}`, tag: view.tag });
  assert.equal(await page.evaluate("location.search"), search && `?${search}`);
  assert.equal(await page.evaluate(view.shows), true, `${view.tag} shows its state`);
  assert.equal(await page.evaluate(FRAMED), true, `the frame around ${view.tag}`);
}

for (const mount of ["/app", "/"]) {
  describe(`the workspace at ${mount}`, () => {
    let emulator: Emulator;
    let page: Page;
    before(async () => {
      emulator = await start({ mount });
      page = await openWith(browser, "about:blank", async () => {});
    });
    after(async () => {
      await page?.close();
      await emulator?.stop();
    });

    test("each view is reached by a deep link and by a reload", async () => {
      const { origin, base } = emulator;
      for (const view of VIEWS) {
        await page.goto(`${origin}${base}${view.path}`);
        await reached(page, base, view);
        await reload(page);
        await reached(page, base, view);
      }
    });

    test("back and forward move between the views, a new query keeping the search view", async () => {
      const { origin, base } = emulator;
      const [log, chat, search, doc] = VIEWS;
      const memo: View = {
        path: "search?q=memo",
        tag: "pipeline-search",
        shows: `document.querySelector('pipeline-search [data-query]')?.textContent === 'memo' && ${FIELD} === 'memo'`,
      };
      await page.goto(`${origin}${base}`);
      await reached(page, base, log);

      // The side pane's link, then the header's search field submitted, twice; the second query
      // changes only the location's query, so the view stays mounted and follows it.
      await click(page, "Chat");
      await reached(page, base, chat);
      const submit = (q: string) =>
        page.evaluate(`(() => {
          const field = document.querySelector("input[name=q]");
          field.value = ${JSON.stringify(q)};
          field.form.requestSubmit();
        })()`);
      await submit("brief");
      await reached(page, base, search);
      await page.evaluate("void (window.searchView = document.querySelector('pipeline-search'))");
      await submit("memo");
      await arrived(page, memo);
      await reached(page, base, memo);
      assert.equal(
        await page.evaluate("window.searchView === document.querySelector('pipeline-search')"),
        true,
        "the search view stays mounted for a new query",
      );
      // An entry of the document list reaches the view in documents.test.ts; a same-document
      // navigation stands in here.
      await page.evaluate("navigation.navigate('documents/doc-1').finished.then(() => true)");
      await reached(page, base, doc);

      for (const view of [memo, search, chat, log]) {
        await traverse(page, -1);
        await arrived(page, view);
        await reached(page, base, view);
      }
      for (const view of [chat, search, memo, doc]) {
        await traverse(page, 1);
        await arrived(page, view);
        await reached(page, base, view);
      }
    });

    test("the About route is gone: its path shows the not-found view, and no link names it", async () => {
      const { origin, base } = emulator;
      await page.goto(`${origin}${base}about`);
      await mounted(page, "pipeline-not-found");
      assert.deepEqual(await route(page), { path: `${base}about`, tag: "pipeline-not-found" });
      assert.deepEqual(
        await page.evaluate("[...document.querySelectorAll('nav a')].map((a) => a.textContent)"),
        ["Event log", "Chat"],
      );
      // The not-found view's link leads back to the event log.
      await page.evaluate("document.querySelector('pipeline-not-found a').click()");
      await reached(page, base, VIEWS[0]);
    });
  });
}

/** Resolves once the page's location and view are `view`'s: a traversal's mount is async. */
async function arrived(page: Page, view: View): Promise<void> {
  const [path, search = ""] = view.path.split("?");
  const expression = `location.pathname.endsWith(${JSON.stringify(`/${path}`)}) && location.search === ${JSON.stringify(search && `?${search}`)} && document.querySelector('main')?.firstElementChild?.localName === ${JSON.stringify(view.tag)} && (${view.shows})`;
  await until(page, expression);
}

describe("the workspace's layout", () => {
  let emulator: Emulator;
  let page: Page;
  before(async () => {
    emulator = await start();
    page = await openWith(browser, `${emulator.origin}${emulator.base}chat`, async () => {});
    await mounted(page, "pipeline-chat");
  });
  after(async () => {
    await page?.close();
    await emulator?.stop();
  });

  /** The header's, side pane's, and main pane's boxes, at the viewport's width. */
  async function boxes(width: number) {
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return page.evaluate(`(() => {
      const box = (selector) => {
        const { left, right, top, bottom, width } = document.querySelector(selector).getBoundingClientRect();
        return { left, right, top, bottom, width };
      };
      return {
        header: box(".workspace-header"),
        side: box(".workspace-side"),
        main: box(".workspace-main"),
        // The viewport's width less a page scrollbar's, which a stacked page shows.
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`);
  }

  test("wide, the panes sit side by side below the header", async () => {
    const { header, side, main, scrollWidth } = await boxes(1280);
    assert.equal(side.top, header.bottom);
    assert.equal(main.top, header.bottom);
    assert.ok(side.right <= main.left, `side ${side.right} ends before main ${main.left}`);
    assert.equal(scrollWidth, 1280, "nothing overflows the viewport");
  });

  test("below 48rem, the panes stack into one column: header, side pane, main pane", async () => {
    for (const width of [767, 375]) {
      const { header, side, main, clientWidth, scrollWidth } = await boxes(width);
      assert.equal(side.top, header.bottom, `${width}: side below the header`);
      assert.equal(main.top, side.bottom, `${width}: main below the side pane`);
      assert.equal(side.left, main.left, `${width}: one column`);
      assert.equal(side.width, main.width, `${width}: one column`);
      assert.equal(side.width, clientWidth, `${width}: the column spans the viewport`);
      assert.equal(scrollWidth, clientWidth, `${width}: nothing overflows the viewport`);
    }
    // 768px is 48rem: wide again.
    const { side, main } = await boxes(768);
    assert.ok(side.right <= main.left, "768: side by side");
  });
});
