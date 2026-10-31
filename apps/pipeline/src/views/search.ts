// The "/search" route: the matches for the query in ?q=, which the header's search field submits,
// a placeholder until slice 16 composes sl-search-results here. A new query from the field
// changes only the location's query, so the view stays mounted and follows the router's change
// event. Loaded on its first visit.

import { html, LitElement } from "lit";

import { appRouter, queryParam } from "../route.ts";
import { frame, placeholder } from "./view.ts";

export const searchTag = "pipeline-search";

class PipelineSearch extends LitElement {
  static properties = { query: { state: true } };

  /** The query the view shows the matches for, ?q=. */
  declare query: string;

  #follow = () => {
    this.query = queryParam("q");
  };

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#follow();
    appRouter().addEventListener("change", this.#follow);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    appRouter().removeEventListener("change", this.#follow);
  }

  render() {
    const query = this.query.trim();
    return frame(
      "Search",
      query
        ? html`<p class="view-meta">Matches for <q data-query>${query}</q></p>
            ${placeholder("Each document whose name or text matches shows here.")}`
        : placeholder("Search the documents by name or text from the field above."),
    );
  }
}

customElements.define(searchTag, PipelineSearch);
