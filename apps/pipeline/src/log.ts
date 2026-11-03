// The live event log, the "/" route: the run events the app's one feed (live.ts) delivers, each
// run's stage events and a failed run's failure event, shown through the components'
// sl-event-log, which keeps each shown event in place as the next arrives. The log keeps no read
// of its own: it shows the feed's deliveries, those kept since the feed started, then each as it
// arrives, so mounting it, again or late, replays the feed's and opens no second subscription. The
// deliveries one frame hears are shown in one update, so a long stream's replay after a reload
// lays the log out once a frame, not once an event.
//
// The log keeps the cursor of the last event it showed in sessionStorage, and main starts the feed
// after it, so a reload, which loads a new document, shows the events after the last one this tab
// showed, with no gap and no duplicate; a tab that has shown none reads from the oldest event the
// stream keeps. Only what the log has shown moves the cursor: events the feed delivers while
// another view is mounted are shown when the log next mounts, in this document or the next. A
// stored cursor the stream never gave out, as after the emulator restarted with a new store, the
// feed forgets and reads from the oldest event at once, and the log forgets it too.
//
// The log fills the main pane, as the chat does, and holds sl-event-log to the height its header
// and status line leave, so the log's own frame scrolls and follows the newest event while the
// reader is at its end; the page stays put as events arrive. The status line above it says the
// log follows the stream live, and from where (the oldest event, when the stream restarted under
// the tab's cursor), or, while the feed's read has failed, why it is paused; it stays one line
// high whatever it says, so its text changing moves nothing below it.

import { html, LitElement } from "lit";

import "@jaimestill/spike-html-apps-components/event-log.js";
import type { LogEvent } from "@jaimestill/spike-html-apps-components/event-log.js";
import type { Cursor, Delivery } from "@jaimestill/spike-html-apps-sdk/events.js";

import { appFeed } from "./live.ts";
import type { RunData, StageFeed } from "./live.ts";

/** The event log view's tag, which the router mounts. */
export const logTag = "pipeline-log";

/** The sessionStorage key of the last cursor the log showed. */
export const cursorKey = "pipeline-log.cursor";

/** The stored cursor, or undefined when there is none or storage is unavailable. It came from the
 * sequence the feed reads, so it passes back as one, as the adapter's Cursor says. */
export function storedCursor(): Cursor | undefined {
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

/** The cursor the feed started after, which main read from storage; undefined from the oldest. */
let resumed: Cursor | undefined;

/**
 * Starts the feed main made after the stored cursor `after`. When the feed restarts from the
 * oldest event, the cursor one the stream never gave out, the stored one is forgotten with it, so
 * a reload before the log shows an event starts from the oldest too, rather than at the same
 * refusal. Any other failure keeps it: the read retries from it, and so does a reload, so a
 * failure that passes (the connection lost a moment) resumes with no gap and no duplicate.
 */
export function resumeFeed(feed: StageFeed, after: Cursor | undefined) {
  resumed = after;
  feed.addEventListener("restart", () => storeCursor(undefined), { once: true });
  feed.start();
}

/** The event as the log shows it: the delivery's CloudEvent as it is, its time optional in both,
 * so an event without one, which the emulator never publishes, shows its type alone. */
const logged = ({ event }: Delivery<RunData>): LogEvent => event;

/** What the status line says while the feed reads: that the log is live, and from where; a
 * restart is said plainly, as no failure, since the log misses nothing for it. */
function following(feed: StageFeed): string {
  if (feed.restarted)
    return "The stream restarted; following the run events live, from the oldest it keeps.";
  return resumed === undefined
    ? "Following the run events live, from the oldest the stream keeps."
    : "Following the run events live, after the last one this tab showed.";
}

class PipelineLog extends LitElement {
  static properties = {
    events: { state: true },
    following: { state: true },
    paused: { state: true },
  };

  /** The events shown, the feed's deliveries in its order. */
  declare events: readonly LogEvent[];
  /** What the status line says while the feed reads. */
  declare following: string;
  /** Why the feed's read is paused, while it is; empty while it reads. */
  declare paused: string;

  #disconnect: AbortController | undefined;
  /** The deliveries heard since the last frame, shown together at the next. */
  #pending: Delivery<RunData>[] = [];
  /** The frame that shows them, while one is requested. */
  #frame = 0;

  constructor() {
    super();
    this.events = [];
    this.following = "";
    this.paused = "";
  }

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    const feed = appFeed();
    this.events = feed.deliveries.map(logged);
    this.#shown(feed.deliveries.at(-1));
    feed.addEventListener(
      "delivery",
      (e) => {
        this.#pending.push((e as CustomEvent<Delivery<RunData>>).detail);
        this.#frame ||= requestAnimationFrame(() => this.#flush());
      },
      { signal },
    );
    feed.addEventListener("failure", () => this.#followFeed(), { signal });
    feed.addEventListener("restart", () => this.#followFeed(), { signal });
    this.#followFeed();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    // Those not shown yet are the feed's still: the next mount shows them, and moves the cursor.
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#pending = [];
  }

  /** Shows the deliveries heard since the last frame, in one update of the log: sl-event-log
   * measures its frame at each update, so an update per delivery, as a reload's replay of a long
   * stream delivers them, would lay the growing log out once for each event. */
  #flush() {
    this.#frame = 0;
    const pending = this.#pending;
    this.#pending = [];
    this.events = [...this.events, ...pending.map(logged)];
    this.#shown(pending.at(-1));
  }

  /** The log has shown the delivery: its cursor is where a reload resumes. */
  #shown(delivery: Delivery<RunData> | undefined) {
    if (delivery) storeCursor(delivery.cursor);
  }

  #followFeed() {
    const feed = appFeed();
    const failure = feed.failure;
    this.following = following(feed);
    this.paused =
      failure === undefined
        ? ""
        : failure instanceof Error && failure.message
          ? failure.message
          : String(failure);
  }

  render() {
    return html`
      <header class="view-header"><h1>Event log</h1></header>
      <div class="view-body log-body">
        <p class="log-status ${this.paused ? "paused" : ""}" role="status">
          ${this.paused ? `Live events paused: ${this.paused}. Reconnecting…` : this.following}
        </p>
        <sl-event-log .events=${this.events}></sl-event-log>
      </div>
    `;
  }
}

customElements.define(logTag, PipelineLog);
