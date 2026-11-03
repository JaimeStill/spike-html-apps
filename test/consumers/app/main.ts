// The consumer's app, which mise run consumers copies into each manager's consumer, builds with
// Vite, and loads (scripts/consumers.ts): it imports the four layers as a consumer outside the
// spike does, by package name, at the subpaths their exports name. The foundation's page entry
// and its profile registration, noctis's sheet and its registration, every component, and every
// entry of the sdk's; the router mounts one route, rendering each component with the least it
// needs, and the client reads the measure's JSON path and its problem path. What the measure reads
// is on window.consumer.

import "@jaimestill/spike-html-apps-foundation/page.css";
import "@jaimestill/spike-html-apps-foundation/register.js";
import "@jaimestill/spike-html-apps-noctis/noctis.css";
import "@jaimestill/spike-html-apps-noctis/noctis.js";
import { profiles } from "@jaimestill/spike-html-apps-foundation/registry.js";

import { tagName as artifactViewer } from "@jaimestill/spike-html-apps-components/artifact-viewer.js";
import { tagName as chatThread } from "@jaimestill/spike-html-apps-components/chat-thread.js";
import { tagName as composer } from "@jaimestill/spike-html-apps-components/composer.js";
import { tagName as documentList } from "@jaimestill/spike-html-apps-components/document-list.js";
import { tagName as drawer } from "@jaimestill/spike-html-apps-components/drawer.js";
import { tagName as entry } from "@jaimestill/spike-html-apps-components/entry.js";
import { tagName as eventLog } from "@jaimestill/spike-html-apps-components/event-log.js";
import { tagName as pagination } from "@jaimestill/spike-html-apps-components/pagination.js";
import { tagName as searchResults } from "@jaimestill/spike-html-apps-components/search-results.js";
import { tagName as stageTimeline } from "@jaimestill/spike-html-apps-components/stage-timeline.js";
import { tagName as statusBadge } from "@jaimestill/spike-html-apps-components/status-badge.js";
import { tagName as uploadDropzone } from "@jaimestill/spike-html-apps-components/upload-dropzone.js";

import { createClient } from "@jaimestill/spike-html-apps-sdk/api.js";
import { anonymous } from "@jaimestill/spike-html-apps-sdk/auth.js";
import { UnknownCursorError } from "@jaimestill/spike-html-apps-sdk/events.js";
import { natsSequence } from "@jaimestill/spike-html-apps-sdk/events/nats.js";
import { createRouter } from "@jaimestill/spike-html-apps-sdk/router.js";

/** Each component's tag, with the properties it is rendered with. */
const components: [string, Record<string, unknown>][] = [
  [artifactViewer, { name: "notes.md", contentType: "text/markdown", content: "# Notes" }],
  [chatThread, { items: [] }],
  [composer, { label: "Message" }],
  [documentList, { items: [], page: 1, size: 10, total: 0 }],
  [drawer, { label: "Drawer" }],
  [
    entry,
    {
      item: {
        id: "1",
        name: "a.pdf",
        status: "complete",
        updated_at: "2026-11-03T12:00:00Z",
        size: 1024,
        content_type: "application/pdf",
      },
    },
  ],
  [eventLog, { events: [] }],
  [pagination, { page: 1, size: 10, total: 25 }],
  [searchResults, { query: "", items: [] }],
  [stageTimeline, { stages: [{ name: "extract", position: 1, state: "active" }] }],
  [statusBadge, { label: "complete" }],
  [uploadDropzone, { uploads: [] }],
];

/** The route's element: each component, its properties set, in its light DOM. */
class ConsumerView extends HTMLElement {
  connectedCallback() {
    for (const [tag, properties] of components) {
      this.append(Object.assign(document.createElement(tag), properties));
    }
  }
}
customElements.define("consumer-view", ConsumerView);

const router = createRouter({ "/": "consumer-view" }, { outlet: document.querySelector("main")! });
await router.start();

const client = createClient({ base: "/api", auth: anonymous });
const [json, problem] = await Promise.all([client.get("/json"), client.get("/problem")]);

Object.assign(window, {
  consumer: {
    tags: components.map(([tag]) => tag),
    colors: profiles("color"),
    route: router.current?.pattern,
    json,
    problem,
    // The sdk's event entries, bundled and evaluated: their exports read, with no connection made.
    events: typeof natsSequence === "function" && UnknownCursorError.prototype instanceof Error,
  },
});
