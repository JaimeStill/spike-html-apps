// The frame the main pane's views share: the view's heading over its body. Views render into
// light DOM, as the workspace does, so the page's foundation sheets and the app's own layer style
// them.

import { html } from "lit";
import type { TemplateResult } from "lit";

/** A view's heading and its body, inside the view's frame. */
export const frame = (heading: string, body: TemplateResult): TemplateResult => html`
  <header class="view-header"><h1>${heading}</h1></header>
  <div class="view-body">${body}</div>
`;
