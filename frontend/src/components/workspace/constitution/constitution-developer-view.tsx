"use client";

import { ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Tooltip } from "@/components/workspace/tooltip";
import { groupMiddlewares } from "@/core/constitution/parse";
import type {
  ConstitutionMiddleware,
  ConstitutionRecord,
  GateNotification,
} from "@/core/constitution/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { ConstitutionRing } from "./constitution-ring";

/**
 * What was assembled, and what the gates did with it.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §6.2.
 * This tier is the one allowed to show internal names, so its job is the
 * opposite of the user tier's: render the detail faithfully. The two derived
 * axes (`kind`, `frequency`) come straight from the payload rather than being
 * recomputed, the hook list is shown as the identifiers it is, and `changes`
 * keys are printed as they arrived — they are contract fields, and a renaming
 * table here would become a third vocabulary.
 */
export interface ConstitutionDeveloperViewProps {
  record: ConstitutionRecord;
  gates: readonly GateNotification[];
  selectedKey: string | null;
  onSelectStage: (key: string) => void;
  className?: string;
}

/**
 * The copy key for a row's kind.
 *
 * The payload splits an overlay into `kind: "overlay"` plus `overlay_kind`, and
 * names a guard `"guard"` — while the frozen copy table (§13.4) keys its three
 * words `member` / `gate` / `handoff`. The keys are identifiers, not copy, so
 * the mapping lives here, explicitly, instead of being hidden in a fallback.
 */
const KIND_COPY_KEY: Record<string, string> = {
  member: "member",
  guard: "gate",
  handoff: "handoff",
};

function kindKeyOf(row: ConstitutionMiddleware): string {
  const raw =
    row.kind === "overlay" ? (row.overlay_kind ?? row.kind) : row.kind;
  return KIND_COPY_KEY[raw] ?? raw;
}

export function ConstitutionDeveloperView({
  record,
  gates,
  selectedKey,
  onSelectStage,
  className,
}: ConstitutionDeveloperViewProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => groupMiddlewares(record), [record]);

  const stageLabel = (key: string) =>
    (t.constitution.stage as Record<string, string>)[key] ?? key;

  const facts: Array<[string, string]> = [
    [t.constitution.facts.model, record.model.name ?? "—"],
    [t.constitution.facts.tools, String(record.tools.mounted_count)],
    [t.constitution.facts.deferred, String(record.tools.deferred_count)],
    [
      t.constitution.facts.removed,
      String(record.tool_authorization.removed_count),
    ],
  ];
  const factTestIds = ["model", "tools", "deferred", "removed"];

  return (
    <div
      data-testid="constitution-developer-view"
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="mx-auto w-full max-w-[22rem]">
        <ConstitutionRing
          stages={record.stages}
          labelForStage={stageLabel}
          segmentLabel={t.constitution.a11y.segment}
          selectedKey={selectedKey}
          onSelectStage={onSelectStage}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {facts.map(([label, value], index) => (
          <div
            key={label}
            data-testid={`constitution-fact-${factTestIds[index]}`}
            className="flex flex-col"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono">{value}</dd>
          </div>
        ))}
      </dl>

      {record.truncated && (
        <p
          data-testid="constitution-truncated"
          className="bg-muted/60 text-muted-foreground rounded-md px-3 py-1.5 text-xs"
        >
          {t.constitution.truncated}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {[...groups.ring, ...groups.outside].map((group) => (
          <section
            key={group.key}
            data-testid={`constitution-devmw-group-${group.key}`}
          >
            <h3 className="text-muted-foreground flex items-baseline gap-2 text-xs font-medium">
              {stageLabel(group.key)}
              <span className="font-mono">{group.rows.length}</span>
            </h3>
            <ul className="mt-1 flex flex-col">
              {group.rows.map((row) => (
                <MiddlewareRow
                  key={row.name}
                  row={row}
                  description={
                    (t.constitution.middleware as Record<string, string>)[
                      row.name
                    ]
                  }
                  kindLabel={
                    (t.constitution.kind as Record<string, string>)[
                      kindKeyOf(row)
                    ] ?? row.kind
                  }
                  frequencyLabel={
                    (t.constitution.frequency as Record<string, string>)[
                      row.frequency
                    ] ?? row.frequency
                  }
                  expanded={expanded === row.name}
                  onToggle={() =>
                    setExpanded((current) =>
                      current === row.name ? null : row.name,
                    )
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {gates.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {gates.map((notice, index) => (
            <li
              key={`${notice.tag}-${index}`}
              data-testid={`constitution-dev-gate-${index}`}
              className="bg-muted/40 rounded-md px-3 py-1.5 text-xs"
            >
              <span className="font-mono">{notice.name}</span>
              <span className="text-muted-foreground">
                {" "}
                {notice.tag} · {notice.action}
              </span>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
                {Object.entries(notice.changes).map(([key, value]) => (
                  <div
                    key={key}
                    data-testid={`constitution-dev-gate-change-${index}-${key}`}
                    className="col-span-2 grid grid-cols-subgrid"
                  >
                    <dt className="text-muted-foreground font-mono">{key}</dt>
                    <dd className="font-mono break-all">
                      {typeof value === "string"
                        ? value
                        : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiddlewareRow({
  row,
  description,
  kindLabel,
  frequencyLabel,
  expanded,
  onToggle,
}: {
  row: ConstitutionMiddleware;
  description: string | undefined;
  kindLabel: string;
  frequencyLabel: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      data-testid={`constitution-devmw-row-${row.name}`}
      className="border-b last:border-b-0"
    >
      <Tooltip content={description}>
        <button
          type="button"
          data-testid={`constitution-devmw-toggle-${row.name}`}
          aria-expanded={expanded}
          className="hover:bg-muted/50 flex w-full items-center gap-2 py-1 text-left text-xs"
          onClick={onToggle}
        >
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="truncate font-mono">{row.name}</span>
          <span className="text-muted-foreground ml-auto shrink-0 rounded border px-1">
            {kindLabel}
          </span>
          <span className="text-muted-foreground shrink-0 rounded border px-1">
            {frequencyLabel}
          </span>
        </button>
      </Tooltip>
      {expanded && (
        <div
          data-testid={`constitution-devmw-hooks-${row.name}`}
          className="text-muted-foreground flex flex-wrap gap-1 py-1 pl-5 text-[10px]"
        >
          {row.hooks.map((hook) => (
            <span key={hook} className="bg-muted rounded px-1 font-mono">
              {hook}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
