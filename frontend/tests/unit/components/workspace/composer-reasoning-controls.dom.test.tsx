/**
 * 输入栏/侧栏共用的「模式 + 推理深度」控件（spec 2026-09-10 §5.3.2/§6，plan Task 5 seam C dom）：
 * 两个菜单都由它们自己拥有门控规则，因此三种观察形态可在此直接钉死：
 * - (T,T) 思考 + 全 4 模式 + 推理深度（只列模型子集）；
 * - (T,F) 全 4 模式、无推理深度入口；
 * - (F,F) 模式菜单只剩闪速（thinking/pro/ultra 这些点不动的死条目消失）。
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";

const { EffortMenu, ModeMenu } = await import(
  "@/components/workspace/composer-reasoning-controls"
);

const T = zhCN.inputBox;
const ALL_LEVELS = ["minimal", "low", "medium", "high"] as const;

function renderInI18n(node: React.ReactNode) {
  return render(
    <I18nContext.Provider
      value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}
    >
      {node}
    </I18nContext.Provider>,
  );
}

function openMenu(triggerName: string) {
  // Radix DropdownMenu opens on keyDown in jsdom/happy-dom, not on click.
  fireEvent.keyDown(screen.getByRole("button", { name: triggerName }), {
    key: "ArrowDown",
  });
}

/** The mode trigger announces both the control and the mode it currently shows. */
function modeTriggerName(modeLabel: string) {
  return `${T.mode}: ${modeLabel}`;
}

/** Menu items carry label + description as their accessible name, so anchor on the label. */
function menuItem(label: string) {
  return screen.getByRole("menuitem", { name: new RegExp(`^${label}`) });
}

function queryMenuItem(label: string) {
  return screen.queryByRole("menuitem", { name: new RegExp(`^${label}`) });
}

afterEach(() => {
  cleanup();
});

describe("ModeMenu gating", () => {
  it("lists every mode for a thinking model", () => {
    renderInI18n(<ModeMenu mode="pro" supportsThinking onSelect={rs.fn()} />);
    openMenu(modeTriggerName(T.proMode));

    for (const label of [T.flashMode, T.reasoningMode, T.proMode, T.ultraMode]) {
      expect(menuItem(label)).toBeTruthy();
    }
  });

  it("lists only flash when the model cannot think", () => {
    renderInI18n(
      <ModeMenu mode="flash" supportsThinking={false} onSelect={rs.fn()} />,
    );
    openMenu(modeTriggerName(T.flashMode));

    expect(menuItem(T.flashMode)).toBeTruthy();
    for (const label of [T.reasoningMode, T.proMode, T.ultraMode]) {
      expect(queryMenuItem(label)).toBeNull();
    }
  });

  it("reports the resolved mode through the trigger", () => {
    // A stored "pro" on a model without thinking renders as the flash label, which
    // is what the runtime would actually run.
    renderInI18n(
      <ModeMenu mode="pro" supportsThinking={false} onSelect={rs.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: modeTriggerName(T.flashMode) }),
    ).toBeTruthy();
  });

  it("selects an offered mode", () => {
    const onSelect = rs.fn();
    renderInI18n(
      <ModeMenu mode="flash" supportsThinking={false} onSelect={onSelect} />,
    );
    openMenu(modeTriggerName(T.flashMode));

    fireEvent.click(menuItem(T.flashMode));
    expect(onSelect).toHaveBeenCalledWith("flash");
  });
});

describe("EffortMenu gating and levels", () => {
  it("lists exactly the model's declared subset", () => {
    renderInI18n(
      <EffortMenu
        mode="pro"
        supportsReasoningEffort
        effort="high"
        levels={["low", "high"]}
        onSelect={rs.fn()}
      />,
    );
    openMenu(`${T.reasoningEffort}: ${T.reasoningEffortHigh}`);

    expect(menuItem(T.reasoningEffortLow)).toBeTruthy();
    expect(menuItem(T.reasoningEffortHigh)).toBeTruthy();
    expect(queryMenuItem(T.reasoningEffortMinimal)).toBeNull();
    expect(queryMenuItem(T.reasoningEffortMedium)).toBeNull();
  });

  it("lists every level when the model declares no subset", () => {
    renderInI18n(
      <EffortMenu
        mode="pro"
        supportsReasoningEffort
        effort="medium"
        levels={[...ALL_LEVELS]}
        onSelect={rs.fn()}
      />,
    );
    openMenu(`${T.reasoningEffort}: ${T.reasoningEffortMedium}`);

    for (const label of [
      T.reasoningEffortMinimal,
      T.reasoningEffortLow,
      T.reasoningEffortMedium,
      T.reasoningEffortHigh,
    ]) {
      expect(menuItem(label)).toBeTruthy();
    }
  });

  it("picks a level through the menu", () => {
    const onSelect = rs.fn();
    renderInI18n(
      <EffortMenu
        mode="pro"
        supportsReasoningEffort
        effort="medium"
        levels={["low", "medium", "high"]}
        onSelect={onSelect}
      />,
    );
    openMenu(`${T.reasoningEffort}: ${T.reasoningEffortMedium}`);

    fireEvent.click(menuItem(T.reasoningEffortLow));
    expect(onSelect).toHaveBeenCalledWith("low");
  });

  it("renders nothing without effort support", () => {
    const { container } = renderInI18n(
      <EffortMenu
        mode="pro"
        supportsReasoningEffort={false}
        effort="medium"
        levels={[...ALL_LEVELS]}
        onSelect={rs.fn()}
      />,
    );
    expect(
      container.querySelector('[data-slot="dropdown-menu-trigger"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /推理深度/ })).toBeNull();
  });

  it("renders nothing in flash mode, where the run discards the level", () => {
    renderInI18n(
      <EffortMenu
        mode="flash"
        supportsReasoningEffort
        effort="medium"
        levels={[...ALL_LEVELS]}
        onSelect={rs.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /推理深度/ })).toBeNull();
  });
});
