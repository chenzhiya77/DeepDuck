"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  openSettingsDialog,
  type SettingsSection,
  useSettingsDialog,
} from "./settings";

/**
 * Every {@link SettingsSection}, as a lookup table rather than a hand-copied list: typed as a
 * total record, the compiler rejects a section that is added to the union but not listed here.
 * That drift is what dropped `models` and `pet` from the old hand-written set, and a dropped
 * section makes `?settings=<it>` do nothing at all — no error, no hint, no dialog (2026-09-16).
 */
const SETTINGS_SECTION_IDS: Record<SettingsSection, true> = {
  account: true,
  appearance: true,
  channels: true,
  integrations: true,
  models: true,
  memory: true,
  tools: true,
  skills: true,
  notification: true,
  pet: true,
  about: true,
};

const SETTINGS_SECTIONS = new Set<string>(Object.keys(SETTINGS_SECTION_IDS));

function asSettingsSection(value: string | null): SettingsSection | null {
  if (!value) return null;
  return SETTINGS_SECTIONS.has(value) ? (value as SettingsSection) : null;
}

/**
 * Bridges the `?settings=<section>` query param to the shared settings dialog
 * store. It does not mount its own dialog — a single {@link SettingsDialogHost}
 * renders the one dialog — so a deep link can never race a second dialog opened
 * from the nav menu or command palette.
 */
export function WorkspaceSettingsDeepLink() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { open } = useSettingsDialog();
  const openedFromDeepLinkRef = useRef(false);

  useEffect(() => {
    const nextSection = asSettingsSection(searchParams.get("settings"));
    if (nextSection) {
      openedFromDeepLinkRef.current = true;
      openSettingsDialog(nextSection);
    }
  }, [searchParams]);

  useEffect(() => {
    if (open || !openedFromDeepLinkRef.current) {
      return;
    }
    openedFromDeepLinkRef.current = false;
    if (searchParams.has("settings")) {
      const next = new URLSearchParams(searchParams);
      next.delete("settings");
      const suffix = next.toString();
      router.replace(suffix ? `${pathname}?${suffix}` : pathname, {
        scroll: false,
      });
    }
  }, [open, pathname, router, searchParams]);

  return null;
}
