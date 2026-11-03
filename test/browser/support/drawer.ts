// The browser tier's reading of the documents drawer: the workspace's <sl-drawer>, which holds
// <pipeline-documents>, and the header's documents button, its badge, and its live region, read
// as the page renders them; and a drag of files entering the window, as one from the desktop
// starts.

import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

/** The drawer, as a page expression. */
export const DRAWER = "document.querySelector('pipeline-workspace sl-drawer')";

/** The header's documents button, as a page expression. */
export const BUTTON = "document.querySelector('.workspace-documents button')";

/** The drawer's Close button, as a page expression. */
export const CLOSE = `${DRAWER}.shadowRoot.querySelector('dialog header button')`;

/** The drawer and its button as the page shows them: the drawer's mode and whether its dialog is
 * open modally, where focus is, and the button's visibility, expanded state, badges, and live
 * region's text. */
export interface Shown {
  mode: "docked" | "drawer";
  modal: boolean;
  focus: "close" | "button" | "search" | "body" | "other";
  button: boolean;
  expanded: string | null;
  badges: string[];
  said: string;
}

/** The drawer and its button as the page shows them now. */
export const shown = (page: Page): Promise<Shown> =>
  page.evaluate(`(() => {
    const drawer = ${DRAWER};
    const button = ${BUTTON};
    const dialog = drawer.shadowRoot.querySelector("dialog");
    const el = document.activeElement;
    const focus =
      el === drawer && drawer.shadowRoot.activeElement === ${CLOSE} ? "close"
      : el === button ? "button"
      : el?.matches("input[name=q]") ? "search"
      : el === document.body ? "body" : "other";
    return {
      mode: drawer.matches(":state(docked)") ? "docked" : "drawer",
      modal: dialog?.matches(":modal") ?? false,
      focus,
      button: button.checkVisibility(),
      expanded: button.getAttribute("aria-expanded"),
      badges: [...button.querySelectorAll(".workspace-badge")].map((b) => b.textContent.trim()),
      said: document.getElementById(button.getAttribute("aria-describedby")).textContent.trim(),
    };
  })()`);

/** Dispatches dragenter on the main pane, bubbling to the window, as a drag carrying `kind` (a
 * file, or text) enters the page. */
export async function dragEnter(page: Page, kind: "file" | "text"): Promise<void> {
  await page.evaluate(`(() => {
    const transfer = new DataTransfer();
    if (${JSON.stringify(kind)} === "file") transfer.items.add(new File(["a"], "dragged.txt"));
    else transfer.setData("text/plain", "dragged text");
    document.querySelector("main").dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true, composed: true, cancelable: true }),
    );
  })()`);
}
