/**
 * 运行进度容器（spec 2026-09-06 §9 Task 11）：
 * - 第一行 = 单轨时长加权整体条（段边界刻线 + 当前段跨度提亮 + 连续填充）+ 右侧仅 ETA；
 * - 第二行 = 单行实时日志（结构化 tail → i18n 句，aria-live=polite）+ failed 徽标；
 * - ETA warmup 不足时显示「估算中…」而不是假数字；快速档只有一段（无刻线）。
 */
import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen, within } from "@testing-library/react";

import { EvalRunBanner } from "@/components/workspace/knowledge/eval-run-banner";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { overallFraction } from "@/core/knowledge/eval-run-status";
import type { EvalRunProgress } from "@/core/knowledge/types";

const iso = (msOffset: number) => new Date(Date.now() + msOffset).toISOString();

function progress(overrides: Partial<EvalRunProgress> = {}): EvalRunProgress {
  return {
    run_id: "run-1",
    phase: "questions",
    done: 3,
    total: 10,
    failed: 0,
    started_at: iso(-5_000),
    updated_at: iso(0),
    phase_started_at: iso(-5_000),
    phase_durations: {},
    tail: { kind: "item", phase: "questions", done: 3, total: 10, failed: 0 },
    ...overrides,
  };
}

function renderBanner(props: { progress: EvalRunProgress | null; tier?: "l1" | "l1_l2" }) {
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <EvalRunBanner progress={props.progress} tier={props.tier ?? "l1_l2"} />
    </I18nContext.Provider>,
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

afterEach(cleanup);

describe("EvalRunBanner 加权条", () => {
  it("fills to the weighted overall fraction and exposes progressbar semantics", () => {
    const snapshot = progress({ phase: "questions", done: 3, total: 10 });
    renderBanner({ progress: snapshot });

    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe(String(Math.round(overallFraction(snapshot, "l1_l2") * 100)));
    expect(bar.getAttribute("aria-label")).toContain("答题评测");

    expect(screen.getByTestId("eval-banner-fill").style.width).toBe(percent(overallFraction(snapshot, "l1_l2")));
  });

  it("draws one tick per phase boundary and highlights the current span", () => {
    renderBanner({ progress: progress({ phase: "questions" }) });

    // 冷启动先验 10/35/55 → 刻线在 10% 与 45%，当前段（答题）跨度 10%→45%。
    const ticks = screen.getAllByTestId("eval-banner-tick");
    expect(ticks.map((tick) => tick.style.left)).toEqual(["10%", "45%"]);

    const span = screen.getByTestId("eval-banner-span");
    expect(span.style.left).toBe("10%");
    expect(span.style.width).toBe("35%");
  });

  it("collapses the quick tier to a single span without ticks", () => {
    renderBanner({ progress: progress({ phase: "layer1", done: 0, total: 1 }), tier: "l1" });

    expect(screen.queryAllByTestId("eval-banner-tick")).toHaveLength(0);
    expect(screen.getByTestId("eval-banner-span").style.width).toBe("100%");
    expect(screen.getByTestId("eval-banner-fill").style.width).toBe("0%");
  });

  it("renders an empty bar during the optimistic window (no progress yet)", () => {
    renderBanner({ progress: null });

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByTestId("eval-banner-fill").style.width).toBe("0%");
  });
});

describe("EvalRunBanner ETA", () => {
  it("withholds the estimate during warmup", () => {
    // elapsed 5s < 20s 门控 → 不给数字。
    renderBanner({ progress: progress({ started_at: iso(-5_000) }) });

    expect(screen.getByTestId("eval-banner-eta").textContent).toBe("估算中…");
  });

  it("extrapolates the remaining minutes once warmed up", () => {
    // layer1 实测 20s（先验占比 0.1 → scale 200s）：质量段期望 110s、答题段 70s，
    // 几何回到先验 10/35/55；f = 0.1 + 0.35×0.5 = 0.275，elapsed 60s → 158s ≈ 3 分钟。
    renderBanner({
      progress: progress({
        phase: "questions",
        done: 5,
        total: 10,
        started_at: iso(-60_000),
        phase_started_at: iso(-40_000),
        phase_durations: { layer1: 20 },
      }),
    });

    expect(screen.getByTestId("eval-banner-eta").textContent).toBe("预计剩余 ~3 分钟");
  });
});

describe("EvalRunBanner 单行日志", () => {
  it("renders the tail event through i18n on a polite live region", () => {
    renderBanner({ progress: progress({ tail: { kind: "item", phase: "questions", done: 3, total: 10, failed: 0 } }) });

    const log = screen.getByTestId("eval-banner-log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.textContent).toContain("答题评测 3/10");
  });

  it("announces phase transitions and failure events", () => {
    const { rerender } = render(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <EvalRunBanner progress={progress({ tail: { kind: "phase", phase: "ragas", done: 0, total: 20, failed: 0 } })} tier="l1_l2" />
      </I18nContext.Provider>,
    );
    expect(screen.getByTestId("eval-banner-log").textContent).toContain("进入质量评估");

    rerender(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <EvalRunBanner progress={progress({ failed: 2, tail: { kind: "fail", phase: "questions", done: 4, total: 10, failed: 2 } })} tier="l1_l2" />
      </I18nContext.Provider>,
    );
    const log = screen.getByTestId("eval-banner-log");
    expect(log.textContent).toContain("答题评测 4/10");
    expect(log.textContent).toContain("失败 2");
  });

  it("falls back to a waiting line when the registry has no tail yet", () => {
    renderBanner({ progress: progress({ tail: null }) });

    expect(screen.getByTestId("eval-banner-log").textContent).toContain("等待首个进度事件");
  });

  it("keeps the failed badge out of the way when nothing failed", () => {
    renderBanner({ progress: progress({ failed: 0, tail: { kind: "item", phase: "questions", done: 3, total: 10, failed: 0 } }) });

    expect(within(screen.getByTestId("eval-banner-log")).queryByTestId("eval-banner-failed")).toBeNull();
  });
});
