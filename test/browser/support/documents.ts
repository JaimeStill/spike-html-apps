// The browser tier's reading and driving of the side pane's documents (<pipeline-documents>): the
// uploads the dropzone lists and the entries the document list shows, read from what their shadow
// roots render; files chosen through the dropzone's own file input, as the picker sets it, or
// dropped on its zone; a slowed upload, by the DevTools Protocol's network conditions; and a click
// at an element's center, as a mouse makes it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { until } from "@jaimestill/spike-html-apps-tooling/browser.js";
import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

/** The dropzone's shadow root, as a page expression. */
const ZONE = "document.querySelector('pipeline-documents sl-upload-dropzone').shadowRoot";

/** The document list's shadow root, as a page expression. */
export const LIST = "document.querySelector('pipeline-documents sl-document-list').shadowRoot";

/** The list's pagination's shadow root, as a page expression. */
export const PAGINATION = `${LIST}.querySelector('sl-pagination').shadowRoot`;

/** An upload as the dropzone renders it: its name, its state (its row's class), its finished
 * label, a failed one's message, and an uploading one's bar. */
export interface ShownUpload {
  name: string;
  state: string;
  label: string | null;
  message: string | null;
  sent: number | null;
  max: number | null;
}

/** An entry as the list renders it: its name and status, and whether its item is current. */
export interface ShownEntry {
  name: string;
  status: string;
  current: boolean;
}

/** The uploads the dropzone shows, in order. */
export const uploads = (page: Page): Promise<ShownUpload[]> =>
  page.evaluate(`[...${ZONE}.querySelectorAll("li.upload")].map((li) => {
    const bar = li.querySelector("progress");
    return {
      name: li.querySelector(".name").textContent,
      state: ["uploading", "done", "failed", "cancelled"].find((s) => li.classList.contains(s)),
      label: li.querySelector(".state")?.textContent.trim() ?? null,
      message: li.querySelector(".message")?.textContent ?? null,
      sent: bar ? bar.value : null,
      max: bar ? bar.max : null,
    };
  })`);

/** The entries the list shows, in order. */
export const entries = (page: Page): Promise<ShownEntry[]> =>
  page.evaluate(`[...${LIST}.querySelectorAll("li")].map((li) => {
    const root = li.querySelector("sl-entry").shadowRoot;
    return {
      name: root.querySelector(".name").textContent,
      status: root.querySelector(".status").textContent,
      current: li.getAttribute("aria-current") === "true",
    };
  })`);

/** The list's status line's text, trimmed, and the pagination's summary's, null when it shows
 * none. */
export const listStatus = (page: Page): Promise<{ status: string; summary: string | null }> =>
  page.evaluate(`({
    status: ${LIST}.querySelector(".status").textContent.replace(/\\s+/g, " ").trim(),
    summary: ${PAGINATION}.querySelector(".summary")?.textContent.replace(/\\s+/g, " ").trim() ?? null,
  })`);

/** Resolves once the list is ready: its first page loaded, or the one it was turned to. */
export const listReady = (page: Page): Promise<unknown> =>
  until(page, `document.querySelector('pipeline-documents sl-document-list')?.state === "ready"`);

/** Resolves once the list shows `count` entries. */
export const entriesShown = (page: Page, count: number): Promise<unknown> =>
  until(page, `${LIST}.querySelectorAll("li").length === ${count}`);

/** A file to choose or drop: its name, its bytes' count (or its text), and its type. */
export interface FileSpec {
  name: string;
  size?: number;
  text?: string;
  type?: string;
}

/** Chooses the files through the dropzone's file input, as its picker sets them: each written to
 * a directory of its own, removed once the input holds them. */
export async function choose(page: Page, files: FileSpec[]): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "browser-upload."));
  try {
    const paths = files.map(({ name, size = 0, text }) => {
      const path = join(dir, name);
      writeFileSync(path, text ?? Buffer.alloc(size, 97));
      return path;
    });
    const { result } = await page.cdp("Runtime.evaluate", {
      expression: `${ZONE}.querySelector("input[type=file]")`,
    });
    await page.cdp("DOM.setFileInputFiles", { files: paths, objectId: result.objectId });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Drops the files on the dropzone's zone, as a drag from the desktop ends. */
export async function drop(page: Page, files: FileSpec[]): Promise<void> {
  await page.evaluate(`(() => {
    const transfer = new DataTransfer();
    for (const { name, size = 0, text, type = "" } of ${JSON.stringify(files)}) {
      transfer.items.add(new File([text ?? "a".repeat(size)], name, { type }));
    }
    const zone = ${ZONE}.querySelector(".zone");
    for (const type of ["dragenter", "dragover", "drop"]) {
      zone.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, composed: true, cancelable: true }));
    }
  })()`);
}

/** Slows the page's uploads to `bytesPerSecond`, or with none lifts the limit. */
export async function throttle(page: Page, bytesPerSecond?: number): Promise<void> {
  await page.cdp("Network.enable");
  await page.cdp("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: bytesPerSecond ?? -1,
  });
}

/** Clicks the element the expression names at its center, as a mouse does, scrolled into view
 * first. */
export async function clickAt(page: Page, element: string): Promise<void> {
  const { x, y }: { x: number; y: number } = await page.evaluate(`(() => {
    const element = ${element};
    element.scrollIntoView({ block: "center" });
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

/** The dropzone's cancel control for the upload named, as a page expression. */
export const cancelOf = (name: string): string =>
  `${ZONE}.querySelector(${JSON.stringify(`button[aria-label="Cancel ${name}"]`)})`;

/** The list's entry button for the document named, as a page expression. */
export const entryOf = (name: string): string =>
  `[...${LIST}.querySelectorAll("sl-entry")].find((e) => e.item?.name === ${JSON.stringify(name)}).shadowRoot.querySelector("button")`;
