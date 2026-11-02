// The client's frame, <external-client>: a header holding the title and the theme menu, and the
// main region, which says the services are loading, then shows a panel for each service
// services.json lists, side by side when the viewport is wide enough and stacked below it; or, when
// the file is missing or isn't a service list, an error naming it. It renders into light DOM, so
// the page's sheets style it and the foundation's preferences module's <sl-theme-menu> opens from
// its button by the invoker command --open.

import { html, LitElement } from "lit";
import type { TemplateResult } from "lit";

import "./panel.ts";
import type { Loaded } from "./services.ts";

/** The frame's tag, which main creates. */
export const clientTag = "external-client";

/** The client's frame: its header, then a panel per service, or what kept the services from
 * loading. */
export class ExternalClient extends LitElement {
  static properties = {
    loaded: { attribute: false },
  };

  /** What reading services.json came to; undefined while it loads. */
  declare loaded: Loaded | undefined;

  protected createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <header class="client-header">
        <h1 class="client-title">External client</h1>
        <button type="button" commandfor="theme" command="--open">Theme</button>
        <sl-theme-menu id="theme"></sl-theme-menu>
      </header>
      <main class="client-main">${this.#main()}</main>
    `;
  }

  #main(): TemplateResult {
    const loaded = this.loaded;
    if (!loaded) return html`<p class="client-loading" role="status">Loading the services…</p>`;
    if (!loaded.ok) {
      return html`<div class="client-error" role="alert">
        <h2>The services couldn't be loaded</h2>
        <p class="client-message">${loaded.message}</p>
      </div>`;
    }
    return html`<div class="client-panels">
      ${loaded.services.map(
        (service, i) =>
          html`<external-panel .service=${service} .key=${`panel-${i + 1}`}></external-panel>`,
      )}
    </div>`;
  }
}

customElements.define(clientTag, ExternalClient);
