"use client";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { useLocalSettings } from "@/core/settings";
import { DEFAULT_LOCAL_SETTINGS } from "@/core/settings/local";

import { SettingsSection } from "./settings-section";

/**
 * 宠物设置。发现性由本行的提示文案承担 —— 宠物本体恒 `pointer-events-none`,
 * 不做 hover 控制药丸(spec §10.1)。
 */
export function PetSettingsPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();

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
