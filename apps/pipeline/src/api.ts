// The emulator's API as the app calls it: the client main makes from the shell's config, which
// every view reaches through apiClient, and the domain services over it, each a stateless object
// of endpoints over the client (the sdk's Service pattern), with the entities they answer as the
// emulator's domain packages write them (domain/document and domain/run).

import type { Client, Page, Result } from "@jaimestill/spike-html-apps-sdk/api.js";
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
 * content, and an upload. The content is read as text, the body exactly as stored whatever its
 * content type, so a JSON document keeps its whitespace and key order, and one that doesn't parse
 * is still its text, for the viewer to show as invalid; an empty body is "". */
export const documentService = (client: Client) =>
  ({
    list: (query: PageQuery, signal?: AbortSignal): Promise<Result<Page<Document>>> =>
      client.get("documents", { query: { ...query }, signal }),
    document: (id: string, signal?: AbortSignal): Promise<Result<Document>> =>
      client.get(`documents/${encodeURIComponent(id)}`, { signal }),
    content: (id: string, signal?: AbortSignal): Promise<Result<string>> =>
      client.get(`documents/${encodeURIComponent(id)}/content`, { as: "text", signal }),
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

/** The services the app calls, over the one client. */
export interface Api {
  documents: ReturnType<typeof documentService>;
  runs: ReturnType<typeof runService>;
}

let api: Api | undefined;

/** Sets the client every view calls through; main calls it before the workspace renders. */
export function useClient(client: Client) {
  api = { documents: documentService(client), runs: runService(client) };
}

/** The services over the client main set; throws when a view calls before useClient was. */
export function appApi(): Api {
  if (!api) throw new Error("useClient wasn't called before a view called the API");
  return api;
}
