// The browser tier's keyboard: real key presses through the DevTools Protocol, so the foundation's
// keys module, a field's typing, a text field's Enter, and a modal dialog's Escape each see what a
// keyboard sends.
// Adapted from spike-html-apps-foundation (8b12185): test/browser/keys.test.ts, its press helper.

import type { Page } from "@jaimestill/spike-html-apps-tooling/browser.js";

/** The protocol's modifier bits. */
const SHIFT = 8;

/**
 * Sends a real key press: keyDown then keyUp, with a US layout's code for a letter, and the text
 * a character types. `shift` holds Shift, as `?` needs.
 */
export async function press(
  page: Page,
  key: string,
  { code, shift = false }: { code?: string; shift?: boolean } = {},
): Promise<void> {
  const letter = /^[a-z]$/i.test(key);
  const event = {
    key,
    code: code ?? (letter ? `Key${key.toUpperCase()}` : ""),
    modifiers: shift ? SHIFT : 0,
    windowsVirtualKeyCode: letter
      ? key.toUpperCase().charCodeAt(0)
      : (({ Escape: 27, Tab: 9, Enter: 13 } as Record<string, number>)[key] ?? 0),
  };
  // Enter types a carriage return, which a text field takes as a line break.
  const text = [...key].length === 1 ? { text: key } : key === "Enter" ? { text: "\r" } : {};
  await page.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...event, ...text });
  await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/** Presses `/`, the slash key. */
export const pressSlash = (page: Page) => press(page, "/", { code: "Slash" });

/** Presses `?`, Shift and the slash key. */
export const pressHelp = (page: Page) => press(page, "?", { code: "Slash", shift: true });

/** Presses Escape. */
export const pressEscape = (page: Page) => press(page, "Escape", { code: "Escape" });

/** Presses Enter, or with `shift` Shift+Enter. */
export const pressEnter = (page: Page, shift = false) =>
  press(page, "Enter", { code: "Enter", shift });

/** Presses Tab, or with `shift` Shift+Tab: the browser moves focus to the next control, or the
 * previous one. */
export const pressTab = (page: Page, shift = false) => press(page, "Tab", { code: "Tab", shift });
