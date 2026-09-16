"use client";

import { ChevronRight, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  isSparseProviderOptionDisabled,
  isSparseSourceUnsupported,
  MODEL_REFERENCE_NONE,
  modelReferenceOptions,
  PARSE_BACKEND_OPTIONS,
  PARSE_PROVIDER_OPTIONS,
  RERANK_PROVIDER_OPTIONS,
  resolveSparseCapability,
  SPARSE_PROVIDER_OPTIONS,
  sparseProbeKey,
  visionReferenceOptions,
  type RagConfigFormValues,
} from "@/core/rag/config-form";
import {
  useProbeSparseCapability,
  useRagConfig,
  useSaveRagConfig,
} from "@/core/rag/hooks";
import {
  AUTOFILL_OFF_INPUT_PROPS,
  SECRET_INPUT_AUTOFILL_PROPS,
} from "@/lib/input-autofill";
import { cn } from "@/lib/utils";

import { InfoTip } from "./info-tip";
import { ReindexDialog } from "./reindex-dialog";

/** Sentinel for "no value" — Radix Select rejects an empty item value. */
const AUTO_OPTION_VALUE = "__auto__";

/** Rows the retrieval group's advanced section holds; its trigger names that count. */
const ADVANCED_SETTING_COUNT = 5;

/** The credential the capability probe needs before it can call anything. */
const EMBEDDING_KEY_SOURCE = "embedding_api_key";

/**
 * How long the form waits before probing a newly typed candidate. Each probe is one real embedding
 * call against the platform, so the wait is about not billing a call per keystroke.
 */
const PROBE_DEBOUNCE_MS = 400;

/**
 * A provider dropdown. Its ids come from the backend's curated allowlist; the empty id means
 * "let the downstream service decide", which is what the wire carries as null.
 *
 * `disabledReasons` greys out an individual option *and* says why: an option nobody can pick and
 * nobody can explain reads as a broken control, and the reason would otherwise only reach the
 * admin who scrolls to the alert at the bottom of the section.
 */
function OptionSelect({
  label,
  value,
  options,
  labels,
  disabledReasons,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  disabledReasons?: Partial<Record<string, string>>;
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
        {options.map((option) => {
          const reason = disabledReasons?.[option];
          return (
            <SelectItem
              key={option || AUTO_OPTION_VALUE}
              value={option || AUTO_OPTION_VALUE}
              disabled={Boolean(reason)}
            >
              {reason
                ? `${labels[option] ?? option} · ${reason}`
                : (labels[option] ?? option)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/**
 * One row of the form: the label sits in a fixed gutter, so every value column lines up no
 * matter how long the labels are. Two values = the two retrieval roles, one = an ordinary row.
 */
const ROW = "grid grid-cols-[8rem_1fr] items-center gap-x-4 py-3";
const ROW_PAIR = "grid grid-cols-[8rem_1fr_1fr] items-center gap-x-4 py-3";

/** Hairlines between rows; with the shared gutter they are what makes a group read as one form. */
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y">{children}</div>;
}

/**
 * A row that only exists because of the row above it: indented behind a rule, so the scope is
 * shown instead of spelled out — the sparse rows used to repeat 「稀疏」 five times to say what
 * this indent says once (2026-09-16).
 */
const NESTED_GUTTER = "ml-3 border-l border-border pl-3";

/** The gutter cell: the visible label, plus an ⓘ when there is a sentence for it. */
function RowLabel({
  children,
  info,
  nested,
}: {
  children: React.ReactNode;
  info?: string;
  nested?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-1 text-xs",
        nested && NESTED_GUTTER,
      )}
    >
      {children}
      {info && <InfoTip text={info} />}
    </span>
  );
}

/** A role heading: the role name carries the weight, its English tag is a quiet pill. */
function RoleHeading({ label, tag }: { label: string; tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold">{label}</span>
      <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
        {tag}
      </span>
    </div>
  );
}

/**
 * The stand-in text of a field that holds no value of its own: the reason a row is locked, and
 * the note that a credential arrives from the environment. Same message, so same type and same
 * weight — they sit in comparable rows and used to differ in size, side and tint (2026-09-16).
 */
const PLACEHOLDER_TEXT = "text-muted-foreground/70 text-sm";

/**
 * A value the current provider fixes — shown rather than hidden (2026-09-15): a control that
 * vanishes when you switch provider reads as a missing feature, and the tallest cell used to
 * push its neighbour out of alignment. The box states *why* it is locked.
 */
function LockedBox({
  reason,
  value,
}: {
  reason: string;
  /** Only ever a non-secret value; secret rows pass nothing and show the reason alone. */
  value?: string;
}) {
  return (
    <div className="border-input bg-muted/40 text-muted-foreground flex h-9 items-center justify-between gap-2 rounded-md border px-3">
      {/* A blank or absent value shows the reason: the box must never look editable-empty. */}
      <span className={cn("truncate", !value?.trim() && PLACEHOLDER_TEXT)}>
        {value?.trim() ? value : reason}
      </span>
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
    </div>
  );
}

/**
 * A credential input whose provenance chip rides *inside* the field (2026-09-16): set beside
 * the box it squeezed the box — worst on the retrieval pair, where the row then had to hold
 * two of them. Inside, it costs the field a slice of its own padding instead of the row's width.
 *
 * It leads the field while the field is untouched, like a locked row's reason does, and clears
 * the moment the field becomes yours — on focus, or because something is typed in it. It is a
 * note about provenance, not a placeholder for a format: left up while typing it reads as part
 * of the value, and the text typed after it looks appended to the note.
 *
 * `env`-sourced fields come back from the API empty (the environment holds the secret), so a
 * chip next to a non-empty field can only mean an override is being typed — never a stored key.
 */
function SecretInput({
  badge,
  className,
  value,
  ...props
}: React.ComponentProps<"input"> & { badge?: string }) {
  const [focused, setFocused] = useState(false);
  const showBadge = Boolean(badge) && !focused && !value;

  return (
    <div className={cn("relative", className)}>
      <Input
        type="password"
        className={showBadge ? "pl-32" : undefined}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...SECRET_INPUT_AUTOFILL_PROPS}
        {...props}
      />
      {showBadge && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 left-3 -translate-y-1/2",
            PLACEHOLDER_TEXT,
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

/**
 * RAG functional-model editor (spec 2026-09-10 rag functional-model config §5, extended by
 * spec 2026-09-14 rag model provider adaptation §4.1).
 *
 * Every group reads as the same form: a label gutter on the left, values on the right, rows
 * separated by a hairline. The retrieval group is the one two-value form — 向量 and 重排 are
 * peers with identical row structure, so their row labels are written **once** in the gutter
 * instead of once per column. The sparse settings live behind an advanced disclosure because
 * three of them only matter in one configuration.
 *
 * The three model-reference rows (graph extraction, eval judge, caption VLM) are plain pickers
 * over the configured `models:` entries: the backend resolves what each role needs from the
 * named entry, so none of them asks for an endpoint or a key of its own. The embedding and
 * rerank rows are the exception — they select a *provider* from the backend's curated
 * allowlist and carry an endpoint, because those clients are not model-entry based. A provider
 * that ships its own address shows that row **locked** rather than hidden.
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
  const probe = useProbeSparseCapability();
  const { models } = useModels();
  const { config: modelsConfig } = useModelsConfig();

  const [values, setValues] = useState<RagConfigFormValues | null>(null);
  // The last candidate a probe was actually sent for, so re-rendering (or unrelated typing) does
  // not repeat the same call — and so a *new* candidate always does get one.
  const requestedProbe = useRef<string | null>(null);
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

  // The sparse half's capability is a three-state answer (spec 2026-09-16 §3 D2): the allowlist
  // settles the dialect question, a probe settles the model question, and everything unproven
  // stays `unknown` — which blocks nothing.
  const probeVerdict = probe.data ?? null;
  const sparseCapability = values
    ? resolveSparseCapability(values, view?.embedding_providers, probeVerdict)
    : "unknown";
  // Judged from the form's own provider, so switching the picker warns immediately.
  const sparseUnsupported = values
    ? isSparseSourceUnsupported(values, view?.embedding_providers, probeVerdict)
    : false;
  const sparseUnverified =
    values?.embedding_sparse_source === "provider" &&
    probeVerdict?.key === (values ? sparseProbeKey(values) : "") &&
    probeVerdict.status === "unverifiable";

  // Probe only when the question can actually be asked: the allowlist says this provider *can*
  // supply the sparse half, the form is asking it for that half, a model is named, and there is a
  // key to call with. The key test is `sources[...] !== "unset"` and NOT "the input box is not
  // empty" — an environment-backed key arrives as an empty box, and reading that as "no key" would
  // leave the feature dead in exactly the deployment that needs it.
  const probeApplies =
    view !== undefined &&
    values !== null &&
    values.embedding_sparse_source === "provider" &&
    values.embedding_model.trim() !== "" &&
    view.sources?.[EMBEDDING_KEY_SOURCE] !== "unset" &&
    view.embedding_providers?.some(
      (provider) =>
        provider.provider_id === values.embedding_provider &&
        provider.emits_sparse,
    ) === true;

  useEffect(() => {
    if (!probeApplies || !values) return;
    const key = sparseProbeKey(values);
    if (requestedProbe.current === key) return;
    // One real (billable) embedding call per candidate: without the pause, a six-character model
    // id would be six calls, five of them for ids that do not exist.
    const timer = setTimeout(() => {
      requestedProbe.current = key;
      probe.mutate({
        key,
        embedding_provider: values.embedding_provider,
        embedding_model: values.embedding_model.trim(),
        embedding_base_url: values.embedding_base_url.trim() || null,
        embedding_api_key: values.embedding_api_key.trim() || null,
      });
    }, PROBE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [probeApplies, values, probe]);

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
    "tei-sparse": F.providerTeiSparse,
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

  /** Provenance is state, not documentation: a chip when the environment supplies it. */
  function isEnvBacked(field: string) {
    return sources[field] === "env";
  }

  /** The overwrite warning, shown once per row even though the pair holds two credentials. */
  function secretHintFor(...fields: string[]) {
    return fields.some((field) => sources[field] === "ui")
      ? F.secretHint
      : undefined;
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

  const sparseExternal = values.embedding_sparse_source === "external";

  return (
    <div className="flex w-full flex-col gap-4">
      <Group title={F.groupRetrieval} info={F.groupRetrievalHint}>
        <Rows>
          <div className={`${ROW_PAIR} pt-0 pb-2`}>
            <span />
            <RoleHeading label={F.embeddingModel} tag={F.roleTagEmbedding} />
            <RoleHeading label={F.rerankModel} tag={F.roleTagRerank} />
          </div>

          <div className={ROW_PAIR}>
            <RowLabel>{F.providerLabel}</RowLabel>
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
          </div>

          <div className={ROW_PAIR}>
            <RowLabel>{F.modelLabel}</RowLabel>
            <Input
              value={values.embedding_model}
              aria-label={F.embeddingModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) =>
                update("embedding_model", event.target.value)
              }
            />
            <Input
              value={values.rerank_model}
              aria-label={F.rerankModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("rerank_model", event.target.value)}
            />
          </div>

          <div className={ROW_PAIR}>
            <RowLabel
              info={secretHintFor("embedding_api_key", "rerank_api_key")}
            >
              {F.apiKeyLabel}
            </RowLabel>
            <SecretInput
              badge={
                isEnvBacked("embedding_api_key")
                  ? F.secretFromEnvBadge
                  : undefined
              }
              value={values.embedding_api_key}
              aria-label={F.embeddingApiKey}
              onChange={(event) =>
                update("embedding_api_key", event.target.value)
              }
            />
            <SecretInput
              badge={
                isEnvBacked("rerank_api_key") ? F.secretFromEnvBadge : undefined
              }
              value={values.rerank_api_key}
              aria-label={F.rerankApiKey}
              onChange={(event) => update("rerank_api_key", event.target.value)}
            />
          </div>

          <div className={ROW_PAIR}>
            <RowLabel info={F.retrievalEndpointHint}>
              {F.endpointLabel}
            </RowLabel>
            {values.embedding_provider === "dashscope" ? (
              <LockedBox
                reason={F.lockedByProvider}
                value={values.embedding_base_url}
              />
            ) : (
              <Input
                value={values.embedding_base_url}
                aria-label={F.embeddingBaseUrl}
                {...AUTOFILL_OFF_INPUT_PROPS}
                onChange={(event) =>
                  update("embedding_base_url", event.target.value)
                }
              />
            )}
            {values.rerank_provider === "dashscope" ? (
              <LockedBox
                reason={F.lockedByProvider}
                value={values.rerank_base_url}
              />
            ) : (
              <Input
                value={values.rerank_base_url}
                aria-label={F.rerankBaseUrl}
                {...AUTOFILL_OFF_INPUT_PROPS}
                onChange={(event) =>
                  update("rerank_base_url", event.target.value)
                }
              />
            )}
          </div>
        </Rows>

        <Collapsible className="mt-5">
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1.5 text-xs">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            {F.advancedSettings(ADVANCED_SETTING_COUNT)}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <Rows>
              <div className={ROW}>
                <RowLabel info={`${F.sparseSourceHint} ${F.sparseProbeHint}`}>
                  {F.embeddingSparseSource}
                </RowLabel>
                <div className="space-y-1.5">
                  <OptionSelect
                    label={F.embeddingSparseSource}
                    value={values.embedding_sparse_source}
                    options={EMBEDDING_SPARSE_SOURCE_OPTIONS}
                    labels={SPARSE_SOURCE_LABELS}
                    disabledReasons={
                      isSparseProviderOptionDisabled(sparseCapability)
                        ? { provider: F.sparseProviderDenseOnly }
                        : undefined
                    }
                    onChange={(next) =>
                      update(
                        "embedding_sparse_source",
                        next as RagConfigFormValues["embedding_sparse_source"],
                      )
                    }
                  />
                  {probe.isPending && (
                    <p className="text-muted-foreground text-xs" role="status">
                      {F.sparseProbing}
                    </p>
                  )}
                  {!probe.isPending && sparseUnverified && (
                    <p className="text-muted-foreground text-xs">
                      {F.sparseUnverified}
                    </p>
                  )}
                </div>
              </div>

              {sparseExternal ? (
                <>
                  {/* The sparse service is asked the same four questions, in the same order, as
                      the embedding service above — 提供商 / Model ID / API Key / 接口地址. The
                      gutter names them once for both; each control still carries its own
                      accessible name (F.sparse*) so the two are never confused out loud. */}
                  <div className={ROW}>
                    <RowLabel nested>{F.providerLabel}</RowLabel>
                    <OptionSelect
                      label={F.sparseProvider}
                      value={values.sparse_provider}
                      options={SPARSE_PROVIDER_OPTIONS}
                      labels={PROVIDER_LABELS}
                      onChange={(next) =>
                        update(
                          "sparse_provider",
                          next as RagConfigFormValues["sparse_provider"],
                        )
                      }
                    />
                  </div>
                  <div className={ROW}>
                    <RowLabel nested>{F.modelLabel}</RowLabel>
                    <Input
                      value={values.sparse_model}
                      aria-label={F.sparseModel}
                      {...AUTOFILL_OFF_INPUT_PROPS}
                      onChange={(event) =>
                        update("sparse_model", event.target.value)
                      }
                    />
                  </div>
                  <div className={ROW}>
                    <RowLabel nested>{F.apiKeyLabel}</RowLabel>
                    <SecretInput
                      badge={
                        isEnvBacked("sparse_api_key")
                          ? F.secretFromEnvBadge
                          : undefined
                      }
                      value={values.sparse_api_key}
                      aria-label={F.sparseApiKey}
                      onChange={(event) =>
                        update("sparse_api_key", event.target.value)
                      }
                    />
                  </div>
                  <div className={ROW}>
                    <RowLabel nested>{F.endpointLabel}</RowLabel>
                    <Input
                      value={values.sparse_base_url}
                      aria-label={F.sparseBaseUrl}
                      {...AUTOFILL_OFF_INPUT_PROPS}
                      onChange={(event) =>
                        update("sparse_base_url", event.target.value)
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  {[
                    F.providerLabel,
                    F.modelLabel,
                    F.apiKeyLabel,
                    F.endpointLabel,
                  ].map((label) => (
                    <div key={label} className={ROW}>
                      <RowLabel nested>{label}</RowLabel>
                      <LockedBox reason={F.lockedExternalOnly} />
                    </div>
                  ))}
                </>
              )}
            </Rows>
          </CollapsibleContent>
        </Collapsible>

        {embeddingChanged && (
          <p className="text-destructive mt-3 text-xs" role="alert">
            {F.embeddingChangeWarning}
          </p>
        )}

        {/* Outside the disclosure on purpose: a warning nobody can see while the section is
            collapsed is not a warning. */}
        {sparseUnsupported && (
          <p className="text-destructive mt-3 text-xs" role="alert">
            {F.sparseProviderUnsupported}
          </p>
        )}
      </Group>

      <Group title={F.groupExtraction} info={F.extractModelHint}>
        <div className={ROW}>
          <RowLabel>{F.extractModel}</RowLabel>
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
        </div>
      </Group>

      <Group title={F.groupEvaluation} info={F.groupEvaluationHint}>
        <div className={ROW}>
          <RowLabel>{F.judgeModel}</RowLabel>
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
        </div>
      </Group>

      <Group title={F.groupMultimodal} info={F.groupMultimodalHint}>
        <Rows>
          <div className={ROW}>
            <RowLabel info={F.captionModelHint}>{F.captionModel}</RowLabel>
            <div className="space-y-1.5">
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

              {!hasVisionModel && (
                <p className="text-muted-foreground text-xs">
                  {F.vlmNoVisionModel}
                </p>
              )}
            </div>
          </div>

          <div className={ROW}>
            <RowLabel>{F.asrProvider}</RowLabel>
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
          </div>

          <div className={ROW}>
            <RowLabel>{F.asrModel}</RowLabel>
            <Input
              value={values.video.asr_model}
              aria-label={F.asrModel}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => updateVideo("asr_model", event.target.value)}
            />
          </div>
        </Rows>
      </Group>

      <Group title={F.groupServices} info={F.groupServicesHint}>
        <Rows>
          <div className={ROW}>
            <RowLabel>{F.qdrantUrl}</RowLabel>
            <Input
              type="url"
              value={values.qdrant_url}
              aria-label={F.qdrantUrl}
              {...AUTOFILL_OFF_INPUT_PROPS}
              onChange={(event) => update("qdrant_url", event.target.value)}
            />
          </div>

          <div className={ROW}>
            <RowLabel info={F.parseBaseUrlHint}>{F.parseProvider}</RowLabel>
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
          </div>

          {values.parse_provider === "mineru-local" ? (
            <>
              <div className={ROW}>
                <RowLabel>{F.parseBaseUrl}</RowLabel>
                <Input
                  value={values.parse_base_url}
                  aria-label={F.parseBaseUrl}
                  {...AUTOFILL_OFF_INPUT_PROPS}
                  onChange={(event) =>
                    update("parse_base_url", event.target.value)
                  }
                />
              </div>
              <div className={ROW}>
                <RowLabel>{F.parseBackend}</RowLabel>
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
              </div>
              <div className={ROW}>
                <RowLabel>{F.mineruToken}</RowLabel>
                <LockedBox reason={F.lockedCloudOnly} />
              </div>
            </>
          ) : (
            <>
              <div className={ROW}>
                <RowLabel>{F.parseBaseUrl}</RowLabel>
                <LockedBox reason={F.lockedLocalOnly} />
              </div>
              <div className={ROW}>
                <RowLabel>{F.parseBackend}</RowLabel>
                <LockedBox reason={F.lockedLocalOnly} />
              </div>
              <div className={ROW}>
                <RowLabel>{F.mineruToken}</RowLabel>
                <SecretInput
                  badge={
                    isEnvBacked("mineru_api_token")
                      ? F.secretFromEnvBadge
                      : undefined
                  }
                  value={values.mineru_api_token}
                  aria-label={F.mineruToken}
                  onChange={(event) =>
                    update("mineru_api_token", event.target.value)
                  }
                />
              </div>
            </>
          )}
        </Rows>
      </Group>

      <Group title={F.reindexTitle} info={F.reindexHint}>
        <div className={ROW}>
          <RowLabel>{F.reindexKbLabel}</RowLabel>
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
        </div>
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
        {/* Disabled without a reason reads as a broken button, and the alert above can be
            scrolled out of sight — so the same sentence rides next to the button it blocks. */}
        {sparseUnsupported ? (
          <span className="text-destructive text-xs">
            {F.sparseProviderUnsupported}
          </span>
        ) : (
          !hasChanges && (
            <span className="text-muted-foreground text-xs">{F.noChanges}</span>
          )
        )}
        <Button
          onClick={handleSave}
          disabled={!hasChanges || sparseUnsupported || save.isPending}
        >
          {save.isPending ? t.common.loading : t.common.save}
        </Button>
      </div>
    </div>
  );
}

/** A titled card whose explanatory sentence sits behind an ⓘ (see `InfoTip`). */
function Group({
  title,
  info,
  children,
}: {
  title: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          {title}
          {info && <InfoTip text={info} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}
