// The browser tier's reading of the pipeline app: which route a page shows, the lines its log
// shows, parsed back into the events they render, and the navigations a person makes, through the
// DevTools Protocol, as the sdk's router tier makes them. Each wait is the tooling's page wait,
// until, which polls an expression inside the page.

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

/** Where a page is: its URL path, and the tag of <main>'s first element, null when it has none. */
export interface Route {
  path: string;
  tag: string | null;
}

/** A run's stage event, as a log line renders it. */
export interface StageEvent {
  time: string;
  type: string;
  subject: string;
  data: { stage: string; position: number; stage_count: number; document_id: string };
}

/** A line of the log: an event line, its cursor and the event it renders; a line that renders
 * no stage event, its text; or a failure's text. */
export type Line =
  | { cursor: string | null; text: string; event: StageEvent; error?: undefined }
  | {
      cursor: string | null;
      unparsed: string;
      text?: undefined;
      event?: undefined;
      error?: undefined;
    }
  | { error: string; cursor?: undefined; text?: undefined; event?: undefined };

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

/** A stage line as the log writes it: the event's time, type, and subject, then its data. */
const stageLine =
  /^(?<time>\S*) (?<type>\S+) run (?<subject>\S+): (?<stage>\S+) \((?<position>\d+)\/(?<stage_count>\d+)\) of document (?<document_id>\S+)$/;

/** The log's lines: each event line's cursor and the event it renders, and each failure's text. */
export async function lines(page: Page): Promise<Line[]> {
  const items: { cursor: string | null; error: boolean; text: string }[] = await page.evaluate(
    "[...document.querySelectorAll('pipeline-log li')].map((li) => ({ cursor: li.dataset.cursor ?? null, error: li.className === 'error', text: li.textContent }))",
  );
  return items.map(({ cursor, error, text }): Line => {
    if (error) return { error: text };
    const fields = text.match(stageLine)?.groups;
    if (!fields) return { cursor, unparsed: text };
    const { time, type, subject, stage, position, stage_count, document_id } = fields;
    return {
      cursor,
      text,
      event: {
        time,
        type,
        subject,
        data: { stage, position: Number(position), stage_count: Number(stage_count), document_id },
      },
    };
  });
}

/** Resolves to the log's lines once it shows `count` of them. */
export async function linesOnce(page: Page, count: number): Promise<Line[]> {
  await until(page, `document.querySelectorAll('pipeline-log li').length >= ${count}`);
  return lines(page);
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
