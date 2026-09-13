"use client";

import type { Message } from "@langchain/langgraph-sdk";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PetSprite } from "@/components/workspace/pet/pet-sprite";
import { hasOpenHumanInputRequest } from "@/core/messages/human-input";
import { isHiddenFromUIMessage } from "@/core/messages/utils";
import { collectFatigueInput, computeFatigueLevel } from "@/core/pet/fatigue";
import {
  clampOffset,
  normalizeDisplaySize,
  type PetOffset,
  type PetViewport,
} from "@/core/pet/placement";
import { derivePetState, type PetState } from "@/core/pet/state";
import { collectActiveToolNames } from "@/core/pet/tools";
import { useLocalSettings } from "@/core/settings/hooks";
import { useAppActivity } from "@/core/threads/activity-context";
import { pathOfThread } from "@/core/threads/utils";

import petManifest from "../../../../public/pet/parrot/manifest.json";

/**
 * §18 分期:`FATIGUE_ENABLED` 保持 false —— 疲劳轴 2026-09-12 被用户明确「不做」(见 spec §17)。
 * `WORK_KIND_ENABLED` 于 2026-09-13 打开:`think` 与 `work` 两组真美术都已到位,于是
 * 「在推理」与「有工具在飞」不再共用同一张图;未声明的子类别(`work-exec` 等)按 §9.2
 * 的两级回落落到 `work`。这两张帧到位之前翻它是无效的(全部塌回 idle)。
 */
const FATIGUE_ENABLED = false;
const WORK_KIND_ENABLED = true;

/** 起拖阈值:照抄 Qoder 实测值,避免 Alt+单击被误判成拖拽 */
const DRAG_THRESHOLD_PX = 4;

/**
 * 订阅者:读**外壳那条薄订阅**(`useAppActivity`,spec §10.3)派生状态,把渲染
 * 交给 `PetSprite`。
 *
 * 它挂在外壳而不在聊天页里 —— 所以换页时它还在,这就是「app 的灯」。仍是
 * **观察者**(§4.1):不订阅 custom 事件、不持有线程/记忆、不发任何请求。
 * 三个扫描都 memo 在 `activity.messages` 上;外壳用 `values` 快照喂消息,数组只在
 * **结构性变化**时换新,与 §12「token 级零重算」同效。
 */
export function AgentPet() {
  const activity = useAppActivity();
  // 跨线程重置的键来自外壳的目标,不再是页面的路由参数
  const threadId = activity.target?.threadId ?? null;
  const [settings, setSettings] = useLocalSettings();
  const shellRef = useRef<HTMLDivElement>(null);

  // 一次性态:`greet` 是挂载生命周期(每挂载一次,切线程不重放),
  // `done` 是「在跑」的下降沿闩锁,播完由 animationend 清掉。
  const [greetActive, setGreetActive] = useState(true);
  const [doneActive, setDoneActive] = useState(false);
  const wasLoadingRef = useRef(activity.running);
  const loadingStartedAtRef = useRef<number | null>(null);

  // 拖拽手势只活在 ref 里,不进状态机(spec §10.1)
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: PetOffset;
    dragged: boolean;
    captureTarget: Element | null;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<PetOffset | null>(null);
  const swallowNextClickRef = useRef(false);
  const offsetRef = useRef<PetOffset>(settings.pet.offset);
  offsetRef.current = dragOffset ?? settings.pet.offset;

  const [viewport, setViewport] = useState<PetViewport | null>(null);

  const pathname = usePathname();
  const router = useRouter();

  /**
   * Alt+单击 = 跳回它代表的那个会话(Task 4)。**只做单目标** —— 宠物代表一个
   * 线程,点它直接回去,不做选择器(多会话版是「浮动会话卡」那条独立线,§17)。
   */
  const jumpRef = useRef<(() => void) | null>(null);
  jumpRef.current = () => {
    const target = activity.target;
    if (!target) return;
    const href = target.href ?? pathOfThread(target.threadId);
    // 目标不在当前页才跳;同路径即无操作 —— 知识库页打开线程后会把 thread 参数
    // 从 URL 上抹掉(只剩 ?kb=),所以只能比路径,不能比整个 URL
    if (href.split("?")[0] === pathname) return;
    router.push(href);
  };

  // 活动状态对消息形状保持不可知(它是通道,不是解析者),形状在这一侧收口
  const messages = activity.messages as Message[];

  // 消息侧的两个扫描:同样 memo 在消息数组上(spec §12)
  const activeToolNames = useMemo(
    () => collectActiveToolNames(messages),
    [messages],
  );
  const fatigueSignals = useMemo(
    () => collectFatigueInput(messages),
    [messages],
  );

  // 逐字照抄 page.tsx 的调用形式(同过滤器)
  const hasOpenHumanInputCard = useMemo(
    () =>
      hasOpenHumanInputRequest(
        messages,
        (message) => !isHiddenFromUIMessage(message),
      ),
    [messages],
  );

  // 下降沿:开始计时 + 触发 done 闩锁
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    if (activity.running && !wasLoading) {
      loadingStartedAtRef.current = Date.now();
      // 新 run 开始 ⇒ 上一轮的 done 已陈旧(例如它落在 wait/error 分支没播)
      setDoneActive(false);
    }
    if (!activity.running && wasLoading) {
      setDoneActive(true);
    }
    wasLoadingRef.current = activity.running;
  }, [activity.running]);

  // 跨线程重置:done 闩锁与计时起点归零;greet 不重放(spec §11)
  useEffect(() => {
    setDoneActive(false);
    loadingStartedAtRef.current = null;
    wasLoadingRef.current = activity.running;
    // threadId 变即重置,不看「在跑」的瞬时值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // 可见区:随外壳尺寸变化重算,供渲染时 clamp
  useEffect(() => {
    const parent = shellRef.current?.parentElement;
    if (!parent) return;

    const measure = () => {
      const rect = parent.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({ width: rect.width, height: rect.height });
      }
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const offset = settings.pet.offset;
  // 盒子尺寸的唯一来源:用户设置收口一次,既喂 clamp 也喂渲染器(§10.2)
  const boxSize = normalizeDisplaySize(settings.pet.displaySize);
  const rendered = clampOffset(
    dragOffset ?? offset,
    { size: boxSize },
    viewport ?? { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
  );

  const handleOneShotEnd = useCallback(() => {
    setGreetActive(false);
    setDoneActive(false);
  }, []);

  // Alt+拖拽 / Alt+单击:命中测试走 window 级矩形,宠物自身恒 pointer-events-none(§10.1)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!event.altKey) return;
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) return;

      const target = event.target;
      let captureTarget: Element | null = null;
      if (target instanceof Element) {
        try {
          target.setPointerCapture?.(event.pointerId);
          captureTarget = target;
        } catch {
          // 合成事件里 pointerId 可能无效;window 级监听照常收事件
        }
      }
      // 落在宠物盒上的 Alt 手势一律吞掉紧随的 click:拖拽是显而易见的,单击也
      // 一样 —— 不吞的话 Alt+单击会同时触发底下的消息链接(§10.1 / Task 4)
      swallowNextClickRef.current = true;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: offsetRef.current,
        dragged: false,
        captureTarget,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.dragged) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
          return;
        }
        drag.dragged = true;
      }
      setDragOffset({
        right: drag.startOffset.right - dx,
        top: drag.startOffset.top + dy,
      });
    };

    const endDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      try {
        drag.captureTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        // 元素可能已卸载,无需处理
      }
      if (!drag.dragged) {
        // 没越过阈值 = 单击 ⇒ 跳回它代表的会话(阈值天然把两种手势分开,§10.1)
        jumpRef.current?.();
        return;
      }
      setDragOffset(null);
      setSettings("pet", {
        offset: {
          right: Math.round(drag.startOffset.right - (event.clientX - drag.startX)),
          top: Math.round(drag.startOffset.top + (event.clientY - drag.startY)),
        },
      });
    };

    const swallowClick = (event: MouseEvent) => {
      if (!swallowNextClickRef.current) return;
      swallowNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("click", swallowClick, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("click", swallowClick, true);
    };
  }, [setSettings]);

  if (!settings.pet.enabled) return null;

  const elapsedMs =
    loadingStartedAtRef.current === null
      ? 0
      : Date.now() - loadingStartedAtRef.current;

  const derived = derivePetState({
    isLoading: activity.running,
    wasLoading: doneActive,
    hasError: activity.hasError,
    hasOpenHumanInputRequest: hasOpenHumanInputCard,
    activeToolNames: WORK_KIND_ENABLED ? activeToolNames : [],
    fatigue: FATIGUE_ENABLED
      ? computeFatigueLevel({ ...fatigueSignals, elapsedMs })
      : 0,
  });

  const state: PetState = {
    ...derived,
    oneShot:
      derived.oneShot ??
      (greetActive && derived.base === "idle" ? "greet" : null),
  };

  return (
    <div
      ref={shellRef}
      aria-hidden="true"
      className="pet-shell pointer-events-none absolute z-20"
      style={{ right: rendered.right, top: rendered.top }}
    >
      <PetSprite
        state={state}
        manifest={petManifest}
        size={boxSize}
        onOneShotEnd={handleOneShotEnd}
      />
    </div>
  );
}
