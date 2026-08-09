/**
 * Three-column shell (spec §5.2): draggable gutters with pixel min/max guards
 * and the push-style collapsible kb list (header button or drag-to-edge →
 * width 0; floating handle restores it).
 */
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { KnowledgePanelsShell } from "@/components/workspace/knowledge/panels-shell";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";

// react-resizable-panels measures through ResizeObserver, which happy-dom
// does not implement; a no-op stub is enough for render-level assertions.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {
        /* no-op stub */
      }
      unobserve() {
        /* no-op stub */
      }
      disconnect() {
        /* no-op stub */
      }
    }
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
});

function renderShell() {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <KnowledgePanelsShell
        left={({ collapseLeft }) => (
          <button data-testid="left-content" type="button" onClick={collapseLeft}>
            库列表
          </button>
        )}
        middle={<div data-testid="middle-content">文档</div>}
        right={<div data-testid="right-content">会话</div>}
      />
    </I18nContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("KnowledgePanelsShell", () => {
  it("renders all three columns with two draggable separators", () => {
    const { container } = renderShell();
    expect(screen.getByTestId("left-content")).toBeTruthy();
    expect(screen.getByTestId("middle-content")).toBeTruthy();
    expect(screen.getByTestId("right-content")).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="resizable-handle"]').length).toBe(2);
    expect(screen.queryByRole("button", { name: "展开列表栏" })).toBeNull();
  });

  it("collapses the left column via the control and shows the floating expand handle", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("left-content"));
    expect(screen.getByRole("button", { name: "展开列表栏" })).toBeTruthy();
  });

  it("restores the left column when the floating handle is clicked", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("left-content"));
    const handle = screen.getByRole("button", { name: "展开列表栏" });
    fireEvent.click(handle);
    expect(screen.queryByRole("button", { name: "展开列表栏" })).toBeNull();
  });
});
