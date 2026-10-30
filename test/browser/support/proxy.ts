// The browser tier's second origin: a plain http proxy on another loopback port that forwards every
// request to an emulator, so a page loads the emulator's own app, shell and config included, from
// an origin other than the emulator's. With `rewrite`, it rewrites each HTML answer (the shell) on
// its way to the page. A page the proxy answers is still a loopback page to the browser, unlike one
// the DevTools Protocol's Fetch domain fulfills, which the browser takes for a public page whose
// requests to the loopback address its Local Network Access checks block.

import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Proxies the origin `target()` returns, read at each request, so the proxy can start before the
 * emulator that names its origin; resolves to its origin and a stop(). `rewrite` maps each
 * text/html body.
 */
export async function proxy(
  target: () => string,
  rewrite: (html: string) => string = (html) => html,
): Promise<{ origin: string; stop: () => Promise<void> }> {
  const server = createServer((incoming, outgoing) => {
    const { hostname, port } = new URL(target());
    const forward = request(
      { hostname, port, path: incoming.url, method: incoming.method, headers: incoming.headers },
      async (answer) => {
        if (!answer.headers["content-type"]?.startsWith("text/html")) {
          // An answer from a request the client made always carries its status.
          outgoing.writeHead(answer.statusCode!, answer.headers);
          answer.pipe(outgoing);
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of answer) chunks.push(chunk);
        const body = Buffer.from(rewrite(Buffer.concat(chunks).toString("utf8")));
        outgoing.writeHead(answer.statusCode!, {
          ...answer.headers,
          "content-length": body.length,
        });
        outgoing.end(body);
      },
    );
    forward.on("error", () => outgoing.destroy());
    incoming.pipe(forward);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    // A server listening on a host and port has an AddressInfo, never a pipe's path.
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
