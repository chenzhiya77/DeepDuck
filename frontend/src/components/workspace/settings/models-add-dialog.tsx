"use client";

import { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { expandBatchToEntries } from "@/core/models/batch";
import type { ManagedModelInput, ProviderId } from "@/core/models/types";

interface ModelsAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All existing model names (config.yaml + UI) used for -2/-3 dedupe. */
  existingNames: string[];
  /** Called with the expanded new entries; the caller merges + persists. */
  onAdd: (entries: ManagedModelInput[]) => void;
  isPending: boolean;
}

/**
 * Batch "add models" dialog (spec 2026-09-10 §5.3.1): one shared credential
 * block plus a repeatable Model ID list, expanded client-side into N flat
 * entries. The backend contract is unchanged.
 */
export function ModelsAddDialog({
  open,
  onOpenChange,
  existingNames,
  onAdd,
  isPending,
}: ModelsAddDialogProps) {
  const { t } = useI18n();
  const M = t.settings.models;

  const [provider, setProvider] = useState<ProviderId>("openai-compatible");
  const [apiType, setApiType] = useState<"chat" | "responses">("chat");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelIds, setModelIds] = useState<string[]>([""]);
  const [thinking, setThinking] = useState(false);
  const [vision, setVision] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [contextWindow, setContextWindow] = useState("");
  const [error, setError] = useState<string | null>(null);

  function updateModelId(index: number, value: string) {
    setModelIds((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function reset() {
    setProvider("openai-compatible");
    setApiType("chat");
    setEndpoint("");
    setApiKey("");
    setShowKey(false);
    setModelIds([""]);
    setThinking(false);
    setVision(false);
    setReasoning(false);
    setContextWindow("");
    setError(null);
  }

  function handleSubmit() {
    if (!modelIds.some((id) => id.trim())) {
      setError(M.validationNoModelId);
      return;
    }
    const parsedWindow = contextWindow.trim()
      ? Number(contextWindow)
      : undefined;
    const entries = expandBatchToEntries(
      {
        provider,
        endpoint: endpoint.trim() || undefined,
        apiKey: apiKey || undefined,
        apiType,
        supportsThinking: thinking,
        supportsVision: vision,
        supportsReasoningEffort: reasoning,
        contextWindow:
          parsedWindow && parsedWindow > 0 ? parsedWindow : undefined,
      },
      modelIds,
      existingNames,
    );
    onAdd(entries);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{M.addTitle}</DialogTitle>
          <DialogDescription>{M.addDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Provider */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.provider}</span>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as ProviderId)}
            >
              <SelectTrigger className="w-full" aria-label={M.provider}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">
                  {M.providerOpenaiCompatible}
                </SelectItem>
                <SelectItem value="anthropic">{M.providerAnthropic}</SelectItem>
                <SelectItem value="deepseek">{M.providerDeepseek}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* API type — only meaningful for openai-compatible (spec §5.3.1) */}
          {provider === "openai-compatible" && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{M.apiType}</span>
              <Select
                value={apiType}
                onValueChange={(value) =>
                  setApiType(value as "chat" | "responses")
                }
              >
                <SelectTrigger className="w-full" aria-label={M.apiType}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">{M.apiTypeChat}</SelectItem>
                  <SelectItem value="responses">{M.apiTypeResponses}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Endpoint */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.endpoint}</span>
            <Input
              value={endpoint}
              aria-label={M.endpoint}
              placeholder="https://api.example.com/v1"
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>

          {/* API key */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.apiKey}</span>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                aria-label={M.apiKey}
                className="pr-10"
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                aria-label={M.apiKeyToggle}
                onClick={() => setShowKey((v) => !v)}
                className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                {showKey ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>
          </div>

          {/* Model IDs (repeatable) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{M.modelIds}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setModelIds((prev) => [...prev, ""])}
              >
                <PlusIcon className="size-4" />
                {M.addModelId}
              </Button>
            </div>
            {modelIds.map((id, index) => (
              <div className="flex items-center gap-2" key={index}>
                <Input
                  value={id}
                  placeholder={M.modelIdPlaceholder}
                  onChange={(e) => updateModelId(index, e.target.value)}
                />
                {modelIds.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={M.removeModelId}
                    onClick={() =>
                      setModelIds((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Shared capability defaults */}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={thinking}
                onCheckedChange={setThinking}
                aria-label={M.thinking}
              />
              {M.thinking}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={vision}
                onCheckedChange={setVision}
                aria-label={M.vision}
              />
              {M.vision}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={reasoning}
                onCheckedChange={setReasoning}
                aria-label={M.reasoning}
              />
              {M.reasoning}
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.contextWindow}</span>
            <Input
              type="number"
              min={1}
              value={contextWindow}
              aria-label={M.contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? t.common.loading : M.addSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
