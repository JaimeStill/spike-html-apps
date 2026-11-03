// The app's router, which main starts, for the views it mounts: a view that reads the query, the
// search view's ?q=, follows the router's change event, which a query-only navigation dispatches
// with the view left mounted.

import type { Router } from "@jaimestill/spike-html-apps-sdk/router.js";

let router: Router | undefined;

/** Sets the router every view follows; main calls it before the router starts. */
export function useRouter(started: Router) {
  router = started;
}

/** The router main set; throws when a view mounts before useRouter was called. */
export function appRouter(): Router {
  if (!router) throw new Error("useRouter wasn't called before a view mounted");
  return router;
}

/** The location's query parameter `name`, or "" when it has none. A view reads the location, not
 * router.current, since the router mounts a view before it updates current. */
export function queryParam(name: string): string {
  return new URLSearchParams(location.search).get(name) ?? "";
}
