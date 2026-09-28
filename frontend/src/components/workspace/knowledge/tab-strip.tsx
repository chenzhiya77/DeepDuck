"use client";

import { Check, ChevronRight } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";

import { computeFoldCount } from "./tab-strip.utils";

/** 遮罩宽（spec D3：固定 40px 骑行尾，不随内容变——拖分隔条时行尾不抖）。 */
const MASK_WIDTH = 40;

/**
 * tab 行溢出降级（spec 2026-09-28-kb-tabs-overflow）：放得下的平铺、放不下的
 * 进「遮罩下拉」（D1 乙 固定折叠边界——下拉内容只随宽度变、滚动永不改它）。
 * 六 trigger 永不移出 DOM（不变式：Radix 方向键循环与"滚动不改成员"都靠它）。
 */
export function TabStrip<T extends string>({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: readonly { value: T; label: string }[];
  activeTab: T;
  onTabChange: (value: T) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [foldCount, setFoldCount] = useState(tabs.length);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const ends = Array.from(
      element.querySelectorAll<HTMLElement>("[data-slot='tabs-trigger']"),
    ).map((node) => node.offsetLeft + node.offsetWidth);
    const width = element.clientWidth;
    const nextFold = computeFoldCount(width, ends, MASK_WIDTH);
    const nextOverflow = element.scrollWidth > width;
    setFoldCount((prev) => (prev === nextFold ? prev : nextFold));
    setOverflowing((prev) => (prev === nextOverflow ? prev : nextOverflow));
  }, []);

  // 每次 render 后量一次（D5）——i18n 切语言改标签宽，容器宽度没变、
  // ResizeObserver 不触发；幂等 setState、不自激。RO 兜拖分隔条的宽度变化。
  useLayoutEffect(() => {
    measure();
  });
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="relative mx-4 mt-2">
      {/* 滚动容器：隐藏滚动条（遮罩+渐隐是唯一溢出暗示）+ 底部内边距垫
          激活下划线（variant="line" 画在 trigger 下 5px、越界 2px）。 */}
      <div
        ref={containerRef}
        className="flex overflow-x-auto pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="tab-strip-scroll"
      >
        <TabsList variant="line">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {overflowing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t.knowledge.tabs.more}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-end pr-1"
              data-testid="tab-strip-mask"
              style={{
                backgroundImage:
                  "linear-gradient(to left, var(--background) 45%, transparent)",
              }}
              type="button"
            >
              <ChevronRight className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {tabs.slice(foldCount).map((tab) => (
              <DropdownMenuItem
                aria-current={tab.value === activeTab ? "true" : undefined}
                key={tab.value}
                onSelect={() => onTabChange(tab.value)}
              >
                {tab.value === activeTab ? <Check className="size-4" /> : null}
                {tab.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
