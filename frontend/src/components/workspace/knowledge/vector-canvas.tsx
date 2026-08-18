"use client";

/**
 * echarts 适配层（2026-08-15 spec §8）：jsdom 不可运行，DOM 测试中整体 mock。
 * 经 next/dynamic(ssr:false) 由 vector-tab 懒加载——不进首屏 chunk。
 * 2D/3D 同走 echarts-gl scatter3D 管线（2026-08-17 用户拍板）：2D = 数据铺在
 * X-Z 立面 [x,0,y] + 正交正视锁定，缩放/平移/resize 行为与 3D 完全一致；
 * 旧 2D dataZoom 方案（视窗保持/归位 bug/遮挡区）整体退役。
 * 聚焦交互（2026-08-15 用户拍板）：hover 散点 → 同文档切片/同大类瞬态聚焦；
 * 搜索框（searchedDocIds prop）→ 文档锁定聚焦（优先于 hover）。淡化走自定义
 * setOption（内置 emphasis.focus='series' 粒度不够：区分不了同 series 内不同文档）。
 */
import { LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Scatter3DChart } from "echarts-gl/charts";
import { Grid3DComponent } from "echarts-gl/components";
import { useEffect, useMemo, useRef, useState } from "react";

import type { VectorProjectionPoint } from "@/core/knowledge/types";

import type { VectorSeriesGroup } from "./vector-tab";

echarts.use([
  Scatter3DChart,
  Grid3DComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

/** source_type → 散点形状（双编码：形状分大类，颜色分组）。 */
const SOURCE_SYMBOLS: Record<string, string> = {
  chunk: "circle",
  entity: "triangle",
  wiki: "rect",
  card: "diamond",
};

/**
 * 视觉层级（2026-08-17 用户拍板）：
 * - 尺寸按类别固定梯度：量越小点越大，卡片个位数点不被大类淹没。
 * - 透明度 4 档固定值，按类别点数排名选档：点最多的最透、最少的最实；
 *   类别缺席时档位从实端截取，小数据集不至于全员透明。
 */
const RANK_OPACITIES: readonly number[] = [0.45, 0.5, 0.6, 0.7]; // 点数排名 1→4
const SOURCE_SIZE: Record<string, number> = { chunk: 8, entity: 9, wiki: 10, card: 14 };

/** 光晕衬底比主点大出的像素量（等效参考实现的白色描边）。 */
const HALO_SIZE_BOOST = 1.2;

/** 同色系边界分桶数：同桶点对（1/K）仍看不到白圈，K=6 时密集区视觉边界已完整。 */
const HALO_BUCKETS = 6;

export interface VectorCanvasProps {
  series: VectorSeriesGroup[];
  dims: 2 | 3;
  onPointClick?: (point: VectorProjectionPoint) => void;
  /** 搜索锁定：匹配文档的 doc_id 集合；null/undefined = 无锁定（回落 hover 聚焦）。 */
  searchedDocIds?: ReadonlySet<string> | null;
}

interface ScatterDatum {
  value: [number, number] | [number, number, number];
  point: VectorProjectionPoint;
  /** 聚焦淡化时的项级覆写（低透明度保轮廓，不隐藏）。 */
  itemStyle?: { opacity: number };
}

/**
 * 聚焦语义（2026-08-15 用户拍板）：
 * - document：hover 某切片 → 该文档切片保持，其余文档切片淡出；实体/wiki/
 *   卡片是跨文档参照系，不淡出；
 * - collection：hover 实体/wiki/卡片 → 该大类保持，其余所有（含切片）淡出；
 * - docSearch：搜索框锁定 → 匹配文档切片保持，其余切片淡出。
 */
export type VectorFocus =
  | { kind: "document"; docId: string }
  | { kind: "collection"; sourceType: string }
  | { kind: "docSearch"; docIds: ReadonlySet<string> }
  | null;

/** 淡化透明度：淡出保空间参照，不隐藏（用户审美基线：不能深到压过聚焦项）。 */
export const DIMMED_OPACITY = 0.12;

/** 聚焦淡化判定（纯函数，jsdom 可测）。 */
export function isPointDimmed(point: VectorProjectionPoint, focus: VectorFocus): boolean {
  if (!focus) return false;
  switch (focus.kind) {
    case "document":
      return point.source_type === "chunk" && point.color_key !== focus.docId;
    case "docSearch":
      return point.source_type === "chunk" && !focus.docIds.has(point.color_key);
    case "collection":
      return point.source_type !== focus.sourceType;
  }
}

/** hover 聚焦的相等比对：同文档/同大类连续 mouseover 不触发重复 setOption。 */
function focusEqual(a: VectorFocus, b: VectorFocus): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "document" && b.kind === "document") return a.docId === b.docId;
  if (a.kind === "collection" && b.kind === "collection") return a.sourceType === b.sourceType;
  return false;
}

/**
 * hover 聚焦心跳控制器（2026-08-15 诊断修复）：echarts-gl 3D 在「散点 → 空白」
 * 时**不派发 mouseout**，hover 聚焦会永久卡住。修复思路：
 * - zr mousemove（全画布恒派发，与 hit 无关）→ arm() 武装定时器；
 * - chart mousemove hit（命中时每次都派发）→ feedHit() 复位定时器；
 * - 移到空白：arm 持续但无 hit → 定时器到期清除聚焦；
 * - 在点上慢移/停住：hit 持续喂或无任何事件 → 均不误清。
 */
export const HOVER_HEARTBEAT_MS = 90;

export interface HoverFocusHeartbeat {
  /** 画布内任意鼠标移动：启动/重置清除定时器。 */
  arm: () => void;
  /** 命中散点：取消清除定时器。 */
  feedHit: () => void;
  /** 组件卸载：静默挂起定时器。 */
  dispose: () => void;
}

export function createHoverFocusHeartbeat(
  onClear: () => void,
  delayMs: number = HOVER_HEARTBEAT_MS,
): HoverFocusHeartbeat {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    arm() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        onClear();
      }, delayMs);
    },
    feedHit() {
      cancel();
    },
    dispose() {
      cancel();
    },
  };
}

/**
 * hover tooltip 截断（2026-08-17 二迭代，用户反馈太长+挡点）：label/preview
 * 各 20 字，扫读级摘要；tooltip 本体半透明毛玻璃（见下方 tooltip 配置）。
 */
export const TOOLTIP_LABEL_MAX = 20;
export const TOOLTIP_PREVIEW_MAX = 20;

/** 截断到 max 字，超出补省略号。 */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** tooltip HTML（纯函数，jsdom 可测）：label 一行 + preview 弱化一行。 */
export function buildTooltipHtml(label: string, preview: string | undefined): string {
  const title = escapeHtml(truncate(label, TOOLTIP_LABEL_MAX));
  if (!preview) return title;
  return `${title}<br/><span style="opacity:.7">${escapeHtml(truncate(preview, TOOLTIP_PREVIEW_MAX))}</span>`;
}

/** 当前是否暗色主题（next-themes 在 <html> 上挂 .dark class）。 */
function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** 墨色：浅色主题用深灰，暗色主题翻成亮灰（轴线/图例文字等装饰元素）。 */
function ink(alpha: number, dark: boolean): string {
  return dark ? `rgba(235,238,245,${alpha})` : `rgba(60,60,60,${alpha})`;
}

/** 3D 三轴共享的弱化样式（UX：默认网格/辅助线太深，会压过散点；主题感知）。 */
function axisMuted(dark: boolean) {
  return {
    type: "value" as const,
    scale: true,
    nameTextStyle: { color: ink(0.55, dark) },
    axisLabel: { textStyle: { color: ink(0.4, dark) } },
    axisLine: { lineStyle: { color: ink(0.3, dark) } },
    axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: ink(dark ? 0.1 : 0.06, dark) } },
    splitArea: { show: false },
    // hover 时的投影辅助线（鼠标进入画布的那组十字/虚线）
    axisPointer: { lineStyle: { color: ink(0.22, dark) }, label: { show: false } },
  };
}

/**
 * 解析画布底色为 GL 可用的 rgb 字符串——衬底颜色来源（衬底的职责是“与底色
 * 一致”：浅色主题近白、深色主题近黑，都在底上隐形，只在盖住散点处显形）。
 * --background 是 lab() 记法，GL 只认 rgb/hex，借 canvas 2D 转译；jsdom 回退白色。
 */
function resolveCanvasBgColor(): string {
  if (typeof document === "undefined") return "#ffffff";
  const bg = getComputedStyle(document.body).backgroundColor;
  if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") return "#ffffff";
  if (/^#|^rgb/.test(bg)) return bg; // 已是 GL 可解析的格式
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#ffffff";
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}

export default function VectorCanvas({ series, dims, onPointClick, searchedDocIds }: VectorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  // onPointClick 经 ref 穿透，避免回调 identity 变化触发 setOption。
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;
  // hover 瞬态聚焦（散点 mouseover 驱动；搜索锁定时被覆盖）。
  const [hoverFocus, setHoverFocus] = useState<VectorFocus>(null);
  // 主题切换信号（<html> .dark 变化）→ 主 effect 全量重建（装饰层主题感知）。
  const [themeTick, setThemeTick] = useState(0);
  // 搜索锁定优先于 hover 聚焦（有搜索词时 hover 不再改动画面，避免打架）。
  const effectiveFocus = useMemo<VectorFocus>(
    () => (searchedDocIds ? { kind: "docSearch", docIds: searchedDocIds } : hoverFocus),
    [searchedDocIds, hoverFocus],
  );
  // 主 effect（series/dims 驱动全量重建）读取当前聚焦值的穿透 ref。
  const focusRef = useRef<VectorFocus>(null);
  focusRef.current = effectiveFocus;

  // series 重设（聚焦淡化 / 图例显隐共用一条路径）。图例点击只隐藏同名主系列，
  // 衬底（__halo 后缀）不在图例管辖内不会跟着隐——读图例选中态同步关掉
  // （用户实测：隐藏类别后白衬底残留）。悬停重建也走这里，隐藏状态不会丢。
  const refreshRef = useRef<() => void>(() => undefined);
  refreshRef.current = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const legend = (chart.getOption() as { legend?: unknown } | undefined)?.legend;
    const selected =
      ((Array.isArray(legend) ? legend[0] : legend) as
        | { selected?: Record<string, boolean> }
        | undefined)?.selected ?? {};
    const hidden = new Set(
      Object.entries(selected)
        .filter(([, on]) => on === false)
        .map(([name]) => name),
    );
    chart.setOption(
      { series: buildSeriesOptions(series, dims, focusRef.current, hidden, resolveCanvasBgColor()) },
      { notMerge: false },
    );
  };

  // dims 入依赖：切换 2D/3D 时销毁并重建 chart（dispose 连带移除 GL 层），
  // 避免复用实例换配置时的残留/状态串扰。代价：切换时相机位重置，可接受。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container);
    chartRef.current = chart;
    chart.on("click", (params) => {
      const datum = (params as { data?: ScatterDatum }).data;
      if (datum?.point) {
        clickRef.current?.(datum.point);
      }
    });
    // 图例显隐 → 衬底同步（选中态存在图例组件上，重设 series 不动它）。
    chart.on("legendselectchanged", () => refreshRef.current());
    // hover 聚焦驱动（诊断修复 2026-08-15）：用 chart mousemove 取代 mouseover——
    // hit 时每次都派发（2D/3D 一致），无需依赖变化检测；3D 的 mouseout 不派发，
    // 清除交给心跳（zr mousemove 武装、hit 复位、超时清除），mouseout/globalout
    // 保留为 2D 的即时清除与移出画布的兑底。
    const heartbeat = createHoverFocusHeartbeat(() => {
      setHoverFocus((previous) => (previous === null ? previous : null));
    });
    chart.getZr().on("mousemove", heartbeat.arm);
    chart.on("mousemove", (params) => {
      const datum = (params as { data?: ScatterDatum }).data;
      const point = datum?.point;
      if (!point) return; // 空白（2D 会派发无 data 事件；3D 不派发）：交给心跳
      heartbeat.feedHit();
      const next: VectorFocus =
        point.source_type === "chunk"
          ? { kind: "document", docId: point.color_key }
          : { kind: "collection", sourceType: point.source_type };
      setHoverFocus((previous) => (focusEqual(previous, next) ? previous : next));
    });
    const clearHover = () => setHoverFocus((previous) => (previous === null ? previous : null));
    chart.on("mouseout", clearHover);
    chart.on("globalout", clearHover);
    // resize：GL 投影随容器等比重投影，直接 resize 即可——无 dataZoom 视窗要维护。
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    // 主题切换（next-themes 在 <html> 上切 .dark）→ 全量重建。
    const themeObserver = new MutationObserver(() => setThemeTick((t) => t + 1));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      heartbeat.dispose();
      observer.disconnect();
      themeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [dims]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const dark = isDarkTheme();
    // 图例带各类点数（识别度：直接看出量级，不用猜）。
    const legendCounts = new Map(series.map((group) => [group.label, group.points.length]));
    // tooltip 颜色按点的类别取主色——悬停可能命中白色衬底系列，
    // params.marker 会是白点（用户实测）。
    const colorBySource = new Map(series.map((group) => [group.sourceType, group.color]));
    const common = {
      animation: false,
      textStyle: { fontSize: 11 },
      legend: {
        type: "scroll" as const,
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        // 只列主系列——光晕衬底系列（__halo 后缀）是视觉辅助，不进图例。
        data: series.map((group) => group.label),
        formatter: (name: string) => {
          const count = legendCounts.get(name);
          return count == null ? name : `${name} ${count}`;
        },
        // 2026-08-17（用户拍板）：图例栏压扁（padding 归零 + 项距收紧）；
        // 半透明白底胶囊作底托——3D 场景轴标签会探到栏位区域，直接压在
        // 画布上显得虚浮。canvas 绘制不支持 CSS 变量，用 rgba 近似主题色。
        padding: [2, 8],
        itemGap: 8,
        backgroundColor: dark ? "rgba(24,24,30,0.55)" : "rgba(255,255,255,0.65)",
        borderRadius: 6,
        textStyle: { fontSize: 11, color: ink(0.75, dark) },
      },
      tooltip: {
        trigger: "item" as const,
        confine: true,
        // 2026-08-17 UX（用户拍板）：半透明毛玻璃——55% 主题 popover 色 +
        // backdrop-filter，盖住节点时仍能透过看到被遮散点；max-width 收窄
        // 减少覆盖面积；标题前置系列色 marker，一眼对应类别。
        // backgroundColor 是不支持 color-mix 的旧环境兜底。
        backgroundColor: dark ? "rgba(24,24,30,0.6)" : "rgba(255,255,255,0.55)",
        borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
        padding: [6, 8],
        textStyle: { fontSize: 11 },
        extraCssText:
          "max-width:180px;white-space:normal;line-height:1.5;border-radius:8px;" +
          "backdrop-filter:blur(10px);box-shadow:0 2px 10px rgba(0,0,0,0.08);" +
          "background:color-mix(in srgb, var(--popover, #fff) 55%, transparent);" +
          "color:var(--popover-foreground, #333);",
        formatter: (params: unknown) => {
          const datum = (params as { data?: ScatterDatum }).data;
          if (!datum?.point) return "";
          const color = colorBySource.get(datum.point.source_type) ?? "#999";
          const marker =
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
            `background:${color};margin-right:4px"></span>`;
          return `${marker}${buildTooltipHtml(datum.point.label, datum.point.preview)}`;
        },
      },
      series: buildSeriesOptions(series, dims, focusRef.current, undefined, resolveCanvasBgColor()),
    };
    // 3D 分支：grid3D + 三轴（viewControl 轨道相机：左键旋转、滚轮缩放；
    // distance/边距按视觉调准，三轴浅色系避免压过散点）；
    // 2D 分支（2026-08-17 用户拍板：2D 按 3D 逻辑来）：同管线俯视特例——
    // 数据铺在地面 [x,0,y]，正交投影 + 俯视锁定（旋转关闭），左键拖拽平移、
    // 滚轮缩放；resize 时投影随容器等比重投影，无 dataZoom 视窗要维护。
    const option =
      dims === 3
        ? {
            ...common,
            xAxis3D: axisMuted(dark),
            yAxis3D: axisMuted(dark),
            zAxis3D: axisMuted(dark),
            grid3D: {
              // 布局迭代（2026-08-17，用户手动调准 + 拍板）：
              // - distance 250：取景远近（用户手动调准）；
              // - top 必须 ≥ 0：负值会让 echarts-gl 的 GL 视口裁剪越界，
              //   底部出现未渲染白带并截断轴标签（用户实测踩坑）；
              // - 垂直居中用正的 bottom 边距抬立方体，不用负 top。
              top: "0%",
              bottom: "24%",
              left: "4%",
              right: "4%",
              viewControl: {
                distance: 250,
                rotateSensitivity: 2.5,
                zoomSensitivity: 1.5,
                panSensitivity: 1.5,
              },
            },
          }
        : {
            ...common,
            xAxis3D: axisMuted(dark),
            // 2D 数据全在 X-Z 立面（y 恒 0）：进深轴结构完整但全透明——
            // 任何 show:false（轴级/子级）都会让 echarts-gl 轴构建逐帧读 null
            // 崩溃（实测），只能透明化处理；隐藏后轴线不再与 X 轴重合。
            yAxis3D: {
              ...axisMuted(dark),
              min: -1,
              max: 1,
              name: "",
              axisLine: { lineStyle: { color: "rgba(0,0,0,0)" } },
              axisLabel: { textStyle: { color: "rgba(0,0,0,0)" } },
              splitLine: { show: true, lineStyle: { color: "rgba(0,0,0,0)" } },
              axisPointer: { lineStyle: { color: "rgba(0,0,0,0)" }, label: { show: false } },
            },
            // 竖直轴在 2D 语义上是 Y（echarts-gl 里 Z 朝上，轴名显示为“Z”）。
            zAxis3D: { ...axisMuted(dark), name: "Y" },
            grid3D: {
              top: "0%",
              bottom: "24%",
              left: "4%",
              right: "4%",
              // 纯平面 2D（用户拍板）：进深压为 0——前后壁重合，透视正视下
              // 不再看到侧壁/地板边，视觉上是纯二维平面。
              boxDepth: 0,
              viewControl: {
                // 透视投影 + 正视锁定。勿用正交：正交的缩放走 orthographicSize，
                // 而 echarts-gl 的相机写回（grid3DChangeCamera→setView）不含它——
                // 任何 setOption（如悬停淡化）都会让缩放闪回（用户实测）。
                // echarts-gl 里 Z 轴朝上：alpha=0 正视时 X 横 Z 纵，
                // 数据铺 X-Z 立面即为干净 2D（alpha≈90 俯视会退化，勿用）。
                alpha: 0,
                beta: 0,
                distance: 180, // 初始更近 → 图更大（用户反馈 250 初始图偏小，2026-08-17）
                rotateSensitivity: 0,
                rotateMouseButton: "middle",
                panMouseButton: "left",
                zoomSensitivity: 1.5,
                panSensitivity: 0.8, // 用户反馈 1.5 拖动太灵（2026-08-17）
              },
            },
          };
    chart.setOption(option, { notMerge: true });
  }, [series, dims, themeTick]);

  // 聚焦 effect：merge 模式轻量重设 series（淡化是数据项级样式，不碰轴/取景）。
  useEffect(() => {
    refreshRef.current();
  }, [series, dims, effectiveFocus]);

  return <div className="h-full w-full" data-testid="vector-canvas" ref={containerRef} />;
}

/**
 * series 构建（主 effect 全量 / 聚焦 effect merge 共用）：淡化覆写在数据项级。
 * emphasis.focus 取 'none'——内置 blur 只按 series 整组淡化，区分不了同 series
 * 内的不同文档，与本组件的自定义淡化叠加会双重变淡，故禁用。
 *
 * 白边用“光晕衬底”而非 GL 描边（2026-08-17 源码实锤后的用户拍板）：
 * echarts-gl 的散点描边是 sdfSprite shader 的 series 级 uniform，且混合算法
 * 预乘不对称（mix(fill.rgb×fill.a, stroke.rgb, a)）——低透明度系列的描边带
 * 会混入被压暗的填充色，渲染成深色网格线（用户实测“黑线”）。改为每个系列
 * 画两层：底层白色、大一圈、同形状（顶点色 alpha 逐点正常生效，淡化时跟随），
 * 上层彩色填充——露出的白圈即描边，混合行为与 matplotlib 一致。
 */
function buildSeriesOptions(
  series: VectorSeriesGroup[],
  dims: 2 | 3,
  focus: VectorFocus,
  hiddenLabels?: ReadonlySet<string>,
  haloColor = "#ffffff",
) {
  // 透明度按数量排名分档：点最多的类别拿最透的档
  const ranked = series
    .filter((group) => group.points.length > 0)
    .sort((a, b) => b.points.length - a.points.length);
  const slots = RANK_OPACITIES.slice(Math.max(0, RANK_OPACITIES.length - ranked.length));
  const opacityByGroup = new Map(ranked.map((group, rank) => [group, slots[rank] ?? 0.7]));
  // 层序也用同一排名（2026-08-17 用户拍板，对齐 matplotlib 参考语义）：点多的
  // 先画垫底、点少的后画置顶——与透明度/尺寸两杠杆同向（多的当密度底图，少的
  // 当地标）。图例显示顺序由 legend.data 显式固定，不受影响；空类别排最后
  // （画不出东西，仅保持图例项完整）。3D 下遮挡由深度测试决定，层序只影响
  // 同深度混合，不丢空间感。
  const ordered = [...ranked, ...series.filter((group) => group.points.length === 0)];
  return ordered.flatMap((group) => {
    const opacity = opacityByGroup.get(group) ?? 0.7;
    const hidden = hiddenLabels?.has(group.label) ?? false;
    const symbol = SOURCE_SYMBOLS[group.sourceType] ?? "circle";
    const makeData = (pts: VectorProjectionPoint[]) =>
      pts.map((point): ScatterDatum => ({
        // 2D = 3D 的正视特例：二维坐标铺到 X-Z 立面 [x, 0, y]（Z 轴朝上）。
        value: dims === 3 ? [point.x, point.y, point.z ?? 0] : [point.x, 0, point.y],
        point,
        ...(isPointDimmed(point, focus) ? { itemStyle: { opacity: DIMMED_OPACITY } } : {}),
      }));
    // 同色系边界分桶（2026-08-17 用户实测：异色重叠有白圈分界、同色没有）——
    // 根因：整组“先全部衬底、再全部填充”，同组填充把邻居衬底整个盖住。
    // matplotlib 逐点原子绘制（后点白边压前点填充），等效做法 = 切成若干桶、
    // 每桶 衬底+主点 紧挨成对：跨桶同色点的白圈互相可见（后桶衬底压前桶填充），
    // 同桶点对（占 1/K）仍不可见，但密集区每个点都有跨桶邻居，视觉边界完整。
    // 轮询分配保证确定性（setOption 按位 merge 要求结构稳定）；同名主点桶共用
    // 图例名，图例显隐对全部桶生效。
    const buckets: VectorProjectionPoint[][] = Array.from({ length: HALO_BUCKETS }, () => []);
    group.points.forEach((point, idx) => buckets[idx % HALO_BUCKETS]?.push(point));
    return buckets.flatMap((pts) => [
      {
        type: "scatter3D",
        name: `${group.label}__halo`, // 后缀名不进图例（legend.data 显式只列主系列）
        symbol,
        symbolSize: (SOURCE_SIZE[group.sourceType] ?? 8) + HALO_SIZE_BOOST,
        // 衬底颜色 = 画布底色（浅色主题近白、深色主题近黑，底上隐形），
        // 与填充同 alpha（对齐 matplotlib：alpha 同时作用于填充和描边）——
        // 只在盖住其他点的地方显出分隔圈。图例隐藏时同步关闭（不吃悬停/点击）。
        itemStyle: { color: haloColor, opacity: hidden ? 0 : opacity },
        silent: hidden,
        emphasis: { focus: "none" as const },
        data: makeData(pts),
      },
      {
        type: "scatter3D",
        name: group.label,
        symbol,
        symbolSize: SOURCE_SIZE[group.sourceType] ?? 8,
        itemStyle: { color: group.color, opacity },
        emphasis: { focus: "none" as const, itemStyle: { opacity: 1 } },
        data: makeData(pts),
      },
    ]);
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
