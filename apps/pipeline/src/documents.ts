// The side pane's documents, <pipeline-documents>: the upload dropzone and the document list, the
// two composed from the components layer's sl-upload-dropzone and sl-document-list. It renders
// into light DOM, as the workspace does, so the page's sheets style its frame. The drawer holding
// it names it: the drawer's own h2, "Documents", in either mode, so the element adds no heading of
// its own for the whole. Under it the upload is a section with an h3, and the list follows without
// one, its own list of entries named "Documents" by the list element.
//
// Files chosen or dropped upload at once, side by side, each with its progress and a cancel; a
// finished upload refreshes the page shown, so the new document joins the list when it falls on
// that page, and the summary's count when it doesn't (the listing is oldest first); a failed one
// shows its problem's title, and a cancelled one is never stored, its body cut short. The uploads
// are this page's: a reload lists the documents again but not the uploads that made them.
//
// The list shows a page of the documents, each with its run's progress as its status: read from the
// API for the page's runs as the page loads, then raised live by the app's one stage feed
// (live.ts), each run's entry changing in place; a run that fails shows failed, at its failed
// stage, by its failure event live or by its answer on a load. The status takes its state's tone,
// red failed, green complete, the accent under way. The page and its size are kept in
// sessionStorage, so a reload shows the same page. Activating an entry navigates to its document's
// view, whose entry is then the selected one.
//
// The element reports its uploads as they change, by `uploads-change`, so the workspace's header
// can count those in flight while the drawer holding this element is closed. The element never
// moves: the drawer swaps only its own wrapper around it, so the uploads, the page, and the live
// statuses carry on whether the drawer is docked, open, or closed.

import { html, LitElement, nothing } from "lit";
import type { PropertyValues } from "lit";

import { emit } from "@jaimestill/spike-html-apps-foundation/dom.js";

import "@jaimestill/spike-html-apps-components/document-list.js";
import type { DocumentItem } from "@jaimestill/spike-html-apps-components/document-list.js";
import type { OpenDetail, StatusTone } from "@jaimestill/spike-html-apps-components/entry.js";
import type {
  PageChangeDetail,
  PageSizeChangeDetail,
} from "@jaimestill/spike-html-apps-components/pagination.js";
import "@jaimestill/spike-html-apps-components/upload-dropzone.js";
import type {
  FilesSelectDetail,
  UploadCancelDetail,
  UploadItem,
} from "@jaimestill/spike-html-apps-components/upload-dropzone.js";
import type { Page, Problem } from "@jaimestill/spike-html-apps-sdk/api.js";

import { appApi } from "./api.ts";
import type { Document } from "./api.ts";
import { appFeed } from "./live.ts";
import type { Failure, Progress, ProgressDetail } from "./live.ts";
import { appRouter } from "./route.ts";

/** The side pane's tag, which the workspace renders. */
export const documentsTag = "pipeline-documents";

/** The problem type the client gives a call its signal aborted: an upload's cancel. */
const aborted = "urn:standards-lab:problem:abort";

/** The sessionStorage key of the page and size the list shows. */
export const pagingKey = "pipeline-documents.paging";

/** The page sizes offered, the pagination's own. */
const pageSizes = [12, 24, 48, 96];

/**
 * A run's progress as an entry's status: "underway 2/5" until its last stage completes, then
 * "complete 5/5"; "pending" before anything has told of the run. The two words are one length, so
 * the status keeps its width as the run advances: the entry wraps its status below a name the two
 * don't fit beside, and a status that grew would wrap there mid-run, the entry growing a line. A
 * failed run's status is "failed 3/5", the stage it failed at of its count, as the document view's
 * "Failed at stage 3 of 5" counts it; shorter than "underway", so a run that fails never grows its
 * status either.
 */
export function statusOf(progress: Progress | undefined, failure?: Failure): string {
  if (failure) return `failed ${failure.position}/${failure.count}`;
  if (!progress) return "pending";
  const { completed, count } = progress;
  return `${completed >= count ? "complete" : "underway"} ${completed}/${count}`;
}

/**
 * A run's status as its entry's tone: a failed run's red, a complete one's green, and one under
 * way the accent; a run nothing has told of yet stays muted.
 */
export function toneOf(progress: Progress | undefined, failure?: Failure): StatusTone | null {
  if (failure) return "failed";
  if (!progress) return null;
  return progress.completed >= progress.count ? "complete" : "active";
}

/** The stored page and size, or the first page at the smallest size when there are none, they
 * don't parse, or storage is unavailable. */
function storedPaging(): { page: number; size: number } {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(pagingKey) ?? "null");
    const { page, size } = (stored ?? {}) as { page?: unknown; size?: unknown };
    if (Number.isInteger(page) && (page as number) >= 1 && pageSizes.includes(size as number)) {
      return { page: page as number, size: size as number };
    }
  } catch {
    // Nothing stored that parses, or no storage: the defaults.
  }
  return { page: 1, size: pageSizes[0] };
}

function storePaging(page: number, size: number) {
  try {
    sessionStorage.setItem(pagingKey, JSON.stringify({ page, size }));
  } catch {
    // Nothing to keep the page in: a reload shows the first.
  }
}

/** `uploads-change`'s detail: every upload the element shows, in flight or finished. */
export interface UploadsChangeDetail {
  uploads: readonly UploadItem[];
}

/** An upload in flight or finished, with the controller that cancels it. */
interface Upload extends UploadItem {
  abort?: AbortController;
}

/** The side pane: its uploads and its document list. */
export class PipelineDocuments extends LitElement {
  static properties = {
    selected: { attribute: false },
    uploads: { state: true },
    items: { state: true },
    listState: { state: true },
    message: { state: true },
    page: { state: true },
    size: { state: true },
    total: { state: true },
    more: { state: true },
    live: { state: true },
  };

  /** The id of the document the main pane shows, whose entry the list marks; null when none. */
  declare selected: string | null;
  declare uploads: Upload[];
  /** The page's documents, each with its run's progress as its status. */
  declare items: (DocumentItem & { run_id: string })[];
  declare listState: "loading" | "error" | "ready";
  /** Why the list failed to load: the problem's title. */
  declare message: string;
  declare page: number;
  declare size: number;
  declare total: number | null;
  declare more: boolean;
  /** Why the live feed is paused, while it is; empty while it reads. */
  declare live: string;

  /** Aborts the page's load in flight when another replaces it or the element leaves. */
  #load: AbortController | undefined;
  #disconnect: AbortController | undefined;
  /** The runs the element has heard of, by the feed or a page it loaded. */
  readonly #heard = new Set<string>();
  /** The quiet refresh a run heard of for the first time schedules. */
  #soon: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.selected = null;
    this.uploads = [];
    this.items = [];
    this.listState = "loading";
    this.message = "";
    ({ page: this.page, size: this.size } = storedPaging());
    this.total = null;
    this.more = false;
    this.live = "";
  }

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    const feed = appFeed();
    const follow = (e: Event) => this.#progress((e as CustomEvent<ProgressDetail>).detail);
    feed.addEventListener("progress", follow, { signal });
    feed.addEventListener("run-failed", follow, { signal });
    feed.addEventListener("failure", () => this.#followFeed(), { signal });
    this.#followFeed();
    void this.#fetch({ quiet: false });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#load?.abort();
    clearTimeout(this.#soon);
  }

  protected updated(changed: PropertyValues<this>) {
    if (changed.has("uploads")) {
      emit<UploadsChangeDetail>(this, "uploads-change", { uploads: this.uploads });
    }
  }

  render() {
    return html`
      <section class="workspace-pane" aria-labelledby="upload-heading">
        <h3 id="upload-heading">Upload</h3>
        <sl-upload-dropzone
          .uploads=${this.uploads}
          @files-select=${(e: CustomEvent<FilesSelectDetail>) => this.#select(e.detail.files)}
          @upload-cancel=${(e: CustomEvent<UploadCancelDetail>) => this.#cancel(e.detail.id)}
        ></sl-upload-dropzone>
      </section>
      <div class="workspace-pane">
        ${
          this.live
            ? html`<p class="documents-live" role="status">
              Live status paused: ${this.live}. Reconnecting…
            </p>`
            : nothing
        }
        <sl-document-list
          .items=${this.items}
          .selected=${this.selected}
          .state=${this.listState}
          .message=${this.message}
          .page=${this.page}
          .size=${this.size}
          .total=${this.total}
          .more=${this.more}
          .pageSizes=${pageSizes}
          @open=${(e: CustomEvent<OpenDetail>) => this.#open(e.detail.id)}
          @page-change=${(e: CustomEvent<PageChangeDetail>) => this.#turn(e.detail.page, this.size)}
          @page-size-change=${(e: CustomEvent<PageSizeChangeDetail>) => this.#resize(e.detail.size)}
        ></sl-document-list>
        ${
          this.listState === "error"
            ? html`<button type="button" class="documents-retry" @click=${() => this.#retry()}>
              Try again
            </button>`
            : nothing
        }
      </div>
    `;
  }

  #followFeed() {
    const failure = appFeed().failure;
    this.live =
      failure === undefined ? "" : failure instanceof Error ? failure.message : String(failure);
  }

  /**
   * A run's progress rose, or it failed: its entry, when the page shows it, takes a new item with
   * the new status, so the entry, which updates when its item changes, shows it in place. A run the
   * element hasn't heard of before, on the last page, is a document uploaded elsewhere (another
   * tab, another client), which lands on this page or makes the next: the page refreshes quietly,
   * once for a burst of them. While a page loads, the load in flight answers for it.
   */
  #progress({ run }: ProgressDetail) {
    const heard = this.#heard.has(run);
    this.#heard.add(run);
    if (!this.items.some((item) => item.run_id === run)) {
      if (!heard && !this.more && this.listState !== "loading") this.#refreshSoon();
      return;
    }
    const feed = appFeed();
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

  #open(id: string) {
    void appRouter().navigate(`documents/${encodeURIComponent(id)}`);
  }

  #turn(page: number | null, size: number) {
    // The listing is addressed by number, so Next always names its page.
    if (page === null) return;
    this.page = page;
    this.size = size;
    storePaging(page, size);
    void this.#fetch({ quiet: false });
  }

  /** A new size keeps the page's first document in view: the page that holds it at that size. */
  #resize(size: number) {
    const first = (this.page - 1) * this.size;
    this.#turn(Math.floor(first / size) + 1, size);
  }

  #retry() {
    this.listState = "loading";
    void this.#fetch({ quiet: false });
  }

  /**
   * Loads the page, then its runs' progress, then shows them. A quiet load (after an upload)
   * leaves the list as it is until the page arrives, so the status line doesn't flash its loading
   * text; any other marks it loading, the documents shown kept, marked busy. A page past the last,
   * the documents fewer than when it was stored, loads the last page in its place.
   */
  async #fetch({ quiet }: { quiet: boolean }): Promise<void> {
    this.#load?.abort();
    const load = new AbortController();
    this.#load = load;
    const { signal } = load;
    if (!quiet) this.listState = "loading";
    const { documents, runs } = appApi();
    const listed = await documents.list({ page: this.page, size: this.size }, signal);
    if (signal.aborted) return;
    if (!listed.ok) return this.#failed(listed.problem);
    const page: Page<Document> = listed.data;
    const total = page.total ?? null;
    if (page.items.length === 0 && total !== null && total > 0 && this.page > 1) {
      this.page = Math.ceil(total / this.size);
      storePaging(this.page, this.size);
      return this.#fetch({ quiet });
    }
    // Each run's answer joins the feed's progress; one that fails leaves the run to its events.
    const feed = appFeed();
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
    this.items = page.items.map((doc) => ({
      ...doc,
      status: statusOf(feed.progress(doc.run_id), feed.failed(doc.run_id)),
      status_tone: toneOf(feed.progress(doc.run_id), feed.failed(doc.run_id)),
    }));
    this.total = total;
    this.more = page.more;
    this.message = "";
    this.listState = "ready";
  }

  #failed(problem: Problem) {
    this.message = problem.title;
    this.listState = "error";
  }

  #select(files: File[]) {
    const { documents } = appApi();
    for (const file of files) {
      const abort = new AbortController();
      const id = crypto.randomUUID();
      this.uploads = [
        ...this.uploads,
        { id, name: file.name, size: file.size, sent: 0, state: "uploading", abort },
      ];
      void documents
        .upload(file, {
          signal: abort.signal,
          // The total is the body's own size, which the file's is; 0 when the browser can't tell.
          progress: (sent) => this.#update(id, { sent }),
        })
        .then((result) => {
          if (result.ok) {
            this.#update(id, { state: "done", sent: file.size });
            void this.#fetch({ quiet: true });
          } else if (result.problem.type === aborted) {
            // A cancel that comes once the whole body has gone out may still land, the emulator
            // storing it before its answer arrives; the quiet refresh lists it if it did, so the
            // list never leaves out a document that exists.
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

  /** Changes the upload's fields; a finished upload drops its controller, which has nothing left
   * to cancel. */
  #update(id: string, changes: Partial<Upload>) {
    this.uploads = this.uploads.map((upload) => {
      if (upload.id !== id || upload.state !== "uploading") return upload;
      const next = { ...upload, ...changes };
      if (next.state !== "uploading") delete next.abort;
      return next;
    });
  }
}

customElements.define(documentsTag, PipelineDocuments);
