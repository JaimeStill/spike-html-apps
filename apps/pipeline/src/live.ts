// The app's one live read of the emulator's run events, its stage events and its failure events,
// which every view that shows a run's progress shares: main makes the feed over the NATS sequence
// and starts it once, and a view listens to it rather than reading the sequence itself, so the app
// holds one subscription however many views show runs. The side pane's document list and the
// document view's stage timeline read each run's progress from it, and the event log the
// deliveries it keeps, which a view mounted late replays before it follows the live ones.
//
// The read starts where main tells it: after the cursor the event log last showed in this tab, so
// a reload resumes the log's sequence with no gap and no duplicate, or, with none, at the oldest
// event the stream keeps. Either way the feed learns a run's progress from its events and from the
// API's answer for it (note), and each run's completed count only ever rises, so an event and an
// API answer arriving in either order agree, and a run whose earlier events came before the
// cursor is known by its answer. A stage event's position is the stage's own, not a count of the
// events read, so a read that starts mid-run still raises the run to it. A run's failure is
// recorded beside its progress, from the failure event or from an API answer of a failed run,
// whichever arrives first, the two telling the same stage, reason, and time; a failure is
// terminal, so nothing later, an event or an answer read before it failed, un-fails the run or
// raises its progress past the failed stage. When the read fails (the connection lost for good,
// the token refused), the feed says so and reads again after a backoff, from the last cursor it
// delivered, or its start, with no gap and no duplicate. A start cursor the stream never gave out
// (the tab's, kept from a stream before an emulator restart) is no failure to wait out: the read
// fails before it delivers anything, so the feed forgets the cursor and reads again at once from
// the oldest event the stream keeps, which nothing shown can duplicate, and says it restarted.

import { UnknownCursorError } from "@jaimestill/spike-html-apps-sdk/events.js";
import type {
  CloudEvent,
  Cursor,
  Delivery,
  EventSequence,
} from "@jaimestill/spike-html-apps-sdk/events.js";

import type { Run } from "./api.ts";

/** The stage event's type: the emulator's nats.prefix ("emulator", its config's default) and the
 * run domain's run.stage. */
export const stageType = "emulator.run.stage";

/** The failure event's type: the same prefix and the run domain's run.failed, which the run
 * publishes in place of the stage event of the stage it failed at. */
export const failedType = "emulator.run.failed";

/** A stage event's data, as the run domain's StageCompletedData writes it. */
export interface StageData {
  stage: string;
  position: number;
  stage_count: number;
  document_id: string;
}

/** A failure event's data, as the run domain's RunFailedData writes it: the failed stage's, as a
 * stage event's data would be, with why it failed. */
export interface FailedData extends StageData {
  reason: string;
}

/** The data of either event the feed reads; the event's type tells which. */
export type RunData = StageData | FailedData;

/** The failure event's data, or undefined when the event is any other or carries none. */
export function failedData(event: CloudEvent<RunData>): FailedData | undefined {
  return event.type === failedType && event.data && "reason" in event.data ? event.data : undefined;
}

/** A run's progress: how many of its stages are complete, of how many. */
export interface Progress {
  completed: number;
  count: number;
}

/** A run's failure: the stage it failed at, that stage's position of how many, why, and when (an
 * RFC 3339 timestamp, null when neither the event nor the answer told it). */
export interface Failure {
  stage: string;
  position: number;
  count: number;
  reason: string;
  time: string | null;
}

/** `progress`'s and `run-failed`'s detail: the run whose progress rose, or that failed. */
export interface ProgressDetail {
  run: string;
}

/** The waits between a failed read and the next, in ms, the last repeated. */
const backoff = [1_000, 2_000, 5_000, 10_000, 30_000];

/** How long a read runs without failing before the feed takes it for reconnected, in ms. */
const settle = 2_000;

/**
 * The live feed. It dispatches `delivery` with each delivery's CustomEvent, `progress` with a
 * ProgressDetail when a run's completed count rises, `run-failed` with a ProgressDetail when a run
 * fails, once a run, `failure` when the read fails or recovers, `failure` then holding the
 * error or undefined, and `restart` when it forgets a start cursor the stream never gave out and
 * reads from the oldest event, `restarted` then true. The two failures are named apart: `failure`
 * is the feed's own, its read lost, and `run-failed` a run's, which the emulator reports.
 */
export class StageFeed extends EventTarget {
  readonly #sequence: EventSequence<RunData>;
  readonly #deliveries: Delivery<RunData>[] = [];
  readonly #progress = new Map<string, Progress>();
  readonly #failures = new Map<string, Failure>();
  #failure: unknown = undefined;
  #cursor: Cursor | undefined;
  #started = false;
  #restarted = false;

  /** The feed over the sequence, reading from after the cursor `after`, or with none from the
   * oldest event the stream keeps. */
  constructor(sequence: EventSequence<RunData>, after?: Cursor) {
    super();
    this.#sequence = sequence;
    this.#cursor = after;
  }

  /** Every delivery so far, from the feed's start, in the sequence's order. */
  get deliveries(): readonly Delivery<RunData>[] {
    return this.#deliveries;
  }

  /** The error of the read that last failed, while the feed waits to read again; undefined while
   * it reads. */
  get failure(): unknown {
    return this.#failure;
  }

  /** Whether the feed forgot the cursor it started after, one the stream never gave out, and reads
   * from the oldest event the stream keeps instead. */
  get restarted(): boolean {
    return this.#restarted;
  }

  /** The run's progress, or undefined when neither an event nor the API has told of it. */
  progress(run: string): Progress | undefined {
    return this.#progress.get(run);
  }

  /** The run's failure, or undefined while neither an event nor the API has told of one. */
  failed(run: string): Failure | undefined {
    return this.#failures.get(run);
  }

  /** Takes the API's answer for a run: its stages complete so far, and its failure, when it has
   * failed. */
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
    // A failed run completes nothing from its failed stage on.
    const failure = this.#failures.get(run);
    if (failure && completed >= failure.position) return;
    this.#progress.set(run, { completed, count });
    this.dispatchEvent(new CustomEvent<ProgressDetail>("progress", { detail: { run } }));
  }

  /** Records the run's failure, the first told of it kept: the event and the answer tell the same
   * one, and a failure is terminal. */
  #failRun(run: string, failure: Failure) {
    if (this.#failures.has(run)) return;
    this.#failures.set(run, failure);
    this.dispatchEvent(new CustomEvent<ProgressDetail>("run-failed", { detail: { run } }));
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
            // The stages before the failed one completed; their own events told so already.
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
        // Only the start cursor: one the feed delivered came from this stream. Every other failure,
        // the connection's or the token's among them, is waited out and read again from the cursor.
        if (this.#deliveries.length === 0 && error instanceof UnknownCursorError) {
          // Nothing is delivered yet, so the oldest event duplicates none; the loop's next attempt
          // is the first again, and its settling clears any failure an earlier attempt reported.
          this.#cursor = undefined;
          this.#restarted = true;
          this.dispatchEvent(new Event("restart"));
          attempt = -1;
          continue;
        }
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
