// The chat view in the binary's build, over the emulator's conversations: Enter in the composer
// sends and clears it, Shift+Enter adds a line and sends nothing; a reply streams into the thread
// word by word with the composer busy, then idle, and joins the emulator's history; Stop, and
// Escape in the composer, abort a reply mid-stream, which shows incomplete and stops growing, the
// composer keeping focus on Escape; Escape outside any field stops one too, and Escape in the
// composer with nothing streaming leaves the field; /fail shows the failed item with the
// failure's message; the thread survives leaving the chat and coming back, and a reload, which
// reads the history back; the thread follows the newest item unless the reader has scrolled up;
// and a send the network fails shows its trouble with Try again, which sends it. Each case opens
// its own tab, so its sessionStorage, and its conversation, start empty; the cases share one
// emulator whose replies stream a word every 80 ms, so a reply takes about 3.5 s.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { launch, until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Browser, Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { click, mounted, openWith, reload, resize } from "./support/app.ts";
import { clickAt } from "./support/documents.ts";
import { start } from "./support/emulator.ts";
import type { Emulator } from "./support/emulator.ts";
import { pressEnter, pressEscape } from "./support/keys.ts";

/** The emulator's scripted reply, domain/conversation's Script. */
const SCRIPT =
  "Hello from the emulator. This reply is scripted: it streams one word at a time, on a timer, " +
  "the way a model's reply arrives, so a client can render it as it comes and fold the events " +
  "into the response once it completes.";

/** The words the failure path streams before its error, domain/conversation's FailAfter. */
const FAIL_AFTER = 4;

let browser: Browser;
let emulator: Emulator;
const pages: Page[] = [];

before(async () => {
  browser = await launch();
  emulator = await start({ env: { EMULATOR_CONVERSATIONS_DELTA_INTERVAL: "80ms" } });
});
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
});
after(async () => {
  await browser?.close();
  await emulator?.stop();
});

/** Opens the chat view in a new tab; `prepare` runs on the blank page first. */
async function open(prepare: (page: Page) => Promise<void> = async () => {}): Promise<Page> {
  const page = await openWith(browser, `${emulator.origin}${emulator.base}chat`, prepare);
  pages.push(page);
  await mounted(page, "pipeline-chat");
  await until(page, `${COMPOSER}?.shadowRoot?.querySelector("textarea")`);
  return page;
}

const VIEW = "document.querySelector('pipeline-chat')";
const COMPOSER = `${VIEW}?.querySelector('sl-composer')`;
const FIELD = `${COMPOSER}.shadowRoot.querySelector('textarea')`;
const ACTION = `${COMPOSER}.shadowRoot.querySelector('button.action')`;
const THREAD = `${VIEW}.querySelector('sl-chat-thread').shadowRoot`;

/** An item of the thread as shown: its role, its status label, and its text. */
interface Shown {
  role: string;
  status: string | null;
  text: string;
}

/** The thread's items as it shows them. */
const items = (page: Page): Promise<Shown[]> =>
  page.evaluate(`[...${THREAD}.querySelectorAll(".thread > li")].map((li) => ({
    role: li.querySelector(".role")?.textContent ?? "",
    status: li.querySelector(".status")?.textContent ?? null,
    text: li.querySelector(".content")?.textContent.trim() ?? "",
  }))`);

/** The last item's text, as a page expression. */
const LAST_TEXT = `([...${THREAD}.querySelectorAll(".thread > li")].at(-1)?.querySelector(".content")?.textContent.trim() ?? "")`;

/** The last item's status label, as a page expression. */
const LAST_STATUS = `([...${THREAD}.querySelectorAll(".thread > li")].at(-1)?.querySelector(".status")?.textContent ?? null)`;

/** Focuses the composer's field and types the text into it, as an input method commits it. */
async function type(page: Page, text: string) {
  await page.evaluate(`${FIELD}.focus()`);
  await page.cdp("Input.insertText", { text });
}

/** Types the text and presses Enter. */
async function send(page: Page, text: string) {
  await type(page, text);
  await pressEnter(page);
}

/** The deepest focused element's tag, through the shadow roots, or "body". */
const FOCUSED = `(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el?.localName ?? "body";
})()`;

/** The conversation the emulator holds for the page's session: its history, as the API reads it. */
async function history(page: Page): Promise<{ role: string; text: string }[]> {
  const id: string = await page.evaluate(`sessionStorage.getItem("pipeline.conversation")`);
  assert.ok(id, "the session stored its conversation's id");
  const response = await fetch(`${emulator.origin}/api/conversations/${id}`);
  const { history } = (await response.json()) as {
    history: { role: string; content: { text: string }[] }[];
  };
  return history.map(({ role, content }) => ({ role, text: content.map((c) => c.text).join("") }));
}

/** The last item's role label, as a page expression. */
const LAST_ROLE = `([...${THREAD}.querySelectorAll(".thread > li")].at(-1)?.querySelector(".role")?.textContent ?? null)`;

/** Resolves once the reply has streamed `words` words, while it still streams. */
const streamed = (page: Page, words: number) =>
  until(
    page,
    `${COMPOSER}.busy && ${LAST_ROLE} === "Assistant" && ${LAST_TEXT}.split(/\\s+/).filter(Boolean).length >= ${words}`,
  );

describe("the composer's keys", () => {
  test("Enter sends and clears; Shift+Enter adds a line and sends nothing", async () => {
    const page = await open();
    await type(page, "first line");
    await pressEnter(page, true);
    await page.cdp("Input.insertText", { text: "second line" });
    assert.equal(await page.evaluate(`${COMPOSER}.value`), "first line\nsecond line");
    assert.deepEqual(await items(page), [], "Shift+Enter sent nothing");
    assert.equal(await page.evaluate(`${COMPOSER}.busy`), false);

    await pressEnter(page);
    await until(page, `${COMPOSER}.busy`);
    assert.equal(await page.evaluate(`${COMPOSER}.value`), "", "the composer cleared");
    assert.deepEqual((await items(page))[0], {
      role: "User",
      status: null,
      text: "first line\nsecond line",
    });
    await until(page, `!${COMPOSER}.busy`, 10_000);
  });

  test("Escape with nothing streaming leaves the field", async () => {
    const page = await open();
    await type(page, "a draft");
    assert.equal(await page.evaluate(FOCUSED), "textarea");
    await pressEscape(page);
    assert.equal(await page.evaluate(FOCUSED), "body");
    assert.equal(await page.evaluate(`${COMPOSER}.value`), "a draft", "the draft kept");
  });
});

describe("a reply", () => {
  test("streams in word by word with the composer busy, then idle, and joins the history", async (t) => {
    const page = await open();
    // Records, every 5 ms, each change of the last item's text and the composer's busy.
    await page.evaluate(`void (window.seen = [], setInterval(() => {
      const shown = { text: ${LAST_TEXT}, status: ${LAST_STATUS}, busy: ${COMPOSER}.busy };
      const last = window.seen.at(-1);
      if (!last || last.text !== shown.text || last.busy !== shown.busy || last.status !== shown.status)
        window.seen.push(shown);
    }, 5))`);
    await send(page, "What do the documents say?");
    await until(page, `${COMPOSER}.busy`);
    assert.equal(await page.evaluate(`${ACTION}.classList.contains("stop")`), true);
    await until(page, `!${COMPOSER}.busy && ${LAST_TEXT} === ${JSON.stringify(SCRIPT)}`, 10_000);
    const seen: { text: string; status: string | null; busy: boolean }[] =
      await page.evaluate("window.seen");
    const partial = seen.filter(
      ({ text, busy }) => busy && text !== "" && SCRIPT.startsWith(text) && text !== SCRIPT,
    );
    t.diagnostic(`${partial.length} intermediate states`);
    assert.ok(partial.length >= 2, `the reply grew in place: ${JSON.stringify(seen.slice(0, 5))}`);
    for (let i = 1; i < partial.length; i++)
      assert.ok(partial[i].text.length > partial[i - 1].text.length, "each state longer");
    assert.ok(
      partial.every(({ status }) => status === "Streaming"),
      "streaming while it grows",
    );
    // Idle once complete: send again, no status label.
    assert.equal(await page.evaluate(LAST_STATUS), null);
    assert.equal(await page.evaluate(`${ACTION}.classList.contains("stop")`), false);
    assert.deepEqual(await history(page), [
      { role: "user", text: "What do the documents say?" },
      { role: "assistant", text: SCRIPT },
    ]);
  });

  test("Stop aborts it mid-stream: it shows incomplete and stops growing", async () => {
    const page = await open();
    await send(page, "Stop me");
    await streamed(page, 3);
    await clickAt(page, ACTION);
    await until(page, `!${COMPOSER}.busy`);
    assert.equal(await page.evaluate(LAST_STATUS), "Incomplete");
    const stopped: string = await page.evaluate(LAST_TEXT);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await page.evaluate(LAST_TEXT), stopped, "nothing more arrived");
    assert.ok(stopped.length < SCRIPT.length && SCRIPT.startsWith(stopped));
    // The emulator never keeps a reply cut off.
    assert.deepEqual(await history(page), [{ role: "user", text: "Stop me" }]);
  });

  test("Escape in the composer aborts it mid-stream, and the field keeps focus", async () => {
    const page = await open();
    await send(page, "Escape me");
    await streamed(page, 3);
    await page.cdp("Input.insertText", { text: "next" });
    await pressEscape(page);
    await until(page, `!${COMPOSER}.busy`);
    assert.equal(await page.evaluate(LAST_STATUS), "Incomplete");
    assert.equal(await page.evaluate(FOCUSED), "textarea", "the field kept focus");
    assert.equal(await page.evaluate(`${COMPOSER}.value`), "next", "the next draft kept");
  });

  test("Escape outside any field aborts it mid-stream", async () => {
    const page = await open();
    await send(page, "Escape me from outside");
    await streamed(page, 2);
    await page.evaluate(`document.activeElement.blur(), ${FIELD}.blur()`);
    assert.equal(await page.evaluate(FOCUSED), "body");
    await pressEscape(page);
    await until(page, `!${COMPOSER}.busy`);
    assert.equal(await page.evaluate(LAST_STATUS), "Incomplete");
  });

  test("/fail shows the failed item with the failure's message", async () => {
    const page = await open();
    await send(page, "/fail");
    await until(page, `${LAST_STATUS} === "Failed"`, 10_000);
    assert.equal(await page.evaluate(`${COMPOSER}.busy`), false);
    const words = SCRIPT.split(" ").slice(0, FAIL_AFTER).join(" ");
    assert.equal(await page.evaluate(LAST_TEXT), words);
    const alert: string = await page.evaluate(
      `${VIEW}.querySelector('.chat-error[role="alert"]').textContent`,
    );
    assert.match(alert, /The reply failed\. The emulator failed this reply deliberately/);
    assert.deepEqual(await history(page), [{ role: "user", text: "/fail" }]);
  });
});

describe("the thread", () => {
  test("survives leaving the chat and coming back, and a reload", async () => {
    const page = await open();
    await send(page, "Remember this");
    await until(page, `!${COMPOSER}.busy && ${LAST_TEXT} === ${JSON.stringify(SCRIPT)}`, 10_000);
    await type(page, "an unsent draft");
    const before = await items(page);
    assert.equal(before.length, 2);

    await click(page, "Event log");
    await mounted(page, "pipeline-log");
    await click(page, "Chat");
    await mounted(page, "pipeline-chat");
    await until(page, `${THREAD}?.querySelectorAll(".thread > li").length === 2`);
    assert.deepEqual(await items(page), before);
    assert.equal(await page.evaluate(`${COMPOSER}.value`), "an unsent draft");

    // A reload reads the conversation back from the emulator by the id the session stored.
    await reload(page);
    await mounted(page, "pipeline-chat");
    await until(page, `${THREAD}?.querySelectorAll(".thread > li").length === 2`);
    assert.deepEqual(await items(page), before);
  });

  test("follows the newest item as a reply streams, unless the reader has scrolled up", async () => {
    const page = await open(async (page) => resize(page, 1280, 420));
    const MAIN = "document.querySelector('.workspace-main')";
    const gap = `(${MAIN}.scrollHeight - ${MAIN}.scrollTop - ${MAIN}.clientHeight)`;
    await send(page, "One");
    await until(page, `!${COMPOSER}.busy`, 10_000);
    await send(page, "Two");
    await streamed(page, 10);
    assert.ok(
      await page.evaluate(`${MAIN}.scrollHeight > ${MAIN}.clientHeight`),
      "the main pane scrolls",
    );
    assert.ok((await page.evaluate(gap)) <= 1, "at the end while it streams");
    // The reader scrolls up: the reply grows below, and the pane stays where they put it.
    await page.evaluate(`${MAIN}.scrollTop = 0`);
    await streamed(page, 20);
    assert.equal(await page.evaluate(`${MAIN}.scrollTop`), 0, "not yanked back");
    // Back at the end, it follows again.
    await page.evaluate(`${MAIN}.scrollTop = ${MAIN}.scrollHeight`);
    await streamed(page, 30);
    assert.ok((await page.evaluate(gap)) <= 1, "following again");
    await until(page, `!${COMPOSER}.busy`, 10_000);
    // The footer, the composer and its status line, meets the pane's bottom edge.
    const edge: { footer: number; main: number } = await page.evaluate(`({
      footer: ${VIEW}.querySelector(".chat-footer").getBoundingClientRect().bottom,
      main: ${MAIN}.getBoundingClientRect().bottom,
    })`);
    assert.ok(
      Math.abs(edge.main - edge.footer) <= 1,
      `the footer at the bottom: ${JSON.stringify(edge)}`,
    );
  });
});

describe("a send the network fails", () => {
  test("shows its trouble with Try again, which sends it", async () => {
    // The message's first request fails as a lost network does; the rest pass through.
    const page = await open(async (page) => {
      page.on("Fetch.requestPaused", ({ requestId }: { requestId: string }) => {
        void page.cdp("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
        void page.cdp("Fetch.disable");
      });
      await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*/messages" }] });
    });
    await send(page, "Are you there?");
    await until(page, `${VIEW}.querySelector(".chat-trouble")`);
    assert.match(
      await page.evaluate(`${VIEW}.querySelector(".chat-trouble").textContent`),
      /Couldn't send the message\.\s+Network error/,
    );
    assert.equal(await page.evaluate(`${COMPOSER}.busy`), false);
    await clickAt(page, `${VIEW}.querySelector(".chat-trouble button")`);
    await until(page, `!${COMPOSER}.busy && ${LAST_TEXT} === ${JSON.stringify(SCRIPT)}`, 10_000);
    assert.equal(await page.evaluate(`${VIEW}.querySelector(".chat-trouble")`), null);
    // The user's message shows once, as the emulator holds it once.
    assert.deepEqual(
      (await items(page)).map(({ role }) => role),
      ["User", "Assistant"],
    );
    assert.deepEqual(await history(page), [
      { role: "user", text: "Are you there?" },
      { role: "assistant", text: SCRIPT },
    ]);
  });
});
