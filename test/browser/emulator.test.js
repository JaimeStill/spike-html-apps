// The tier's own harness: start launches the emulator again on fresh ports when a reserved port
// was taken before the emulator bound it, and on no other failure. No browser is needed.

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";

import { freePort, start } from "./support/emulator.js";

/** A reserve handing out `first` as its first port and a free one after, counting its calls. */
function reserving(first) {
  const reserve = async () => (++reserve.calls === 1 ? first : freePort());
  reserve.calls = 0;
  return reserve;
}

test("a boot whose first reserved port is taken launches again on fresh ports", async () => {
  // The holder drops each connection, so its close is prompt; it never answers HTTP.
  const held = createServer((socket) => socket.destroy());
  await new Promise((resolve) => held.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = held.address();
    const reserve = reserving(port);
    const emulator = await start({ reserve });
    try {
      assert.equal(emulator.launches, 2, "the held port's launch, then the fresh one's");
      assert.equal(reserve.calls, 6, "three ports a launch");
      assert.notEqual(emulator.origin, `http://127.0.0.1:${port}`);
      assert.equal((await fetch(`${emulator.origin}/healthz`)).status, 200);
    } finally {
      await emulator.stop();
    }
  } finally {
    await new Promise((resolve) => held.close(resolve));
  }
});

test("a boot that fails for any other reason launches once", async () => {
  const reserve = reserving(await freePort());
  await assert.rejects(start({ reserve, env: { EMULATOR_NATS_TOKEN: "" } }), /token/);
  assert.equal(reserve.calls, 3, "one launch's ports");
});
