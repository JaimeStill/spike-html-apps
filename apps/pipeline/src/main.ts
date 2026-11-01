// The pipeline app's entry, the module the shell's last script tag loads, after register.ts and
// preferences.ts have run render-blocking: it reads the shell's config, makes the API client on its
// base, opens the NATS sequence with the config's static token and starts the app's one live feed
// of run events over it (live.ts), renders the workspace into the body, and starts the router over
// the main pane's views in the workspace's outlet. The router's base is the document's <base href>,
// which the shell writes; links are relative to it. The event log is defined here; every other view
// loads on its first visit.

import "@jaimestill/spike-html-apps-foundation/keys.js";

import { createClient } from "@jaimestill/spike-html-apps-sdk/api.js";
import type { TokenProvider } from "@jaimestill/spike-html-apps-sdk/auth.js";
import { natsSequence } from "@jaimestill/spike-html-apps-sdk/events/nats.js";
import { createRouter } from "@jaimestill/spike-html-apps-sdk/router.js";

import { useClient } from "./api.ts";
import { readConfig } from "./config.ts";
import { StageFeed, useFeed } from "./live.ts";
import type { RunData } from "./live.ts";
import { PipelineLog, useEvents } from "./log.ts";
import { useRouter } from "./route.ts";
import { PipelineWorkspace, workspaceTag } from "./workspace.ts";
import "./workspace.css";

const config = readConfig();

/** The config's token, which never changes, so there is nothing to refresh to. */
const token: TokenProvider = {
  token: async () => config.nats.token,
  refresh: async () => undefined,
};

useClient(createClient({ base: config.apiBase }));

// The one sequence, and so the one connection, the app reads; the feed is its one read of the
// run events, which the side pane's list follows and the log, until slice 16, reads beside.
const sequence = natsSequence<RunData>({
  servers: config.nats.url,
  stream: config.nats.stream,
  token,
});
const feed = new StageFeed(sequence);
useFeed(feed);
feed.start();
useEvents(sequence);
customElements.define("pipeline-log", PipelineLog);

const workspace = document.createElement(workspaceTag) as PipelineWorkspace;
document.body.append(workspace);
await workspace.updateComplete;

const router = createRouter(
  {
    "/": "pipeline-log",
    "/chat": async () => (await import("./views/chat.ts")).chatTag,
    "/search": async () => (await import("./views/search.ts")).searchTag,
    "/documents/:document": async () => (await import("./views/document.ts")).documentTag,
  },
  {
    outlet: workspace.outlet,
    notFound: async () => (await import("./views/not-found.ts")).notFoundTag,
  },
);
useRouter(router);
router.addEventListener("change", () => {
  workspace.route = router.current;
});
await router.start();
