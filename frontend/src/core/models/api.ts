import { fetch as authFetch } from "@/core/api/fetcher";

import { getBackendBaseURL } from "../config";
import { isStaticWebsiteOnly } from "../static-mode";

import type {
  ManagedModelInput,
  ModelsConfigResponse,
  ModelsResponse,
} from "./types";

const STATIC_MODELS_RESPONSE: ModelsResponse = {
  models: [],
  token_usage: { enabled: false },
};

export async function loadModels(): Promise<ModelsResponse> {
  if (isStaticWebsiteOnly()) {
    return STATIC_MODELS_RESPONSE;
  }

  const res = await fetch(`${getBackendBaseURL()}/api/models`);
  const data = (await res.json()) as Partial<ModelsResponse>;
  return {
    models: data.models ?? [],
    token_usage: data.token_usage ?? { enabled: false },
  };
}

// ── Admin models management (spec 2026-09-10 §5.4–§5.5) ───────────────────

/** Sentinel the server echoes in place of a real api_key, and accepts on write
 * to mean "keep the stored key" (spec §5.4). */
export const MASKED_API_KEY = "********";

export class ModelsConfigRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ModelsConfigRequestError";
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

export async function loadModelsConfig(): Promise<ModelsConfigResponse> {
  const response = await authFetch(`${getBackendBaseURL()}/api/models/config`);
  if (!response.ok) {
    throw new ModelsConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to load model configuration"),
    );
  }
  return response.json() as Promise<ModelsConfigResponse>;
}

export async function saveModelsConfig(
  models: ManagedModelInput[],
): Promise<ModelsConfigResponse> {
  const response = await authFetch(`${getBackendBaseURL()}/api/models/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
  if (!response.ok) {
    throw new ModelsConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to save model configuration"),
    );
  }
  return response.json() as Promise<ModelsConfigResponse>;
}
