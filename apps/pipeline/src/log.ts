// The live event log, the "/" route: each run's stage events as text lines as they arrive, until
// slice 16 shows the stream through sl-event-log. The element reads while it is connected and
// stops when the router replaces it. It keeps the cursor
// of the last event it showed in sessionStorage, so a reload, or a return to the route, continues
// the sequence after it with no gap and no duplicate; a tab that has shown none reads from the
// oldest event the stream keeps.

import { html, LitElement } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Cursor, EventSequence } from "@jaimestill/spike-html-apps-sdk/events.js";

import { frame } from "./views/view.ts";

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

/** A line of the log: an event's text and the cursor it was delivered at, or a failure's text. */
type Line = { key: number; text: string; cursor?: Cursor; error?: true };

export class PipelineLog extends LitElement {
  static properties = { lines: { state: true } };

  /** The lines shown, in arrival order. */
  declare lines: Line[];

  #abort: AbortController | undefined;

  constructor() {
    super();
    this.lines = [];
  }

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lines = [];
    this.#abort = new AbortController();
    void this.#read(this.#abort.signal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
  }

  render() {
    // The cursor marks each event line, so a reader of the page can tell where the sequence stands.
    return frame(
      "Event log",
      html`<ol class="log">
        ${repeat(
          this.lines,
          (line) => line.key,
          (line) =>
            line.error
              ? html`<li class="error">${line.text}</li>`
              : html`<li data-cursor=${line.cursor ?? ""}>${line.text}</li>`,
        )}
      </ol>`,
    );
  }

  #append(line: Omit<Line, "key">) {
    this.lines = [...this.lines, { key: this.lines.length, ...line }];
  }

  async #read(signal: AbortSignal) {
    if (!events) throw new Error("useEvents wasn't called before the log mounted");
    const after = storedCursor();
    let shown = 0;
    try {
      for await (const { event, cursor } of events.read({ types: [stageType], after, signal })) {
        const data = event.data;
        const head = `${event.time ?? ""} ${event.type} run ${event.subject ?? "?"}`;
        const text = data
          ? `${head}: ${data.stage} (${data.position}/${data.stage_count}) ` +
            `of document ${data.document_id}`
          : head;
        this.#append({ text, cursor });
        storeCursor(cursor);
        shown++;
      }
    } catch (error) {
      // The router replaced the log, which shows nothing more.
      if (signal.aborted) return;
      // A stored cursor the stream never gave out (the emulator restarted with a new store, say)
      // fails the read before it shows anything, and every read from it after; forgetting it lets
      // a reload start again from the oldest.
      if (after !== undefined && shown === 0) storeCursor(undefined);
      this.#append({ text: `the event read failed: ${String(error)}`, error: true });
    }
  }
}
