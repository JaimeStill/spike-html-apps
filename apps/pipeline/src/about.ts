// The "/about" route: static text, loaded on its first visit, so a deep link, a reload, and back
// and forward each have a second route to land on, and the build a chunk that resolves against
// the relative base.

export const aboutTag = "pipeline-about";

class PipelineAbout extends HTMLElement {
  connectedCallback() {
    const heading = document.createElement("h1");
    heading.textContent = "About";
    const text = document.createElement("p");
    text.textContent = "The pipeline app over the emulator: its run stage events, live.";
    this.replaceChildren(heading, text);
  }
}

customElements.define(aboutTag, PipelineAbout);
