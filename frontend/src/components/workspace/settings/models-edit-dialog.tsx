"use client";

import { useEffect, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { MASKED_API_KEY } from "@/core/models/api";
import type { ManagedModel, ManagedModelInput, ProviderId } from "@/core/models/types";

interface ModelsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ManagedModel | null;
  onSave: (input: ManagedModelInput) => void;
  isPending: boolean;
}

/**
 * Single-model edit dialog (spec 2026-09-10 §5.7). Provider / model / name are
 * identity fields and are read-only after creation; an empty api_key means
 * "keep the stored key" (the masking sentinel is submitted).
 */
export function ModelsEditDialog({
  open,
  onOpenChange,
  model,
  onSave,
  isPending,
}: ModelsEditDialogProps) {
  const { t } = useI18n();
  const M = t.settings.models;

  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [thinking, setThinking] = useState(false);
  const [vision, setVision] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [contextWindow, setContextWindow] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  useEffect(() => {
    if (!model) return;
    setDisplayName(model.display_name ?? "");
    setApiKey("");
    setEndpoint(model.endpoint ?? "");
    setThinking(Boolean(model.supports_thinking));
    setVision(Boolean(model.supports_vision));
    setReasoning(Boolean(model.supports_reasoning_effort));
    setContextWindow(
      model.context_window != null ? String(model.context_window) : "",
    );
    setMaxTokens("");
  }, [model]);

  if (!model) return null;

  function handleSubmit() {
    if (!model) return;
    const parsedWindow = contextWindow.trim() ? Number(contextWindow) : undefined;
    const parsedMaxTokens = maxTokens.trim() ? Number(maxTokens) : undefined;
    onSave({
      provider: (model.provider ?? "openai-compatible") as ProviderId,
      name: model.name,
      model: model.model,
      display_name: displayName.trim() || undefined,
      api_key: apiKey || MASKED_API_KEY,
      endpoint: endpoint.trim() || undefined,
      supports_thinking: thinking,
      supports_vision: vision,
      supports_reasoning_effort: reasoning,
      context_window:
        parsedWindow && parsedWindow > 0 ? parsedWindow : undefined,
      max_tokens:
        parsedMaxTokens && parsedMaxTokens > 0 ? parsedMaxTokens : undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{M.editTitle}</DialogTitle>
          <DialogDescription>{M.editDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <p className="text-muted-foreground text-xs">{M.identityHint}</p>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.displayName}</span>
            <Input
              value={displayName}
              aria-label={M.displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.apiKey}</span>
            <Input
              type="password"
              value={apiKey}
              aria-label={M.apiKey}
              placeholder={MASKED_API_KEY}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.endpoint}</span>
            <Input
              value={endpoint}
              aria-label={M.endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>

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

          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{M.maxTokens}</span>
              <Input
                type="number"
                min={1}
                value={maxTokens}
                aria-label={M.maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
          </div>
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
            {isPending ? t.common.loading : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
