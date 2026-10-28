// The live event log, the "/" route: each run's stage events as text lines as they arrive, from
// the oldest the stream keeps. The element reads while it is connected and stops when the router
// replaces it.

import type { EventSequence } from "@jaimestill/spike-html-apps-sdk/events.js";

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
    try {
      for await (const { event } of events.read({ types: [stageType], signal })) {
        const item = document.createElement("li");
        const data = event.data;
        item.textContent = data
          ? `${event.time ?? ""} run ${event.subject ?? "?"}: ${data.stage} ` +
            `(${data.position}/${data.stage_count}) of document ${data.document_id}`
          : `${event.time ?? ""} run ${event.subject ?? "?"}: ${event.type}`;
        list.append(item);
      }
    } catch (error) {
      const item = document.createElement("li");
      item.textContent = `the event read failed: ${String(error)}`;
      list.append(item);
    }
  }
}
