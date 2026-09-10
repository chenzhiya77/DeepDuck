import { fetch as authFetch } from "@/core/api/fetcher";

import { getBackendBaseURL } from "../config";

import type { RagConfigInput, RagConfigView } from "./types";

/**
 * Admin RAG functional-model configuration client (spec 2026-09-10 §4).
 *
 * Both routes are admin-gated server-side; a 403 is surfaced as
 * {@link RagConfigRequestError} with `isAdminRequired` so the settings view can render
 * its denial state instead of an error toast.
 */

/** Sentinel the server echoes in place of a stored secret, and accepts on write to keep it. */
export const MASKED_RAG_SECRET = "********";

export class RagConfigRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RagConfigRequestError";
    this.status = status;
  }
  get isAdminRequired(): boolean {
    return this.status === 403;
  }
}

async function readErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
  const error = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  return typeof error.detail === "string" ? error.detail : fallback;
}

export async function loadRagConfig(): Promise<RagConfigView> {
  const response = await authFetch(`${getBackendBaseURL()}/api/rag/config`);
  if (!response.ok) {
    throw new RagConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to load the RAG configuration"),
    );
  }
  return response.json() as Promise<RagConfigView>;
}

export async function saveRagConfig(
  input: RagConfigInput,
): Promise<RagConfigView> {
  const response = await authFetch(`${getBackendBaseURL()}/api/rag/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new RagConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to save the RAG configuration"),
    );
  }
  return response.json() as Promise<RagConfigView>;
}
