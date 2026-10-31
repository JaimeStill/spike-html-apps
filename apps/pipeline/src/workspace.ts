// The app's frame, <pipeline-workspace>: a header holding the title, the search field, the
// documents button, the help button, and the theme menu; a side pane holding the views'
// navigation and, in an <sl-drawer>, <pipeline-documents>, the upload dropzone and the document
// list, its entry for the document the main pane shows marked; the main pane, the router's outlet,
// which shows one view; and the help dialog. It renders into light DOM, so the foundation's keys
// module, which reads data-keys from the document, binds its controls, and the page's sheets
// style it.
//
// The shortcuts are the foundation's: data-keys on the search field (/), which keys.js focuses,
// and on the documents (d), help (?), and theme (t) buttons, which it clicks; the help button
// opens the dialog by the invoker command show-modal, and keys.js fills its [data-keys-list] with
// every binding as it opens; the theme button sends <sl-theme-menu> its --open command. Escape
// closes either modal dialog natively. keys.js fires none of them while a key is typed in a text
// field.
//
// The drawer docks wider than the app's stacking width, DOCK: its documents sit in the side pane,
// below the navigation, and the documents button is hidden, so keys.js, which acts only on a
// rendered control, neither lists d nor fires it. At or below DOCK the drawer is a modal dialog,
// closed until the documents button, d, or files dragged onto the window open it; choosing an
// entry there navigates and closes it. The button counts the uploads in flight and marks an upload
// that failed while the drawer was closed, until it next opens, and says both through a polite
// live region. <pipeline-documents> is never moved: the drawer swaps only its own wrapper, so its
// uploads and its live statuses carry on while the drawer is closed and across a resize.

import { html, LitElement, nothing } from "lit";
import { live } from "lit/directives/live.js";

import "@jaimestill/spike-html-apps-components/drawer.js";
import type { Drawer } from "@jaimestill/spike-html-apps-components/drawer.js";
import type { Match } from "@jaimestill/spike-html-apps-sdk/router.js";

import "./documents.ts";
import type { UploadsChangeDetail } from "./documents.ts";

export const workspaceTag = "pipeline-workspace";

/** The views the side pane's navigation links to: each one's route pattern, href relative to the
 * base, and text. */
const VIEWS = [
  { pattern: "/", href: ".", text: "Event log" },
  { pattern: "/chat", href: "chat", text: "Chat" },
] as const;

/**
 * The app's stacking width, at or below which the drawer is a modal dialog and the header shows
 * its button. The drawer reads it in `(max-width: …)`, so it is a hair under 48rem: 768px, 48rem,
 * stays docked, as the app's layout below 48rem stacks; workspace.css's narrow query is the same.
 */
export const DOCK = "47.99rem";

/** What the documents button's live region says: the uploads in flight, and a failure. */
export function announcement(uploading: number, failed: boolean): string {
  const said: string[] = [];
  if (uploading > 0)
    said.push(`${uploading} ${uploading === 1 ? "upload" : "uploads"} in progress`);
  if (failed) said.push("an upload failed");
  const text = said.join(", ");
  return text && `${text[0].toUpperCase()}${text.slice(1)}.`;
}

export class PipelineWorkspace extends LitElement {
  static properties = {
    route: { attribute: false },
    drawerOpen: { state: true },
    uploading: { state: true },
    failed: { state: true },
  };

  /** The route the router mounted, which marks the current view's link and fills the search
   * field on the search view; undefined before the first mount and where no route matches. */
  declare route: Match | undefined;
  /** Whether the modal drawer is open, as its open and close events tell. */
  declare drawerOpen: boolean;
  /** How many uploads are in flight. */
  declare uploading: number;
  /** Whether an upload failed while the modal drawer was closed, since it last opened. */
  declare failed: boolean;

  /** The uploads seen failed, so each marks the button once. */
  readonly #failures = new Set<string>();
  #disconnect: AbortController | undefined;

  constructor() {
    super();
    this.drawerOpen = false;
    this.uploading = 0;
    this.failed = false;
  }

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect = new AbortController();
    // Files dragged onto the window while the drawer is closed open it, so its dropzone is there
    // to drop them on; a drag of anything but files, text or a link, leaves it be.
    window.addEventListener(
      "dragenter",
      (e) => {
        if (e.dataTransfer?.types.includes("Files")) this.#drawer?.show();
      },
      { signal: this.#disconnect.signal },
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
  }

  get #drawer(): Drawer | null {
    return this.querySelector("sl-drawer");
  }

  /** Whether the drawer is a modal dialog, at or below DOCK, rather than docked. */
  get #modal(): boolean {
    return this.#drawer?.matches(":state(drawer)") ?? false;
  }

  #uploads({ uploads }: UploadsChangeDetail) {
    this.uploading = uploads.filter((upload) => upload.state === "uploading").length;
    for (const upload of uploads) {
      if (upload.state !== "failed" || this.#failures.has(upload.id)) continue;
      this.#failures.add(upload.id);
      // A failure shown in the docked pane, or in the open drawer, has been seen.
      if (this.#modal && !this.drawerOpen) this.failed = true;
    }
  }

  /** The drawer opened or closed; events of the same names from its content are theirs. */
  #drawerChanged(e: Event) {
    if (e.target !== e.currentTarget) return;
    this.drawerOpen = e.type === "open";
    if (this.drawerOpen) this.failed = false;
  }

  /** The main pane, the router's outlet. The workspace renders nothing into it, so the router's
   * element is the only content Lit leaves alone there. */
  get outlet(): HTMLElement {
    const outlet = this.querySelector<HTMLElement>(".workspace-main");
    if (!outlet) throw new Error("the workspace hasn't rendered: await its updateComplete");
    return outlet;
  }

  render() {
    const pattern = this.route?.pattern;
    const query = pattern === "/search" ? (this.route?.query.get("q") ?? "") : "";
    const selected =
      pattern === "/documents/:document" ? (this.route?.params.document ?? null) : null;
    return html`
      <header class="workspace-header">
        <a class="workspace-title" href=".">Pipeline</a>
        <div class="workspace-find">
          <form class="workspace-search" role="search" action="search" method="get">
            <input
              type="search"
              name="q"
              aria-label="Search documents"
              placeholder="Search documents"
              autocomplete="off"
              data-keys="/"
              .value=${live(query)}
            />
          </form>
          <div class="workspace-documents">
              <button
                type="button"
                aria-label="Documents"
                aria-haspopup="dialog"
                aria-expanded=${this.drawerOpen ? "true" : "false"}
                aria-describedby="documents-said"
                data-keys="d"
                @click=${() => this.#drawer?.toggle()}
              >
                Documents <kbd>D</kbd>${
                  this.uploading > 0
                    ? html`<span class="workspace-badge" aria-hidden="true">${this.uploading}</span>`
                    : nothing
                }${
                  this.failed
                    ? html`<span class="workspace-badge workspace-failed" aria-hidden="true"
                        >!</span
                      >`
                    : nothing
                }
              </button>
              <span id="documents-said" class="workspace-hidden" role="status"
                >${announcement(this.uploading, this.failed)}</span
              >
          </div>
        </div>
        <div class="workspace-actions">
          <button type="button" commandfor="help" command="show-modal" data-keys="?">
            Help <kbd>?</kbd>
          </button>
          <button type="button" commandfor="theme" command="--open" data-keys="t">
            Theme <kbd>T</kbd>
          </button>
        </div>
        <sl-theme-menu id="theme"></sl-theme-menu>
      </header>
      <div class="workspace-side">
        <nav aria-label="Views">
          <ul>
            ${VIEWS.map(
              (view) =>
                html`<li>
                  <a href=${view.href} aria-current=${pattern === view.pattern ? "page" : "false"}
                    >${view.text}</a
                  >
                </li>`,
            )}
          </ul>
        </nav>
        <sl-drawer
          label="Documents"
          dock=${DOCK}
          @open=${this.#drawerChanged}
          @close=${this.#drawerChanged}
        >
          <pipeline-documents
            .selected=${selected}
            @uploads-change=${(e: CustomEvent<UploadsChangeDetail>) => this.#uploads(e.detail)}
            @open=${(e: Event) => {
              // An entry chosen: the list navigates, and the modal drawer gets out of the way.
              if ((e.target as Element).localName === "sl-document-list") this.#drawer?.close();
            }}
          ></pipeline-documents>
        </sl-drawer>
      </div>
      <main class="workspace-main"></main>
      <dialog id="help" class="workspace-help" aria-labelledby="help-title">
        <h2 id="help-title">Keyboard shortcuts</h2>
        <div data-keys-list></div>
        <p class="workspace-help-note"><kbd>Esc</kbd> closes a dialog.</p>
        <footer>
          <button type="button" commandfor="help" command="close" data-keys="?">
            Close <kbd>?</kbd>
          </button>
        </footer>
      </dialog>
    `;
  }
}

customElements.define(workspaceTag, PipelineWorkspace);
