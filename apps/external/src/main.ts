// The client's entry, the one module index.html loads, render-blocking
// (vite.external.config.ts): its first imports are the foundation's full stylesheet and every
// built-in profile's registration, so the theme menu offers them all, then the preferences
// module, which applies the reader's stored theme choice to the root element before first paint
// and defines <sl-theme-menu>. It then renders the frame into the body, which says the services are
// loading, and with no top-level await, so rendering waits on nothing more, fetches services.json
// and hands the frame what it holds.

import "@jaimestill/spike-html-apps-foundation/page-full.css";
import "@jaimestill/spike-html-apps-foundation/register-full.js";
import "@jaimestill/spike-html-apps-foundation/preferences.js";

import { clientTag } from "./client.ts";
import type { ExternalClient } from "./client.ts";
import { loadServices } from "./services.ts";
import "./client.css";

const client = document.createElement(clientTag) as ExternalClient;
document.body.append(client);
void loadServices().then((loaded) => {
  client.loaded = loaded;
});
