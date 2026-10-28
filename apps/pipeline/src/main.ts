// The pipeline app's entry, the module the shell's script tag loads: it reads the shell's config,
// opens the NATS sequence with the config's static token, and starts the router over its two
// routes in an outlet it adds to the body. The router's base is the document's <base href>, which
// the shell writes; links are relative to it.

import type { TokenProvider } from "@jaimestill/spike-html-apps-sdk/auth.js";
import { natsSequence } from "@jaimestill/spike-html-apps-sdk/events/nats.js";
import { createRouter } from "@jaimestill/spike-html-apps-sdk/router.js";

import { readConfig } from "./config.ts";
import { PipelineLog, useEvents } from "./log.ts";

const config = readConfig();

/** The config's token, which never changes, so there is nothing to refresh to. */
const token: TokenProvider = {
  token: async () => config.nats.token || undefined,
  refresh: async () => undefined,
};

useEvents(natsSequence({ servers: config.nats.url, stream: config.nats.stream, token }));
customElements.define("pipeline-log", PipelineLog);

/** A link to a path relative to the base. */
function link(href: string, text: string) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  return a;
}

const nav = document.createElement("nav");
nav.append(link(".", "Log"), " ", link("about", "About"));
const outlet = document.createElement("main");
document.body.append(nav, outlet);

const router = createRouter(
  {
    "/": "pipeline-log",
    "/about": async () => (await import("./about.ts")).aboutTag,
  },
  { outlet },
);
await router.start();
