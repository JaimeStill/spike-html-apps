// One build of the pipeline app, served by the binary at /app and at the root: under each mount,
// Vite's relative base, the shell's <base href>, and the router's base agree, so every asset loads,
// a deep link and a reload reach the router, and back and forward move between its routes.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { launch } from "@jaimestill/spike-html-apps-tooling/browser.js";

import { click, mounted, openWith, reload, route, traverse } from "./support/app.js";
import { start } from "./support/emulator.js";

let browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

for (const mount of ["/app", "/"]) {
  describe(`the build at ${mount}`, () => {
    let emulator;
    before(async () => {
      emulator = await start({ mount });
    });
    after(async () => {
      await emulator?.stop();
    });

    test("loads every asset, and a deep link, a reload, and history reach the router", async (t) => {
      const { origin, base } = emulator;
      // Every response and failed load the page's network log records, from the first request.
      const responses = [];
      const failures = [];
      const page = await openWith(browser, "about:blank", async (page) => {
        page.on("Network.responseReceived", ({ response }) =>
          responses.push({ url: response.url, status: response.status }),
        );
        page.on("Network.loadingFailed", ({ requestId, errorText }) =>
          failures.push({ requestId, errorText }),
        );
        await page.cdp("Network.enable");
      });
      try {
        // The deep link: the server sends the shell, and the router mounts the lazy route.
        await page.goto(`${origin}${base}about`);
        await mounted(page, "pipeline-about");
        assert.deepEqual(await route(page), { path: `${base}about`, tag: "pipeline-about" });
        assert.equal(await page.evaluate("document.baseURI"), `${origin}${base}`);

        await reload(page);
        await mounted(page, "pipeline-about");
        assert.deepEqual(await route(page), { path: `${base}about`, tag: "pipeline-about" });

        // The nav's links are relative to the base, and the router takes their clicks.
        await click(page, "Log");
        await mounted(page, "pipeline-log");
        assert.deepEqual(await route(page), { path: base, tag: "pipeline-log" });

        await traverse(page, -1);
        await mounted(page, "pipeline-about");
        assert.deepEqual(await route(page), { path: `${base}about`, tag: "pipeline-about" });
        await traverse(page, 1);
        await mounted(page, "pipeline-log");
        assert.deepEqual(await route(page), { path: base, tag: "pipeline-log" });

        for (const { url, status } of responses) t.diagnostic(`${status} ${url}`);
        assert.deepEqual(failures, []);
        assert.deepEqual(
          responses.filter(({ status }) => status >= 400),
          [],
        );
        // Each load of the shell, then the entry and the about chunk under the base's assets/.
        const assets = responses.filter(({ url }) => url.startsWith(`${origin}${base}assets/`));
        assert.ok(
          assets.some(({ url }) => /\/main-[\w-]+\.js$/.test(url)),
          "the entry loaded",
        );
        assert.ok(
          assets.some(({ url }) => /\/about-[\w-]+\.js$/.test(url)),
          "the chunk loaded",
        );
        assert.ok(responses.every(({ url }) => url.startsWith(`${origin}${base}`)));
      } finally {
        await page.close();
      }
    });
  });
}
