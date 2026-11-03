// A service's panel, <external-panel>: everything the client shows of one service, over that
// service's own sdk client, with its API base and a token provider for its token, and its own NATS
// sequence, with the same token, read by one live feed (feed.ts). Nothing in a panel reaches
// another's service, so one service's documents, matches, and events never appear in another's
// panel, and one that fails leaves the others working. It renders into light DOM, as the pipeline
// app's workspace does, so the page's sheets style it.
//
// The panel composes the components layer: the upload dropzone, its files uploading at once, side
// by side, each with its progress and a cancel; the document list, a page of the documents, each
// with its run's status, live; the selected document's run in the stage timeline, live; a search
// field over the search results; and the event log of the service's run events, live. Activating
// a list entry or a match selects its document, its entry marked, its stages shown.
//
// The panel's first load is its service's document listing. When that fails, the panel fails with
// the call's problem: its title, the sdk's own for a problem the client made, "Network error" when
// the service doesn't admit the client's origin, with Try again. While its live read is refused or
// lost, the panel's status line says so and the feed reads again by itself.
//
// The pipeline app's side pane (apps/pipeline/src/documents.ts) wires the dropzone and the list to
// its one client and feed the same way, and its document view the timeline; an app imports no
// other app, so the panel holds its own copy of that wiring, the statuses' wording, the uploads'
// lifecycle, and the run's stages as the timeline shows them.

import { html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";

import "@jaimestill/spike-html-apps-components/document-list.js";
import type { DocumentItem } from "@jaimestill/spike-html-apps-components/document-list.js";
import type { OpenDetail, StatusTone } from "@jaimestill/spike-html-apps-components/entry.js";
import "@jaimestill/spike-html-apps-components/event-log.js";
import type { LogEvent } from "@jaimestill/spike-html-apps-components/event-log.js";
import type { PageChangeDetail } from "@jaimestill/spike-html-apps-components/pagination.js";
import type { PageSizeChangeDetail } from "@jaimestill/spike-html-apps-components/pagination.js";
import "@jaimestill/spike-html-apps-components/search-results.js";
import type {
  SearchMatch,
  SearchOpenDetail,
  SearchState,
} from "@jaimestill/spike-html-apps-components/search-results.js";
import "@jaimestill/spike-html-apps-components/stage-timeline.js";
import type { TimelineStage } from "@jaimestill/spike-html-apps-components/stage-timeline.js";
import "@jaimestill/spike-html-apps-components/upload-dropzone.js";
import type {
  FilesSelectDetail,
  UploadCancelDetail,
  UploadItem,
} from "@jaimestill/spike-html-apps-components/upload-dropzone.js";
import { createClient } from "@jaimestill/spike-html-apps-sdk/api.js";
import type { Problem } from "@jaimestill/spike-html-apps-sdk/api.js";
import type { TokenProvider } from "@jaimestill/spike-html-apps-sdk/auth.js";
import type { Delivery } from "@jaimestill/spike-html-apps-sdk/events.js";
import { natsSequence } from "@jaimestill/spike-html-apps-sdk/events/nats.js";
import type { NatsSequence } from "@jaimestill/spike-html-apps-sdk/events/nats.js";

import { apiOf } from "./api.ts";
import type { Api, Document, Run } from "./api.ts";
import { RunFeed } from "./feed.ts";
import type { Failure, Progress, RunData, RunDetail } from "./feed.ts";
import type { Service } from "./services.ts";

/** The panel's tag, which the client's frame renders once per service. */
export const panelTag = "external-panel";

/** The problem type the client gives a call its signal aborted: an upload's cancel. */
const aborted = "urn:standards-lab:problem:abort";

/** The page sizes the list offers, the pagination's own. */
const pageSizes = [6, 12, 24, 48];

/** The matches a search reads: its first page. */
const searchSize = 48;

/** A token provider for the service's token, which never changes, so there is nothing to refresh
 * to. */
const tokenOf = (token: string): TokenProvider => ({
  token: async () => token,
  refresh: async () => undefined,
});

/** A run's progress as an entry's status: "pending", "processing 2/5", "complete 5/5", or "failed
 * 3/5". "processing" is the longest word, so a running status keeps one width through its stages,
 * and completing or failing only shortens it: a status that grew could wrap below its name. */
function statusOf(progress: Progress | undefined, failure?: Failure): string {
  if (failure) return `failed ${failure.position}/${failure.count}`;
  if (!progress) return "pending";
  const { completed, count } = progress;
  return `${completed >= count ? "complete" : "processing"} ${completed}/${count}`;
}

/** A run's status as its entry's tone: failed red, complete green, under way the accent. */
function toneOf(progress: Progress | undefined, failure?: Failure): StatusTone | null {
  if (failure) return "failed";
  if (!progress) return null;
  return progress.completed >= progress.count ? "complete" : "active";
}

/** The run's stages as the timeline shows them, by the feed's progress and failure for it: the
 * stages up to its completed count complete, the next active once the run has started; a failed
 * run's failed stage failed, with its time and reason, those before it complete. A stage's time is
 * the answer's, else its event's. */
function timelineOf(run: Run, feed: RunFeed): TimelineStage[] {
  const completed = feed.progress(run.id)?.completed ?? 0;
  const failure = feed.failed(run.id);
  const times = feed.times(run.id);
  return run.stages.map((stage) => {
    const completedAt = stage.completed_at ?? times.get(stage.position) ?? null;
    const { name, position } = stage;
    if (failure) {
      if (position === failure.position) {
        return {
          name,
          position,
          state: "failed",
          failedAt: stage.failed_at ?? failure.time,
          reason: stage.reason ?? failure.reason,
        };
      }
      return {
        name,
        position,
        state: position < failure.position ? "complete" : "pending",
        completedAt,
      };
    }
    const state =
      position <= completed
        ? "complete"
        : completed > 0 && position === completed + 1
          ? "active"
          : "pending";
    return { name, position, state, completedAt };
  });
}

/** The run's status in one line; why it failed is the timeline's, under the failed stage. */
function runStatus(stages: readonly TimelineStage[], failure?: Failure): string {
  const count = stages.length;
  if (failure) return `Failed at stage ${failure.position} of ${count}, ${failure.stage}`;
  const done = stages.filter((stage) => stage.state === "complete").length;
  if (done === 0) return "Not started";
  if (done >= count) return `Complete: all ${count} stages`;
  const active = stages.find((stage) => stage.state === "active");
  return `In progress: stage ${done + 1} of ${count}${active ? `, ${active.name}` : ""}`;
}

/** The message of an error the feed's read failed with. */
const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : String(error);

/** An upload in flight or finished, with the controller that cancels it. */
interface Upload extends UploadItem {
  abort?: AbortController;
}

/** The selected document's run: loading, its answer, or the problem's title. */
type Selection =
  | { state: "loading"; id: string; name: string }
  | { state: "error"; id: string; name: string; message: string }
  | { state: "ready"; id: string; name: string; run: Run };

/** One service's panel, over its own API and its own feed. */
export class ExternalPanel extends LitElement {
  static properties = {
    service: { attribute: false },
    key: { attribute: false },
    phase: { state: true },
    problem: { state: true },
    uploads: { state: true },
    items: { state: true },
    listState: { state: true },
    listMessage: { state: true },
    page: { state: true },
    size: { state: true },
    total: { state: true },
    more: { state: true },
    selection: { state: true },
    query: { state: true },
    found: { state: true },
    searchState: { state: true },
    searchMessage: { state: true },
    searchTotal: { state: true },
    events: { state: true },
    live: { state: true },
  };

  /** The service the panel shows, set before the panel connects. */
  declare service: Service;
  /** The panel's key among the page's panels, which its elements' ids start with. */
  declare key: string;
  /** Loading its first page, failed with `problem`, or showing the service. */
  declare phase: "loading" | "failed" | "ready";
  /** Why the panel failed: the first load's problem. */
  declare problem: Problem | null;
  declare uploads: Upload[];
  declare items: (DocumentItem & { run_id: string })[];
  declare listState: "loading" | "error" | "ready";
  declare listMessage: string;
  declare page: number;
  declare size: number;
  declare total: number | null;
  declare more: boolean;
  /** The selected document and its run, or null when none is selected. */
  declare selection: Selection | null;
  /** The query the shown matches answer, trimmed. */
  declare query: string;
  /** The matches shown, the first page's. */
  declare found: readonly SearchMatch[];
  declare searchState: SearchState;
  declare searchMessage: string;
  declare searchTotal: number | null;
  /** The service's run events, as the feed delivered them. */
  declare events: readonly LogEvent[];
  /** Why the live read is paused, while it is; empty while it reads. */
  declare live: string;

  #api: Api | undefined;
  #sequence: NatsSequence<RunData> | undefined;
  #feed: RunFeed | undefined;
  #disconnect: AbortController | undefined;
  #load: AbortController | undefined;
  #search: AbortController | undefined;
  #select: AbortController | undefined;
  /** The runs the panel has heard of, by the feed or a page it loaded. */
  readonly #heard = new Set<string>();
  /** The quiet refresh a run heard of for the first time schedules. */
  #soon: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.key = "panel";
    this.phase = "loading";
    this.problem = null;
    this.uploads = [];
    this.items = [];
    this.listState = "loading";
    this.listMessage = "";
    this.page = 1;
    this.size = pageSizes[0];
    this.total = null;
    this.more = false;
    this.selection = null;
    this.query = "";
    this.found = [];
    this.searchState = "ready";
    this.searchMessage = "";
    this.searchTotal = null;
    this.events = [];
    this.live = "";
  }

  protected createRenderRoot() {
    return this;
  }

  /** The panel's live feed, once it has connected. */
  get feed(): RunFeed | undefined {
    return this.#feed;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    const { apiBase, nats } = this.service;
    const auth = tokenOf(nats.token);
    this.#api = apiOf(createClient({ base: apiBase, auth }));
    this.#sequence = natsSequence<RunData>({ servers: nats.url, stream: nats.stream, token: auth });
    const feed = new RunFeed(this.#sequence);
    this.#feed = feed;
    const follow = (e: Event) => this.#progress((e as CustomEvent<RunDetail>).detail);
    feed.addEventListener("progress", follow, { signal });
    feed.addEventListener("run-failed", follow, { signal });
    feed.addEventListener(
      "delivery",
      (e) => {
        this.events = [...this.events, (e as CustomEvent<Delivery<RunData>>).detail.event];
      },
      { signal },
    );
    feed.addEventListener(
      "failure",
      () => {
        this.live = feed.failure === undefined ? "" : messageOf(feed.failure);
      },
      { signal },
    );
    feed.start(signal);
    void this.#fetch({ quiet: false });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#load?.abort();
    this.#search?.abort();
    this.#select?.abort();
    clearTimeout(this.#soon);
    void this.#sequence?.close();
  }

  /** An element id under the panel's key. */
  #id(name: string): string {
    return `${this.key}-${name}`;
  }

  render() {
    const { name, apiBase } = this.service;
    return html`
      <section class="panel" aria-labelledby=${this.#id("name")}>
        <header class="panel-header">
          <h2 id=${this.#id("name")}>${name}</h2>
          <p class="panel-base">${apiBase}</p>
          ${this.phase === "ready" ? this.#liveLine() : nothing}
        </header>
        ${
          this.phase === "failed"
            ? this.#failed()
            : this.phase === "loading"
              ? html`<p class="panel-loading" role="status">Loading ${name}…</p>`
              : this.#ready()
        }
      </section>
    `;
  }

  #liveLine(): TemplateResult {
    return html`<p class="panel-live ${this.live ? "paused" : ""}" role="status">
      ${this.live ? `Live events paused: ${this.live}. Reconnecting…` : "Following run events live."}
    </p>`;
  }

  #failed(): TemplateResult {
    const problem = this.problem;
    return html`<div class="panel-failed" role="alert">
      <p class="panel-problem">${problem?.title}</p>
      <p class="panel-reason">
        Listing ${this.service.name}'s documents at ${this.service.apiBase} failed${
          problem?.detail ? `: ${problem.detail}.` : "."
        }
      </p>
      <button type="button" class="panel-retry" @click=${() => this.#retry()}>Try again</button>
    </div>`;
  }

  #ready(): TemplateResult {
    return html`
      <section class="panel-section" aria-labelledby=${this.#id("upload")}>
        <h3 id=${this.#id("upload")}>Upload</h3>
        <sl-upload-dropzone
          .uploads=${this.uploads}
          @files-select=${(e: CustomEvent<FilesSelectDetail>) => this.#upload(e.detail.files)}
          @upload-cancel=${(e: CustomEvent<UploadCancelDetail>) => this.#cancel(e.detail.id)}
        ></sl-upload-dropzone>
      </section>
      <section class="panel-section" aria-labelledby=${this.#id("documents")}>
        <h3 id=${this.#id("documents")}>Documents</h3>
        <sl-document-list
          .items=${this.items}
          .selected=${this.selection?.id ?? null}
          .state=${this.listState}
          .message=${this.listMessage}
          .page=${this.page}
          .size=${this.size}
          .total=${this.total}
          .more=${this.more}
          .pageSizes=${pageSizes}
          @open=${(e: CustomEvent<OpenDetail>) => this.#choose(e.detail.id)}
          @page-change=${(e: CustomEvent<PageChangeDetail>) => this.#turn(e.detail.page, this.size)}
          @page-size-change=${(e: CustomEvent<PageSizeChangeDetail>) => this.#resize(e.detail.size)}
        ></sl-document-list>
        ${
          this.listState === "error"
            ? html`<button type="button" class="panel-retry" @click=${() => this.#retry()}>
                Try again
              </button>`
            : nothing
        }
      </section>
      <section class="panel-section" aria-labelledby=${this.#id("stages")}>
        <h3 id=${this.#id("stages")}>Stages</h3>
        ${this.#stages()}
      </section>
      <section class="panel-section" aria-labelledby=${this.#id("search")}>
        <h3 id=${this.#id("search")}>Search</h3>
        <form
          class="panel-search"
          role="search"
          aria-label=${`Search ${this.service.name}`}
          @submit=${(e: SubmitEvent) => this.#submit(e)}
        >
          <input
            type="search"
            name="q"
            aria-label="Search documents"
            placeholder="Search documents"
            autocomplete="off"
          />
          <button type="submit">Search</button>
        </form>
        <sl-search-results
          .query=${this.query}
          .items=${this.found}
          .total=${this.searchTotal}
          .state=${this.searchState}
          .message=${this.searchMessage}
          @open=${(e: CustomEvent<SearchOpenDetail>) => this.#choose(e.detail.id)}
        ></sl-search-results>
      </section>
      <section class="panel-section" aria-labelledby=${this.#id("events")}>
        <h3 id=${this.#id("events")}>Run events</h3>
        <sl-event-log .events=${this.events}></sl-event-log>
      </section>
    `;
  }

  /** The selected document's stages: a hint before any is selected, then its name over its run's
   * status line and its timeline, both held a line high while the run loads. */
  #stages(): TemplateResult {
    const selection = this.selection;
    if (!selection) {
      return html`<p class="panel-hint">Choose a document or a match to follow its stages.</p>`;
    }
    const feed = this.#feed!;
    let status: TemplateResult | string;
    let stages: TimelineStage[] = [];
    if (selection.state === "loading") status = "Loading its run…";
    else if (selection.state === "error") {
      status = html`<span class="panel-error">${selection.message}</span>`;
    } else {
      stages = timelineOf(selection.run, feed);
      const failure = feed.failed(selection.run.id);
      status = html`<span class=${failure ? "panel-error" : ""}>${runStatus(stages, failure)}</span>`;
    }
    return html`
      <p class="panel-selected">${selection.name}</p>
      <p class="panel-run" role="status">${status}</p>
      ${stages.length > 0 ? html`<sl-stage-timeline .stages=${stages}></sl-stage-timeline>` : nothing}
    `;
  }

  /**
   * A run's progress rose, or it failed: its entry, when the page shows it, takes the new status,
   * and the timeline follows when the run is the selected one's. A run the panel hasn't heard of,
   * with the last page shown, is a document uploaded elsewhere: the page refreshes quietly, once
   * for a burst of them.
   */
  #progress({ run }: RunDetail) {
    const feed = this.#feed!;
    if (this.selection?.state === "ready" && this.selection.run.id === run) this.requestUpdate();
    const heard = this.#heard.has(run);
    this.#heard.add(run);
    if (!this.items.some((item) => item.run_id === run)) {
      if (!heard && !this.more && this.listState === "ready") this.#refreshSoon();
      return;
    }
    const status = statusOf(feed.progress(run), feed.failed(run));
    const status_tone = toneOf(feed.progress(run), feed.failed(run));
    this.items = this.items.map((item) =>
      item.run_id === run && (item.status !== status || item.status_tone !== status_tone)
        ? { ...item, status, status_tone }
        : item,
    );
  }

  #refreshSoon() {
    clearTimeout(this.#soon);
    this.#soon = setTimeout(() => void this.#fetch({ quiet: true }), 200);
  }

  #retry() {
    if (this.phase === "failed") this.phase = "loading";
    void this.#fetch({ quiet: false });
  }

  #turn(page: number | null, size: number) {
    if (page === null) return;
    this.page = page;
    this.size = size;
    void this.#fetch({ quiet: false });
  }

  /** A new size keeps the page's first document in view. */
  #resize(size: number) {
    const first = (this.page - 1) * this.size;
    this.#turn(Math.floor(first / size) + 1, size);
  }

  /**
   * Loads the page, then its runs' progress, then shows them. A quiet load leaves the list as it
   * is until the page arrives; any other marks it loading, the documents shown kept, busy. The
   * panel's first load failing fails the panel; a later one fails the list alone. A page past the
   * last loads the last page in its place.
   */
  async #fetch({ quiet }: { quiet: boolean }): Promise<void> {
    this.#load?.abort();
    const load = new AbortController();
    this.#load = load;
    const { signal } = load;
    if (!quiet) this.listState = "loading";
    const { documents, runs } = this.#api!;
    const listed = await documents.list(this.page, this.size, signal);
    if (signal.aborted) return;
    if (!listed.ok) {
      if (this.phase !== "ready") {
        this.problem = listed.problem;
        this.phase = "failed";
        return;
      }
      this.listMessage = listed.problem.title;
      this.listState = "error";
      return;
    }
    const page = listed.data;
    const total = page.total ?? null;
    if (page.items.length === 0 && total !== null && total > 0 && this.page > 1) {
      this.page = Math.ceil(total / this.size);
      return this.#fetch({ quiet });
    }
    const feed = this.#feed!;
    await Promise.all(
      page.items
        .filter((doc) => !feed.progress(doc.run_id))
        .map(async (doc) => {
          const run = await runs.run(doc.run_id, signal);
          if (run.ok) feed.note(run.data);
        }),
    );
    if (signal.aborted) return;
    for (const doc of page.items) this.#heard.add(doc.run_id);
    this.items = page.items.map((doc: Document) => ({
      ...doc,
      status: statusOf(feed.progress(doc.run_id), feed.failed(doc.run_id)),
      status_tone: toneOf(feed.progress(doc.run_id), feed.failed(doc.run_id)),
    }));
    this.total = total;
    this.more = page.more;
    this.listMessage = "";
    this.listState = "ready";
    this.problem = null;
    this.phase = "ready";
  }

  /** Selects the document by its id, from the list or a match: its entry marked, and its run
   * loaded for the timeline, which then follows the feed. */
  async #choose(id: string): Promise<void> {
    this.#select?.abort();
    const select = new AbortController();
    this.#select = select;
    const { signal } = select;
    const { documents, runs } = this.#api!;
    let doc: { name: string; run_id: string } | undefined = this.items.find(
      (item) => item.id === id,
    );
    const named = doc?.name ?? this.found.find((match) => match.id === id)?.name ?? "";
    this.selection = { state: "loading", id, name: named };
    if (!doc) {
      const found = await documents.document(id, signal);
      if (signal.aborted) return;
      if (!found.ok) {
        this.selection = { state: "error", id, name: named, message: found.problem.title };
        return;
      }
      doc = found.data;
    }
    const run = await runs.run(doc.run_id, signal);
    if (signal.aborted) return;
    if (!run.ok) {
      this.selection = { state: "error", id, name: doc.name, message: run.problem.title };
      return;
    }
    this.#feed!.note(run.data);
    this.selection = { state: "ready", id, name: doc.name, run: run.data };
  }

  #submit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const query = String(new FormData(form).get("q") ?? "").trim();
    void this.#find(query);
  }

  /** Searches for the query, the matches shown cleared until the answer replaces them, the state
   * set to loading with them in one update, so the status line, the results' live region, goes
   * straight to "Searching for" the query and never says there are none; a blank query asks the
   * API nothing, which refuses one, and shows the prompt. */
  async #find(query: string): Promise<void> {
    this.#search?.abort();
    this.query = query;
    if (!query) {
      this.found = [];
      this.searchTotal = null;
      this.searchState = "ready";
      return;
    }
    const search = new AbortController();
    this.#search = search;
    const { signal } = search;
    this.searchState = "loading";
    this.found = [];
    this.searchTotal = null;
    const found = await this.#api!.search.search(query, searchSize, signal);
    if (signal.aborted) return;
    if (!found.ok) {
      this.found = [];
      this.searchTotal = null;
      this.searchMessage = found.problem.title;
      this.searchState = "error";
      return;
    }
    const { items, more, total } = found.data;
    this.found = items;
    this.searchTotal = more ? (total ?? null) : null;
    this.searchMessage = "";
    this.searchState = "ready";
  }

  #upload(files: File[]) {
    const { documents } = this.#api!;
    for (const file of files) {
      const abort = new AbortController();
      const id = crypto.randomUUID();
      this.uploads = [
        ...this.uploads,
        { id, name: file.name, size: file.size, sent: 0, state: "uploading", abort },
      ];
      void documents
        .upload(file, { signal: abort.signal, progress: (sent) => this.#update(id, { sent }) })
        .then((result) => {
          if (result.ok) {
            this.#update(id, { state: "done", sent: file.size });
            void this.#fetch({ quiet: true });
          } else if (result.problem.type === aborted) {
            // A cancel once the whole body has gone out may still land; the refresh lists it then.
            this.#update(id, { state: "cancelled" });
            void this.#fetch({ quiet: true });
          } else {
            this.#update(id, { state: "failed", message: result.problem.title });
          }
        });
    }
  }

  #cancel(id: string) {
    this.uploads.find((upload) => upload.id === id)?.abort?.abort();
  }

  /** Changes the upload's fields; a finished upload drops its controller. */
  #update(id: string, changes: Partial<Upload>) {
    this.uploads = this.uploads.map((upload) => {
      if (upload.id !== id || upload.state !== "uploading") return upload;
      const next = { ...upload, ...changes };
      if (next.state !== "uploading") delete next.abort;
      return next;
    });
  }
}

customElements.define(panelTag, ExternalPanel);
