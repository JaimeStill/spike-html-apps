// A service's API as the client calls it: the domain services each panel makes over its own client,
// each a stateless object of endpoints over that client (the sdk's Service pattern), with the
// entities they answer as the emulator's domain packages write them (domain/document, domain/run,
// and domain/search). The client calls only what a panel shows: the listing, one document, an
// upload, a run, and a search.
//
// The pipeline app declares the same endpoints over its one client (apps/pipeline/src/api.ts); an
// app imports no other app, so each holds its own copy.

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

/** A run's stage, as domain/run's Stage writes it. Each time and the reason is null until the
 * stage reaches its state. */
export interface Stage {
  name: string;
  position: number;
  state: "pending" | "complete" | "failed";
  completed_at: string | null;
  failed_at: string | null;
  reason: string | null;
}

/** A run, as domain/run's Run writes it: its stages in their positions' order. */
export interface Run {
  id: string;
  document_id: string;
  status: "running" | "complete" | "failed";
  stages: Stage[];
  created_at: string;
  completed_at: string | null;
}

/** A search's match, as domain/search's Match writes it, the search results' SearchMatch as it
 * is. */
export interface Match {
  id: string;
  name: string;
  field: "name" | "content";
  snippet: string;
}

/** An upload's signal, which cancels it, and its progress, as the client's upload reports it. */
export interface UploadControl {
  signal?: AbortSignal;
  progress?: (sent: number, total: number) => void;
}

/** The documents domain, /documents: a page of the listing, oldest first, one document, and an
 * upload, whose body is the file's bytes under its type, octet-stream when the browser gives it
 * none. A cross-origin upload carries Content-Type and Authorization, and a progress listener, so
 * the browser preflights it. */
export const documentService = (client: Client) =>
  ({
    list: (page: number, size: number, signal?: AbortSignal): Promise<Result<Page<Document>>> =>
      client.get("documents", { query: { page, size }, signal }),
    document: (id: string, signal?: AbortSignal): Promise<Result<Document>> =>
      client.get(`documents/${encodeURIComponent(id)}`, { signal }),
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

/** The search domain, /search: a page of the matches for a query that isn't blank. */
export const searchService = (client: Client) =>
  ({
    search: (q: string, size: number, signal?: AbortSignal): Promise<Result<Page<Match>>> =>
      client.get("search", { query: { q, page: 1, size }, signal }),
  }) satisfies Service;

/** A panel's services, over its own client. */
export interface Api {
  documents: ReturnType<typeof documentService>;
  runs: ReturnType<typeof runService>;
  search: ReturnType<typeof searchService>;
}

/** The services over the client. */
export const apiOf = (client: Client): Api => ({
  documents: documentService(client),
  runs: runService(client),
  search: searchService(client),
});
