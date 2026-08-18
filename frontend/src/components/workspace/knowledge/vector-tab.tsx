"use client";

/**
 * 向量空间面板（2026-08-15 spec §8 P5）：工具栏（collection chips / 2D·3D /
 * 算法 / 重新计算）+ echarts 散点画布。本组件持有全部数据与交互逻辑
 * （纯 React 可测）；canvas 适配层经 next/dynamic 懒加载隔离（jsdom 中
 * 整体 mock）。3D 切换与重新计算在 Task 7 接通，本任务渲染禁用态。
 *
 * 工具栏三档降级（2026-08-17 二迭代，窄栏防重叠错位）：
 * ① 档0——chips 色点+文字、右侧控件内联；
 * ② 档1——chips 仅色点（aria-label + tooltip 兜底，未激活色点降透明度）；
 * ③ 档2——2D/3D 与算法收进 ⋯ 菜单，重算图标常驻。
 * 升档不走固定像素断点——溢出检测（scrollWidth > clientWidth）自校准；
 * flex-nowrap 保证任何档位不换行、无两行跳高。右侧控件统一 28px
 * （h-7/size-7；SelectTrigger 需 h-7! 压过 data-[size] 高特异性高度）。
 * chips 选中态 = collection 同色浅底（hex alpha），outline 变体常驻边框，
 * 选中/取消切换不改变按钮宽度。
 */
import { MoreHorizontal, RefreshCw, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { useRecomputeVectorProjection, useVectorProjection } from "@/core/knowledge/hooks";
import type {
  VectorProjectionAlgo,
  VectorProjectionPoint,
} from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

import type { VectorCanvasProps } from "./vector-canvas";

// ssr:false —— echarts 依赖 DOM/WebGL，且不进首屏 chunk（性能预算体系只测
// SSR HTML 引用资源，异步 chunk 天然豁免）。
const VectorCanvas = dynamic<VectorCanvasProps>(() => import("./vector-canvas"), { ssr: false });

export type VectorCollectionKey = "chunks" | "entities" | "wiki" | "cards";
const ALL_COLLECTIONS: readonly VectorCollectionKey[] = ["chunks", "entities", "wiki", "cards"];

/** One legend series: points sharing one collection color (spec §8 2026-08-15 UX 迭代). */
export interface VectorSeriesGroup {
  key: string;
  sourceType: string;
  /** 图例显示名：四类固定文案（切片/实体/百科/卡片）。 */
  label: string;
  color: string;
  points: VectorProjectionPoint[];
}

/**
 * 四类固定色（2026-08-15 用户拍板 UX 迭代）：文档一多，按个体（doc_id/type）
 * 分组会让图例和画面太花——改为每类 collection 统一一色，图例恒四项。
 * 与工具栏 chips 色点同源。
 * 2026-08-17：用户拍板采用 Material Design 400 级色板（对齐参考实现）——
 * 介于 echarts 默认高饱和与降饱和柔和版之间。曾试过经典四色（太浓）、
 * 降饱和版（灰蒙蒙）、参考图采样浅色版，均弃。
 */
const SOURCE_COLORS: Record<string, string> = {
  chunk: "#42a5f5",
  entity: "#66bb6a",
  wiki: "#ab47bc",
  card: "#ff7043",
};

/** chips 色点直接复用四类固定色。 */
const CHIP_COLORS: Record<VectorCollectionKey, string> = {
  chunks: SOURCE_COLORS.chunk!,
  entities: SOURCE_COLORS.entity!,
  wiki: SOURCE_COLORS.wiki!,
  cards: SOURCE_COLORS.card!,
};

/** 着色分组（UX 迭代后）：按 source_type 聚为四组，各一色，图例固定文案。 */
export function groupPointsIntoSeries(
  points: readonly VectorProjectionPoint[],
  labels: { chunks: string; entities: string; wiki: string; cards: string },
): VectorSeriesGroup[] {
  const labelFor: Record<string, string> = {
    chunk: labels.chunks,
    entity: labels.entities,
    wiki: labels.wiki,
    card: labels.cards,
  };
  const groups = new Map<string, VectorSeriesGroup>();
  for (const point of points) {
    let group = groups.get(point.source_type);
    if (!group) {
      group = {
        key: point.source_type,
        sourceType: point.source_type,
        label: labelFor[point.source_type] ?? point.source_type,
        color: SOURCE_COLORS[point.source_type] ?? "#73c0de",
        points: [],
      };
      groups.set(point.source_type, group);
    }
    group.points.push(point);
  }
  return [...groups.values()];
}

/** 档级：0=全量（chips 色点+文字、控件内联） 1=chips 仅色点 2=控件收进 ⋯ 菜单。 */
type ToolbarTier = 0 | 1 | 2;

/**
 * 工具栏自适应降级：固定像素断点估不准真实渲染宽度（字体/缩放/文案都会变），
 * 改为直接检测溢出——scrollWidth > clientWidth 即升档；回落不猜节省量，升档时
 * 记录当前档位内容的 scrollWidth 作为恢复点，宽度回到该值即降档（+4px 防亚像素抖动）。
 * jsdom 无布局（scrollWidth 恒 0）→ 恒 0 档，单测只见宽档控件（窄档用例钉
 * scrollWidth 模拟溢出）。
 */
function useToolbarTier(ref: RefObject<HTMLDivElement | null>): ToolbarTier {
  const [tier, setTier] = useState<ToolbarTier>(0);
  const tierRef = useRef<ToolbarTier>(0);
  const restoreWidth = useRef<[number, number, number]>([0, 0, 0]);

  const evaluate = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.clientWidth;
    const overflow = element.scrollWidth > width + 1;
    const current = tierRef.current;
    if (overflow && current < 2) {
      // 记录当前档位内容的需求宽度——升档后回落到本档的精确触发点。
      restoreWidth.current[current + 1] = element.scrollWidth + 4;
      tierRef.current = (current + 1) as ToolbarTier;
      setTier(tierRef.current);
    } else if (!overflow && current > 0 && width >= restoreWidth.current[current]) {
      tierRef.current = (current - 1) as ToolbarTier;
      setTier(tierRef.current);
    }
  }, [ref]);

  // 每次渲染后校准（幂等：档级不变则不 setState，不自激）——覆盖内容变化
  // （采样徽标出现/消失）与档级切换后的级联再评估。
  useEffect(() => {
    evaluate();
  });
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(evaluate);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, evaluate]);

  return tier;
}

export function VectorTab({
  kbId,
  enabled,
  indexingCount = 0,
  onOpenChunk,
  onOpenWikiEntry,
  onOpenManualCard,
}: {
  kbId: string;
  /** keep-alive pane 的懒加载门：仅 tab 激活后才发起投影请求。 */
  enabled: boolean;
  /** 仍在索引管线中的文档数（>0 时提示投影可能不完整）。 */
  indexingCount?: number;
  /** chunk 点击：(doc_id, chunk_id) —— page 层回查完整 doc 再开抽屉。 */
  onOpenChunk: (docId: string, chunkId: string) => void;
  onOpenWikiEntry: (entryId: string) => void;
  onOpenManualCard: (cardId: string) => void;
}) {
  const { t } = useI18n();
  const tv = t.knowledge.vectorSpace;
  const [collections, setCollections] = useState<VectorCollectionKey[]>([...ALL_COLLECTIONS]);
  const [algo, setAlgo] = useState<VectorProjectionAlgo>("pca");
  const [dims, setDims] = useState<2 | 3>(2);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarTier = useToolbarTier(toolbarRef);
  // 聚焦交互（2026-08-15 用户拍板）：文档搜索框——输入关键词即锁定匹配文档的
  // 切片高亮，其余切片淡出；清空恢复。搜索锁定优先于 hover 聚焦（canvas 内合成）。
  const [docQuery, setDocQuery] = useState("");

  const projectionQuery = useVectorProjection(kbId, { collections, algo, dims }, enabled);
  const projection = projectionQuery.data;
  const recompute = useRecomputeVectorProjection(kbId);

  const series = useMemo(
    () =>
      groupPointsIntoSeries(projection?.points ?? [], {
        chunks: tv.chips.chunks,
        entities: tv.chips.entities,
        wiki: tv.chips.wiki,
        cards: tv.chips.cards,
      }),
    [projection, tv],
  );

  /** 搜索锁定：文档名大小写不敏感子串匹配 → 匹配文档的 doc_id 集合（空词=null）。 */
  const searchedDocIds = useMemo(() => {
    const needle = docQuery.trim().toLowerCase();
    if (!needle) return null;
    const ids = new Set<string>();
    for (const point of projection?.points ?? []) {
      if (point.source_type === "chunk" && point.label.toLowerCase().includes(needle)) {
        ids.add(point.color_key);
      }
    }
    return ids;
  }, [docQuery, projection]);

  const handleDimsChange = (value: string) => {
    if (value === "2" || value === "3") {
      setDims(Number(value) as 2 | 3);
    }
  };

  const handleAlgoChange = (value: string) => setAlgo(value as VectorProjectionAlgo);

  const toggleCollection = (key: VectorCollectionKey) => {
    setCollections((previous) => {
      const next = previous.includes(key) ? previous.filter((k) => k !== key) : [...previous, key];
      // 保持 ALL_COLLECTIONS 声明顺序，请求参数稳定（缓存键友好）。
      return ALL_COLLECTIONS.filter((k) => next.includes(k));
    });
  };

  /** 点击分发（spec §8：复用现有抽屉链路；entity 无详情目标，保持惰性）。 */
  const handlePointClick = (point: VectorProjectionPoint) => {
    if (point.source_type === "chunk") {
      onOpenChunk(point.color_key, point.id);
    } else if (point.source_type === "wiki") {
      onOpenWikiEntry(point.id);
    } else if (point.source_type === "card") {
      onOpenManualCard(point.id);
    }
  };

  const points = projection?.points ?? [];
  const showCanvas = !projectionQuery.isLoading && !projectionQuery.isError && points.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="vector-tab">
      {/* 文档搜索栏（wiki-tab 同款独立一栏，置于工具栏上方）：锁定聚焦匹配文档的切片 */}
      <div className="shrink-0 border-b px-4 py-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            aria-label={tv.searchDocs}
            className="h-7 pr-2 pl-7 text-xs"
            placeholder={tv.searchDocs}
            value={docQuery}
            onChange={(event) => setDocQuery(event.target.value)}
          />
        </div>
      </div>

      {/* 工具栏：collection chips + 维度/算法/重算（flex-nowrap + 溢出检测降级，任何档位不换行） */}
      <div
        ref={toolbarRef}
        className="flex flex-nowrap items-center gap-1.5 overflow-hidden border-b px-4 py-2"
        data-testid="vector-toolbar"
      >
        {ALL_COLLECTIONS.map((key) => {
          const active = collections.includes(key);
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                {/* 选中态 = collection 同色浅底 + 同色边框（hex alpha）；outline
                    常驻边框 → 选中/取消切换不改变宽度。 */}
                <Button
                  aria-label={tv.chips[key]}
                  aria-pressed={active}
                  className={cn("h-7 gap-1.5 px-2 text-xs", !active && "text-muted-foreground")}
                  size="sm"
                  style={
                    active
                      ? {
                          backgroundColor: `${CHIP_COLORS[key]}1f`,
                          borderColor: `${CHIP_COLORS[key]}80`,
                        }
                      : undefined
                  }
                  variant="outline"
                  onClick={() => toggleCollection(key)}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", !active && "opacity-40")}
                    style={{ backgroundColor: CHIP_COLORS[key] }}
                  />
                  {toolbarTier === 0 && <span>{tv.chips[key]}</span>}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tv.chips[key]}</TooltipContent>
            </Tooltip>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {projection?.sampled && (
            <Badge className="shrink-0 text-xs" variant="secondary">
              {tv.sampledBadge(projection.shown_points, projection.total_points)}
            </Badge>
          )}
          {/* 档0/1：控件内联（档2 收进 ⋯ 菜单） */}
          {toolbarTier < 2 && (
            <>
              <ToggleGroup
                size="sm"
                type="single"
                value={String(dims)}
                variant="outline"
                onValueChange={handleDimsChange}
              >
                <ToggleGroupItem aria-label="2D" className="h-7 px-2 text-xs" value="2">
                  2D
                </ToggleGroupItem>
                <ToggleGroupItem aria-label="3D" className="h-7 px-2 text-xs" value="3">
                  3D
                </ToggleGroupItem>
              </ToggleGroup>
              {/* 算法 label 省略（PCA/UMAP 值自解释）；Select 收窄 + h-7!
                  压过 data-[size] 高特异性高度，与全栏 28px 对齐；px-2/gap-1.5
                  紧凑内距，防下拉箭头遮挡 UMAP 文字。 */}
              <Select value={algo} onValueChange={handleAlgoChange}>
                <SelectTrigger aria-label={tv.algoLabel} className="h-7! w-20 gap-1.5 px-2 text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pca">PCA</SelectItem>
                  <SelectItem value="umap">UMAP</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          {/* 档2：⋯ 菜单（RadioItem 承载切换，无嵌套弹层，交互稳健） */}
          {toolbarTier === 2 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label={tv.moreOptions} className="size-7" size="icon" variant="outline">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{tv.dimsLabel}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(dims)} onValueChange={handleDimsChange}>
                  <DropdownMenuRadioItem value="2">2D</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="3">3D</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{tv.algoLabel}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={algo} onValueChange={handleAlgoChange}>
                  <DropdownMenuRadioItem value="pca">PCA</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="umap">UMAP</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* 重新计算：低频操作降级为图标按钮（aria-label/tooltip 兑底可发现性），
              pending 时图标自旋。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={tv.recompute}
                className="size-7"
                disabled={recompute.isPending}
                size="icon"
                variant="outline"
                onClick={() => recompute.mutate({ collections, algo, dims })}
              >
                <RefreshCw className={cn("size-3.5", recompute.isPending && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tv.recompute}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 索引中提示（投影可能不完整） */}
      {indexingCount > 0 && (
        <div className="border-b px-4 py-1.5 text-xs text-amber-600 dark:text-amber-500">
          {tv.indexingHint(indexingCount)}
        </div>
      )}

      {/* 主体：三态 + 画布 */}
      <div className="min-h-0 flex-1">
        {projectionQuery.isLoading && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {tv.loading}
          </div>
        )}
        {projectionQuery.isError && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm">
            <span className="text-destructive">{tv.loadFailed}</span>
            {projectionQuery.error instanceof Error && projectionQuery.error.message && (
              <span className="text-muted-foreground max-w-md text-center text-xs">
                {projectionQuery.error.message}
              </span>
            )}
          </div>
        )}
        {!projectionQuery.isLoading && !projectionQuery.isError && points.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {tv.empty}
          </div>
        )}
        {showCanvas && (
          <VectorCanvas dims={dims} searchedDocIds={searchedDocIds} series={series} onPointClick={handlePointClick} />
        )}
      </div>
    </div>
  );
}
