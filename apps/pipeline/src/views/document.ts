// The "/documents/:document" route: one document, by the id the router sets as its document
// attribute, a placeholder until slice 14 composes its stage timeline and its content in
// sl-artifact-viewer here. Loaded on its first visit.

import { html, LitElement } from "lit";

import { frame, placeholder } from "./view.ts";

export const documentTag = "pipeline-document";

class PipelineDocument extends LitElement {
  static properties = { documentId: { attribute: "document" } };

  /** The document's id, the route's :document param. */
  declare documentId: string | undefined;

  protected createRenderRoot() {
    return this;
  }

  render() {
    return frame(
      "Document",
      html`<p class="view-meta">Document <code>${this.documentId ?? ""}</code></p>
        ${placeholder("Its stages, live, and its content show here.")}`,
    );
  }
}

customElements.define(documentTag, PipelineDocument);
