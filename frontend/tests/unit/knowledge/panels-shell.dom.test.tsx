/**
 * Three-column shell (spec §5.2): draggable gutters with pixel min/max guards
 * and the push-style collapsible kb list. Fold phases are intent-driven —
 * "folding" from the click until the CSS transition reports done (a safety
 * timer stands in for transitionend in the DOM-less test environment) — so
 * the tests simulate arrival by setting the resting width and letting the
 * settle timer fire.
 */
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { KnowledgePanelsShell } from "@/components/workspace/knowledge/panels-shell";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";

// The settle fallback is a timer and the toggle slot's mount kick uses rAF;
// fake timers keep both deterministic.
rs.useFakeTimers();

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
          <button data-testid="left-collapse" type="button" onClick={collapseLeft}>
            收起
          </button>
        )}
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

function headerToggle() {
  return screen.queryByRole("button", { name: "展开列表栏" });
}

/** Simulate the transition landing at a resting width (stand-in for
 *  transitionend): set the width, let the settle fallback fire. */
function settleAt(aside: HTMLElement, px: number) {
  Object.defineProperty(aside, "offsetWidth", { configurable: true, value: px });
  act(() => {
    rs.advanceTimersByTime(450);
  });
}

/** Let the toggle slot's mount kick (rAF) run. */
function flushFrames(ms = 20) {
  act(() => {
    rs.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("KnowledgePanelsShell", () => {
  it("renders all three columns with two draggable separators", () => {
    const { container } = renderShell();
    expect(screen.getByTestId("left-collapse")).toBeTruthy();
    expect(screen.getByTestId("middle-content")).toBeTruthy();
    expect(screen.getByTestId("right-content")).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="resizable-handle"]').length).toBe(2);
  });

  it("keeps the middle header empty while the list is expanded", () => {
    renderShell();
    // The list header owns the fold in this state, so the library name is not
    // pushed right by a second control. The slot BOX persists at net-zero
    // advance (unmounting it yanked 12px back in one frame — divider jitter),
    // but the button is not in it and it contributes no text.
    expect(headerToggle()).toBeNull();
    expect(screen.getByTestId("middle-header").textContent).toBe("");
  });

  it("moves the control to the middle header as soon as the fold starts", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("left-collapse"));
    // Intent-driven: the slot mounts at the click, no width watching.
    const toggle = headerToggle();
    expect(toggle).toBeTruthy();
    // Never a floating overlay: it renders inside the header row the consumer
    // chose, not on top of the content column.
    expect(screen.getByTestId("middle-header").contains(toggle)).toBe(true);
  });

  it("grows the toggle slot with the fold and shrinks it with the unfold", () => {
    const { container } = renderShell();
    const aside = container.querySelector("aside")!;
    const slotClass = () =>
      (screen.getByTestId("middle-header").firstElementChild as HTMLElement).className;

    fireEvent.click(screen.getByTestId("left-collapse"));
    // Mounted at the narrow width; the rAF kick grows it so the width
    // transition actually runs (mounting at the target would skip it).
    expect(slotClass()).toContain("w-3");
    flushFrames();
    expect(slotClass()).toContain("w-6");

    // Unfolding shrinks it back in step…
    fireEvent.click(screen.getByRole("button", { name: "展开列表栏" }));
    expect(slotClass()).toContain("w-3");
    // …and the settle empties it at net-zero advance — the BOX stays mounted
    // (unmounting it used to yank its advance back and jump the divider),
    // only the button leaves.
    settleAt(aside, 224);
    expect(screen.getByTestId("middle-header").firstElementChild).toBeTruthy();
    expect(headerToggle()).toBeNull();
  });

  it("restores the list and drops the control again", () => {
    const { container } = renderShell();
    const aside = container.querySelector("aside")!;
    fireEvent.click(screen.getByTestId("left-collapse"));
    settleAt(aside, 0);
    expect(headerToggle()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开列表栏" }));
    settleAt(aside, 224);
    // The button leaves the (persisting, net-zero) slot.
    expect(headerToggle()).toBeNull();
  });

  it("arms the flex transition on click and disarms once the fold settles", () => {
    const { container } = renderShell();
    const aside = container.querySelector("aside")!;
    const shell = screen.getByTestId("knowledge-panels-shell");
    const styleText = container.querySelector("style")?.textContent ?? "";
    expect(styleText).toContain("#kb-list");
    expect(styleText).toContain("200ms");
    expect(shell.getAttribute("data-fold-animating")).toBeNull();

    fireEvent.click(screen.getByTestId("left-collapse"));
    expect(shell.getAttribute("data-fold-animating")).toBe("true");
    settleAt(aside, 0);
    expect(shell.getAttribute("data-fold-animating")).toBeNull();
  });

  it("keeps the content clipped, never squeezed, across the whole round trip", () => {
    // The app sidebar keeps its content at a constant width and slides it —
    // here the equivalent is pinning the content to its fold-start width for
    // BOTH directions, released only once the unfold has settled. Dropping
    // the pin earlier squeezed the content back into the per-character
    // wrapping the user reported.
    const { container } = renderShell();
    const aside = container.querySelector("aside")!;
    Object.defineProperty(aside, "offsetWidth", { configurable: true, value: 224 });
    const inner = aside.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByTestId("left-collapse"));
    expect(inner.style.width).toBe("224px");
    settleAt(aside, 0);
    expect(inner.style.width).toBe("224px");
    fireEvent.click(screen.getByRole("button", { name: "展开列表栏" }));
    // Still pinned mid-unfold…
    expect(inner.style.width).toBe("224px");
    // …released exactly when the unfold settles at the pinned width.
    settleAt(aside, 224);
    expect(inner.style.width).toBe("");
  });

  it("fades the content per direction while mid-flight", () => {
    const { container } = renderShell();
    const aside = container.querySelector("aside")!;
    Object.defineProperty(aside, "offsetWidth", { configurable: true, value: 224 });

    fireEvent.click(screen.getByTestId("left-collapse"));
    // Collapsing: legible for the first half, then a late accelerating fade.
    expect(aside.className).toContain("duration-100");
    expect(aside.className).toContain("delay-100");
    settleAt(aside, 0);
    expect(aside.className).toContain("opacity-0");

    fireEvent.click(screen.getByRole("button", { name: "展开列表栏" }));
    // Expanding: fade in over the whole curve, no delay.
    expect(aside.className).toContain("duration-200");
    expect(aside.className).not.toContain("delay-100");
    expect(aside.className).not.toContain("opacity-0");
  });
});
