// The view for a path no route matches, a removed one such as "/about" included: it says so and
// links back to the event log. Loaded on its first use.

import { html, LitElement } from "lit";

import { frame } from "./view.ts";

export const notFoundTag = "pipeline-not-found";

class PipelineNotFound extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  render() {
    return frame(
      "Not found",
      html`<p>Nothing in the workspace lives at this address.</p>
        <p><a href=".">Go to the event log</a></p>`,
    );
  }
}

customElements.define(notFoundTag, PipelineNotFound);
