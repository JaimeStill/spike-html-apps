// A panel's live read of its service's run events, its stage events and its failure events: the
// panel makes one feed over its own NATS sequence and starts it once, and its document list, its
// stage timeline, and its event log all follow the feed, so a panel holds one subscription, on its
// own service's stream, and no event of another service's reaches it.
//
// The read starts at the oldest event the stream keeps, so a panel opened late shows every run
// event its service has kept. The feed learns a run's progress from its events and from the API's
// answer for it (note); each run's completed count only ever rises, so the two arriving in either
// order agree. A run's failure, from its failure event or from an answer of a failed run, whichever
// comes first, is terminal: nothing later raises the run past its failed stage. When the read fails
// (the connection refused or lost, the origin not admitted), the feed says so and reads again after
// a backoff, from the last cursor it delivered, or from the oldest, with no gap and no duplicate.
//
// The pipeline app's live.ts is the same feed over its one sequence, with a cursor the event log
// keeps across a reload; an app imports no other app, so this is the client's own copy, without
// the resume.

import type {
  CloudEvent,
  Cursor,
  Delivery,
  EventSequence,
} from "@jaimestill/spike-html-apps-sdk/events.js";

import type { Run } from "./api.ts";

/** The stage event's type: the emulator's nats.prefix, its default "emulator", and run.stage. */
export const stageType = "emulator.run.stage";

/** The failure event's type, which a run publishes in place of the stage event it failed at. */
export const failedType = "emulator.run.failed";

/** A stage event's data, as the run domain's StageCompletedData writes it. */
export interface StageData {
  stage: string;
  position: number;
  stage_count: number;
  document_id: string;
}

/** A failure event's data, as the run domain's RunFailedData writes it. */
export interface FailedData extends StageData {
  reason: string;
}

/** The data of either event the feed reads. */
export type RunData = StageData | FailedData;

/** A run's progress: how many of its stages are complete, of how many. */
export interface Progress {
  completed: number;
  count: number;
}

/** A run's failure: the stage it failed at, its position of how many, why, and when (null when
 * nothing told it). */
export interface Failure {
  stage: string;
  position: number;
  count: number;
  reason: string;
  time: string | null;
}

/** `progress`'s and `run-failed`'s detail: the run whose progress rose, or that failed. */
export interface RunDetail {
  run: string;
}

/** The failure event's data, or undefined for any other event. */
function failedData(event: CloudEvent<RunData>): FailedData | undefined {
  return event.type === failedType && event.data && "reason" in event.data ? event.data : undefined;
}

/** The waits between a failed read and the next, in ms, the last repeated. */
const backoff = [1_000, 2_000, 5_000, 10_000, 30_000];

/** How long a read runs without failing before the feed takes it for reconnected, in ms. */
const settle = 2_000;

/**
 * The live feed. It dispatches `delivery` with each delivery as a CustomEvent's detail, `progress`
 * with a RunDetail when a run's completed count rises, `run-failed` with a RunDetail when a run
 * fails, once a run, and `failure` when the read fails or recovers, `failure` then holding the
 * error or undefined.
 */
export class RunFeed extends EventTarget {
  readonly #sequence: EventSequence<RunData>;
  readonly #deliveries: Delivery<RunData>[] = [];
  readonly #progress = new Map<string, Progress>();
  readonly #failures = new Map<string, Failure>();
  #failure: unknown = undefined;
  #cursor: Cursor | undefined;
  #started = false;

  constructor(sequence: EventSequence<RunData>) {
    super();
    this.#sequence = sequence;
  }

  /** Every delivery so far, in the sequence's order. */
  get deliveries(): readonly Delivery<RunData>[] {
    return this.#deliveries;
  }

  /** The error of the read that last failed, while the feed waits to read again; undefined while
   * it reads. */
  get failure(): unknown {
    return this.#failure;
  }

  /** The run's progress, or undefined when nothing has told of it. */
  progress(run: string): Progress | undefined {
    return this.#progress.get(run);
  }

  /** The run's failure, or undefined while nothing has told of one. */
  failed(run: string): Failure | undefined {
    return this.#failures.get(run);
  }

  /** Each stage's completion time, by its position, from the run's stage events. */
  times(run: string): Map<number, string> {
    const times = new Map<number, string>();
    for (const { event } of this.#deliveries) {
      if (event.type === stageType && event.subject === run && event.data && event.time)
        times.set(event.data.position, event.time);
    }
    return times;
  }

  /** Takes the API's answer for a run: its stages complete so far, and its failure, if any. */
  note(run: Run) {
    const completed = run.stages.filter((stage) => stage.state === "complete").length;
    this.#rise(run.id, completed, run.stages.length);
    const stage = run.stages.find((stage) => stage.state === "failed");
    if (run.status === "failed" && stage) {
      this.#failRun(run.id, {
        stage: stage.name,
        position: stage.position,
        count: run.stages.length,
        reason: stage.reason ?? "",
        time: stage.failed_at,
      });
    }
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
    const failure = this.#failures.get(run);
    if (failure && completed >= failure.position) return;
    this.#progress.set(run, { completed, count });
    this.dispatchEvent(new CustomEvent<RunDetail>("progress", { detail: { run } }));
  }

  #failRun(run: string, failure: Failure) {
    if (this.#failures.has(run)) return;
    this.#failures.set(run, failure);
    this.dispatchEvent(new CustomEvent<RunDetail>("run-failed", { detail: { run } }));
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
        const reads = this.#sequence.read({
          types: [stageType, failedType],
          after: this.#cursor,
          signal,
        });
        for await (const delivery of reads) {
          clearTimeout(settled);
          this.#fail(undefined);
          attempt = 0;
          this.#cursor = delivery.cursor;
          this.#deliveries.push(delivery);
          this.dispatchEvent(new CustomEvent("delivery", { detail: delivery }));
          const { subject, data, time } = delivery.event;
          if (!subject || !data) continue;
          const failed = failedData(delivery.event);
          if (failed) {
            this.#rise(subject, failed.position - 1, failed.stage_count);
            this.#failRun(subject, {
              stage: failed.stage,
              position: failed.position,
              count: failed.stage_count,
              reason: failed.reason,
              time: time ?? null,
            });
          } else if (delivery.event.type === stageType) {
            this.#rise(subject, data.position, data.stage_count);
          }
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
