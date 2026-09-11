"use client";

import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import {
  PET_DISPLAY_SIZE_MAX,
  PET_DISPLAY_SIZE_MIN,
  commitDisplaySize,
  normalizeDisplaySize,
} from "@/core/pet/placement";
import { useLocalSettings } from "@/core/settings";
import { DEFAULT_LOCAL_SETTINGS } from "@/core/settings/local";

import { SettingsSection } from "./settings-section";

/**
 * 宠物设置。发现性由本行的提示文案承担 —— 宠物本体恒 `pointer-events-none`,
 * 不做 hover 控制药丸(spec §10.1)。
 *
 * 缩放的提交时机是**松手**(§10.2):盒子尺寸一变就重排并重置 `background-position`
 * 的百分比基准,逐帧写设置会让动画抖。故拖动中只改 `draft`,松手/回车/失焦才落盘。
 */
export function PetSettingsPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();
  const committed = normalizeDisplaySize(settings.pet.displaySize);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? committed;

  const commitSize = () => {
    if (draft === null) return;
    const size = commitDisplaySize(draft);
    setDraft(null);
    if (size !== committed) setSettings("pet", { displaySize: size });
  };

  return (
    <SettingsSection
      title={t.settings.pet.title}
      description={
        <div className="flex items-center gap-2">
          <div>{t.settings.pet.description}</div>
          <div>
            <Switch
              aria-label={t.settings.pet.title}
              checked={settings.pet.enabled}
              onCheckedChange={(enabled) => setSettings("pet", { enabled })}
            />
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          {t.settings.pet.dragHint}
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <label className="text-sm" htmlFor="pet-display-size">
              {t.settings.pet.size}
            </label>
            <input
              id="pet-display-size"
              type="range"
              min={PET_DISPLAY_SIZE_MIN}
              max={PET_DISPLAY_SIZE_MAX}
              step={2}
              value={shown}
              className="accent-foreground w-48"
              onChange={(event) => setDraft(Number(event.target.value))}
              onPointerUp={commitSize}
              onKeyUp={commitSize}
              onBlur={commitSize}
            />
            <span className="text-muted-foreground text-sm tabular-nums">
              {shown}px
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {t.settings.pet.sizeHint}
          </p>
        </div>

        <div>
          <Button
            variant="outline"
            onClick={() =>
              setSettings("pet", {
                offset: DEFAULT_LOCAL_SETTINGS.pet.offset,
              })
            }
          >
            <RotateCcwIcon className="mr-2 size-4" />
            {t.settings.pet.resetPosition}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
