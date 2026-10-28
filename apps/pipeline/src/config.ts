// The shell's config: the server writes the HTML that loads this app, and in it a JSON script
// element, its id configId, holding an AppConfig. The app reads it once, at start.

/** The id of the `<script type="application/json">` element the shell writes the config into. */
export const configId = "app-config";

/** The config the shell writes. Every member is present, and the token is never empty: the
 * emulator's NATS server requires one, and the shell always writes it. */
export interface AppConfig {
  /** The emulator's API, a URL or a path; the app resolves it against the document's base. */
  apiBase: string;
  nats: {
    /** The NATS server's WebSocket URL (ws:// or wss://). */
    url: string;
    /** The JetStream stream that holds the emulator's events. */
    stream: string;
    /** The static token the NATS server requires; never empty. */
    token: string;
  };
}

/** The shell's config, parsed from its element; throws, naming the element, when it is missing or
 * isn't an AppConfig, an empty token included. */
export function readConfig(doc: Document = document): AppConfig {
  const element = doc.getElementById(configId);
  if (!element || element.getAttribute("type") !== "application/json") {
    throw new Error(`the shell wrote no <script type="application/json" id="${configId}">`);
  }
  const config: unknown = JSON.parse(element.textContent ?? "");
  if (!isConfig(config)) throw new Error(`#${configId} doesn't hold an AppConfig`);
  return config;
}

function isConfig(value: unknown): value is AppConfig {
  const config = value as Partial<AppConfig> | null;
  const nats = config?.nats;
  return (
    typeof config?.apiBase === "string" &&
    typeof nats?.url === "string" &&
    typeof nats.stream === "string" &&
    typeof nats.token === "string" &&
    nats.token !== ""
  );
}
