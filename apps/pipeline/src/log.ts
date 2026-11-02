// The live event log, the "/" route: the run events the app's one feed (live.ts) delivers, each
// run's stage events and a failed run's failure event, shown through the components'
// sl-event-log, which keeps each shown event in place as the next arrives. The log keeps no read
// of its own: it shows the feed's deliveries, those kept since the feed started, then each as it
// arrives, so mounting it, again or late, replays the feed's and opens no second subscription.
//
// The log keeps the cursor of the last event it showed in sessionStorage, and main starts the feed
// after it, so a reload, which loads a new document, shows the events after the last one this tab
// showed, with no gap and no duplicate; a tab that has shown none reads from the oldest event the
// stream keeps. Only what the log has shown moves the cursor: events the feed delivers while
// another view is mounted are shown when the log next mounts, in this document or the next.
//
// The log fills the main pane, as the chat does, and holds sl-event-log to the height its header
// and status line leave, so the log's own frame scrolls and follows the newest event while the
// reader is at its end; the page stays put as events arrive. The status line above it says the
// log follows the stream live, and from where, or, while the feed's read has failed, why it is
// paused; it stays one line high whatever it says, so its text changing moves nothing below it.

import { html, LitElement } from "lit";

import "@jaimestill/spike-html-apps-components/event-log.js";
import type { LogEvent } from "@jaimestill/spike-html-apps-components/event-log.js";
import type { Cursor, Delivery } from "@jaimestill/spike-html-apps-sdk/events.js";

import { appFeed } from "./live.ts";
import type { RunData, StageFeed } from "./live.ts";

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
 * Starts the feed main made after the stored cursor `after`, and keeps a cursor the stream never
 * gave out from failing every reload: a read from it fails before it delivers anything, so while
 * the feed has failed with nothing delivered the stored cursor is forgotten, and a reload starts
 * from the oldest event; once the feed delivers, its start is kept again, unless the log stored a
 * later one. The read itself retries from the same cursor, so a failure that passes (the
 * connection lost a moment) resumes with no gap and no duplicate.
 */
export function resumeFeed(feed: StageFeed, after: Cursor | undefined) {
  resumed = after;
  if (after !== undefined) {
    const watch = new AbortController();
    feed.addEventListener(
      "failure",
      () => {
        if (feed.deliveries.length > 0) return;
        storeCursor(feed.failure === undefined ? after : undefined);
      },
      { signal: watch.signal },
    );
    feed.addEventListener(
      "delivery",
      () => {
        if (storedCursor() === undefined) storeCursor(after);
        watch.abort();
      },
      { signal: watch.signal },
    );
  }
  feed.start();
}

/** The event as the log shows it. A CloudEvent's time is optional, the log's is not: an event
 * without one, which the emulator never publishes, shows no time. */
const logged = ({ event }: Delivery<RunData>): LogEvent => ({
  ...event,
  time: event.time ?? "",
});

/** What the status line says while the feed reads: that the log is live, and from where. */
function following(): string {
  return resumed === undefined
    ? "Following the run events live, from the oldest the stream keeps."
    : "Following the run events live, after the last one this tab showed.";
}

class PipelineLog extends LitElement {
  static properties = { events: { state: true }, paused: { state: true } };

  /** The events shown, the feed's deliveries in its order. */
  declare events: readonly LogEvent[];
  /** Why the feed's read is paused, while it is; empty while it reads. */
  declare paused: string;

  #disconnect: AbortController | undefined;

  constructor() {
    super();
    this.events = [];
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
        const delivery = (e as CustomEvent<Delivery<RunData>>).detail;
        this.events = [...this.events, logged(delivery)];
        this.#shown(delivery);
      },
      { signal },
    );
    feed.addEventListener("failure", () => this.#followFeed(), { signal });
    this.#followFeed();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
  }

  /** The log has shown the delivery: its cursor is where a reload resumes. */
  #shown(delivery: Delivery<RunData> | undefined) {
    if (delivery) storeCursor(delivery.cursor);
  }

  #followFeed() {
    const failure = appFeed().failure;
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
          ${this.paused ? `Live events paused: ${this.paused}. Reconnecting…` : following()}
        </p>
        <sl-event-log .events=${this.events}></sl-event-log>
      </div>
    `;
  }
}

customElements.define(logTag, PipelineLog);
