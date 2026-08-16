"use client";

/**
 * 向量空间面板（2026-08-15 spec §8 P5）：工具栏（collection chips / 2D·3D /
 * 算法 / 重新计算）+ echarts 散点画布。本组件持有全部数据与交互逻辑
 * （纯 React 可测）；canvas 适配层经 next/dynamic 懒加载隔离（jsdom 中
 * 整体 mock）。3D 切换与重新计算在 Task 7 接通，本任务渲染禁用态。
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import { useVectorProjection } from "@/core/knowledge/hooks";
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

/** One legend series: points sharing the same color key (spec §8 着色规则). */
export interface VectorSeriesGroup {
  key: string;
  sourceType: string;
  /** 图例显示名：chunk 组=文档名、entity 组=类型、wiki/card=固定文案。 */
  label: string;
  color: string;
  points: VectorProjectionPoint[];
}

/** 调色板（echarts 默认色系）——chunk/entity 组按 color_key 稳定哈希取色。 */
const PALETTE = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
  "#3ba272", "#9a60b4", "#ea7ccc", "#48a9a6", "#d4b106",
];

/** wiki / card 固定色（spec §8：各一色），与工具栏 chips 色点一致。 */
const SOURCE_FIXED_COLORS: Record<string, string> = {
  wiki: "#9a60b4",
  card: "#fc8452",
};

/** chips 色点：collection 大类标识（chunks/entities 是组色族的代表色）。 */
const CHIP_COLORS: Record<VectorCollectionKey, string> = {
  chunks: "#5470c6",
  entities: "#91cc75",
  wiki: "#9a60b4",
  cards: "#fc8452",
};

/** 稳定字符串哈希（FNV-1a 32bit）——同一 color_key 跨渲染恒同色。 */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function colorForGroup(point: VectorProjectionPoint): string {
  return SOURCE_FIXED_COLORS[point.source_type] ?? PALETTE[hashKey(point.color_key) % PALETTE.length]!;
}

/** 着色分组：chunk→color_key(doc_id)、entity→color_key(type)、wiki/card→单色单组。 */
export function groupPointsIntoSeries(
  points: readonly VectorProjectionPoint[],
  labels: { wiki: string; cards: string },
): VectorSeriesGroup[] {
  const groups = new Map<string, VectorSeriesGroup>();
  for (const point of points) {
    let group = groups.get(point.color_key);
    if (!group) {
      const label =
        point.source_type === "chunk"
          ? point.label // doc_name
          : point.source_type === "wiki"
            ? labels.wiki
            : point.source_type === "card"
              ? labels.cards
              : point.color_key; // entity type
      group = {
        key: point.color_key,
        sourceType: point.source_type,
        label,
        color: colorForGroup(point),
        points: [],
      };
      groups.set(point.color_key, group);
    }
    group.points.push(point);
  }
  return [...groups.values()];
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
  // Task 7：2D/3D 切换接通（dims 参数化 + scatter3D），本任务固定 2D。
  const dims = 2 as const;

  const projectionQuery = useVectorProjection(kbId, { collections, algo, dims }, enabled);
  const projection = projectionQuery.data;

  const series = useMemo(
    () => groupPointsIntoSeries(projection?.points ?? [], { wiki: tv.chips.wiki, cards: tv.chips.cards }),
    [projection, tv],
  );

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
      {/* 工具栏：collection chips + 维度/算法/重算 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        {ALL_COLLECTIONS.map((key) => {
          const active = collections.includes(key);
          return (
            <Button
              aria-pressed={active}
              className={cn("h-7 gap-1.5 px-2 text-xs", !active && "text-muted-foreground")}
              key={key}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => toggleCollection(key)}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: CHIP_COLORS[key] }}
              />
              {tv.chips[key]}
            </Button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup size="sm" type="single" value="2d" variant="outline">
            <ToggleGroupItem aria-label="2D" className="h-7 px-2 text-xs" value="2d">
              2D
            </ToggleGroupItem>
            <ToggleGroupItem aria-label="3D" className="h-7 px-2 text-xs" disabled value="3d">
              3D
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-muted-foreground text-xs">{tv.algoLabel}</span>
          <Select value={algo} onValueChange={(value) => setAlgo(value as VectorProjectionAlgo)}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pca">PCA</SelectItem>
              <SelectItem value="umap">UMAP</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled className="h-7 text-xs" size="sm" variant="outline">
            {tv.recompute}
          </Button>
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
        {showCanvas && <VectorCanvas dims={dims} series={series} onPointClick={handlePointClick} />}
      </div>
    </div>
  );
}
