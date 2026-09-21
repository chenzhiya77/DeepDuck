import type { ManagedModel, ManagedModelInput, ProviderId } from "./types";

/**
 * The three thinking-recipe shapes the settings UI can write (spec 2026-09-21 §3.3, D3).
 *
 * A recipe is the payload an entry sends when thinking is on / off; the shape is *where*
 * the switch lives inside it. The three spellings come from the protocols, not from us:
 * the OpenAI-compatible gateway nests it under `extra_body.thinking`, vLLM / SGLang pass
 * the chat-template variable, and native Anthropic takes it as a constructor parameter.
 * `models/factory.py` recognizes exactly these three — a fourth spelling is forwarded
 * verbatim and only the endpoint can reject it — so the UI never invents one.
 *
 * The class behind an entry decides its shape, and the frontend only ever sees the
 * curated provider id; the two are one-to-one in `PROVIDER_ALLOWLIST`, which is why the
 * table below is keyed by id. `openai-compatible` is the one id that covers anything (a
 * plain gateway, a self-hosted vLLM, …), so it is the only one that has to ask the user.
 *
 * Keep the literals byte-identical to the backend pin
 * (`backend/tests/test_model_factory.py::_THINKING_SHAPES`): the factory has to recognize
 * what this table writes, and a drifted spelling would only surface on a live endpoint.
 */

/** A pickable shape. `anthropic` is never offered — it is derived, not chosen. */
export type ThinkingShape = "none" | "gateway" | "vllm" | "anthropic";

/** Everything the `openai-compatible` dropdown offers. */
export const THINKING_SHAPE_OPTIONS: readonly ThinkingShape[] = [
  "none",
  "gateway",
  "vllm",
];

export type ThinkingRecipeFields = Pick<
  ManagedModelInput,
  "when_thinking_enabled" | "when_thinking_disabled"
>;

type StoredRecipe = Pick<
  ManagedModel,
  "when_thinking_enabled" | "when_thinking_disabled"
>;

const SHAPE_FIELDS = [
  "when_thinking_enabled",
  "when_thinking_disabled",
] as const;

const DERIVED_SHAPES: readonly Exclude<ThinkingShape, "none">[] = [
  "gateway",
  "vllm",
  "anthropic",
];

const SHAPE_RECIPES: Record<
  Exclude<ThinkingShape, "none">,
  ThinkingRecipeFields
> = {
  gateway: {
    when_thinking_enabled: { extra_body: { thinking: { type: "enabled" } } },
    when_thinking_disabled: { extra_body: { thinking: { type: "disabled" } } },
  },
  vllm: {
    when_thinking_enabled: {
      extra_body: { chat_template_kwargs: { enable_thinking: true } },
    },
    when_thinking_disabled: {
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    },
  },
  anthropic: {
    when_thinking_enabled: {
      thinking: { type: "enabled", budget_tokens: 4096 },
    },
    when_thinking_disabled: { thinking: { type: "disabled" } },
  },
};

const PINNED_SHAPES: Partial<Record<ProviderId, ThinkingShape>> = {
  anthropic: "anthropic",
  deepseek: "gateway",
};

/** The shape a provider decides on its own; `null` = the user has to pick one. */
export function autoThinkingShape(
  provider: string | null | undefined,
): ThinkingShape | null {
  if (!provider) return null;
  return PINNED_SHAPES[provider as ProviderId] ?? null;
}

/** The recipes are plain data, and the literals we wrote round-trip unchanged. */
function sameRecipe(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What the editor should show for a stored entry, and whether those dicts match no
 * literal — then a save has to carry them back instead of writing "not set" over them.
 */
export function thinkingShapeFromEntry(entry: StoredRecipe): {
  shape: ThinkingShape;
  preserve: boolean;
} {
  const declared = SHAPE_FIELDS.filter((field) => entry[field] != null);
  if (declared.length === 0) return { shape: "none", preserve: false };

  const matches = DERIVED_SHAPES.filter((shape) =>
    declared.every((field) =>
      sameRecipe(entry[field], SHAPE_RECIPES[shape][field]),
    ),
  );
  const [match] = matches;
  return match
    ? { shape: match, preserve: false }
    : { shape: "none", preserve: true };
}

/**
 * The two fields to submit: the provider's own shape when it has one, otherwise the
 * pick. `existing` is the escape hatch for a hand-written recipe — it is carried back
 * only when nothing was picked, so an explicit choice always wins.
 */
export function thinkingRecipeFor(
  provider: string | null | undefined,
  picked: ThinkingShape,
  existing?: ThinkingRecipeFields,
): ThinkingRecipeFields {
  const shape = autoThinkingShape(provider) ?? picked;
  if (shape === "none") return existing ? { ...existing } : {};
  return { ...SHAPE_RECIPES[shape] };
}

/**
 * The API type as the field the backend stores (spec 2026-09-21 D6): Responses is
 * `true`, Chat writes nothing. `false` is never produced — the two are different
 * files, since an absent key means "never set" while an explicit `false` is a value
 * the UI cannot express and must not invent.
 */
export function apiTypeToUseResponsesApi(
  apiType: "chat" | "responses" | undefined,
): true | undefined {
  return apiType === "responses" ? true : undefined;
}
