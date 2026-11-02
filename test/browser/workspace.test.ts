// The pipeline app's workspace in the binary's build, at /app and at the root: each view of the
// main pane reached by a deep link, by a reload, and by back and forward, with the frame around it
// in place; the About route gone; the panes side by side when wide, the side pane wide enough for
// a document's entry to take two lines, and the navigation alone stacked above the main pane below
// 48rem, the documents in the drawer (drawer.test.ts); and the app's own text in the type
// profile's interface font, under the default profile and under sans.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { click, mounted, openWith, reload, resize, route, traverse } from "./support/app.ts";
import { choose, entriesShown, LIST, listReady, uploads } from "./support/documents.ts";
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

/** The frame is in place: the header's title, search field, documents, help, and theme buttons,
 * and the theme menu; the side pane's navigation, and its drawer's upload and document list; and
 * the main pane, the outlet. */
const FRAMED = `(() => {
  const ws = document.querySelector("pipeline-workspace");
  return !!ws && [
    "header .workspace-title", "header input[type=search][name=q][data-keys='/']",
    "header button[commandfor=help][data-keys='?']", "header button[commandfor=theme][data-keys=t]",
    "header sl-theme-menu#theme", "header button[data-keys=d]", ".workspace-side nav",
    ".workspace-side sl-drawer #upload-heading", ".workspace-side sl-drawer sl-document-list",
    "main.workspace-main",
  ].every((selector) => ws.querySelector(selector));
})()`;

/** The search field's value. */
const FIELD = "document.querySelector('input[name=q]').value";

/** The search view's results have answered for the query: its status line counts matches or says
 * there are none for it. */
const SEARCHED = (q: string) =>
  `(() => {
    const results = document.querySelector("pipeline-search sl-search-results");
    const status = results?.shadowRoot?.querySelector(".status")?.textContent ?? "";
    return results?.query === ${JSON.stringify(q)} && results.state === "ready" && status.includes(${JSON.stringify(`“${q}”`)});
  })()`;

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
    shows: `${SEARCHED("brief")} && ${FIELD} === 'brief'`,
  },
  {
    path: "documents/doc-1",
    tag: "pipeline-document",
    shows:
      "document.querySelector('pipeline-document')?.getAttribute('document') === 'doc-1' && document.querySelector('pipeline-document h1')?.textContent === 'Document not found' && document.querySelector('pipeline-document code')?.textContent === 'doc-1'",
  },
];

/** Resolves once the router has mounted the view's tag and the view shows its state, failing
 * naming the view when it doesn't within the wait; asserts the location's path and query and the frame. */
async function reached(page: Page, base: string, view: View): Promise<void> {
  await mounted(page, view.tag);
  // A view that asks the API as it mounts, the document view, shows its state once it answers.
  await until(page, view.shows).catch(() => undefined);
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
        shows: `${SEARCHED("memo")} && ${FIELD} === 'memo'`,
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
    // Typical names: each fits its line beside its status in the pane at 1280px.
    for (const name of ["quarterly-report.pdf", "notes.txt", "onboarding-checklist.md"]) {
      await emulator.upload(name);
    }
    page = await openWith(browser, `${emulator.origin}${emulator.base}chat`, async () => {});
    await mounted(page, "pipeline-chat");
    await entriesShown(page, 3);
  });
  after(async () => {
    await page?.close();
    await emulator?.stop();
  });

  /** The header's, side pane's, drawer's, and main pane's boxes, at the viewport's width. */
  async function boxes(width: number) {
    await resize(page, width);
    // The drawer reads its mode from a media query, whose change lags the resize by a frame.
    await page.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    return page.evaluate(`(() => {
      const box = (selector) => {
        const { left, right, top, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      return {
        header: box(".workspace-header"),
        side: box(".workspace-side"),
        drawer: box(".workspace-side sl-drawer"),
        main: box(".workspace-main"),
        // The viewport's width less a page scrollbar's, which a stacked page shows.
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`);
  }

  test("wide, the panes sit side by side below the header, the side pane 30rem at most", async () => {
    for (const width of [1280, 1024, 768]) {
      const { header, side, main, scrollWidth } = await boxes(width);
      assert.equal(side.top, header.bottom, `${width}: side below the header`);
      assert.equal(main.top, header.bottom, `${width}: main below the header`);
      assert.ok(
        side.right <= main.left,
        `${width}: side ${side.right} ends before main ${main.left}`,
      );
      assert.ok(side.width >= 320 && side.width <= 480, `${width}: side ${side.width}px`);
      // The main pane keeps 28rem at the narrowest wide width, and the larger share above it.
      assert.ok(main.width >= 448, `${width}: main ${main.width}px`);
      assert.ok(main.width > side.width, `${width}: main wider than the side pane`);
      assert.equal(scrollWidth, width, `${width}: nothing overflows the viewport`);
    }
    assert.equal((await boxes(1280)).side.width, 480, "1280: the side pane at 30rem");
  });

  test("at 1280px, a typical entry takes two lines: its name and status, then its meta", async () => {
    await boxes(1280);
    const lines: { name: string; head: number; meta: number; status: boolean }[] =
      await page.evaluate(`[
      ...${LIST}.querySelectorAll("sl-entry"),
    ].map((entry) => {
      const root = entry.shadowRoot;
      // The lines a part's text takes: its boxes' distinct tops.
      const tops = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      };
      const name = root.querySelector(".name");
      const named = name.getBoundingClientRect();
      const status = root.querySelector(".status").getBoundingClientRect();
      return {
        name: name.textContent,
        head: tops(name),
        // The status sits on the name's line, not wrapped below it.
        status: status.top >= named.top && status.bottom <= named.bottom,
        meta: tops(root.querySelector(".meta")),
      };
    })`);
    for (const line of lines) {
      const { name } = line;
      assert.deepEqual(line, { name, head: 1, status: true, meta: 1 }, `${name} on two lines`);
    }
  });

  test("below 48rem, the navigation stacks between the header and the main pane, the drawer taking no room", async () => {
    for (const width of [767, 480, 375]) {
      const { header, side, drawer, main, clientWidth, scrollWidth } = await boxes(width);
      assert.equal(side.top, header.bottom, `${width}: side below the header`);
      assert.equal(main.top, side.bottom, `${width}: main below the side pane`);
      assert.equal(side.left, main.left, `${width}: one column`);
      assert.equal(side.width, main.width, `${width}: one column`);
      assert.equal(side.width, clientWidth, `${width}: the column spans the viewport`);
      assert.equal(drawer.height, 0, `${width}: the closed drawer takes no room`);
      assert.equal(scrollWidth, clientWidth, `${width}: nothing overflows the viewport`);
    }
    // 768px is 48rem: wide again.
    const { side, main } = await boxes(768);
    assert.ok(side.right <= main.left, "768: side by side");
  });
});

describe("the workspace's text", () => {
  let emulator: Emulator;
  let page: Page;
  before(async () => {
    emulator = await start();
    page = await openWith(browser, `${emulator.origin}${emulator.base}chat`, async () => {});
    await mounted(page, "pipeline-chat");
    await listReady(page);
    await choose(page, [{ name: "notes.txt", text: "meeting notes" }]);
    await entriesShown(page, 1);
    assert.equal((await uploads(page))[0].state, "done");
  });
  after(async () => {
    await page?.close();
    await emulator?.stop();
  });

  /** The interface font the root's profile resolves, and each sample's computed font. */
  const FONTS = `(() => {
    const zone = document.querySelector("pipeline-documents sl-upload-dropzone").shadowRoot;
    const family = (el) => getComputedStyle(el).fontFamily;
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim(),
      body: getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim(),
      samples: {
        nav: family(document.querySelector(".workspace-side nav a")),
        heading: family(document.querySelector("#upload-heading")),
        prose: family(document.querySelector("pipeline-chat .chat-status")),
        prompt: family(zone.querySelector(".prompt")),
        upload: family(zone.querySelector("li.upload .name")),
      },
    };
  })()`;

  for (const type of [null, "sans"]) {
    test(`is in the interface font under the ${type ?? "default"} type profile`, async () => {
      await page.evaluate(
        type === null
          ? "document.documentElement.removeAttribute('data-type')"
          : `document.documentElement.setAttribute("data-type", ${JSON.stringify(type)})`,
      );
      const { token, body, samples } = await page.evaluate(FONTS);
      // The default profile's interface font is mono, its body font sans; sans sets both sans.
      assert.equal(token === body, type === "sans", `the ${type ?? "default"} profile's fonts`);
      for (const [sample, family] of Object.entries(samples)) {
        assert.equal(family, token, `${sample} in --font-ui`);
      }
    });
  }
});
