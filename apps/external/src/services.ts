// Where the services are: services.json, beside the build, which the client fetches relative to
// its page at start. The client is static files hosted apart from the services it calls, so the
// host, not the build, says where they are: the same build calls any services a host's file lists.
// The file is a ServiceList; the client shows a panel for each service it lists, in order.
//
//   {
//     "services": [
//       {
//         "name": "Service A",
//         "apiBase": "http://127.0.0.1:8181/api",
//         "nats": { "url": "ws://127.0.0.1:4322", "stream": "EMULATOR", "token": "…" }
//       },
//       …
//     ]
//   }

/** The file's name, which every failure to read it names. */
export const servicesFile = "services.json";

/** A service as the file lists it: the name its panel shows, its API, and its event stream. Every
 * member is a string that isn't empty. */
export interface Service {
  name: string;
  /** The service's API, an absolute URL, on the service's origin. */
  apiBase: string;
  nats: {
    /** The service's NATS WebSocket URL (ws:// or wss://). */
    url: string;
    /** The JetStream stream that holds the service's events. */
    stream: string;
    /** The static token the service's API and NATS server take. */
    token: string;
  };
}

/** The file's content: the services, at least one. */
export interface ServiceList {
  services: Service[];
}

/** What reading the file came to: the services, or why there are none, a message naming the
 * file. */
export type Loaded = { ok: true; services: Service[] } | { ok: false; message: string };

/** Fetches the file relative to the page and reads it, resolving to its services or to why it
 * holds none, never rejecting: the file unreachable, missing or failing (any status but 2xx), not
 * JSON, or not a ServiceList, the message naming the file and what is wrong with it. */
export async function loadServices(base: string = document.baseURI): Promise<Loaded> {
  const url = new URL(servicesFile, base);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    return failed(`couldn't be fetched (${messageOf(error)})`);
  }
  if (!response.ok) {
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    return failed(response.status === 404 ? `wasn't found (${status})` : `failed (${status})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch (error) {
    return failed(`isn't JSON (${messageOf(error)})`);
  }
  const wrong = problemOf(parsed);
  if (wrong) return failed(`isn't a service list: ${wrong}`);
  return { ok: true, services: (parsed as ServiceList).services };
}

const failed = (what: string): Loaded => ({ ok: false, message: `${servicesFile} ${what}.` });

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What makes the value no ServiceList, the first member found wrong, or "" when it is one. */
function problemOf(value: unknown): string {
  const list = value as Partial<ServiceList> | null;
  if (typeof list !== "object" || list === null || Array.isArray(list)) return "not an object";
  if (!Array.isArray(list.services)) return "services is not an array";
  if (list.services.length === 0) return "services lists none";
  for (const [i, service] of list.services.entries()) {
    const at = `services[${i}]`;
    if (typeof service !== "object" || service === null) return `${at} is not an object`;
    for (const key of ["name", "apiBase"] as const) {
      if (!filled(service[key])) return `${at}.${key} is not a string with text`;
    }
    if (typeof service.nats !== "object" || service.nats === null) {
      return `${at}.nats is not an object`;
    }
    for (const key of ["url", "stream", "token"] as const) {
      if (!filled(service.nats[key])) return `${at}.nats.${key} is not a string with text`;
    }
    if (!URL.canParse(service.apiBase)) return `${at}.apiBase is not an absolute URL`;
    if (!URL.canParse(service.nats.url)) return `${at}.nats.url is not an absolute URL`;
  }
  return "";
}

const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";
