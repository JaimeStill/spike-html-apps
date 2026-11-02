// The app's one conversation with the emulator's scripted assistant, which the chat view shows:
// a session object that outlives the view, so leaving the chat for a document and coming back
// finds the thread as it was, a reply still streaming included, since the stream it reads belongs
// to the session, not to the view. The view listens for its `change` and renders what it holds.
//
// The emulator keeps every conversation in memory, and a conversation's history is the user's
// messages and the replies that streamed whole (domain/conversation). The session keeps its
// conversation's id in sessionStorage, so a reload in the same tab reads the history back from
// the API, and a new tab, or a restarted emulator, which answers the id with a 404, starts afresh.
// A reply stopped or failed shows in the thread while the page stays, but the emulator never adds
// it to the history, so after a reload the user's message stands without it.
//
// The conversation is created on the first send, so the chat's empty state calls nothing. A reply
// is read with the client's stream and folded into the thread event by event, the Open Responses
// events the emulator writes: response.output_item.added starts an item, its parts and deltas grow
// it, response.output_item.done replaces it whole, and response.completed ends the reply. Every
// event names its item by item_id, so a reply of several items, the emulator's rich reply (a
// message of exactly /rich), grows each in place: a reasoning item's reasoning_text part by
// response.reasoning.delta and its summary_text part by response.reasoning_summary_text.delta, a
// function call's arguments by response.function_call_arguments.delta, as the text streamed, which
// the thread shows as it is until it parses and then formats from its own tokens, the call's output
// whole at its done, and the message's Markdown by response.output_text.delta. Each .done event's
// text replaces what its deltas made. The history read back holds the same items, so a reload shows
// what the stream did. The failure path's error event and response.failed end it failed: its item,
// which the emulator marks incomplete, is shown failed, the response's status, so a failure reads
// apart from a reply the reader stopped, which is incomplete, and the error's message is the
// session's failure. Stop aborts the stream's request, which the emulator sees as the client
// closing the connection, and every item still in progress turns incomplete.
//
// A send that fails before its reply begins (the network, a problem the API answers) is a trouble
// with Try again, which sends the same text again; the user's message stays in the thread once.
// A reply cut off by the network mid-way turns incomplete, and its Try again sends the text as a
// new message, since the emulator already holds the first.

import type { ThreadItem } from "@jaimestill/spike-html-apps-components/chat-thread.js";
import type { Problem, ServerSentEvent } from "@jaimestill/spike-html-apps-sdk/api.js";
import { StreamError } from "@jaimestill/spike-html-apps-sdk/api.js";

import { appApi } from "./api.ts";
import type { Conversation } from "./api.ts";

/** The sessionStorage key of the conversation's id. */
const STORAGE = "pipeline.conversation";

/** The client's abort problem, which a stop before the reply's headers arrive resolves to. */
const abortType = "urn:standards-lab:problem:abort";

/**
 * What the session is doing: loading the stored conversation's history, idle, sending a message
 * until its reply's stream opens, or streaming the reply.
 */
export type Phase = "loading" | "idle" | "sending" | "streaming";

/** A request that failed, with what Try again repeats: the history's load, or a message's send,
 * with whether the retry adds the user's message to the thread again. */
export type Trouble =
  | { kind: "load"; message: string }
  | { kind: "send"; message: string; text: string; again: boolean };

/** An event's data, as the stream's JSON carries it: the members the session reads. */
interface StreamData {
  item?: ThreadItem;
  item_id?: string;
  content_index?: number;
  summary_index?: number;
  part?: { type: string; text: string };
  delta?: string;
  text?: string;
  arguments?: string;
  response?: { output?: ThreadItem[]; error?: { message?: string } | null };
  error?: { message?: string };
}

/** A text part: a message's output_text, or a reasoning item's reasoning_text or summary_text. */
interface TextPart<T extends string> {
  type: T;
  text: string;
}

/**
 * The parts with the one at `at` of `type` grown: its text so far, "" when there is none there or
 * one of another type, with the delta after it, or the done event's whole text in its place.
 */
function grown<P extends { type: string }, T extends string>(
  parts: readonly P[] | undefined,
  at: number,
  type: T,
  { delta, text }: Pick<StreamData, "delta" | "text">,
): (P | TextPart<T>)[] {
  const out: (P | TextPart<T>)[] = [...(parts ?? [])];
  // A part of another type, a refusal among them, holds no text this grows.
  const held = out[at] as Partial<TextPart<string>> | undefined;
  const before = held?.type === type ? (held.text ?? "") : "";
  out[at] = { type, text: text ?? before + (delta ?? "") };
  return out;
}

/** The stored conversation's id, or "" when there is none or storage is blocked. */
function storedId(): string {
  try {
    return sessionStorage.getItem(STORAGE) ?? "";
  } catch {
    return "";
  }
}

/** Stores the conversation's id, or with "" removes it; a blocked storage keeps nothing. */
function storeId(id: string) {
  try {
    if (id) sessionStorage.setItem(STORAGE, id);
    else sessionStorage.removeItem(STORAGE);
  } catch {
    // Storage is blocked: the conversation lasts as long as the page.
  }
}

/** The problem's title, with its detail when it has one. */
const said = (problem: Problem) =>
  problem.detail ? `${problem.title}: ${problem.detail}` : problem.title;

/**
 * The conversation. It dispatches `change` whenever anything it holds changes: its items, its
 * phase, its trouble, or its failure.
 */
export class ChatSession extends EventTarget {
  #id = storedId();
  #items: readonly ThreadItem[] = [];
  #phase: Phase = "idle";
  #trouble: Trouble | undefined;
  #failure = "";
  #reply: AbortController | undefined;
  #loaded = false;

  /** The composer's draft, which the chat view keeps here while it is away. */
  draft = "";

  /** The thread's items, oldest first. */
  get items(): readonly ThreadItem[] {
    return this.#items;
  }

  get phase(): Phase {
    return this.#phase;
  }

  /** Whether a message is being sent or its reply streamed: the composer is busy. */
  get busy(): boolean {
    return this.#phase === "sending" || this.#phase === "streaming";
  }

  /** The request that last failed, until the next send or Try again. */
  get trouble(): Trouble | undefined {
    return this.#trouble;
  }

  /** The message of the last reply's failure, "" when it didn't fail. */
  get failure(): string {
    return this.#failure;
  }

  /** Loads the stored conversation's history, once: a later call does nothing. */
  load() {
    if (this.#loaded) return;
    this.#loaded = true;
    if (this.#id) void this.#restore();
  }

  /** Sends the user's message and streams its reply; does nothing while busy. */
  send(text: string) {
    if (this.busy || this.#phase === "loading") return;
    void this.#post(text, true);
  }

  /** Stops the reply streaming, or the send whose reply hasn't begun. */
  stop() {
    this.#reply?.abort();
  }

  /** Repeats the request that failed. */
  retry() {
    const trouble = this.#trouble;
    if (!trouble || this.busy) return;
    if (trouble.kind === "load") void this.#restore();
    else void this.#post(trouble.text, trouble.again);
  }

  #changed() {
    this.dispatchEvent(new Event("change"));
  }

  async #restore() {
    this.#phase = "loading";
    this.#trouble = undefined;
    this.#changed();
    const read = await appApi().conversations.conversation(this.#id);
    this.#phase = "idle";
    if (read.ok) this.#items = read.data.history;
    else if (read.problem.status === 404 || read.problem.status === 400) {
      // The emulator no longer holds it, restarted since: the next send starts afresh.
      this.#id = "";
      storeId("");
    } else this.#trouble = { kind: "load", message: said(read.problem) };
    this.#changed();
  }

  /** Creates the conversation on the first send; resolves to its id, or to the problem. */
  async #conversation(signal: AbortSignal): Promise<string | Problem> {
    if (this.#id) return this.#id;
    const created = await appApi().conversations.create(signal);
    if (!created.ok) return created.problem;
    const { id }: Conversation = created.data;
    this.#id = id;
    storeId(id);
    return id;
  }

  async #post(text: string, add: boolean) {
    const reply = new AbortController();
    this.#reply = reply;
    const { signal } = reply;
    this.#phase = "sending";
    this.#trouble = undefined;
    this.#failure = "";
    if (add)
      this.#items = [
        ...this.#items,
        { type: "message", role: "user", content: [{ type: "input_text", text }] },
      ];
    this.#changed();

    const id = await this.#conversation(signal);
    const opened =
      typeof id === "string"
        ? await appApi().conversations.message(id, text, signal)
        : { ok: false as const, problem: id };
    if (!opened.ok) {
      // A conversation the emulator no longer holds: the retry creates another.
      if (opened.problem.status === 404) {
        this.#id = "";
        storeId("");
      }
      if (opened.problem.type !== abortType)
        this.#trouble = { kind: "send", message: said(opened.problem), text, again: false };
      this.#end(reply);
      return;
    }

    this.#phase = "streaming";
    this.#changed();
    try {
      for await (const event of opened.data) this.#apply(event);
    } catch (error) {
      if (!(error instanceof StreamError)) throw error;
      this.#trouble = { kind: "send", message: said(error.problem), text, again: true };
    }
    this.#end(reply);
  }

  /** Ends the reply: every item it left in progress, stopped or cut off, turns incomplete. */
  #end(reply: AbortController) {
    if (this.#reply !== reply) return;
    this.#reply = undefined;
    this.#items = this.#items.map((item) =>
      item.status === "in_progress" ? { ...item, status: "incomplete" } : item,
    );
    this.#phase = "idle";
    this.#changed();
  }

  /** Replaces the item with the id by what `change` makes of it; an id not held changes nothing. */
  #update(id: string | undefined, change: (item: ThreadItem) => ThreadItem) {
    const index = this.#items.findIndex((item) => item.id !== undefined && item.id === id);
    if (index === -1) return;
    this.#items = this.#items.with(index, change(this.#items[index]));
  }

  /** Puts the item in the thread, in place of the one with its id, else after the rest. */
  #put(item: ThreadItem) {
    if (this.#items.some((held) => held.id !== undefined && held.id === item.id))
      this.#update(item.id, () => item);
    else this.#items = [...this.#items, item];
  }

  /** Folds one event of the reply's stream into the thread. */
  #apply({ type, data }: ServerSentEvent) {
    let event: StreamData;
    try {
      event = JSON.parse(data) as StreamData;
    } catch {
      return;
    }
    switch (type) {
      case "response.output_item.added":
      case "response.output_item.done":
        if (event.item) this.#put(event.item);
        break;
      case "response.content_part.added":
        this.#update(event.item_id, (item) => {
          const at = event.content_index ?? 0;
          if (item.type === "message" && event.part?.type === "output_text")
            return { ...item, content: grown(item.content, at, "output_text", event.part) };
          if (item.type === "reasoning" && event.part?.type === "reasoning_text")
            return { ...item, content: grown(item.content, at, "reasoning_text", event.part) };
          return item;
        });
        break;
      case "response.output_text.delta":
      case "response.output_text.done":
        this.#update(event.item_id, (item) =>
          item.type === "message"
            ? {
                ...item,
                content: grown(item.content, event.content_index ?? 0, "output_text", event),
              }
            : item,
        );
        break;
      case "response.reasoning.delta":
      case "response.reasoning.done":
        this.#update(event.item_id, (item) =>
          item.type === "reasoning"
            ? {
                ...item,
                content: grown(item.content, event.content_index ?? 0, "reasoning_text", event),
              }
            : item,
        );
        break;
      case "response.reasoning_summary_part.added":
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_summary_text.done":
        this.#update(event.item_id, (item) =>
          item.type === "reasoning"
            ? {
                ...item,
                summary: grown(
                  item.summary,
                  event.summary_index ?? 0,
                  "summary_text",
                  event.part ?? event,
                ),
              }
            : item,
        );
        break;
      case "response.function_call_arguments.delta":
      case "response.function_call_arguments.done":
        this.#update(event.item_id, (item) =>
          item.type === "function_call"
            ? { ...item, arguments: event.arguments ?? item.arguments + (event.delta ?? "") }
            : item,
        );
        break;
      case "response.completed":
        for (const item of event.response?.output ?? []) this.#put(item);
        break;
      case "error":
        this.#failure = event.error?.message || "The reply failed.";
        break;
      case "response.failed":
        // The response failed: its items, stopped part way, show failed rather than stopped.
        for (const item of event.response?.output ?? []) this.#put({ ...item, status: "failed" });
        this.#failure ||= event.response?.error?.message || "The reply failed.";
        break;
      default:
        return;
    }
    this.#changed();
  }
}

let session: ChatSession | undefined;

/** The app's one conversation, made on the chat's first visit. */
export function chatSession(): ChatSession {
  session ??= new ChatSession();
  return session;
}
