// The "/search" route: the matches for the query in ?q=, which the header's search field submits,
// through the components' sl-search-results, the query marked in each match's name and snippet.
// Activating a match opens its document's view. A new query from the field changes only the
// location's query, so the view stays mounted and follows the router's change event, aborting the
// search in flight for the one that replaces it. Loaded on its first visit.
//
// The results' status line says where the search stands: the prompt with no query, searching, the
// count of matches, none, or that the search failed and why, with Try again below it. While a new
// query is searched, the last query's matches stay listed, marked busy, so the list doesn't empty
// and refill. The view reads the first page of matches, at the largest page size the document list
// offers; a query that matches more says how many more below the list, which a narrower query
// reaches. A blank query asks nothing of the API, which refuses one, and shows the prompt.

import { html, LitElement, nothing } from "lit";
import type { PropertyValues } from "lit";

import "@jaimestill/spike-html-apps-components/search-results.js";
import type {
  SearchMatch,
  SearchOpenDetail,
  SearchState,
} from "@jaimestill/spike-html-apps-components/search-results.js";

import { appApi } from "../api.ts";
import { appRouter, queryParam } from "../route.ts";
import { frame } from "./view.ts";

export const searchTag = "pipeline-search";

/** The matches a search reads: the first page, at the document list's largest page size. */
export const searchSize = 96;

class PipelineSearch extends LitElement {
  static properties = {
    query: { state: true },
    items: { state: true },
    state: { state: true },
    message: { state: true },
    total: { state: true },
  };

  /** The query the view shows the matches for, ?q= trimmed. */
  declare query: string;
  /** The matches shown, the first page's. */
  declare items: readonly SearchMatch[];
  declare state: SearchState;
  /** Why the search failed: the problem's title. */
  declare message: string;
  /** How many documents match in all, when more than the page shown; null when the page is all. */
  declare total: number | null;

  /** Aborts the search in flight when another replaces it or the view leaves. */
  #search: AbortController | undefined;

  #follow = () => {
    this.query = queryParam("q").trim();
  };

  constructor() {
    super();
    this.query = "";
    this.items = [];
    this.state = "ready";
    this.message = "";
    this.total = null;
  }

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
    this.#search?.abort();
  }

  protected updated(changed: PropertyValues<this>) {
    if (changed.has("query")) void this.#fetch();
  }

  /** Searches for the query, the matches shown kept, busy, until the answer replaces them. */
  async #fetch(): Promise<void> {
    this.#search?.abort();
    const query = this.query;
    if (!query) {
      this.items = [];
      this.total = null;
      this.state = "ready";
      return;
    }
    const search = new AbortController();
    this.#search = search;
    const { signal } = search;
    this.state = "loading";
    const found = await appApi().search.search({ q: query, page: 1, size: searchSize }, signal);
    if (signal.aborted) return;
    if (!found.ok) {
      this.items = [];
      this.total = null;
      this.message = found.problem.title;
      this.state = "error";
      return;
    }
    const { items, more, total } = found.data;
    this.items = items;
    this.total = more ? (total ?? null) : null;
    this.message = "";
    this.state = "ready";
  }

  #open({ id }: SearchOpenDetail) {
    void appRouter().navigate(`documents/${encodeURIComponent(id)}`);
  }

  render() {
    const { total, items } = this;
    return frame(
      "Search",
      html`<sl-search-results
          .query=${this.query}
          .items=${items}
          .state=${this.state}
          .message=${this.message}
          @open=${(e: CustomEvent<SearchOpenDetail>) => this.#open(e.detail)}
        ></sl-search-results>
        ${
          this.state === "error"
            ? html`<button type="button" class="search-retry" @click=${() => void this.#fetch()}>
                Try again
              </button>`
            : nothing
        }
        ${
          this.state === "ready" && total !== null && total > items.length
            ? html`<p class="search-more">
                The first ${items.length} of ${total} matches; a narrower search finds the rest.
              </p>`
            : nothing
        }`,
    );
  }
}

customElements.define(searchTag, PipelineSearch);
