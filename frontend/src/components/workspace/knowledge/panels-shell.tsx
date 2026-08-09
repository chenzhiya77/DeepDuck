"use client";

import { PanelLeftOpenIcon } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Layout, PanelImperativeHandle } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const LEFT_PANEL_ID = "kb-list";

export interface KnowledgePanelsControls {
  collapseLeft: () => void;
}

/**
 * Three-column shell of the knowledge page (spec §5.2) built on
 * react-resizable-panels: both gutters drag to resize with pixel min/max
 * guards, and the left kb list folds push-style (drag past its min width or
 * click the header button → width 0; a floating edge handle restores it).
 * The middle column keeps its 320px minimum; extreme narrow widths fall back
 * to horizontal scrolling on the outer container instead of crushing columns.
 * The Group carries min-w-[50rem] because the library always fits panels into
 * the container width — without it, a viewport narrower than the sum of all
 * panel minimums silently violates every minSize.
 */
export function KnowledgePanelsShell({
  left,
  middle,
  right,
}: {
  left: (controls: KnowledgePanelsControls) => ReactNode;
  middle: ReactNode;
  right: ReactNode;
}) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // The shell owns the collapsed flag: button clicks set it directly, while
  // onLayoutChanged covers the drag-to-the-edge path (fires on pointer
  // release, so a gesture that reverses before release never flickers).
  const collapseLeft = useCallback(() => {
    leftPanelRef.current?.collapse();
    setLeftCollapsed(true);
  }, []);
  const expandLeft = useCallback(() => {
    leftPanelRef.current?.expand();
    setLeftCollapsed(false);
  }, []);
  const handleLayoutChanged = useCallback((layout: Layout) => {
    setLeftCollapsed(layout[LEFT_PANEL_ID] === 0);
  }, []);

  return (
    <div
      className="relative size-full min-h-0 overflow-x-auto"
      data-testid="knowledge-panels-shell"
    >
      <ResizablePanelGroup
        className="size-full min-w-[50rem] min-h-0"
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
      >
        <ResizablePanel
          className="min-h-0"
          collapsible
          collapsedSize={0}
          defaultSize={224}
          id={LEFT_PANEL_ID}
          maxSize={360}
          minSize={176}
          panelRef={leftPanelRef}
        >
          <aside
            aria-hidden={leftCollapsed}
            className={cn(
              "size-full border-r",
              leftCollapsed && "pointer-events-none opacity-0",
            )}
          >
            {left({ collapseLeft })}
          </aside>
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            "hover:bg-accent w-0.5 transition-colors",
            leftCollapsed && "pointer-events-none opacity-0",
          )}
          disabled={leftCollapsed}
        />
        <ResizablePanel className="min-h-0 min-w-0" id="documents" minSize={320}>
          <section className="size-full border-r">{middle}</section>
        </ResizablePanel>
        <ResizableHandle className="hover:bg-accent w-0.5 transition-colors" />
        <ResizablePanel
          className="min-h-0"
          defaultSize={352}
          id="chat"
          maxSize={560}
          minSize={288}
        >
          <aside className="size-full">{right}</aside>
        </ResizablePanel>
      </ResizablePanelGroup>
      {leftCollapsed && (
        <Button
          aria-label={tk.expandKbList}
          className="absolute top-1/2 left-1 z-20 -translate-y-1/2 shadow-md"
          size="icon-sm"
          variant="outline"
          onClick={expandLeft}
        >
          <PanelLeftOpenIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}
