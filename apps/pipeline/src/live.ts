// The app's one live read of the emulator's stage events, which every view that shows a run's
// progress shares: main makes the feed over the NATS sequence and starts it once, and a view
// listens to it rather than reading the sequence itself, so the app holds one subscription however
// many views show runs. Today the side pane's document list reads each run's progress from it; the
// document view's stage timeline (slice 14) and the event log (slice 16) are meant to read it too,
// the first by a run's progress, the second by the deliveries it keeps, which a view mounted late
// replays before it follows the live ones.
//
// The read starts at the oldest event the stream keeps, so the feed knows every kept run's
// progress, whatever loaded first; a run's progress also takes the API's answer for it (note), and
// each run's completed count only ever rises, so an event and an API answer arriving in either
// order agree. When the read fails (the connection lost for good, the token refused), the feed
// says so and reads again after a backoff, from the last cursor it delivered, with no gap and no
// duplicate.

import type { Cursor, Delivery, EventSequence } from "@jaimestill/spike-html-apps-sdk/events.js";

import type { Run } from "./api.ts";

/** The stage event's type: the emulator's nats.prefix ("emulator", its config's default) and the
 * run domain's run.stage. */
export const stageType = "emulator.run.stage";

/** A stage event's data, as the run domain's StageCompletedData writes it. */
export interface StageData {
  stage: string;
  position: number;
  stage_count: number;
  document_id: string;
}

/** A run's progress: how many of its stages are complete, of how many. */
export interface Progress {
  completed: number;
  count: number;
}

/** `progress`'s detail: the run whose progress rose. */
export interface ProgressDetail {
  run: string;
}

/** The waits between a failed read and the next, in ms, the last repeated. */
const backoff = [1_000, 2_000, 5_000, 10_000, 30_000];

/** How long a read runs without failing before the feed takes it for reconnected, in ms. */
const settle = 2_000;

/**
 * The live feed. It dispatches `delivery` with each delivery's CustomEvent, `progress` with a
 * ProgressDetail when a run's completed count rises, and `failure` when the read fails or recovers,
 * `failure` then holding the error or undefined.
 */
export class StageFeed extends EventTarget {
  readonly #sequence: EventSequence<StageData>;
  readonly #deliveries: Delivery<StageData>[] = [];
  readonly #progress = new Map<string, Progress>();
  #failure: unknown = undefined;
  #cursor: Cursor | undefined;
  #started = false;

  constructor(sequence: EventSequence<StageData>) {
    super();
    this.#sequence = sequence;
  }

  /** Every delivery so far, in the sequence's order. */
  get deliveries(): readonly Delivery<StageData>[] {
    return this.#deliveries;
  }

  /** The error of the read that last failed, while the feed waits to read again; undefined while
   * it reads. */
  get failure(): unknown {
    return this.#failure;
  }

  /** The run's progress, or undefined when neither an event nor the API has told of it. */
  progress(run: string): Progress | undefined {
    return this.#progress.get(run);
  }

  /** Takes the API's answer for a run: its stages complete so far. */
  note(run: Run) {
    const completed = run.stages.filter((stage) => stage.state === "complete").length;
    this.#rise(run.id, completed, run.stages.length);
  }

  /** Starts the one read, once; a later call does nothing. The signal ends it for good. */
  start(signal?: AbortSignal) {
    if (this.#started) return;
    this.#started = true;
    void this.#run(signal);
  }

  #rise(run: string, completed: number, count: number) {
    const known = this.#progress.get(run);
    if (known && known.completed >= completed) return;
    this.#progress.set(run, { completed, count });
    this.dispatchEvent(new CustomEvent<ProgressDetail>("progress", { detail: { run } }));
  }

  #fail(error: unknown) {
    if (this.#failure === error) return;
    this.#failure = error;
    this.dispatchEvent(new Event("failure"));
  }

  async #run(signal?: AbortSignal) {
    for (let attempt = 0; !signal?.aborted; attempt++) {
      // A read that runs a while without failing, or delivers, has reconnected.
      const settled = setTimeout(() => this.#fail(undefined), attempt === 0 ? 0 : settle);
      try {
        const reads = this.#sequence.read({ types: [stageType], after: this.#cursor, signal });
        for await (const delivery of reads) {
          clearTimeout(settled);
          this.#fail(undefined);
          attempt = 0;
          this.#cursor = delivery.cursor;
          this.#deliveries.push(delivery);
          this.dispatchEvent(new CustomEvent("delivery", { detail: delivery }));
          const { subject, data } = delivery.event;
          if (subject && data) this.#rise(subject, data.position, data.stage_count);
        }
        // A read ends without failing only when its signal aborts.
        clearTimeout(settled);
        return;
      } catch (error) {
        clearTimeout(settled);
        if (signal?.aborted) return;
        this.#fail(error);
        const wait = backoff[Math.min(attempt, backoff.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
}

let feed: StageFeed | undefined;

/** Sets the feed every view reads; main calls it before the workspace renders. */
export function useFeed(started: StageFeed) {
  feed = started;
}

/** The feed main set; throws when a view reads before useFeed was called. */
export function appFeed(): StageFeed {
  if (!feed) throw new Error("useFeed wasn't called before a view read the feed");
  return feed;
}
