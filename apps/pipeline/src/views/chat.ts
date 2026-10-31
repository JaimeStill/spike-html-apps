// The "/chat" route: the conversation over the emulator's scripted responses, a placeholder until
// slice 15 composes sl-chat-thread and sl-composer here. Loaded on its first visit.

import { LitElement } from "lit";

import { frame, placeholder } from "./view.ts";

export const chatTag = "pipeline-chat";

class PipelineChat extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  render() {
    return frame(
      "Chat",
      placeholder("Ask about the documents in the workspace; replies stream in here."),
    );
  }
}

customElements.define(chatTag, PipelineChat);
