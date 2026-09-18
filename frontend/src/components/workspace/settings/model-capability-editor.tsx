"use client";

import { Brain, ChevronDown, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";

interface ModelCapabilityEditorProps {
  value: ModelCapabilityValue;
  onChange: (next: ModelCapabilityValue) => void;
  /**
   * Whether this leg can be handed the effort fields at all (spec 2026-09-19 §2 D3). False
   * hides both effort rows: the protocol names effort differently and our translation is not
   * built yet, so offering the control would only produce a save the guard refuses. Deliberately
   * worded as "can send" rather than "supports effort" — see `canSendEffortLevels`.
   */
  canSendEffortLevels: boolean;
  /** True when the value came from the curated registry, so it is labelled a suggestion. */
  suggested?: boolean;
}

/**
 * Capability editor shared by the add wizard's second step and the edit dialog
 * (spec 2026-09-10 §5.4). Windows and effort levels are declared as multi-select
 * subsets, each with a single-choice default drawn from the selected subset, so
 * the form cannot express a default outside its own subset.
 *
 * Windows and the capability pair use the compact forms (a dropdown and two
 * side-by-side toggles): the three window options plus a default are one decision,
 * and the capability pair is a pair of switches, not a list to scan.
 */
export function ModelCapabilityEditor({
  value,
  onChange,
  canSendEffortLevels,
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

      <div className="grid grid-cols-2 gap-2">
        <CapabilityToggle
          icon={<Brain className="size-4" />}
          label={M.thinking}
          checked={value.supportsThinking}
          onChange={(checked) =>
            onChange({ ...value, supportsThinking: checked })
          }
        />
        <CapabilityToggle
          icon={<Eye className="size-4" />}
          label={M.vision}
          checked={value.supportsVision}
          onChange={(checked) =>
            onChange({ ...value, supportsVision: checked })
          }
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{M.supportedWindows}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={M.supportedWindows}
              className="w-full justify-between font-normal"
            >
              {M.subsetSelected(value.supportedWindows.length)}
              <ChevronDown className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          {/* Stays open across picks: choosing a subset is one decision, not N. */}
          <DropdownMenuContent
            align="start"
            className="w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            {CONTEXT_WINDOW_OPTIONS.map((size) => (
              <DropdownMenuCheckboxItem
                key={size}
                checked={value.supportedWindows.includes(size)}
                onCheckedChange={() => onChange(toggleWindow(value, size))}
                onSelect={(event) => event.preventDefault()}
              >
                {windowLabel(size)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {value.supportedWindows.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{M.defaultWindow}</span>
          <Select
            value={
              value.defaultWindow != null ? String(value.defaultWindow) : ""
            }
            onValueChange={(next) =>
              onChange({ ...value, defaultWindow: Number(next) })
            }
          >
            <SelectTrigger className="w-full" aria-label={M.defaultWindow}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {value.supportedWindows.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {windowLabel(size)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {canSendEffortLevels && (
        <>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{M.supportedEfforts}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={M.supportedEfforts}
                  className="w-full justify-between font-normal"
                >
                  {M.subsetSelected(value.supportedEfforts.length)}
                  <ChevronDown className="size-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                {REASONING_EFFORT_LEVELS.map((level) => (
                  <DropdownMenuCheckboxItem
                    key={level}
                    checked={value.supportedEfforts.includes(level)}
                    onCheckedChange={() => onChange(toggleEffort(value, level))}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {effortLabel(level)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {value.supportedEfforts.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{M.defaultEffort}</span>
              <Select
                value={value.defaultEffort ?? ""}
                onValueChange={(next) =>
                  onChange({
                    ...value,
                    defaultEffort: next as ReasoningEffortLevel,
                  })
                }
              >
                <SelectTrigger className="w-full" aria-label={M.defaultEffort}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {value.supportedEfforts.map((level) => (
                    <SelectItem key={level} value={level}>
                      {effortLabel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One half of the capability pair. A `switch`-roled button rather than a switch
 * *inside* a box, so the whole tile is the hit target and the label is the box.
 */
function CapabilityToggle({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-9 items-center justify-center gap-2 rounded-md border text-sm transition-colors",
        checked
          ? "border-primary/60 bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
