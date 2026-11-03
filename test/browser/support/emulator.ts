// The browser tier's emulator: the binary EMULATOR_BINARY names (mise run test:browser builds
// cmd/server into a temporary directory, embedding the pipeline app's build), booted on reserved
// loopback ports with its configuration in its environment, as the integration tier's harness
// boots it, and driven over its HTTP API as a client drives it. The tooling's process helper
// spawns it in a process group of its own, polls /readyz, drains it, and ends it if the run never
// stops it; the harness adds the relaunch on a lost port, the TMPDIR, and the API.
// Adapted from integration/harness.go: its Launch, Ready, and environment, in TypeScript on node.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { freePort, start as run } from "@jaimestill/spike-html-apps-tooling/process.js";
import type { Started } from "@jaimestill/spike-html-apps-tooling/process.js";

export { freePort };

/** The repository root, the binary's working directory, where it reads config.json. */
const root = join(import.meta.dirname, "../../..");

/** The nats token every emulator the tier boots is configured with. */
export const token = "browser-token";

/** The order a run's stages pass in. */
export const stageNames = ["upload", "metadata", "extraction", "chunks", "embeddings"];

/** The hold rules every emulator the tier boots is configured with, EMULATOR_RUNS_HOLD: one per
 * stage, held-at-<stage>.*:<stage>, so a document named held-at-extraction.brief.md starts a run
 * that completes upload and metadata, then stays running with extraction under way for as long as
 * the emulator runs. A case reads a run mid-way through it, however long the page takes to show
 * it; a document no rule names runs to complete. */
export const holdRules = stageNames.map((stage) => `held-at-${stage}.*:${stage}`).join(",");

/** The name a hold rule holds at `stage`: `name` under the stage's held-at- prefix. */
export const heldAt = (stage: string, name: string) => `held-at-${stage}.${name}`;

/** How long a boot, a drain, or a run may take before the tier gives up on it. */
const failsafe = 15_000;

/** How many times start launches the emulator before it gives up on a boot that lost a port. */
export const bootAttempts = 5;

/** The bind's report of a port another socket holds, as the emulator's output names it. */
const addressInUse = /address already in use/;

/** Polls `check` every 25 ms until it resolves truthy, resolving to its value, and rejects naming
 * `what` after the failsafe. */
async function until<T>(what: string, check: () => Promise<T | false>): Promise<T> {
  const deadline = Date.now() + failsafe;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what}: not within ${failsafe} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** What start takes, each optional, as its comment describes. */
export interface StartOptions {
  mount?: string;
  origins?: string[];
  env?: Record<string, string>;
  reserve?: () => Promise<number>;
}

/** An uploaded document, as the API answers it: the fields the tier reads. */
export interface UploadedDocument {
  id: string;
  /** The run the upload started. */
  run_id: string;
}

/** A run, as the API answers it: the fields the tier reads. */
export interface Run {
  status: string;
  stages: { name: string; state: string; failed_at: string | null; reason: string | null }[];
}

/** An upload's body and the Content-Type it declares. */
export interface Content {
  type: string;
  body: string | Uint8Array;
}

/** The text document upload sends by default. */
const brief: Content = { type: "text/plain", body: "the capstone's brief" };

/** An emulator start booted, ready; start's comment and the members' describe each. */
export interface Emulator {
  origin: string;
  launches: number;
  base: string;
  natsPort: number;
  wsURL: string;
  output(): string;
  store(): string | undefined;
  upload(name?: string, content?: Content): Promise<UploadedDocument>;
  run(runId: string): Promise<Run>;
  complete(runId: string): Promise<Run>;
  stop(): Promise<void>;
}

/**
 * Boots the emulator and resolves once its readiness probe answers. Its app is at `mount`; its
 * WebSocket listener, like its CORS, accepts `origins`, by default its own origin, where its app
 * is served; `env` adds or overrides variables last. No overlay applies (EMULATOR_ENV is empty),
 * the stages pass every 100 ms, and holdRules hold the runs of the documents heldAt names. Its TMPDIR, where the embedded NATS server keeps its store,
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
export async function start({
  mount = "/app",
  origins,
  env = {},
  reserve = freePort,
}: StartOptions = {}): Promise<Emulator> {
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

/** start's options with their defaults applied, and the launch's count among start's. */
interface LaunchOptions {
  mount: string;
  origins: string[] | undefined;
  env: Record<string, string>;
  reserve: () => Promise<number>;
  launches: number;
}

/** A launch whose emulator exited, before its readiness, naming a port another socket holds. */
class PortTaken extends Error {}

/** One launch of start's: the emulator on ports `reserve` hands out, resolving once it is ready,
 * and rejecting with PortTaken when it exits having lost one of them. */
async function launch(
  binary: string,
  { mount, origins, env, reserve, launches }: LaunchOptions,
): Promise<Emulator> {
  const [port, natsPort, wsPort] = [await reserve(), await reserve(), await reserve()];
  const origin = `http://127.0.0.1:${port}`;
  const temp = mkdtempSync(join(tmpdir(), "browser-emulator."));
  let started: Started;
  try {
    started = await run(binary, [], {
      ready: `${origin}/readyz`,
      cwd: root,
      timeout: failsafe,
      drain: failsafe,
      env: {
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
        EMULATOR_RUNS_HOLD: holdRules,
        EMULATOR_APP_MOUNT: mount,
        ...env,
      },
    });
  } catch (error) {
    // The helper has ended the emulator's group before it rejects, its message ending with the
    // emulator's output, where a lost port's bind names itself; it rejects with an Error alone.
    rmSync(temp, { recursive: true, force: true });
    const { message } = error as Error;
    throw addressInUse.test(message) ? new PortTaken(message) : error;
  }
  const { output } = started;

  /** Drains the emulator, and removes its TMPDIR; rejects when it exits other than 0 or leaves
   * anything in its TMPDIR. */
  async function stop(): Promise<void> {
    const code = await started.stop();
    const left = readdirSync(temp);
    rmSync(temp, { recursive: true, force: true });
    if (code !== 0) throw new Error(`the emulator at ${origin} exited ${code}:\n${output()}`);
    if (left.length > 0) throw new Error(`the emulator at ${origin} left ${left.join(", ")}`);
  }

  /** The API's JSON answer to `path`, failing on any status but `status`. */
  async function api<T>(path: string, init: RequestInit = {}, status = 200): Promise<T> {
    const response = await fetch(origin + path, init);
    const body = await response.text();
    if (response.status !== status) {
      throw new Error(`${init.method ?? "GET"} ${path} = ${response.status} ${body}`);
    }
    return JSON.parse(body);
  }

  return {
    origin,
    /** How many times start launched the emulator: one, and one more for each lost port. */
    launches,
    /** The app's base under the mount, a path ending in a slash. */
    base: mount === "/" ? "/" : `${mount}/`,
    natsPort,
    wsURL: `ws://127.0.0.1:${wsPort}`,
    /** The output so far: the helper's tail of it, its last 64 KiB. */
    output,
    /** The embedded NATS server's store, as its start record logs it. */
    store: () => output().match(/msg="nats started".* store=(\S+)/)?.[1],
    /** Uploads a document, a text one by default, resolving to the document, its run_id the run
     * it started. */
    upload: (name = "brief.txt", { type, body }: Content = brief) =>
      api<UploadedDocument>(
        `/api/documents?name=${encodeURIComponent(name)}`,
        { method: "POST", headers: { "content-type": type }, body },
        201,
      ),
    /** The run's API answer. */
    run: (runId) => api<Run>(`/api/runs/${runId}`),
    /** Resolves to the run once its status is complete. */
    complete: (runId) =>
      until(`run ${runId}`, async () => {
        const run = await api<Run>(`/api/runs/${runId}`);
        return run.status === "complete" && run;
      }),
    stop,
  };
}
