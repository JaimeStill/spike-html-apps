// The live event log, the "/" route: each run's stage events as text lines as they arrive. The
// element reads while it is connected and stops when the router replaces it. It keeps the cursor
// of the last event it showed in sessionStorage, so a reload, or a return to the route, continues
// the sequence after it with no gap and no duplicate; a tab that has shown none reads from the
// oldest event the stream keeps.

import type { Cursor, EventSequence } from "@jaimestill/spike-html-apps-sdk/events.js";

/** The stage event's type: the emulator's nats.prefix ("emulator", its config's default) and the
 * run domain's run.stage. */
export const stageType = "emulator.run.stage";

/** A stage event's data, as the run domain's StageCompletedData writes it. */
interface StageData {
  stage: string;
  position: number;
  stage_count: number;
  document_id: string;
}

/** The sessionStorage key of the last cursor the log showed. */
export const cursorKey = "pipeline-log.cursor";

/** The stored cursor, or undefined when there is none or storage is unavailable. It came from the
 * sequence the log reads, so it passes back as one, as the adapter's Cursor says. */
function storedCursor(): Cursor | undefined {
  try {
    return (sessionStorage.getItem(cursorKey) ?? undefined) as Cursor | undefined;
  } catch {
    return undefined;
  }
}

/** Stores the cursor, or with undefined removes it; storage that is unavailable keeps nothing, and
 * a reload then starts from the oldest event. */
function storeCursor(cursor: Cursor | undefined) {
  try {
    if (cursor === undefined) sessionStorage.removeItem(cursorKey);
    else sessionStorage.setItem(cursorKey, cursor);
  } catch {
    // Nothing to keep the cursor in.
  }
}

/** The sequence the log reads, set by main before the router mounts the element. */
let events: EventSequence<StageData> | undefined;

/** Sets the sequence every log element reads. */
export function useEvents(sequence: EventSequence<StageData>) {
  events = sequence;
}

export class PipelineLog extends HTMLElement {
  #abort: AbortController | undefined;

  connectedCallback() {
    const heading = document.createElement("h1");
    heading.textContent = "Run stages";
    const list = document.createElement("ol");
    this.replaceChildren(heading, list);
    this.#abort = new AbortController();
    void this.#read(list, this.#abort.signal);
  }

  disconnectedCallback() {
    this.#abort?.abort();
  }

  async #read(list: HTMLOListElement, signal: AbortSignal) {
    if (!events) throw new Error("useEvents wasn't called before the log mounted");
    const after = storedCursor();
    let shown = 0;
    try {
      for await (const { event, cursor } of events.read({ types: [stageType], after, signal })) {
        const item = document.createElement("li");
        // The cursor marks the line, so a reader of the page can tell where the sequence stands.
        item.dataset.cursor = cursor;
        const data = event.data;
        const head = `${event.time ?? ""} ${event.type} run ${event.subject ?? "?"}`;
        item.textContent = data
          ? `${head}: ${data.stage} (${data.position}/${data.stage_count}) ` +
            `of document ${data.document_id}`
          : head;
        list.append(item);
        storeCursor(cursor);
        shown++;
      }
    } catch (error) {
      // A stored cursor the stream never gave out (the emulator restarted with a new store, say)
      // fails the read before it shows anything, and every read from it after; forgetting it lets
      // a reload start again from the oldest.
      if (after !== undefined && shown === 0) storeCursor(undefined);
      const item = document.createElement("li");
      item.className = "error";
      item.textContent = `the event read failed: ${String(error)}`;
      list.append(item);
    }
  }
}
