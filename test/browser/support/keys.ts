// The browser tier's keyboard: real key presses through the DevTools Protocol, so the foundation's
// keys module, a field's typing, and a modal dialog's Escape each see what a keyboard sends.
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
    windowsVirtualKeyCode: letter ? key.toUpperCase().charCodeAt(0) : key === "Escape" ? 27 : 0,
  };
  const text = [...key].length === 1 ? { text: key } : {};
  await page.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...event, ...text });
  await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/** Presses `/`, the slash key. */
export const pressSlash = (page: Page) => press(page, "/", { code: "Slash" });

/** Presses `?`, Shift and the slash key. */
export const pressHelp = (page: Page) => press(page, "?", { code: "Slash", shift: true });

/** Presses Escape. */
export const pressEscape = (page: Page) => press(page, "Escape", { code: "Escape" });
