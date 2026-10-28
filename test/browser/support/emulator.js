// The browser tier's emulator: the binary EMULATOR_BINARY names (mise run test:browser builds
// cmd/server into a temporary directory, embedding the pipeline app's build), booted on reserved
// loopback ports with its configuration in its environment, as the integration tier's harness
// boots it, and driven over its HTTP API as a client drives it.
// Adapted from integration/harness.go: its Launch, Ready, and environment, in node.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The repository root, the binary's working directory, where it reads config.json. */
const root = join(import.meta.dirname, "../../..");

/** The nats token every emulator the tier boots is configured with. */
export const token = "browser-token";

/** The order a run's stages pass in. */
export const stageNames = ["upload", "metadata", "extraction", "chunks", "embeddings"];

/** How long a boot, a drain, or a run may take before the tier gives up on it. */
const failsafe = 15_000;

/** How many times start launches the emulator before it gives up on a boot that lost a port. */
export const bootAttempts = 5;

/** The bind's report of a port another socket holds, as the emulator's output names it. */
const addressInUse = /address already in use/;

/** A free loopback port: one the system hands out, released for the emulator to take. */
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Polls `check` every 25 ms until it resolves truthy, resolving to its value, and rejects naming
 * `what` after the failsafe or once `failed()` returns a reason. */
async function until(what, check, failed = () => undefined) {
  const deadline = Date.now() + failsafe;
  for (;;) {
    const reason = failed();
    if (reason) throw new Error(`${what}: ${reason}`);
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what}: not within ${failsafe} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Boots the emulator and resolves once its readiness probe answers. Its app is at `mount`; its
 * WebSocket listener, like its CORS, accepts `origins`, by default its own origin, where its app
 * is served; `env` adds or overrides variables last. No overlay applies (EMULATOR_ENV is empty),
 * and the stages pass every 100 ms. Its TMPDIR, where the embedded NATS server keeps its store,
 * is a directory of its own, which stop() requires empty and removes.
 *
 * A reserved port is released before the emulator binds it, and the check's tiers reserve and bind
 * loopback ports concurrently, so another process can take one in between: an emulator that exits
 * naming the bind's "address already in use" is launched again on freshly reserved ports, up to
 * bootAttempts launches in all; any other failure rejects at once. `reserve` reserves each port in
 * place of freePort, three per launch, the HTTP server's, the NATS client listener's, then the
 * WebSocket listener's; a test of the retry hands it a port another socket holds. The emulator
 * resolved to records its launches.
 */
export async function start({ mount = "/app", origins, env = {}, reserve = freePort } = {}) {
  const binary = process.env.EMULATOR_BINARY;
  if (!binary) throw new Error("EMULATOR_BINARY names no binary: run mise run test:browser");
  for (let launches = 1; ; launches++) {
    try {
      return await launch(binary, { mount, origins, env, reserve, launches });
    } catch (error) {
      if (!(error instanceof PortTaken) || launches === bootAttempts) throw error;
    }
  }
}

/** A launch whose emulator exited, before its readiness, naming a port another socket holds. */
class PortTaken extends Error {}

/** One launch of start's: the emulator on ports `reserve` hands out, resolving once it is ready,
 * and rejecting with PortTaken when it exits having lost one of them. */
async function launch(binary, { mount, origins, env, reserve, launches }) {
  const [port, natsPort, wsPort] = [await reserve(), await reserve(), await reserve()];
  const origin = `http://127.0.0.1:${port}`;
  const temp = mkdtempSync(join(tmpdir(), "browser-emulator."));
  const child = spawn(binary, [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TMPDIR: temp,
      EMULATOR_ENV: "",
      EMULATOR_LOG_LEVEL: "debug",
      EMULATOR_LOG_FORMAT: "text",
      EMULATOR_SERVER_HOST: "127.0.0.1",
      EMULATOR_SERVER_PORT: String(port),
      EMULATOR_NATS_TOKEN: token,
      EMULATOR_NATS_PORT: String(natsPort),
      EMULATOR_NATS_WEBSOCKET_HOST: "127.0.0.1",
      EMULATOR_NATS_WEBSOCKET_PORT: String(wsPort),
      EMULATOR_CORS_ALLOWED_ORIGINS: (origins ?? [origin]).join(","),
      EMULATOR_RUNS_STAGE_INTERVAL: "100ms",
      EMULATOR_APP_MOUNT: mount,
      ...env,
    },
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => (output += chunk));
  }
  let exit;
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve((exit = code))));
  // A run that ends without stopping the emulator still ends it.
  const orphan = () => child.kill("SIGKILL");
  process.once("exit", orphan);

  /** Drains the emulator with SIGTERM, or after the failsafe kills it, and removes its TMPDIR;
   * rejects when it exits other than 0 or leaves anything in its TMPDIR. */
  async function stop() {
    process.off("exit", orphan);
    if (exit === undefined) child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), failsafe);
    const code = await exited;
    clearTimeout(timer);
    const left = readdirSync(temp);
    rmSync(temp, { recursive: true, force: true });
    if (code !== 0) throw new Error(`the emulator at ${origin} exited ${code}:\n${output}`);
    if (left.length > 0) throw new Error(`the emulator at ${origin} left ${left.join(", ")}`);
  }

  /** The API's JSON answer to `path`, failing on any status but `status`. */
  async function api(path, init = {}, status = 200) {
    const response = await fetch(origin + path, init);
    const body = await response.text();
    if (response.status !== status) {
      throw new Error(`${init.method ?? "GET"} ${path} = ${response.status} ${body}`);
    }
    return JSON.parse(body);
  }

  try {
    await until(
      `the emulator at ${origin}`,
      // Each probe gives up after a second, so a port another socket holds and never answers on
      // fails this poll rather than hanging the boot.
      async () => (await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(1000) })).ok,
      () => exit !== undefined && `exited ${exit}:\n${output}`,
    );
  } catch (error) {
    await stop().catch(() => {});
    if (exit !== undefined && addressInUse.test(output)) throw new PortTaken(error.message);
    throw error;
  }

  return {
    origin,
    /** How many times start launched the emulator: one, and one more for each lost port. */
    launches,
    /** The app's base under the mount, a path ending in a slash. */
    base: mount === "/" ? "/" : `${mount}/`,
    natsPort,
    wsURL: `ws://127.0.0.1:${wsPort}`,
    /** The output so far. */
    output: () => output,
    /** The embedded NATS server's store, as its start record logs it. */
    store: () => output.match(/msg="nats started".* store=(\S+)/)?.[1],
    /** Uploads a text document, resolving to the document, its run_id the run it started. */
    upload: (name = "brief.txt") =>
      api(
        `/api/documents?name=${encodeURIComponent(name)}`,
        { method: "POST", headers: { "content-type": "text/plain" }, body: "the capstone's brief" },
        201,
      ),
    /** Resolves to the run once its status is complete. */
    complete: (runId) =>
      until(`run ${runId}`, async () => {
        const run = await api(`/api/runs/${runId}`);
        return run.status === "complete" && run;
      }),
    stop,
  };
}
