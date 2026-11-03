// The emulator's API as the app calls it: the client main makes from the shell's config, which
// every view reaches through apiClient, and the domain services over it, each a stateless object
// of endpoints over the client (the sdk's Service pattern), with the entities they answer as the
// emulator's domain packages write them (domain/document, domain/run, domain/search, and
// domain/conversation).

import type { Client, Page, Result, ServerSentEvent } from "@jaimestill/spike-html-apps-sdk/api.js";
import type { Service } from "@jaimestill/spike-html-apps-sdk/service.js";

/** A document, as domain/document's Document writes it. */
export interface Document {
  id: string;
  name: string;
  content_type: string;
  size: number;
  /** When the upload was accepted, an RFC 3339 timestamp. */
  created_at: string;
  /** The run the upload started. */
  run_id: string;
}

/** A run's stage, as domain/run's Stage writes it: complete with its time, failed with its time
 * and reason, or pending. Each time and the reason is null until the stage reaches its state. */
export interface Stage {
  name: string;
  position: number;
  state: "pending" | "complete" | "failed";
  completed_at: string | null;
  failed_at: string | null;
  reason: string | null;
}

/** A run, as domain/run's Run writes it: its stages in their positions' order. A failed run has
 * one failed stage, those before it complete and those after it pending, and no completion time;
 * it advances no further. */
export interface Run {
  id: string;
  document_id: string;
  status: "running" | "complete" | "failed";
  stages: Stage[];
  created_at: string;
  completed_at: string | null;
}

/** The documents a listing reads: the page, from 1, and the page size. */
export interface PageQuery {
  page: number;
  size: number;
}

/** An upload's signal, which cancels it, and its progress, as the client's upload reports it. */
export interface UploadControl {
  signal?: AbortSignal;
  progress?: (sent: number, total: number) => void;
}

/** The documents domain, /documents: a page of the listing, oldest first, one document, its
 * content as text or as its bytes, and an upload. The content is served under the type it was
 * uploaded with. As text, it is the body exactly as stored whatever its content type, so a JSON
 * document keeps its whitespace and key order, and one that doesn't parse is still its text, for
 * the viewer to show as invalid; an empty body is "". As bytes, it is a Blob, an empty body an
 * empty Blob. */
export const documentService = (client: Client) =>
  ({
    list: (query: PageQuery, signal?: AbortSignal): Promise<Result<Page<Document>>> =>
      client.get("documents", { query: { ...query }, signal }),
    document: (id: string, signal?: AbortSignal): Promise<Result<Document>> =>
      client.get(`documents/${encodeURIComponent(id)}`, { signal }),
    content: (id: string, signal?: AbortSignal): Promise<Result<string>> =>
      client.get(`documents/${encodeURIComponent(id)}/content`, { as: "text", signal }),
    bytes: async (id: string, signal?: AbortSignal): Promise<Result<Blob>> => {
      // The client decodes a body by its type: JSON parsed, text/* a string, and any other type,
      // octet-stream included, a Blob; no body is undefined. The emulator accepts only a
      // well-formed type, so a type the viewer takes as bytes is never JSON or text/*, and the
      // body is a Blob or none; a string, should one come, is still its bytes as UTF-8.
      const fetched = await client.get<Blob | string | undefined>(
        `documents/${encodeURIComponent(id)}/content`,
        { signal },
      );
      if (!fetched.ok) return fetched;
      const { data } = fetched;
      return { ok: true, data: data instanceof Blob ? data : new Blob(data ? [data] : []) };
    },
    // The body is the file itself, its bytes as they are. The emulator requires a Content-Type, and
    // a browser gives a file it can't type none, so such a file goes as octet-stream.
    upload: (file: File, { signal, progress }: UploadControl = {}): Promise<Result<Document>> =>
      client.upload("documents", file, {
        query: { name: file.name },
        headers: { "Content-Type": file.type || "application/octet-stream" },
        signal,
        progress,
      }),
  }) satisfies Service;

/** The runs domain, /runs: one run by its id. */
export const runService = (client: Client) =>
  ({
    run: (id: string, signal?: AbortSignal): Promise<Result<Run>> =>
      client.get(`runs/${encodeURIComponent(id)}`, { signal }),
  }) satisfies Service;

/** A search's match, as domain/search's Match writes it: the document's id and name, the field the
 * query matched in, and the snippet around the first match, an ellipsis at an end it cuts short.
 * It is the search results' SearchMatch as it is. */
export interface Match {
  id: string;
  name: string;
  field: "name" | "content";
  snippet: string;
}

/** A search, the query and the page of its matches to read. */
export interface SearchQuery extends PageQuery {
  q: string;
}

/** The search domain, /search: a page of the matches for a query, in document creation order,
 * matched case-insensitively against each document's name and text content. A blank query is a
 * 400, so the app asks only with one that isn't. */
export const searchService = (client: Client) =>
  ({
    search: (query: SearchQuery, signal?: AbortSignal): Promise<Result<Page<Match>>> =>
      client.get("search", { query: { ...query }, signal }),
  }) satisfies Service;

/** An item's progress, as domain/conversation's Status writes it. */
export type Status = "in_progress" | "completed" | "incomplete";

/** A message content part, as domain/conversation's Part writes it: a user's input_text, or an
 * assistant's output_text. */
export interface Part {
  type: "input_text" | "output_text";
  text: string;
}

/** A reasoning item's text part, as domain/conversation's Part writes it: reasoning_text in its
 * content, summary_text in its summary. */
export interface ReasoningPart {
  type: "reasoning_text" | "summary_text";
  text: string;
}

/** An Open Responses message item, as domain/conversation's Item writes it: a user's input item,
 * with no id or status, or an assistant's output item. */
export interface MessageItem {
  type: "message";
  id?: string;
  role: "user" | "assistant";
  status?: Status;
  content: Part[];
}

/** A reasoning item, as the emulator's rich reply writes it: its content and its summary. */
export interface ReasoningItem {
  type: "reasoning";
  id: string;
  status: Status;
  content: ReasoningPart[];
  summary: ReasoningPart[];
}

/** A function_call item, as the rich reply writes it: its arguments JSON text, "" until they
 * stream. */
export interface FunctionCallItem {
  type: "function_call";
  id: string;
  status: Status;
  call_id: string;
  name: string;
  arguments: string;
}

/** A function_call_output item, as the rich reply writes it: the output of the call it names by
 * call_id, JSON text, "" while the function runs. */
export interface FunctionCallOutputItem {
  type: "function_call_output";
  id: string;
  status: Status;
  call_id: string;
  output: string;
}

/** An item of a conversation's history or a reply's output, as domain/conversation's Item writes
 * it: a message, or, from the rich reply (a message of exactly /rich), its reasoning, function
 * call, and the call's output, which come ahead of its message. Each is assignable to the chat
 * thread's ThreadItem, so a history shows as it is. */
export type Item = MessageItem | ReasoningItem | FunctionCallItem | FunctionCallOutputItem;

/** A conversation, as domain/conversation's Conversation writes it: its history oldest first, the
 * user's messages and the items of every reply that streamed whole; a reply cut off, or one that
 * failed, never joins it, none of its items. */
export interface Conversation {
  id: string;
  created_at: string;
  history: Item[];
}

/** The conversations domain, /conversations: a new conversation, which takes no body, one by its
 * id with its history, and a message, answered by the scripted reply as an Open Responses event
 * stream, which the stream's signal cuts off. The emulator keeps every conversation in memory, so
 * one outlives a reload but not the emulator. */
export const conversationService = (client: Client) =>
  ({
    create: (signal?: AbortSignal): Promise<Result<Conversation>> =>
      client.post("conversations", undefined, { signal }),
    conversation: (id: string, signal?: AbortSignal): Promise<Result<Conversation>> =>
      client.get(`conversations/${encodeURIComponent(id)}`, { signal }),
    message: (
      id: string,
      text: string,
      signal?: AbortSignal,
    ): Promise<Result<AsyncIterable<ServerSentEvent>>> =>
      client.stream(`conversations/${encodeURIComponent(id)}/messages`, { text }, { signal }),
  }) satisfies Service;

/** The services the app calls, over the one client. */
export interface Api {
  documents: ReturnType<typeof documentService>;
  runs: ReturnType<typeof runService>;
  search: ReturnType<typeof searchService>;
  conversations: ReturnType<typeof conversationService>;
}

let api: Api | undefined;

/** Sets the client every view calls through; main calls it before the workspace renders. */
export function useClient(client: Client) {
  api = {
    documents: documentService(client),
    runs: runService(client),
    search: searchService(client),
    conversations: conversationService(client),
  };
}

/** The services over the client main set; throws when a view calls before useClient was. */
export function appApi(): Api {
  if (!api) throw new Error("useClient wasn't called before a view called the API");
  return api;
}
