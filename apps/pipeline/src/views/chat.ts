// The "/chat" route: the conversation with the emulator's scripted assistant, its thread in
// sl-chat-thread and the message being written in sl-composer, over the app's one conversation
// (conversation.ts), which outlives the view, so leaving the chat and coming back keeps the
// thread, its draft, and a reply still streaming. Loaded on its first visit. The thread is
// verbose, so a reply's reasoning, function calls, and their outputs show ahead of its message,
// each collapsed in its own details until the reader opens it.
//
// The composer binds no key, so the view does, on the composer, where a key typed in its field
// reaches the view before the foundation's keys module, which listens on the document: Enter
// calls the composer's send(), which keeps its rules (nothing sent while the text is blank or a
// reply streams), and Shift+Enter is the field's own newline. While a reply streams, Escape
// stops it, from the composer's field or its Stop button, and from anywhere else outside a field
// by a binding the view registers with the keys module for as long as the reply streams, so the
// help dialog lists it then.
//
// The precedence, highest first: an open modal dialog's Escape closes it, natively, and keys.js
// fires no registered binding while one is open; Escape in the composer while a reply streams
// stops it, and the view's listener cancels the press, which keys.js passes over, so the field
// keeps focus and the reader drafts on; Escape in any other field leaves it, keys.js's release;
// and Escape elsewhere, while a reply streams, stops it, the registered binding. With nothing
// streaming the view takes no Escape, so in the composer it leaves the field as in any other.
//
// The thread follows the newest item as a reply streams, unless the reader has scrolled up from
// the end; scrolling back to the end follows again. sl-chat-thread doesn't follow by itself, and
// its own frame scrolls only when it is held short, so the view leaves it at its content's height
// and follows in the pane that scrolls: the main pane, docked, and the page below the dock. The
// composer is sticky at the bottom of that same scroll, the main pane's or the viewport's, so it
// stays in reach above the thread however long it grows, as a phone's keyboard expects; the view
// fills the pane, so the composer sits at its bottom even while the thread is short.

import { html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";

import "@jaimestill/spike-html-apps-components/chat-thread.js";
import type { ChatThread } from "@jaimestill/spike-html-apps-components/chat-thread.js";
import "@jaimestill/spike-html-apps-components/composer.js";
import type { Composer, SendDetail } from "@jaimestill/spike-html-apps-components/composer.js";
import { register } from "@jaimestill/spike-html-apps-foundation/keys.js";

import { chatSession } from "../conversation.ts";
import type { ChatSession } from "../conversation.ts";

export const chatTag = "pipeline-chat";

/** How near its end, in px, a scroll counts as at the end: the reader hasn't scrolled up. */
const END = 24;

/** The status line's text for the session: what the reader waits on, or nothing. */
export function statusOf(session: ChatSession): string {
  switch (session.phase) {
    case "loading":
      return "Loading the conversation…";
    case "sending":
      return "Sending…";
    case "streaming": {
      // The item the reply is on: its reasoning, its function call and the call's output, then
      // its message, as the rich reply (/rich) streams them.
      const last = session.items.at(-1);
      if (last?.type === "reasoning") return "Reasoning…";
      if (last?.type === "function_call" || last?.type === "function_call_output")
        return "Calling a function…";
      const started =
        last?.type === "message" &&
        last.role === "assistant" &&
        last.content.some((part) => part.type === "output_text" && part.text !== "");
      return started ? "Replying…" : "Waiting for the reply…";
    }
    default:
      return "";
  }
}

class PipelineChat extends LitElement {
  readonly #session = chatSession();
  #disconnect: AbortController | undefined;
  /** Removes the Escape binding registered while a reply streams. */
  #unbind: (() => void) | undefined;
  /** Whether the scroll is at its end, so the thread follows the newest item. */
  #following = true;

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    this.#session.addEventListener("change", () => this.#changed(), { signal });
    // Scroll doesn't bubble: captured on the document, it is heard from the main pane too.
    document.addEventListener(
      "scroll",
      () => {
        this.#following = this.#atEnd();
      },
      { capture: true, passive: true, signal },
    );
    this.#session.load();
    this.#bind();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#unbind?.();
    this.#unbind = undefined;
    const composer = this.#composer;
    if (composer) this.#session.draft = composer.value;
  }

  protected async firstUpdated() {
    const composer = this.#composer;
    if (composer) composer.value = this.#session.draft;
    this.#following = true;
    await this.#follow();
  }

  get #composer(): Composer | null {
    return this.querySelector("sl-composer");
  }

  /** The element that scrolls the view: the main pane while it scrolls itself, docked, else the
   * page's. */
  get #scroller(): Element {
    const main = this.closest(".workspace-main");
    if (main && getComputedStyle(main).overflowY !== "visible") return main;
    return document.scrollingElement ?? document.documentElement;
  }

  #atEnd(): boolean {
    const { scrollTop, scrollHeight, clientHeight } = this.#scroller;
    return scrollHeight - scrollTop - clientHeight <= END;
  }

  /** Scrolls to the newest item once the thread has rendered, unless the reader scrolled up. */
  async #follow() {
    await this.updateComplete;
    await this.querySelector<ChatThread>("sl-chat-thread")?.updateComplete;
    if (!this.#following) return;
    const scroller = this.#scroller;
    scroller.scrollTop = scroller.scrollHeight;
  }

  /** Registers Escape, which stops the reply, while one streams, and removes it after. */
  #bind() {
    if (this.#session.busy && !this.#unbind)
      this.#unbind = register("Escape", "Stop the reply", () => this.#session.stop());
    else if (!this.#session.busy && this.#unbind) {
      this.#unbind();
      this.#unbind = undefined;
    }
  }

  #changed() {
    this.#bind();
    this.requestUpdate();
    void this.#follow();
  }

  #send(e: CustomEvent<SendDetail>) {
    // The reader just sent: the thread follows their message and its reply.
    this.#following = true;
    this.#session.send(e.detail.text);
  }

  /** Enter sends and Escape stops, in the composer; every other key is the field's. */
  #key(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing) return;
    const composer = e.currentTarget as Composer;
    if (e.key === "Escape" && this.#session.busy) {
      e.preventDefault();
      this.#session.stop();
      return;
    }
    // Enter in the field alone: on the button it is the button's own activation.
    const field = e.composedPath()[0] instanceof HTMLTextAreaElement;
    if (field && e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      composer.send();
    }
  }

  render(): TemplateResult {
    const session = this.#session;
    const { trouble, failure } = session;
    return html`
      <header class="view-header"><h1>Chat</h1></header>
      <div class="view-body chat-body">
        <sl-chat-thread verbose .items=${session.items}></sl-chat-thread>
        <div class="chat-footer">
          ${
            failure
              ? html`<p class="chat-error" role="alert">The reply failed. ${failure}</p>`
              : nothing
          }
          ${
            trouble
              ? html`<div class="chat-trouble" role="alert">
                  <p class="chat-error">
                    ${
                      trouble.kind === "load"
                        ? "Couldn't load the conversation."
                        : "Couldn't send the message."
                    }
                    ${trouble.message}
                  </p>
                  <button type="button" @click=${() => session.retry()}>Try again</button>
                </div>`
              : nothing
          }
          <sl-composer
            label="Message"
            placeholder="Ask about the documents"
            .busy=${session.busy}
            .disabled=${session.phase === "loading"}
            @send=${this.#send}
            @stop=${() => session.stop()}
            @keydown=${this.#key}
          ></sl-composer>
          <p class="chat-status">
            <span role="status">${statusOf(session)}</span>
            <span class="chat-hint"><kbd>Enter</kbd> sends, <kbd>Shift+Enter</kbd> adds a line</span>
          </p>
        </div>
      </div>
    `;
  }
}

customElements.define(chatTag, PipelineChat);
