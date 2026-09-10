"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import { useModels, useModelsConfig } from "@/core/models/hooks";
import { RagConfigRequestError } from "@/core/rag/api";
import {
  buildRagConfigInput,
  EXTRACTION_MODEL_NONE,
  extractionModelOptions,
  formValuesFromConfig,
  hasFormChanges,
  isEmbeddingChange,
  VISION_MODEL_CUSTOM,
  visionModelOptions,
  visionModelSelection,
  vlmPrefillFromModel,
  type RagConfigFormValues,
} from "@/core/rag/config-form";
import { useRagConfig, useSaveRagConfig } from "@/core/rag/hooks";
import {
  AUTOFILL_OFF_INPUT_PROPS,
  SECRET_INPUT_AUTOFILL_PROPS,
} from "@/lib/input-autofill";

/**
 * RAG functional-model editor (spec 2026-09-10 rag functional-model config §5).
 *
 * Fields are grouped by what they *do* (retrieval / graph / multimodal / services), each with a
 * one-line purpose, because a flat list of model names left admins guessing which role each one
 * plays. Every input carries a visible label — a secret field whose only label was an
 * `aria-label` reads as an anonymous box.
 *
 * Saving replaces the whole `rag_config.json` object, so Save stays disabled until the admin
 * actually edits something (see `hasFormChanges`).
 */
export function FunctionalModelsView() {
  const { t } = useI18n();
  const M = t.settings.models;
  const F = t.settings.functionalModels;
  const { view, isLoading, error } = useRagConfig();
  const save = useSaveRagConfig();
  const { models } = useModels();
  const { config: modelsConfig } = useModelsConfig();

  const [values, setValues] = useState<RagConfigFormValues | null>(null);

  useEffect(() => {
    if (!view) return;
    setValues(formValuesFromConfig(view));
  }, [view]);

  const payload = useMemo(
    () => (view && values ? buildRagConfigInput(values, view) : {}),
    [values, view],
  );
  const hasChanges = values && view ? hasFormChanges(values, view) : false;
  const embeddingChanged =
    view && values ? isEmbeddingChange(values, view) : false;

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">{t.common.loading}</div>;
  }
  if (error instanceof RagConfigRequestError && error.isAdminRequired) {
    return <div className="text-muted-foreground text-sm">{M.adminRequired}</div>;
  }
  if (error) {
    return <div>Error: {error.message}</div>;
  }
  if (!view || !values) {
    return null;
  }

  const sources = view.sources ?? {};
  const managedModels = modelsConfig?.models ?? [];
  const visionModels = managedModels.filter((model) => model.supports_vision);
  const visionSelection = visionModelSelection(managedModels, values.vlm_model);
  const visionOptions = visionModelOptions(managedModels, F.vlmCustom);

  function update<K extends keyof RagConfigFormValues>(
    key: K,
    value: RagConfigFormValues[K],
  ) {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateVideo(key: keyof RagConfigFormValues["video"], value: string) {
    setValues((prev) =>
      prev ? { ...prev, video: { ...prev.video, [key]: value } } : prev,
    );
  }

  function secretHint(field: string): string | undefined {
    if (sources[field] === "env") return F.secretFromEnv;
    if (sources[field] === "ui") return F.secretHint;
    return undefined;
  }

  function handleSave() {
    if (!hasChanges) return;
    save.mutate(payload, { onSuccess: () => toast.success(F.saved) });
  }

  function handleVisionSelect(next: string) {
    if (next === VISION_MODEL_CUSTOM) return; // the raw id input takes over
    const entry = visionModels.find((model) => model.model === next);
    if (!entry) return;
    const prefill = vlmPrefillFromModel(entry);
    setValues((prev) =>
      prev
        ? {
            ...prev,
            vlm_model: prefill.vlm_model,
            ...(prefill.vlm_base_url
              ? { vlm_base_url: prefill.vlm_base_url }
              : {}),
          }
        : prev,
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-muted-foreground text-sm">{F.description}</p>

      <Group title={F.groupRetrieval} hint={F.groupRetrievalHint}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={F.embeddingModel} hint={secretHint("embedding_api_key")}>
            <Input
              value={values.embedding_model}
              aria-label={F.embeddingModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("embedding_model", event.target.value)}
            />
            <span className="mt-3 block text-sm font-medium">
              {F.embeddingApiKey}
            </span>
            <Input
              type="password"
              value={values.embedding_api_key}
              aria-label={F.embeddingApiKey}
              {...SECRET_INPUT_AUTOFILL_PROPS}
              onChange={(event) =>
                update("embedding_api_key", event.target.value)
              }
            />
          </Field>

          <Field label={F.rerankModel} hint={secretHint("rerank_api_key")}>
            <Input
              value={values.rerank_model}
              aria-label={F.rerankModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("rerank_model", event.target.value)}
            />
            <span className="mt-3 block text-sm font-medium">
              {F.rerankApiKey}
            </span>
            <Input
              type="password"
              value={values.rerank_api_key}
              aria-label={F.rerankApiKey}
              {...SECRET_INPUT_AUTOFILL_PROPS}
              onChange={(event) => update("rerank_api_key", event.target.value)}
            />
          </Field>
        </div>
        {embeddingChanged && (
          <p className="text-destructive mt-3 text-xs" role="alert">
            {F.embeddingChangeWarning}
          </p>
        )}
      </Group>

      <Group title={F.groupExtraction} hint={F.extractModelHint}>
        <Field label={F.extractModel}>
          <Select
            value={values.extract_model || EXTRACTION_MODEL_NONE}
            onValueChange={(next) =>
              update("extract_model", next === EXTRACTION_MODEL_NONE ? "" : next)
            }
          >
            <SelectTrigger className="w-full" aria-label={F.extractModel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {extractionModelOptions(
                models,
                values.extract_model,
                F.extractModelNone,
              ).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Group>

      <Group title={F.groupMultimodal} hint={F.groupMultimodalHint}>
        <div className="flex flex-col gap-4">
          <Field label={F.captionModel}>
            <Select value={visionSelection} onValueChange={handleVisionSelect}>
              <SelectTrigger className="w-full" aria-label={F.captionModel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {visionSelection === VISION_MODEL_CUSTOM && (
            <Field label={F.vlmModelId}>
              <Input
                value={values.vlm_model}
                aria-label={F.vlmModelId}
                {...AUTOFILL_OFF_INPUT_PROPS}
                onChange={(event) => update("vlm_model", event.target.value)}
              />
            </Field>
          )}

          {visionModels.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {F.vlmNoVisionModel}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={F.vlmBaseUrl}>
              <Input
                type="url"
                value={values.vlm_base_url}
                aria-label={F.vlmBaseUrl}
                {...AUTOFILL_OFF_INPUT_PROPS}
                onChange={(event) => update("vlm_base_url", event.target.value)}
              />
            </Field>
            <Field label={F.vlmApiKey} hint={secretHint("vlm_api_key")}>
              <Input
                type="password"
                value={values.vlm_api_key}
                aria-label={F.vlmApiKey}
                {...SECRET_INPUT_AUTOFILL_PROPS}
                onChange={(event) => update("vlm_api_key", event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={F.asrProvider}>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-label={F.asrProvider}
                value={values.video.asr_provider}
                onValueChange={(next) => {
                  if (next) updateVideo("asr_provider", next);
                }}
              >
                <ToggleGroupItem value="funasr" aria-label={F.asrProviderFunasr}>
                  {F.asrProviderFunasr}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="whisper"
                  aria-label={F.asrProviderWhisper}
                >
                  {F.asrProviderWhisper}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field label={F.asrModel}>
              <Input
                value={values.video.asr_model}
                aria-label={F.asrModel}
                {...AUTOFILL_OFF_INPUT_PROPS}
                onChange={(event) =>
                  updateVideo("asr_model", event.target.value)
                }
              />
            </Field>
          </div>
        </div>
      </Group>

      <Group title={F.groupServices} hint={F.groupServicesHint}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={F.qdrantUrl}>
            <Input
              type="url"
              value={values.qdrant_url}
              aria-label={F.qdrantUrl}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("qdrant_url", event.target.value)}
            />
          </Field>
          <Field label={F.mineruToken} hint={secretHint("mineru_api_token")}>
            <Input
              type="password"
              value={values.mineru_api_token}
              aria-label={F.mineruToken}
              {...SECRET_INPUT_AUTOFILL_PROPS}
              onChange={(event) =>
                update("mineru_api_token", event.target.value)
              }
            />
          </Field>
        </div>
      </Group>

      <div className="flex items-center justify-end gap-3">
        {!hasChanges && (
          <span className="text-muted-foreground text-xs">{F.noChanges}</span>
        )}
        <Button onClick={handleSave} disabled={!hasChanges || save.isPending}>
          {save.isPending ? t.common.loading : t.common.save}
        </Button>
      </div>
    </div>
  );
}

/** One bordered group: a title, a one-line purpose, then the fields. */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

/** A labelled field; the label is visible, never an `aria-label` only. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
