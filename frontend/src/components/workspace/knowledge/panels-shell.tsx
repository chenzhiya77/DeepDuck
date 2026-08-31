"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
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
  /**
   * Fold/expand toggle for the list column, built by the shell because that
   * is where the collapsed state lives. Render it into the middle column's
   * header row: the header band is the only horizontal space that never
   * overlaps a document row, and keeping the control mounted (icon + label
   * flip) means it never moves across the fold.
   */
  listToggle: ReactNode;
}

/**
 * Three-column shell of the knowledge page (spec §5.2) built on
 * react-resizable-panels: both gutters drag to resize with pixel min/max
 * guards, and the left kb list folds push-style (drag past its min width or
 * click the toggle → width 0). The toggle is one persistent control that the
 * shell renders and `middle` places in its header row — never a floating
 * overlay, which sat on top of the document table at whatever row happened to
 * be centred. It must stay visible for the drag-to-edge path too, since that
 * collapses the column without ever touching the button.
 * The middle column keeps its 320px minimum; the chat column keeps a 320px
 * floor too so the composer row (deep-research switch + model selector + send
 * button) never wraps at the panel's narrowest drag position. Extreme narrow
 * widths fall back to horizontal scrolling on the outer container instead of
 * crushing columns. The Group carries min-w-[52rem] because the library
 * always fits panels into the container width — without it, a viewport
 * narrower than the sum of all panel minimums silently violates every
 * minSize.
 */
export function KnowledgePanelsShell({
  left,
  middle,
  right,
}: {
  left: ReactNode;
  middle: (controls: KnowledgePanelsControls) => ReactNode;
  right: ReactNode;
}) {
  const { t } = useI18n();
  const tk = t.knowledge;
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  // The shell owns the collapsed flag: button clicks set it directly, while
  // onLayoutChanged covers the drag-to-the-edge path (fires on pointer
  // release, so a gesture that reverses before release never flickers).
  const toggleLeft = useCallback(() => {
    if (leftCollapsed) {
      leftPanelRef.current?.expand();
      setLeftCollapsed(false);
    } else {
      leftPanelRef.current?.collapse();
      setLeftCollapsed(true);
    }
  }, [leftCollapsed]);
  const handleLayoutChanged = useCallback((layout: Layout) => {
    setLeftCollapsed(layout[LEFT_PANEL_ID] === 0);
  }, []);

  const listToggle = (
    <Button
      aria-label={leftCollapsed ? tk.expandKbList : tk.collapseKbList}
      className="-ml-1 -mr-1 size-5 shrink-0 text-muted-foreground hover:text-foreground"
      data-testid="kb-list-toggle"
      size="icon"
      variant="ghost"
      onClick={toggleLeft}
    >
      {leftCollapsed ? (
        <PanelLeftOpenIcon className="size-3.5" />
      ) : (
        <PanelLeftCloseIcon className="size-3.5" />
      )}
    </Button>
  );

  return (
    <div
      className="relative size-full min-h-0 overflow-x-auto"
      data-testid="knowledge-panels-shell"
    >
      <ResizablePanelGroup
        className="size-full min-w-[52rem] min-h-0"
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
            {left}
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
          <section className="size-full border-r">{middle({ listToggle })}</section>
        </ResizablePanel>
        <ResizableHandle className="hover:bg-accent w-0.5 transition-colors" />
        <ResizablePanel
          className="min-h-0"
          defaultSize={352}
          id="chat"
          maxSize={560}
          minSize={320}
        >
          <aside className="size-full">{right}</aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
