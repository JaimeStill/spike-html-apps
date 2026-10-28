// The browser tier's reading of the pipeline app: which route a page shows, the lines its log
// shows, parsed back into the events they render, and the navigations a person makes, through the
// DevTools Protocol, as the sdk's router tier makes them.

/** The page's URL path and the tag of the element its router mounted in <main>. */
export const route = (page) =>
  page.evaluate(
    "({ path: location.pathname, tag: document.querySelector('main')?.firstElementChild?.localName ?? null })",
  );

/** Resolves once the expression is truthy in the page, to its value; rejects naming it after 10 s. */
export function until(page, expression, timeout = 10_000) {
  return page.evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + ${timeout};
    const poll = () => {
      const value = (${expression});
      if (value) resolve(value);
      else if (performance.now() > deadline) reject(new Error(${JSON.stringify(`not within ${timeout} ms: ${expression}`)}));
      else setTimeout(poll, 25);
    };
    poll();
  })`);
}

/** Resolves once the page's router has mounted `tag`. */
export const mounted = (page, tag) =>
  until(
    page,
    `document.querySelector('main')?.firstElementChild?.localName === ${JSON.stringify(tag)}`,
  );

/** A stage line as the log writes it: the event's time, type, and subject, then its data. */
const stageLine =
  /^(?<time>\S*) (?<type>\S+) run (?<subject>\S+): (?<stage>\S+) \((?<position>\d+)\/(?<stage_count>\d+)\) of document (?<document_id>\S+)$/;

/** The log's lines: each event line's cursor and the event it renders, and each failure's text. */
export async function lines(page) {
  const items = await page.evaluate(
    "[...document.querySelectorAll('pipeline-log li')].map((li) => ({ cursor: li.dataset.cursor ?? null, error: li.className === 'error', text: li.textContent }))",
  );
  return items.map(({ cursor, error, text }) => {
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
export async function linesOnce(page, count) {
  await until(page, `document.querySelectorAll('pipeline-log li').length >= ${count}`);
  return lines(page);
}

/** Clicks the nav link with the text, as a mouse does, at its center. */
export async function click(page, text) {
  const { x, y } = await page.evaluate(`(() => {
    const link = [...document.querySelectorAll('nav a')].find((a) => a.textContent === ${JSON.stringify(text)});
    const box = link.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

/** Goes back (-1) or forward (+1) through the browser, as its buttons do. */
export async function traverse(page, delta) {
  const { currentIndex, entries } = await page.cdp("Page.getNavigationHistory");
  await page.cdp("Page.navigateToHistoryEntry", { entryId: entries[currentIndex + delta].id });
}

/** Reloads the page, as the browser's button does, resolving once the new document has loaded. */
export async function reload(page) {
  const loaded = new Promise((resolve) => page.on("Page.loadEventFired", resolve));
  await page.cdp("Page.reload");
  await loaded;
}

/** Opens a blank page, runs `prepare` on it (enabling a protocol domain, say), then loads `url`. */
export async function openWith(browser, url, prepare) {
  const page = await browser.open("about:blank");
  await prepare(page);
  await page.goto(url);
  return page;
}
