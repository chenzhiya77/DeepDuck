import { fetch as authFetch } from "@/core/api/fetcher";

import { getBackendBaseURL } from "../config";
import { isStaticWebsiteOnly } from "../static-mode";

import type {
  ManagedModelInput,
  ModelsConfigResponse,
  ModelsResponse,
  ValidateModelsConfigInput,
  ValidateModelsConfigResult,
} from "./types";

const STATIC_MODELS_RESPONSE: ModelsResponse = {
  models: [],
  token_usage: { enabled: false },
};

/** Selectable context-window sizes; mirrors the backend `CONTEXT_WINDOW_OPTIONS`. */
export const CONTEXT_WINDOW_OPTIONS = [200_000, 400_000, 1_000_000] as const;

/** Reasoning-effort levels, in enum order; mirrors the backend `REASONING_EFFORT_LEVELS`. */
export const REASONING_EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
] as const;

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

/**
 * Probe a provider's model list with the submitted credentials (spec §5.3.2).
 *
 * Purely observational — the server persists nothing, so the add-model wizard can
 * block its second step on `!ok || !model_present` before anything is stored.
 */
export async function validateModelsConfig(
  input: ValidateModelsConfigInput,
): Promise<ValidateModelsConfigResult> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/models/config/validate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw new ModelsConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to validate model credentials"),
    );
  }
  return response.json() as Promise<ValidateModelsConfigResult>;
}
