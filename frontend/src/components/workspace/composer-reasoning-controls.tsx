"use client";

import {
  CheckIcon,
  GraduationCapIcon,
  LightbulbIcon,
  RocketIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
} from "@/components/ai-elements/prompt-input";
import { DropdownMenuGroup, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import type { Translations } from "@/core/i18n/locales/types";
import {
  offeredModes,
  resolveMode,
  type InputMode,
} from "@/core/models/reasoning-effort";
import type { ReasoningEffortLevel } from "@/core/models/types";
import { cn } from "@/lib/utils";

import { ModeHoverGuide } from "./mode-hover-guide";

/**
 * Composer mode + reasoning-depth menus (spec 2026-09-10 §5.3.2).
 *
 * Both menus own their gating rules rather than leaving it to each caller: the
 * mode list drops the thinking-dependent entries on a model that cannot think
 * (they used to render and then silently snap back to Flash), and the depth menu
 * renders nothing unless the model supports it *and* the current mode can carry
 * it. The input box and the sidecar panel therefore cannot drift apart.
 */

/**
 * Keys of `settings`-style lookup tables, narrowed to the string-valued i18n entries
 * so `t.inputBox[key]` stays a plain string (the input box also holds array-valued
 * entries, whose union would otherwise leak into every template literal).
 */
type InputBoxKey = {
  [K in keyof Translations["inputBox"]]: Translations["inputBox"][K] extends string
    ? K
    : never;
}[keyof Translations["inputBox"]];

const MODE_META: Record<
  InputMode,
  {
    icon: LucideIcon;
    label: InputBoxKey;
    description: InputBoxKey;
    iconClassName?: string;
    labelClassName?: string;
  }
> = {
  flash: { icon: ZapIcon, label: "flashMode", description: "flashModeDescription" },
  thinking: {
    icon: LightbulbIcon,
    label: "reasoningMode",
    description: "reasoningModeDescription",
  },
  pro: { icon: GraduationCapIcon, label: "proMode", description: "proModeDescription" },
  ultra: {
    icon: RocketIcon,
    label: "ultraMode",
    description: "ultraModeDescription",
    iconClassName: "text-[#dabb5e]",
    labelClassName: "golden-text",
  },
};

export function ModeMenu({
  mode,
  supportsThinking,
  onSelect,
  disabled,
  triggerClassName,
}: {
  mode: InputMode | undefined;
  supportsThinking: boolean;
  onSelect: (mode: InputMode) => void;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  const { t } = useI18n();
  const resolved = resolveMode(mode, supportsThinking);
  const TriggerIcon = MODE_META[resolved].icon;

  return (
    <PromptInputActionMenu>
      <ModeHoverGuide mode={resolved}>
        <PromptInputActionMenuTrigger
          className={triggerClassName}
          disabled={disabled}
          aria-label={`${t.inputBox.mode}: ${t.inputBox[MODE_META[resolved].label]}`}
        >
          <div>
            <TriggerIcon
              className={cn("size-3", MODE_META[resolved].iconClassName)}
            />
          </div>
          <div
            className={cn(
              "truncate text-xs font-normal",
              MODE_META[resolved].labelClassName,
            )}
          >
            {t.inputBox[MODE_META[resolved].label]}
          </div>
        </PromptInputActionMenuTrigger>
      </ModeHoverGuide>
      <PromptInputActionMenuContent className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            {t.inputBox.mode}
          </DropdownMenuLabel>
          {offeredModes(supportsThinking).map((option) => {
            const meta = MODE_META[option];
            const Icon = meta.icon;
            const selected = resolved === option;
            return (
              <PromptInputActionMenuItem
                key={option}
                className={cn(
                  selected ? "text-accent-foreground" : "text-muted-foreground/65",
                )}
                onSelect={() => onSelect(option)}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1 font-bold">
                    <Icon
                      className={cn(
                        "mr-2 size-4",
                        selected && "text-accent-foreground",
                      )}
                    />
                    {t.inputBox[meta.label]}
                  </div>
                  <div className="pl-7 text-xs">
                    {t.inputBox[meta.description]}
                  </div>
                </div>
                {selected ? (
                  <CheckIcon className="ml-auto size-4" />
                ) : (
                  <div className="ml-auto size-4" />
                )}
              </PromptInputActionMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

const EFFORT_META: Record<
  ReasoningEffortLevel,
  { label: InputBoxKey; description: InputBoxKey }
> = {
  minimal: {
    label: "reasoningEffortMinimal",
    description: "reasoningEffortMinimalDescription",
  },
  low: { label: "reasoningEffortLow", description: "reasoningEffortLowDescription" },
  medium: {
    label: "reasoningEffortMedium",
    description: "reasoningEffortMediumDescription",
  },
  high: {
    label: "reasoningEffortHigh",
    description: "reasoningEffortHighDescription",
  },
};

export function EffortMenu({
  mode,
  supportsReasoningEffort,
  effort,
  levels,
  onSelect,
  disabled,
  triggerClassName,
}: {
  mode: InputMode | undefined;
  supportsReasoningEffort: boolean;
  /**
   * The level the run will use (already resolved through option A). Undefined
   * only when nothing is selected, in which case no entry is ticked.
   */
  effort: ReasoningEffortLevel | undefined;
  /** Options to offer: the model's declared subset, else every level. */
  levels: ReasoningEffortLevel[];
  onSelect: (level: ReasoningEffortLevel) => void;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  const { t } = useI18n();
  // Flash runs no reasoning, so the depth control would offer a choice the run
  // discards; models without effort support never show it at all.
  if (!supportsReasoningEffort || mode === "flash") {
    return null;
  }

  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        className={triggerClassName}
        disabled={disabled}
      >
        <div className="text-xs font-normal">
          {t.inputBox.reasoningEffort}:
          {effort ? ` ${t.inputBox[EFFORT_META[effort].label]}` : ""}
        </div>
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className="w-70">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            {t.inputBox.reasoningEffort}
          </DropdownMenuLabel>
          {levels.map((level) => {
            const meta = EFFORT_META[level];
            const selected = effort === level;
            return (
              <PromptInputActionMenuItem
                key={level}
                className={cn(
                  selected ? "text-accent-foreground" : "text-muted-foreground/65",
                )}
                onSelect={() => onSelect(level)}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1 font-bold">
                    {t.inputBox[meta.label]}
                  </div>
                  <div className="pl-2 text-xs">
                    {t.inputBox[meta.description]}
                  </div>
                </div>
                {selected ? (
                  <CheckIcon className="ml-auto size-4" />
                ) : (
                  <div className="ml-auto size-4" />
                )}
              </PromptInputActionMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}
