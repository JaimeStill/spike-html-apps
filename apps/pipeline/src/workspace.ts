// The app's frame, <pipeline-workspace>: a header holding the title, the search field, the help
// button, and the theme menu; a side pane holding the views' navigation, the upload dropzone, and
// the document list (placeholders until slice 13); the main pane, the router's outlet, which shows
// one view; and the help dialog. It renders into light DOM, so the foundation's keys module, which
// reads data-keys from the document, binds its controls, and the page's sheets style it.
//
// The shortcuts are the foundation's: data-keys on the search field (/), which keys.js focuses,
// and on the help (?) and theme (t) buttons, which it clicks; the help button opens the dialog by
// the invoker command show-modal, and keys.js fills its [data-keys-list] with every binding as it
// opens; the theme button sends <sl-theme-menu> its --open command. Escape closes either modal
// dialog natively. keys.js fires none of them while a key is typed in a text field.

import { html, LitElement } from "lit";
import { live } from "lit/directives/live.js";

import type { Match } from "@jaimestill/spike-html-apps-sdk/router.js";

export const workspaceTag = "pipeline-workspace";

/** The views the side pane's navigation links to: each one's route pattern, href relative to the
 * base, and text. */
const VIEWS = [
  { pattern: "/", href: ".", text: "Event log" },
  { pattern: "/chat", href: "chat", text: "Chat" },
] as const;

export class PipelineWorkspace extends LitElement {
  static properties = { route: { attribute: false } };

  /** The route the router mounted, which marks the current view's link and fills the search
   * field on the search view; undefined before the first mount and where no route matches. */
  declare route: Match | undefined;

  protected createRenderRoot() {
    return this;
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
    return html`
      <header class="workspace-header">
        <a class="workspace-title" href=".">Pipeline</a>
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
      <aside class="workspace-side" aria-label="Workspace">
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
        <section class="workspace-pane" aria-labelledby="upload-heading">
          <h2 id="upload-heading">Upload</h2>
          <p class="view-placeholder">Drop files here, or choose them, to start a run.</p>
        </section>
        <section class="workspace-pane" aria-labelledby="documents-heading">
          <h2 id="documents-heading">Documents</h2>
          <p class="view-placeholder">Each uploaded document and its run's status, a page at a time.</p>
        </section>
      </aside>
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
