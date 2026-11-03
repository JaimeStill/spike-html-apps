// The "/documents/:document" route: one document, by the id the router sets as its document
// attribute. Its header names it, with its size, content type, and upload time by the foundation's
// formatters; under it its run's stages, in sl-stage-timeline, live; and then its content, in
// sl-artifact-viewer. Loaded on its first visit.
//
// The stages are the API's run merged with the app's one stage feed (live.ts), as the side pane's
// list merges them: the run's answer joins the feed's progress (note), so whichever of the two
// told more wins, and the view then follows the feed's progress events for the run, each stage
// advancing in place. A stage's completion time is the run's when its answer had one, else the
// time of the stage event that completed it. So a deep link or a reload shows the run as it stands
// at once, and the stages advance with no reload as the events arrive. A run that fails, by its
// failure event or by its answer, whichever the feed heard first, shows its failed stage failed,
// at the time it failed and with why, read with the stage, the stages after it pending; its status
// line names the stage, and leaves the reason to the timeline, so the view says it once.
//
// The content is fetched as the viewer takes its type, by viewOf: a type it shows as text,
// Markdown, JSON, or any text or textual type, as text, the body as stored; any other, a PDF, an
// image, audio, video, or a type it doesn't know, as a Blob. Either is handed to the viewer as it
// came: the viewer shows JSON by its own reading, its invalid-JSON note for a body that doesn't
// parse; a native type from the Blob, in its own element; and a type it doesn't know as text when
// its bytes are, else its note that it can't be shown, with a download link. The viewer shows no
// header of its own, the view's header naming the document and its type above it; its name still
// names its region and its media. A content fetch that fails shows its problem's title in the
// viewer, with a Try again below it. A document the API doesn't know (404), or an id that is no
// document's (the API's 400 for an id that isn't a UUID), shows the view's own not-found state,
// not the app's.
//
// The router mounts a new element for every document, so moving from one document to another
// (an entry of the list, back, forward) would blank the view while the next loads. Instead, the
// view the router replaces hands what it shows to the one replacing it, which keeps showing it,
// marked busy, until the next document and its run arrive, then swaps them in at once: the frame
// never empties between two documents. Nothing in the view moves on its own: the timeline holds
// its stages' places as they advance, the run's status is one line, and the content's frame is
// last, so content arriving grows the page below everything else.

import { html, LitElement, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";

import { formatBytes, formatDateTime } from "@jaimestill/spike-html-apps-foundation/format.js";

import "@jaimestill/spike-html-apps-components/artifact-viewer.js";
import { viewOf } from "@jaimestill/spike-html-apps-components/artifact-viewer.js";
import "@jaimestill/spike-html-apps-components/stage-timeline.js";
import type { TimelineStage } from "@jaimestill/spike-html-apps-components/stage-timeline.js";
import type { Delivery } from "@jaimestill/spike-html-apps-sdk/events.js";
import type { Problem } from "@jaimestill/spike-html-apps-sdk/api.js";

import { appApi } from "../api.ts";
import type { Document, Run } from "../api.ts";
import { appFeed } from "../live.ts";
import { stageType } from "../live.ts";
import type { Failure, ProgressDetail, RunData } from "../live.ts";
import { frame } from "./view.ts";

/** The document view's tag, which the router mounts. */
export const documentTag = "pipeline-document";

/** The upload time's format: the date and the clock to the minute. */
const uploadedFormat: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/** The document's content, as the viewer shows it: loading, failed with the problem's title, or
 * its body, as text or as a Blob by the viewer's reading of its type. */
type Artifact =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; body: string | Blob };

/** The document's run: its answer, or the problem's title when the API gave none. */
type RunAnswer = { ok: true; run: Run } | { ok: false; message: string };

/** What the view shows: the document loading, missing, failed with the problem's title, or ready
 * with its run and content. */
type Shown =
  | { state: "loading" }
  | { state: "missing"; id: string }
  | { state: "error"; message: string }
  | { state: "ready"; document: Document; run: RunAnswer; artifact: Artifact };

/** What the view the router is replacing showed, for the one replacing it; cleared once the
 * replacement has taken it, or at the next microtask when no document view replaces it. */
let handoff: Shown | undefined;

/** Each stage's completion time, by its position, from the feed's stage events for the run. */
function eventTimes(deliveries: readonly Delivery<RunData>[], run: string): Map<number, string> {
  const times = new Map<number, string>();
  for (const { event } of deliveries) {
    if (event.type === stageType && event.subject === run && event.data && event.time)
      times.set(event.data.position, event.time);
  }
  return times;
}

/**
 * The run's stages as the timeline shows them, by the feed's progress for the run, which holds at
 * least what the run's answer told: the stages up to its completed count complete, and the next
 * the active one, once the run has started; before its first stage completes, every stage is
 * pending. A failed run's failed stage is failed, the stages before it complete and those after it
 * pending, none active. A stage's time is the answer's, else its event's; the failed stage's is
 * the time it failed, and its reason why, the answer's, else the failure event's.
 */
export function timelineOf(
  run: Run,
  completed: number,
  times: ReadonlyMap<number, string>,
  failure?: Failure,
): TimelineStage[] {
  return run.stages.map((stage) => {
    if (failure) {
      const state =
        stage.position < failure.position
          ? "complete"
          : stage.position === failure.position
            ? "failed"
            : "pending";
      if (state === "failed")
        return {
          name: stage.name,
          position: stage.position,
          state,
          failedAt: stage.failed_at ?? failure.time,
          reason: stage.reason ?? failure.reason,
        };
      return {
        name: stage.name,
        position: stage.position,
        state,
        completedAt: stage.completed_at ?? times.get(stage.position) ?? null,
      };
    }
    return {
      name: stage.name,
      position: stage.position,
      state:
        stage.position <= completed
          ? "complete"
          : completed > 0 && stage.position === completed + 1
            ? "active"
            : "pending",
      completedAt: stage.completed_at ?? times.get(stage.position) ?? null,
    };
  });
}

/** The run's status in one line: not started, the stage in progress, complete, or failed at its
 * stage. Why it failed is the timeline's, under the failed stage, so the line doesn't repeat it. */
export function runStatus(stages: readonly TimelineStage[], failure?: Failure): string {
  const count = stages.length;
  if (failure) return `Failed at stage ${failure.position} of ${count}, ${failure.stage}`;
  const done = stages.filter((stage) => stage.state === "complete").length;
  if (done === 0) return "Not started";
  if (done >= count) return `Complete: all ${count} stages`;
  const active = stages.find((stage) => stage.state === "active");
  return `In progress: stage ${done + 1} of ${count}${active ? `, ${active.name}` : ""}`;
}

class PipelineDocument extends LitElement {
  static properties = {
    documentId: { attribute: "document" },
    shown: { state: true },
    busy: { state: true },
    live: { state: true },
  };

  /** The document's id, the route's :document param. */
  declare documentId: string | undefined;
  declare shown: Shown;
  /** Whether what is shown is the view's predecessor's, kept until this document arrives. */
  declare busy: boolean;
  /** Why the live feed is paused, while it is; empty while it reads. */
  declare live: string;

  /** Aborts the load in flight when another replaces it or the view leaves. */
  #load: AbortController | undefined;
  #disconnect: AbortController | undefined;

  constructor() {
    super();
    this.shown = { state: "loading" };
    this.busy = false;
    this.live = "";
  }

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // The view this one replaces showed a document: keep it, busy, until this one's arrives.
    if (handoff) {
      this.shown = handoff;
      this.busy = true;
      handoff = undefined;
    }
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    const feed = appFeed();
    const follow = (run: string) => {
      if (this.shown.state === "ready" && this.shown.run.ok && this.shown.run.run.id === run)
        this.requestUpdate();
    };
    const followRun = (e: Event) => follow((e as CustomEvent<ProgressDetail>).detail.run);
    feed.addEventListener("progress", followRun, { signal });
    feed.addEventListener("run-failed", followRun, { signal });
    feed.addEventListener(
      "delivery",
      (e) => follow((e as CustomEvent<Delivery<RunData>>).detail.event.subject ?? ""),
      { signal },
    );
    feed.addEventListener("failure", () => this.#followFeed(), { signal });
    this.#followFeed();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#load?.abort();
    // A document view mounted in this one's place takes what it shows, in the same replacement.
    if (this.shown.state !== "loading") {
      handoff = this.shown;
      queueMicrotask(() => {
        handoff = undefined;
      });
    }
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("busy")) {
      if (this.busy) this.setAttribute("aria-busy", "true");
      else this.removeAttribute("aria-busy");
    }
  }

  protected updated(changed: PropertyValues<this>) {
    if (changed.has("documentId")) void this.#fetch();
  }

  #followFeed() {
    const failure = appFeed().failure;
    this.live =
      failure === undefined ? "" : failure instanceof Error ? failure.message : String(failure);
  }

  /** Loads the document, then its run and its content side by side, showing the document with its
   * run as soon as both are in, and its content once it arrives. */
  async #fetch(): Promise<void> {
    this.#load?.abort();
    const load = new AbortController();
    this.#load = load;
    const { signal } = load;
    const id = this.documentId ?? "";
    if (!this.busy) this.shown = { state: "loading" };
    const { documents, runs } = appApi();
    const answered = await documents.document(id, signal);
    if (signal.aborted) return;
    if (!answered.ok) return this.#show(this.#failed(id, answered.problem));
    const document = answered.data;

    let artifact: Artifact = { state: "loading" };
    const content = this.#content(document, signal);
    void content.then((settled) => {
      artifact = settled;
    });
    const run = await runs.run(document.run_id, signal);
    if (signal.aborted) return;
    if (run.ok) appFeed().note(run.data);
    // A content that settled before the run shows with the document, never flashing loading.
    this.#show({
      state: "ready",
      document,
      run: run.ok ? { ok: true, run: run.data } : { ok: false, message: run.problem.title },
      artifact,
    });
    if (artifact.state === "loading") this.#artifact(await content);
  }

  /** Fetches the document's content as the viewer takes its type: as text, or as a Blob. */
  async #content({ id, content_type }: Document, signal: AbortSignal): Promise<Artifact> {
    const { documents } = appApi();
    const fetched =
      viewOf(content_type).content === "text"
        ? await documents.content(id, signal)
        : await documents.bytes(id, signal);
    return fetched.ok
      ? { state: "ready", body: fetched.data }
      : { state: "error", message: fetched.problem.title };
  }

  #failed(id: string, problem: Problem): Shown {
    // A 400 is an id that isn't a UUID, and so no document's.
    return problem.status === 404 || problem.status === 400
      ? { state: "missing", id }
      : { state: "error", message: problem.title };
  }

  #show(shown: Shown) {
    this.shown = shown;
    this.busy = false;
  }

  #artifact(artifact: Artifact) {
    if (this.#load?.signal.aborted || this.shown.state !== "ready") return;
    this.shown = { ...this.shown, artifact };
  }

  async #retryContent() {
    if (this.shown.state !== "ready") return;
    const { document } = this.shown;
    this.#artifact({ state: "loading" });
    const signal = this.#load?.signal ?? new AbortController().signal;
    const artifact = await this.#content(document, signal);
    if (!signal.aborted && this.shown.state === "ready" && this.shown.document.id === document.id)
      this.#artifact(artifact);
  }

  render() {
    const { shown } = this;
    switch (shown.state) {
      case "loading":
        return html`<header class="view-header document-header">
            <h1 class="document-pending">Loading the document…</h1>
            <p class="document-meta" aria-hidden="true">&nbsp;</p>
          </header>
          <div class="view-body"></div>`;
      case "missing":
        return frame(
          "Document not found",
          html`<p>No document in the workspace has the id <code>${shown.id}</code>.</p>
            <p><a href=".">Go to the event log</a></p>`,
        );
      case "error":
        return frame(
          "Document",
          html`<p class="document-error" role="alert">
              Couldn't load the document. ${shown.message}
            </p>
            <button type="button" @click=${() => void this.#fetch()}>Try again</button>`,
        );
      case "ready":
        return this.#ready(shown);
    }
  }

  #ready({ document, run, artifact }: Extract<Shown, { state: "ready" }>): TemplateResult {
    const uploaded = new Date(document.created_at);
    return html`
      <header class="view-header document-header">
        <h1>${document.name}</h1>
        <p class="document-meta">
          <span>${formatBytes(document.size)}</span>
          <span>${document.content_type}</span>
          <span
            >Uploaded
            <time datetime=${uploaded.toISOString()}
              >${formatDateTime(uploaded, undefined, uploadedFormat)}</time
            ></span
          >
        </p>
      </header>
      <div class="view-body document-body">
        <section class="document-section" aria-labelledby="document-stages">
          <h2 id="document-stages">Stages</h2>
          ${
            this.live
              ? html`<p class="document-live" role="status">
                  Live status paused: ${this.live}. Reconnecting…
                </p>`
              : nothing
          }
          ${this.#stages(run)}
        </section>
        <section class="document-section" aria-labelledby="document-content">
          <h2 id="document-content">Content</h2>
          <sl-artifact-viewer
            no-header
            name=${document.name}
            content-type=${document.content_type}
            .content=${artifact.state === "ready" ? artifact.body : ""}
            .state=${artifact.state}
            .message=${artifact.state === "error" ? artifact.message : ""}
          ></sl-artifact-viewer>
          ${
            artifact.state === "error"
              ? html`<button
                  type="button"
                  class="document-retry"
                  @click=${() => void this.#retryContent()}
                >
                  Try again
                </button>`
              : nothing
          }
        </section>
      </div>
    `;
  }

  #stages(run: RunAnswer): TemplateResult {
    if (!run.ok)
      return html`<p class="document-error">Couldn't load the run's stages. ${run.message}</p>`;
    const feed = appFeed();
    const answered = run.run.stages.filter((stage) => stage.state === "complete").length;
    const completed = Math.max(feed.progress(run.run.id)?.completed ?? 0, answered);
    const failure = feed.failed(run.run.id);
    const stages = timelineOf(run.run, completed, eventTimes(feed.deliveries, run.run.id), failure);
    return html`<p class="document-run ${failure ? "failed" : ""}" role="status">
        ${runStatus(stages, failure)}
      </p>
      <sl-stage-timeline .stages=${stages}></sl-stage-timeline>`;
  }
}

customElements.define(documentTag, PipelineDocument);
