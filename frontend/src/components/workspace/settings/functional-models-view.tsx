"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { useModels } from "@/core/models/hooks";
import { RagConfigRequestError } from "@/core/rag/api";
import {
  buildRagConfigInput,
  EXTRACTION_MODEL_NONE,
  extractionModelOptions,
  formValuesFromConfig,
  hasFormChanges,
  isEmbeddingChange,
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
 * Every field the file already overrides is re-submitted on save (see
 * `buildRagConfigInput`), so the only action that touches the whole file is a save with
 * real changes — which is why Save stays disabled while the payload is empty.
 */
export function FunctionalModelsView() {
  const { t } = useI18n();
  const M = t.settings.models;
  const F = t.settings.functionalModels;
  const { view, isLoading, error } = useRagConfig();
  const save = useSaveRagConfig();
  const { models } = useModels();

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
  const secretHint = (field: string): string | undefined => {
    if (sources[field] === "env") return F.secretFromEnv;
    if (sources[field] === "ui") return F.secretHint;
    return undefined;
  };

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

  const extractionOptions = extractionModelOptions(
    models,
    values.extract_model,
    F.extractModelNone,
  );

  function handleSave() {
    if (!hasChanges) return;
    save.mutate(payload, { onSuccess: () => toast.success(F.saved) });
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-muted-foreground text-sm">{F.description}</p>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{F.extractModel}</span>
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
            {extractionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{F.extractModelHint}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{F.embeddingModel}</span>
          <Input
            value={values.embedding_model}
            aria-label={F.embeddingModel}
            {...AUTOFILL_OFF_INPUT_PROPS}
            onChange={(event) => update("embedding_model", event.target.value)}
          />
          <Input
            type="password"
            value={values.embedding_api_key}
            aria-label={F.embeddingApiKey}
            className="mt-1"
            {...AUTOFILL_OFF_INPUT_PROPS}
            onChange={(event) => update("embedding_api_key", event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {secretHint("embedding_api_key")}
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">{F.rerankModel}</span>
          <Input
            value={values.rerank_model}
            aria-label={F.rerankModel}
            {...AUTOFILL_OFF_INPUT_PROPS}
            onChange={(event) => update("rerank_model", event.target.value)}
          />
          <Input
            type="password"
            value={values.rerank_api_key}
            aria-label={F.rerankApiKey}
            className="mt-1"
            {...AUTOFILL_OFF_INPUT_PROPS}
            onChange={(event) => update("rerank_api_key", event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {secretHint("rerank_api_key")}
          </p>
        </div>
      </div>

      {embeddingChanged && (
        <p className="text-destructive text-xs" role="alert">
          {F.embeddingChangeWarning}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{F.captionModel}</span>
          <Input
            value={values.vlm_model}
            aria-label={F.captionModel}
            {...AUTOFILL_OFF_INPUT_PROPS}
            onChange={(event) => update("vlm_model", event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{F.vlmBaseUrl}</span>
          <Input
            type="url"
            value={values.vlm_base_url}
            aria-label={F.vlmBaseUrl}
            {...AUTOFILL_OFF_INPUT_PROPS}
            onChange={(event) => update("vlm_base_url", event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{F.vlmApiKey}</span>
        <Input
          type="password"
          value={values.vlm_api_key}
          aria-label={F.vlmApiKey}
          {...SECRET_INPUT_AUTOFILL_PROPS}
          onChange={(event) => update("vlm_api_key", event.target.value)}
        />
        <p className="text-muted-foreground text-xs">{secretHint("vlm_api_key")}</p>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{F.asrProvider}</span>
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
          <ToggleGroupItem value="whisper" aria-label={F.asrProviderWhisper}>
            {F.asrProviderWhisper}
          </ToggleGroupItem>
        </ToggleGroup>
        <Input
          value={values.video.asr_model}
          aria-label={F.asrModel}
          {...SECRET_INPUT_AUTOFILL_PROPS}
          onChange={(event) => updateVideo("asr_model", event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{F.qdrantUrl}</span>
          <Input
            type="url"
            value={values.qdrant_url}
            aria-label={F.qdrantUrl}
            {...SECRET_INPUT_AUTOFILL_PROPS}
            onChange={(event) => update("qdrant_url", event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{F.mineruToken}</span>
          <Input
            type="password"
            value={values.mineru_api_token}
            aria-label={F.mineruToken}
            {...SECRET_INPUT_AUTOFILL_PROPS}
            onChange={(event) => update("mineru_api_token", event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {secretHint("mineru_api_token")}
          </p>
        </div>
      </div>

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
