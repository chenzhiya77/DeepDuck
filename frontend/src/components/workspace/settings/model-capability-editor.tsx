"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import {
  CONTEXT_WINDOW_OPTIONS,
  REASONING_EFFORT_LEVELS,
} from "@/core/models/api";
import {
  toggleEffort,
  toggleWindow,
  type ModelCapabilityValue,
} from "@/core/models/capability";
import type { ReasoningEffortLevel } from "@/core/models/types";

interface ModelCapabilityEditorProps {
  value: ModelCapabilityValue;
  onChange: (next: ModelCapabilityValue) => void;
  /** True when the value came from the curated registry, so it is labelled a suggestion. */
  suggested?: boolean;
}

/**
 * Capability editor shared by the add wizard's second step and the edit dialog
 * (spec 2026-09-10 §5.4). Windows and effort levels are declared as multi-select
 * subsets, each with a single-choice default drawn from the selected subset, so
 * the form cannot express a default outside its own subset.
 */
export function ModelCapabilityEditor({
  value,
  onChange,
  suggested = false,
}: ModelCapabilityEditorProps) {
  const { t } = useI18n();
  const M = t.settings.models;

  function windowLabel(size: number): string {
    switch (size) {
      case 200_000:
        return M.window200k;
      case 400_000:
        return M.window400k;
      case 1_000_000:
        return M.window1m;
      default:
        return String(size);
    }
  }

  function effortLabel(level: ReasoningEffortLevel): string {
    switch (level) {
      case "minimal":
        return t.inputBox.reasoningEffortMinimal;
      case "low":
        return t.inputBox.reasoningEffortLow;
      case "medium":
        return t.inputBox.reasoningEffortMedium;
      case "high":
        return t.inputBox.reasoningEffortHigh;
    }
  }

  return (
    <div className="space-y-4">
      {suggested && (
        <p className="text-muted-foreground text-xs">{M.suggested}</p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={value.supportsThinking}
            onCheckedChange={(checked) =>
              onChange({ ...value, supportsThinking: checked })
            }
            aria-label={M.thinking}
          />
          {M.thinking}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={value.supportsVision}
            onCheckedChange={(checked) =>
              onChange({ ...value, supportsVision: checked })
            }
            aria-label={M.vision}
          />
          {M.vision}
        </label>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">
          {M.supportedWindows}
        </legend>
        <div className="flex flex-wrap gap-4">
          {CONTEXT_WINDOW_OPTIONS.map((size) => (
            <label key={size} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.supportedWindows.includes(size)}
                onCheckedChange={() => onChange(toggleWindow(value, size))}
                aria-label={windowLabel(size)}
              />
              {windowLabel(size)}
            </label>
          ))}
        </div>
      </fieldset>

      {value.supportedWindows.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{M.defaultWindow}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={M.defaultWindow}
            value={
              value.defaultWindow != null ? String(value.defaultWindow) : ""
            }
            onValueChange={(next) => {
              if (next) {
                onChange({ ...value, defaultWindow: Number(next) });
              }
            }}
          >
            {value.supportedWindows.map((size) => (
              <ToggleGroupItem
                key={size}
                value={String(size)}
                aria-label={windowLabel(size)}
              >
                {windowLabel(size)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">
          {M.supportedEfforts}
        </legend>
        <div className="flex flex-wrap gap-4">
          {REASONING_EFFORT_LEVELS.map((level) => (
            <label key={level} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.supportedEfforts.includes(level)}
                onCheckedChange={() => onChange(toggleEffort(value, level))}
                aria-label={effortLabel(level)}
              />
              {effortLabel(level)}
            </label>
          ))}
        </div>
      </fieldset>

      {value.supportedEfforts.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{M.defaultEffort}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={M.defaultEffort}
            value={value.defaultEffort ?? ""}
            onValueChange={(next) => {
              if (next) {
                onChange({
                  ...value,
                  defaultEffort: next as ReasoningEffortLevel,
                });
              }
            }}
          >
            {value.supportedEfforts.map((level) => (
              <ToggleGroupItem
                key={level}
                value={level}
                aria-label={effortLabel(level)}
              >
                {effortLabel(level)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </div>
  );
}
