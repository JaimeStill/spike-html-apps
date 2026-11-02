// The browser tier's external client: its Vite build (mise run build:external), hosted apart on
// an origin of its own by the tooling's static server, with services.json beside it, the body each
// case sets, or none, a 404; and its panels as a page shows them, read from what their components'
// shadow roots render, and driven as a person drives them: files chosen through a panel's own
// dropzone, a query typed into its search field and submitted, an entry clicked.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";
import { serve } from "@jaimestill/spike-html-apps-tooling/server.js";

import { token } from "./emulator.ts";
import type { Emulator } from "./emulator.ts";

/** The client's build, which build:external writes. */
const dist = join(import.meta.dirname, "../../../apps/external/dist");

/** The client's host: its origin, the services.json it serves, and its stop. */
export interface Host {
  origin: string;
  /** Sets the body services.json answers, as served; undefined answers 404. */
  services(body: string | undefined): void;
  stop(): Promise<void>;
}

/** Hosts the client's build on a free loopback port: index.html for the page, its assets, and
 * services.json beside them, which answers 404 until `services` sets a body. */
export async function host(): Promise<Host> {
  let body: string | undefined;
  const server = await serve({
    root: dist,
    shell: "index.html",
    handler: (request, response) => {
      if (request.url?.split("?")[0] !== "/services.json" || body === undefined) return false;
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(body);
      return true;
    },
  });
  return {
    origin: server.origin,
    services: (next) => {
      body = next;
    },
    stop: () => server.stop(),
  };
}

/** services.json's text for the emulators, each by its name, with its API base, its WebSocket
 * URL, the stream, and the token the tier configures every emulator with. */
export const servicesOf = (services: [string, Emulator][]): string =>
  JSON.stringify({
    services: services.map(([name, emulator]) => ({
      name,
      apiBase: `${emulator.origin}/api`,
      nats: { url: emulator.wsURL, stream: "EMULATOR", token },
    })),
  });

/** The panel at `index`, in the page's order, as a page expression. */
export const panel = (index: number) => `document.querySelectorAll("external-panel")[${index}]`;

/** A component of the panel's, by its tag, as a page expression of its shadow root. */
const root = (index: number, tag: string) => `${panel(index)}.querySelector("${tag}").shadowRoot`;

/** Resolves once the panel shows its service: its first page loaded. */
export const panelReady = (page: Page, index: number): Promise<unknown> =>
  until(
    page,
    `${panel(index)}?.phase === "ready" && ${panel(index)}.querySelector("sl-document-list")?.state === "ready"`,
  );

/** What a failed panel shows: its heading, its problem's title, and why. */
export interface PanelFailure {
  heading: string;
  problem: string;
  reason: string;
}

/** Resolves to what the panel shows once it has failed. */
export async function panelFailed(page: Page, index: number): Promise<PanelFailure> {
  await until(page, `!!${panel(index)}?.querySelector(".panel-failed")`);
  return page.evaluate(`(() => {
    const panel = ${panel(index)};
    return {
      heading: panel.querySelector("h2").textContent.trim(),
      problem: panel.querySelector(".panel-problem").textContent.trim(),
      reason: panel.querySelector(".panel-reason").textContent.replace(/\\s+/g, " ").trim(),
    };
  })()`);
}

/** The client's error, the text of its alert, once it shows one. */
export async function clientError(page: Page): Promise<string> {
  await until(page, `!!document.querySelector(".client-error")`);
  return page.evaluate(
    `document.querySelector(".client-error").textContent.replace(/\\s+/g, " ").trim()`,
  );
}

/** The panel's heading's text. */
export const heading = (page: Page, index: number): Promise<string> =>
  page.evaluate(`${panel(index)}.querySelector("h2").textContent.trim()`);

/** The names of the documents the panel's list shows, in order. */
export const listed = (page: Page, index: number): Promise<string[]> =>
  page.evaluate(
    `[...${root(index, "sl-document-list")}.querySelectorAll("sl-entry")].map((e) => e.shadowRoot.querySelector(".name").textContent)`,
  );

/** The statuses of the documents the panel's list shows, by name. */
export const statuses = (page: Page, index: number): Promise<Record<string, string>> =>
  page.evaluate(
    `Object.fromEntries([...${root(index, "sl-document-list")}.querySelectorAll("sl-entry")].map((e) => [e.shadowRoot.querySelector(".name").textContent, e.shadowRoot.querySelector(".status").textContent]))`,
  );

/** Resolves once the panel's list shows a document named `name` with the status `status`. */
export const listedWith = (page: Page, index: number, name: string, status: string) =>
  until(
    page,
    `[...(${root(index, "sl-document-list")}?.querySelectorAll("sl-entry") ?? [])].some((e) => e.shadowRoot.querySelector(".name")?.textContent === ${JSON.stringify(name)} && e.shadowRoot.querySelector(".status")?.textContent === ${JSON.stringify(status)})`,
  );

/** An event as the panel's event log renders it: its type, source, and subject. */
export interface ShownEvent {
  type: string;
  source: string;
  subject: string;
}

/** The events the panel's log shows, in its order. */
export const logged = (page: Page, index: number): Promise<ShownEvent[]> =>
  page.evaluate(`[...${root(index, "sl-event-log")}.querySelectorAll("li.event")].map((li) => {
    const pair = (label) => {
      const dt = [...li.querySelectorAll(".meta dt")].find((dt) => dt.textContent === label);
      return dt ? dt.nextElementSibling.textContent : null;
    };
    return { type: li.querySelector(".type").textContent, source: pair("source"), subject: pair("subject") };
  })`);

/** Resolves to the events the panel's log shows once it shows `count` of the run's. */
export async function loggedFor(
  page: Page,
  index: number,
  run: string,
  count: number,
): Promise<ShownEvent[]> {
  await until(
    page,
    `[...(${root(index, "sl-event-log")}?.querySelectorAll("li.event") ?? [])].filter((li) => li.textContent.includes(${JSON.stringify(run)})).length >= ${count}`,
  );
  return logged(page, index);
}

/** An upload as the panel's dropzone renders it: its name and state, and an uploading one's bar. */
export interface ShownUpload {
  name: string;
  state: string;
}

/** The uploads the panel's dropzone shows, in order. */
export const uploads = (page: Page, index: number): Promise<ShownUpload[]> =>
  page.evaluate(`[...${root(index, "sl-upload-dropzone")}.querySelectorAll("li.upload")].map((li) => ({
    name: li.querySelector(".name").textContent,
    state: ["uploading", "done", "failed", "cancelled"].find((s) => li.classList.contains(s)),
  }))`);

/** Records, inside the page, each upload's bar values in the panel as it renders them, every 5
 * ms, into `window.sampled[index]`, by the upload's name. */
export const sample = (page: Page, index: number): Promise<unknown> =>
  page.evaluate(`void ((window.sampled ??= {})[${index}] = {}, setInterval(() => {
    for (const li of ${root(index, "sl-upload-dropzone")}.querySelectorAll("li.upload")) {
      const bar = li.querySelector("progress");
      const seen = (window.sampled[${index}][li.querySelector(".name").textContent] ??= []);
      if (bar && seen.at(-1) !== bar.value) seen.push(bar.value);
    }
  }, 5))`);

/** The bar values `sample` recorded for the panel's upload named. */
export const sampled = async (page: Page, index: number, name: string): Promise<number[]> =>
  (await page.evaluate(`window.sampled[${index}][${JSON.stringify(name)}] ?? []`)) as number[];

/** The directory the files chosen in this process are written to, removed as the process exits;
 * a chosen file stays on disk while the page may still read it, as support/documents.ts's choose
 * keeps its own. */
let chosen: string | undefined;

/** Chooses a file of `size` bytes named `name` through the panel's dropzone's file input, as its
 * picker sets it. */
export async function choose(page: Page, index: number, name: string, size: number) {
  if (chosen === undefined) {
    const made = mkdtempSync(join(tmpdir(), "browser-external."));
    process.on("exit", () => rmSync(made, { recursive: true, force: true }));
    chosen = made;
  }
  const dir = mkdtempSync(join(chosen, "choice."));
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(size, 97));
  const { result } = await page.cdp("Runtime.evaluate", {
    expression: `${root(index, "sl-upload-dropzone")}.querySelector("input[type=file]")`,
  });
  await page.cdp("DOM.setFileInputFiles", { files: [path], objectId: result.objectId });
}

/** Types the query into the panel's search field and submits it, as Enter does. */
export const search = (page: Page, index: number, q: string): Promise<unknown> =>
  page.evaluate(`(() => {
    const form = ${panel(index)}.querySelector("form.panel-search");
    form.elements.q.value = ${JSON.stringify(q)};
    form.requestSubmit();
  })()`);

/** The panel's search results once they answer `q`: their status line and the matches' names. */
export async function searched(
  page: Page,
  index: number,
  q: string,
): Promise<{ status: string; names: string[] }> {
  const results = `${panel(index)}.querySelector("sl-search-results")`;
  await until(page, `${results}.query === ${JSON.stringify(q)} && ${results}.state === "ready"`);
  return page.evaluate(`(() => {
    const root = ${results}.shadowRoot;
    return {
      status: root.querySelector(".status").textContent.replace(/\\s+/g, " ").trim(),
      names: [...root.querySelectorAll("button.match .name")].map((name) => name.textContent),
    };
  })()`);
}

/** Clicks the panel's list entry for the document named, as a mouse does, at its center. */
export async function clickEntry(page: Page, index: number, name: string): Promise<void> {
  const { x, y }: { x: number; y: number } = await page.evaluate(`(() => {
    const entry = [...${root(index, "sl-document-list")}.querySelectorAll("sl-entry")].find((e) => e.item?.name === ${JSON.stringify(name)});
    const button = entry.shadowRoot.querySelector("button");
    button.scrollIntoView({ block: "center" });
    const box = button.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

/** The panel's stage timeline's stages as it renders them, each its name and its state, in order;
 * none while it shows no timeline. */
export const timeline = (page: Page, index: number): Promise<{ name: string; state: string }[]> =>
  page.evaluate(`[...(${panel(index)}.querySelector("sl-stage-timeline")?.shadowRoot.querySelectorAll("li") ?? [])].map((li) => ({
    name: li.dataset.name,
    state: ["pending", "active", "complete", "failed"].find((s) => li.classList.contains(s)),
  }))`);
