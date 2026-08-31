/**
 * Three-column shell (spec §5.2): draggable gutters with pixel min/max guards
 * and the push-style collapsible kb list. The fold control is one persistent
 * toggle the shell builds and hands to `middle`, so it lives in the library
 * header row instead of floating over the document table.
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
        left={<div data-testid="left-content">库列表</div>}
        middle={({ listToggle }) => (
          <div data-testid="middle-content">
            <div data-testid="middle-header">{listToggle}</div>
            文档
          </div>
        )}
        right={<div data-testid="right-content">会话</div>}
      />
    </I18nContext.Provider>,
  );
}

function toggle() {
  return screen.getByRole("button", { name: /列表栏/ });
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
  });

  it("hands the fold toggle to the middle column instead of overlaying it", () => {
    renderShell();
    // The header row is the toggle's home: an overlay in the content area sat
    // on whichever document row happened to be vertically centred.
    expect(screen.getByTestId("middle-header").contains(toggle())).toBe(true);
    expect(toggle().getAttribute("aria-label")).toBe("收起列表栏");
  });

  it("keeps the toggle mounted across the fold and flips its label", () => {
    renderShell();
    const before = toggle();
    fireEvent.click(before);
    expect(toggle().getAttribute("aria-label")).toBe("展开列表栏");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("收起列表栏");
  });
});
