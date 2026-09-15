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
import {
  useKnowledgeBases,
  useReindexKnowledgeBase,
  useReindexStatus,
} from "@/core/knowledge/hooks";
import { isReindexRunning } from "@/core/knowledge/reindex-status";
import { useModels, useModelsConfig } from "@/core/models/hooks";
import { RagConfigRequestError } from "@/core/rag/api";
import {
  buildRagConfigInput,
  EMBEDDING_PROVIDER_OPTIONS,
  EMBEDDING_SPARSE_SOURCE_OPTIONS,
  formValuesFromConfig,
  hasFormChanges,
  isCaptionCapable,
  isEmbeddingChange,
  MODEL_REFERENCE_NONE,
  modelReferenceOptions,
  PARSE_BACKEND_OPTIONS,
  PARSE_PROVIDER_OPTIONS,
  RERANK_PROVIDER_OPTIONS,
  visionReferenceOptions,
  type RagConfigFormValues,
} from "@/core/rag/config-form";
import { useRagConfig, useSaveRagConfig } from "@/core/rag/hooks";
import {
  AUTOFILL_OFF_INPUT_PROPS,
  SECRET_INPUT_AUTOFILL_PROPS,
} from "@/lib/input-autofill";

import { ReindexDialog } from "./reindex-dialog";

/** Sentinel for "no value" — Radix Select rejects an empty item value. */
const AUTO_OPTION_VALUE = "__auto__";

/**
 * A provider dropdown. Its ids come from the backend's curated allowlist; the empty id means
 * "let the downstream service decide", which is what the wire carries as null.
 */
function OptionSelect({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (next: string) => void;
}) {
  return (
    <Select
      value={value || AUTO_OPTION_VALUE}
      onValueChange={(next) =>
        onChange(next === AUTO_OPTION_VALUE ? "" : next)
      }
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option || AUTO_OPTION_VALUE}
            value={option || AUTO_OPTION_VALUE}
          >
            {labels[option] ?? option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * RAG functional-model editor (spec 2026-09-10 rag functional-model config §5, extended by
 * spec 2026-09-14 rag model provider adaptation §4.1).
 *
 * Fields are grouped by what they *do* (retrieval / graph / evaluation / multimodal /
 * services), each with a one-line purpose, because a flat list of model names left admins
 * guessing which role each one plays. Every input carries a visible label — a secret field
 * whose only label was an `aria-label` reads as an anonymous box.
 *
 * The three model-reference rows (graph extraction, eval judge, caption VLM) are plain pickers
 * over the configured `models:` entries: the backend resolves what each role needs from the
 * named entry, so none of them asks for an endpoint or a key of its own. The embedding and
 * rerank rows are the exception — they select a *provider* from the backend's curated
 * allowlist and carry an endpoint, because those clients are not model-entry based. The
 * endpoint input appears only for a provider that has no built-in default, so a DashScope
 * deployment still shows no address field at all.
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
  // The rebuild entry is library-scoped while this view is app-wide, so the target is picked
  // here (session-only) instead of being derived from wherever the dialog was opened.
  const [reindexKbId, setReindexKbId] = useState("");
  const [reindexOpen, setReindexOpen] = useState(false);
  const { data: knowledgeBases } = useKnowledgeBases();
  const reindexStatus = useReindexStatus(reindexKbId || null);
  const reindex = useReindexKnowledgeBase(reindexKbId || null);

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
  const visionOptions = visionReferenceOptions(
    managedModels,
    values.vlm_model,
    F.vlmModelDefault,
  );
  const hasVisionModel = managedModels.some(isCaptionCapable);

  // Ids come from the backend's curated allowlist; the empty id is "let the service decide".
  const PROVIDER_LABELS: Record<string, string> = {
    dashscope: F.providerDashscope,
    "openai-compatible": F.providerOpenAIChat,
    "generic-rerank": F.providerGenericRerank,
    "mineru-cloud": F.providerMineruCloud,
    "mineru-local": F.providerMineruLocal,
    "": F.parseBackendAuto,
  };
  const SPARSE_SOURCE_LABELS: Record<string, string> = {
    provider: F.sparseSourceProvider,
    external: F.sparseSourceExternal,
    bm25: F.sparseSourceBm25,
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

  function secretHint(field: string): string | undefined {
    if (sources[field] === "env") return F.secretFromEnv;
    if (sources[field] === "ui") return F.secretHint;
    return undefined;
  }

  function handleSave() {
    if (!hasChanges) return;
    save.mutate(payload, { onSuccess: () => toast.success(F.saved) });
  }

  const libraries = knowledgeBases ?? [];
  const selectedKb = libraries.find((kb) => kb.id === reindexKbId);
  const reindexRunning = isReindexRunning(reindexStatus.data, reindex.isPending);
  const reindexProgress = reindexStatus.data?.progress;

  function handleReindexConfirm() {
    reindex.mutate(undefined, {
      onSuccess: (ack) => {
        if (ack.status === "already_running") {
          toast.info(F.reindexAlreadyRunning);
        } else {
          toast.success(F.reindexEnqueued);
        }
        setReindexOpen(false);
      },
    });
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-muted-foreground text-sm">{F.description}</p>

      <Group title={F.groupRetrieval} hint={F.groupRetrievalHint}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={F.embeddingModel} hint={secretHint("embedding_api_key")}>
            <span className="mb-2 block text-sm font-medium">
              {F.embeddingProvider}
            </span>
            <OptionSelect
              label={F.embeddingProvider}
              value={values.embedding_provider}
              options={EMBEDDING_PROVIDER_OPTIONS}
              labels={PROVIDER_LABELS}
              onChange={(next) =>
                update(
                  "embedding_provider",
                  next as RagConfigFormValues["embedding_provider"],
                )
              }
            />
            <Input
              value={values.embedding_model}
              aria-label={F.embeddingModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("embedding_model", event.target.value)}
            />
            {values.embedding_provider !== "dashscope" && (
              <>
                <span className="mt-3 block text-sm font-medium">
                  {F.embeddingBaseUrl}
                </span>
                <Input
                  value={values.embedding_base_url}
                  aria-label={F.embeddingBaseUrl}
                  {...AUTOFILL_OFF_INPUT_PROPS}
                  onChange={(event) =>
                    update("embedding_base_url", event.target.value)
                  }
                />
              </>
            )}
            <span className="mt-3 block text-sm font-medium">
              {F.embeddingSparseSource}
            </span>
            <OptionSelect
              label={F.embeddingSparseSource}
              value={values.embedding_sparse_source}
              options={EMBEDDING_SPARSE_SOURCE_OPTIONS}
              labels={SPARSE_SOURCE_LABELS}
              onChange={(next) =>
                update(
                  "embedding_sparse_source",
                  next as RagConfigFormValues["embedding_sparse_source"],
                )
              }
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {F.sparseSourceHint}
            </p>
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
            <span className="mb-2 block text-sm font-medium">
              {F.rerankProvider}
            </span>
            <OptionSelect
              label={F.rerankProvider}
              value={values.rerank_provider}
              options={RERANK_PROVIDER_OPTIONS}
              labels={PROVIDER_LABELS}
              onChange={(next) =>
                update(
                  "rerank_provider",
                  next as RagConfigFormValues["rerank_provider"],
                )
              }
            />
            <Input
              value={values.rerank_model}
              aria-label={F.rerankModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("rerank_model", event.target.value)}
            />
            {values.rerank_provider !== "dashscope" && (
              <>
                <span className="mt-3 block text-sm font-medium">
                  {F.rerankBaseUrl}
                </span>
                <Input
                  value={values.rerank_base_url}
                  aria-label={F.rerankBaseUrl}
                  {...AUTOFILL_OFF_INPUT_PROPS}
                  onChange={(event) =>
                    update("rerank_base_url", event.target.value)
                  }
                />
              </>
            )}
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
        <p className="text-muted-foreground mt-3 text-xs">
          {F.retrievalEndpointHint}
        </p>
      </Group>

      <Group title={F.groupExtraction} hint={F.extractModelHint}>
        <Field label={F.extractModel}>
          <Select
            value={values.extract_model || MODEL_REFERENCE_NONE}
            onValueChange={(next) =>
              update("extract_model", next === MODEL_REFERENCE_NONE ? "" : next)
            }
          >
            <SelectTrigger className="w-full" aria-label={F.extractModel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelReferenceOptions(
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

      <Group title={F.groupEvaluation} hint={F.groupEvaluationHint}>
        <Field label={F.judgeModel}>
          <Select
            value={values.judge_model || MODEL_REFERENCE_NONE}
            onValueChange={(next) =>
              update("judge_model", next === MODEL_REFERENCE_NONE ? "" : next)
            }
          >
            <SelectTrigger className="w-full" aria-label={F.judgeModel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelReferenceOptions(
                models,
                values.judge_model,
                F.judgeModelNone,
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
          <Field label={F.captionModel} hint={F.captionModelHint}>
            <Select
              value={values.vlm_model || MODEL_REFERENCE_NONE}
              onValueChange={(next) =>
                update("vlm_model", next === MODEL_REFERENCE_NONE ? "" : next)
              }
            >
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

          {!hasVisionModel && (
            <p className="text-muted-foreground text-xs">
              {F.vlmNoVisionModel}
            </p>
          )}

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
          <Field label={F.parseProvider} hint={secretHint("mineru_api_token")}>
            <OptionSelect
              label={F.parseProvider}
              value={values.parse_provider}
              options={PARSE_PROVIDER_OPTIONS}
              labels={PROVIDER_LABELS}
              onChange={(next) =>
                update(
                  "parse_provider",
                  next as RagConfigFormValues["parse_provider"],
                )
              }
            />
            {values.parse_provider === "mineru-local" ? (
              <>
                <span className="mt-3 block text-sm font-medium">
                  {F.parseBaseUrl}
                </span>
                <Input
                  value={values.parse_base_url}
                  aria-label={F.parseBaseUrl}
                  {...AUTOFILL_OFF_INPUT_PROPS}
                  onChange={(event) =>
                    update("parse_base_url", event.target.value)
                  }
                />
                <span className="mt-3 block text-sm font-medium">
                  {F.parseBackend}
                </span>
                <OptionSelect
                  label={F.parseBackend}
                  value={values.parse_backend}
                  options={PARSE_BACKEND_OPTIONS}
                  labels={PROVIDER_LABELS}
                  onChange={(next) =>
                    update(
                      "parse_backend",
                      next as RagConfigFormValues["parse_backend"],
                    )
                  }
                />
                <p className="text-muted-foreground mt-2 text-xs">
                  {F.parseBaseUrlHint}
                </p>
              </>
            ) : (
              <>
                <span className="mt-3 block text-sm font-medium">
                  {F.mineruToken}
                </span>
                <Input
                  type="password"
                  value={values.mineru_api_token}
                  aria-label={F.mineruToken}
                  {...SECRET_INPUT_AUTOFILL_PROPS}
                  onChange={(event) =>
                    update("mineru_api_token", event.target.value)
                  }
                />
              </>
            )}
          </Field>
        </div>
      </Group>

      <Group title={F.reindexTitle} hint={F.reindexHint}>
        <Field label={F.reindexKbLabel}>
          <Select value={reindexKbId} onValueChange={setReindexKbId}>
            <SelectTrigger className="w-full" aria-label={F.reindexKbLabel}>
              <SelectValue placeholder={F.reindexKbPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {libraries.map((kb) => (
                <SelectItem key={kb.id} value={kb.id}>
                  {kb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="mt-3 flex items-center justify-end gap-3">
          {reindexRunning && (
            <span className="text-muted-foreground text-xs" role="status">
              {reindexProgress
                ? `${F.reindexRunning} ${reindexProgress.documents_done}/${reindexProgress.documents_total} · ${F.reindexChunksWritten} ${reindexProgress.chunks_indexed}`
                : F.reindexRunning}
            </span>
          )}
          {!reindexRunning && reindexStatus.data?.last_run === "succeeded" && (
            <span className="text-muted-foreground text-xs">
              {F.reindexLastSucceeded}
            </span>
          )}
          {!reindexRunning && reindexStatus.data?.last_run === "failed" && (
            <span className="text-destructive text-xs" role="alert">
              {F.reindexLastFailed}
            </span>
          )}
          {libraries.length === 0 && (
            <span className="text-muted-foreground text-xs">
              {F.reindexNoKb}
            </span>
          )}
          <Button
            variant="outline"
            disabled={!reindexKbId || reindexRunning}
            onClick={() => setReindexOpen(true)}
          >
            {F.reindexAction}
          </Button>
        </div>
      </Group>

      <ReindexDialog
        open={reindexOpen}
        onOpenChange={setReindexOpen}
        kbName={selectedKb?.name ?? ""}
        onConfirm={handleReindexConfirm}
        pending={reindex.isPending}
      />

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
