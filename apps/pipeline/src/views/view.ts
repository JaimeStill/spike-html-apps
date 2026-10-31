// The frame every view in the main pane shares: its heading, and the placeholder text a view shows
// until a later slice fills it. Views render into light DOM, as the workspace does, so the page's
// foundation sheets and the app's own layer style them.

import { html } from "lit";
import type { TemplateResult } from "lit";

/** A view's heading and its body, inside the view's frame. */
export const frame = (heading: string, body: TemplateResult): TemplateResult => html`
  <header class="view-header"><h1>${heading}</h1></header>
  <div class="view-body">${body}</div>
`;

/** A view's placeholder: what it will show, said in one quiet paragraph. */
export const placeholder = (text: string): TemplateResult =>
  html`<p class="view-placeholder">${text}</p>`;
