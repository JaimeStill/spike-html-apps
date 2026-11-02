// The browser tier's reading of the pipeline app: which route a page shows, the events its log's
// sl-event-log renders, read back from its shadow root, and the navigations a person makes, through
// the DevTools Protocol, as the sdk's router tier makes them. Each wait is the tooling's page wait,
// until, which polls an expression inside the page.

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

/** Where a page is: its URL path, and the tag of <main>'s first element, null when it has none. */
export interface Route {
  path: string;
  tag: string | null;
}

/** An event as the log's sl-event-log renders it: its type, its time's datetime (null when it
 * shows none), its source, subject, and id, each the whole text its line keeps, and its data, the
 * details' JSON parsed, undefined where it says it has none. */
export interface Logged {
  type: string;
  time: string | null;
  source: string;
  subject: string | null;
  id: string;
  data: unknown;
}

/** The event log's sl-event-log's shadow root, as a page expression. */
export const LOG = "document.querySelector('pipeline-log sl-event-log')?.shadowRoot";

/** The event log's status line's text, as a page expression. */
export const LOG_STATUS =
  "document.querySelector('pipeline-log .log-status')?.textContent.trim() ?? null";

/** The page's URL path and the tag of the element its router mounted in <main>. */
export const route = (page: Page): Promise<Route> =>
  page.evaluate(
    "({ path: location.pathname, tag: document.querySelector('main')?.firstElementChild?.localName ?? null })",
  );

/** Resolves once the page's router has mounted `tag`. */
export const mounted = (page: Page, tag: string): Promise<unknown> =>
  until(
    page,
    `document.querySelector('main')?.firstElementChild?.localName === ${JSON.stringify(tag)}`,
  );

/** The events the log shows, in its order, as its sl-event-log renders them. */
export const logged = (page: Page): Promise<Logged[]> =>
  page.evaluate(`[...(${LOG}?.querySelectorAll("li.event") ?? [])].map((li) => {
    const pair = (label) => {
      const dt = [...li.querySelectorAll(".meta dt")].find((dt) => dt.textContent === label);
      return dt ? dt.nextElementSibling.textContent : null;
    };
    const pre = li.querySelector("details.data pre");
    return {
      type: li.querySelector(".type").textContent,
      time: li.querySelector("time.when")?.getAttribute("datetime") ?? null,
      source: pair("source"),
      subject: pair("subject"),
      id: pair("id"),
      data: pre ? JSON.parse(pre.textContent) : undefined,
    };
  })`);

/** Resolves to the events the log shows once it shows `count` of them. */
export async function loggedOnce(page: Page, count: number): Promise<Logged[]> {
  await until(page, `(${LOG}?.querySelectorAll("li.event").length ?? 0) >= ${count}`);
  return logged(page);
}

/** Clicks the nav link with the text, as a mouse does, at its center. */
export async function click(page: Page, text: string): Promise<void> {
  const { x, y }: { x: number; y: number } = await page.evaluate(`(() => {
    const link = [...document.querySelectorAll('nav a')].find((a) => a.textContent === ${JSON.stringify(text)});
    const box = link.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

/** Goes back (-1) or forward (+1) through the browser, as its buttons do. */
export async function traverse(page: Page, delta: number): Promise<void> {
  const { currentIndex, entries }: { currentIndex: number; entries: { id: number }[] } =
    await page.cdp("Page.getNavigationHistory");
  await page.cdp("Page.navigateToHistoryEntry", { entryId: entries[currentIndex + delta].id });
}

/** Reloads the page, as the browser's button does, resolving once the new document has loaded. */
export async function reload(page: Page): Promise<void> {
  const loaded = new Promise((resolve) => page.on("Page.loadEventFired", resolve));
  await page.cdp("Page.reload");
  await loaded;
}

/** Opens a blank page, runs `prepare` on it (enabling a protocol domain, say), then loads `url`. */
export async function openWith(
  browser: Browser,
  url: string,
  prepare: (page: Page) => Promise<void>,
): Promise<Page> {
  const page = await browser.open("about:blank");
  await prepare(page);
  await page.goto(url);
  return page;
}

/** Sizes the page's viewport to `width` by `height`, as a window of that size is. */
export async function resize(page: Page, width: number, height = 800): Promise<void> {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

/** The accessible name the browser computes for the element `expression` finds, as a screen
 * reader is told it: Chrome's accessibility tree, read through the DevTools Protocol. */
export async function accessibleName(page: Page, expression: string): Promise<string> {
  const { result } = await page.cdp("Runtime.evaluate", { expression });
  const { nodes } = await page.cdp("Accessibility.getPartialAXTree", {
    objectId: result.objectId,
    fetchRelatives: false,
  });
  return nodes[0]?.name?.value ?? "";
}
