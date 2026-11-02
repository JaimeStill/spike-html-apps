// The search view in the binary's build, over the emulator's own /api/search, at /app and at the
// root: the header's search field submitted opens the view for ?q=, each match's name and snippet
// with the query's occurrences marked, case-insensitively, through sl-search-results; a deep link,
// a reload, and back and forward reach it; and activating a match opens its document's view. Then,
// once: a query no document matches, a blank one's prompt, which asks the API nothing, and a
// search in flight, which keeps the last query's matches listed and busy, then fails as a lost
// network does, saying why, and Try again finds the matches. Each mount boots its own emulator
// with the same three documents.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { mounted, openWith, reload, route, traverse } from "./support/app.ts";
import { clickAt } from "./support/documents.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import { pressEnter, pressSlash } from "./support/keys.ts";

let browser: Browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** The search results, as a page expression. */
const RESULTS = "document.querySelector('pipeline-search sl-search-results')";

/** The search field, as a page expression. */
const FIELD = "document.querySelector('input[name=q]')";

/** A match as the results render it: its document's name and the field it matched in, its
 * snippet (null when it shows the name alone), and the text of each mark, in the name then the
 * snippet. */
interface ShownMatch {
  name: string;
  field: string;
  snippet: string | null;
  marks: string[];
}

/** What the results show: their state, their status line's text, whether the list is busy, and
 * the matches. */
interface Shown {
  state: string;
  status: string;
  busy: boolean;
  matches: ShownMatch[];
}

const shown = (page: Page): Promise<Shown> =>
  page.evaluate(`(() => {
    const results = ${RESULTS};
    const root = results.shadowRoot;
    return {
      state: results.state,
      status: root.querySelector(".status").textContent.replace(/\\s+/g, " ").trim(),
      busy: root.querySelector("ul.matches")?.getAttribute("aria-busy") === "true",
      matches: [...root.querySelectorAll("button.match")].map((button) => ({
        name: button.querySelector(".name").textContent,
        field: button.querySelector(".field").textContent,
        snippet: button.querySelector(".snippet")?.textContent ?? null,
        marks: [...button.querySelectorAll("mark")].map((mark) => mark.textContent),
      })),
    };
  })()`);

/** Resolves to what the results show once they are ready for `q`. */
async function searched(page: Page, q: string): Promise<Shown> {
  await mounted(page, "pipeline-search");
  await until(page, `${RESULTS}?.query === ${JSON.stringify(q)} && ${RESULTS}.state !== "loading"`);
  return shown(page);
}

/** The documents every mount uploads, and the matches a search for "quarter" finds, in their
 * creation order: two in their content, one in its name alone. */
const DOCUMENTS = [
  { name: "revenue.txt", text: "Revenue grew in the third Quarter, and again in the fourth." },
  { name: "notes.txt", text: "the quarterly numbers, as discussed" },
  { name: "Quarter-plan.md", text: "# Plan" },
];
const QUARTER: ShownMatch[] = [
  {
    name: "revenue.txt",
    field: "in content",
    snippet: "Revenue grew in the third Quarter, and again in the fourth.",
    marks: ["Quarter"],
  },
  {
    name: "notes.txt",
    field: "in content",
    snippet: "the quarterly numbers, as discussed",
    marks: ["quarter"],
  },
  { name: "Quarter-plan.md", field: "in name", snippet: null, marks: ["Quarter"] },
];

/** Asserts the results show the "quarter" matches, ready and not busy. */
function assertQuarter(results: Shown, q = "quarter") {
  assert.deepEqual(results, {
    state: "ready",
    status: `3 matches for “${q}”`,
    busy: false,
    matches: QUARTER,
  });
}

/** Asserts the location is the search view's for `q` under the base, the field holding it. */
async function assertAt(page: Page, base: string, q: string) {
  assert.deepEqual(await route(page), { path: `${base}search`, tag: "pipeline-search" });
  assert.equal(await page.evaluate("location.search"), `?q=${encodeURIComponent(q)}`);
  assert.equal(await page.evaluate(`${FIELD}.value`), q);
}

/** Boots an emulator at the mount with the documents uploaded, and opens a page on it. */
async function setUp(mount: string): Promise<{ emulator: Emulator; page: Page; ids: string[] }> {
  const emulator = await start({ mount });
  const ids: string[] = [];
  for (const { name, text } of DOCUMENTS) {
    ids.push((await emulator.upload(name, { type: "text/plain", body: text })).id);
  }
  const page = await openWith(browser, "about:blank", async () => {});
  return { emulator, page, ids };
}

/** Submits the header's search field as a person does: / focuses it, the query is typed, and
 * Enter submits its form. */
async function submit(page: Page, q: string) {
  await pressSlash(page);
  assert.equal(await page.evaluate(`document.activeElement === ${FIELD}`), true, "/ focused it");
  await page.evaluate(`${FIELD}.select()`);
  await page.cdp("Input.insertText", { text: q });
  await pressEnter(page);
}

for (const mount of ["/app", "/"]) {
  describe(`the search view at ${mount}`, () => {
    let emulator: Emulator;
    let page: Page;
    let ids: string[];
    before(async () => {
      ({ emulator, page, ids } = await setUp(mount));
    });
    after(async () => {
      await page?.close();
      await emulator?.stop();
    });

    test("opens when the header's field is submitted, the query marked in each match", async () => {
      const { origin, base } = emulator;
      await page.goto(`${origin}${base}`);
      await mounted(page, "pipeline-log");
      await page.evaluate("void (window.unreloaded = true)");
      await submit(page, "quarter");
      assertQuarter(await searched(page, "quarter"));
      await assertAt(page, base, "quarter");
      assert.equal(await page.evaluate("window.unreloaded"), true, "the router navigated");
    });

    test("is reached by a deep link and by a reload", async () => {
      const { origin, base } = emulator;
      await page.goto(`${origin}${base}search?q=QUARTER`);
      assertQuarter(await searched(page, "QUARTER"), "QUARTER");
      await assertAt(page, base, "QUARTER");
      await reload(page);
      assertQuarter(await searched(page, "QUARTER"), "QUARTER");
      await assertAt(page, base, "QUARTER");
    });

    test("back and forward move between queries and views, the view following each", async () => {
      const { origin, base } = emulator;
      await page.goto(`${origin}${base}chat`);
      await mounted(page, "pipeline-chat");
      await submit(page, "quarter");
      assertQuarter(await searched(page, "quarter"));
      await submit(page, "notes");
      const notes = await searched(page, "notes");
      assert.equal(notes.status, "1 match for “notes”");
      assert.deepEqual(
        notes.matches.map(({ name, marks }) => ({ name, marks })),
        [{ name: "notes.txt", marks: ["notes"] }],
      );

      await traverse(page, -1);
      assertQuarter(await searched(page, "quarter"));
      await assertAt(page, base, "quarter");
      await traverse(page, -1);
      await mounted(page, "pipeline-chat");
      await traverse(page, 1);
      assertQuarter(await searched(page, "quarter"));
      await traverse(page, 1);
      assert.equal((await searched(page, "notes")).status, "1 match for “notes”");
      await assertAt(page, base, "notes");
    });

    test("opens a match's document when the match is activated", async () => {
      const { origin, base } = emulator;
      await page.goto(`${origin}${base}search?q=quarter`);
      assertQuarter(await searched(page, "quarter"));
      await clickAt(page, `${RESULTS}.shadowRoot.querySelectorAll("button.match")[1]`);
      await mounted(page, "pipeline-document");
      await until(
        page,
        `document.querySelector("pipeline-document h1")?.textContent === "notes.txt"`,
      );
      assert.deepEqual(await route(page), {
        path: `${base}documents/${ids[1]}`,
        tag: "pipeline-document",
      });
      // Back returns to the matches.
      await traverse(page, -1);
      assertQuarter(await searched(page, "quarter"));
    });
  });
}

describe("the search view's other states", () => {
  let emulator: Emulator;
  let page: Page;
  before(async () => {
    ({ emulator, page } = await setUp("/app"));
  });
  after(async () => {
    await page?.close();
    await emulator?.stop();
  });

  test("says no document matches a query none does", async () => {
    await page.goto(`${emulator.origin}${emulator.base}search?q=zebra`);
    assert.deepEqual(await searched(page, "zebra"), {
      state: "ready",
      status: "No matches for “zebra”",
      busy: false,
      matches: [],
    });
  });

  test("prompts for a blank query, and asks the API nothing", async () => {
    const asked: string[] = [];
    page.on("Network.requestWillBeSent", ({ request }: { request: { url: string } }) => {
      if (request.url.includes("/api/search")) asked.push(request.url);
    });
    await page.cdp("Network.enable");
    await page.goto(`${emulator.origin}${emulator.base}search?q=%20%20`);
    assert.deepEqual(await searched(page, ""), {
      state: "ready",
      status: "Search document names and content.",
      busy: false,
      matches: [],
    });
    await page.cdp("Network.disable");
    assert.deepEqual(asked, []);
  });

  test("keeps the last matches busy while it searches, says why it failed, and tries again", async () => {
    await page.goto(`${emulator.origin}${emulator.base}search?q=quarter`);
    assertQuarter(await searched(page, "quarter"));

    // The next search's request held, then failed as a lost network fails it.
    const paused: string[] = [];
    page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) =>
      paused.push(requestId),
    );
    await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/search*" }] });
    await page.evaluate(`navigation.navigate("search?q=notes").finished.then(() => true)`);
    await until(page, `${RESULTS}?.state === "loading"`);
    const searching = await shown(page);
    assert.equal(searching.status, "Searching for “notes”…");
    assert.equal(searching.busy, true, "the last matches marked busy");
    assert.deepEqual(
      searching.matches.map(({ name }) => name),
      QUARTER.map(({ name }) => name),
    );
    assert.equal(await page.evaluate("document.querySelector('.search-retry')"), null);

    while (paused.length === 0) await new Promise((resolve) => setTimeout(resolve, 25));
    await page.cdp("Fetch.failRequest", {
      requestId: paused[0],
      errorReason: "InternetDisconnected",
    });
    await page.cdp("Fetch.disable");
    assert.deepEqual(await searched(page, "notes"), {
      state: "error",
      status: "Couldn't search. Network error",
      busy: false,
      matches: [],
    });

    await clickAt(page, "document.querySelector('.search-retry')");
    const found = await until(page, `${RESULTS}.state === "ready"`).then(() => shown(page));
    assert.equal(found.status, "1 match for “notes”");
    assert.equal(await page.evaluate("document.querySelector('.search-retry')"), null);
  });
});
