import type { Message } from "@langchain/langgraph-sdk";

import { hasToolCalls } from "@/core/messages/utils";

import type { FatigueLevel } from "./state";

export interface FatigueInput {
  toolCallCount: number;
  maxConsecutiveSameTool: number;
  /** `deerflow_tool_meta.status === "error"` 的 ToolMessage 数 */
  toolErrorCount: number;
  /** 上者中 `recoverable_by_model === false` 的子集(auth / config / internal 等) */
  unrecoverableErrorCount: number;
  elapsedMs: number;
}

/**
 * `collectFatigueInput` 的产出:只含可由消息派生的四项。
 *
 * `elapsedMs` 故意不在其中 —— 它是活的(每 tick 变),而 §12 要求这一趟扫描
 * memo 在 `messages.length` 上;把时间塞进来会让缓存每帧失效。
 */
export type FatigueSignals = Omit<FatigueInput, "elapsedMs">;

const MINUTE = 60_000;

/**
 * 阈值表(§7)。**这些数是猜的,不是推导出来的**(§15 开放项 2),上线后需拿
 * 真实 run 校准。两个错误子分的实测触发频率差一个量级(§7):`status: "error"`
 * 在 138 条真实样本里 5 条,`recoverable_by_model: false` 0 条 —— 所以
 * `byUnrecoverable` 本质是布尔告警(1 即 1、2 即满),不是计数曲线。
 */
function byCount(toolCallCount: number): FatigueLevel {
  if (toolCallCount < 5) return 0;
  if (toolCallCount < 15) return 1;
  if (toolCallCount < 35) return 2;
  return 3;
}

function byRepetition(maxConsecutiveSameTool: number): FatigueLevel {
  if (maxConsecutiveSameTool < 3) return 0;
  if (maxConsecutiveSameTool < 5) return 1;
  if (maxConsecutiveSameTool < 8) return 2;
  return 3;
}

function byErrors(toolErrorCount: number): FatigueLevel {
  if (toolErrorCount < 1) return 0;
  if (toolErrorCount < 2) return 1;
  if (toolErrorCount < 4) return 2;
  return 3;
}

function byUnrecoverable(unrecoverableErrorCount: number): FatigueLevel {
  if (unrecoverableErrorCount < 1) return 0;
  if (unrecoverableErrorCount < 2) return 1;
  return 3;
}

function byElapsed(elapsedMs: number): FatigueLevel {
  if (elapsedMs < 2 * MINUTE) return 0;
  if (elapsedMs < 10 * MINUTE) return 1;
  if (elapsedMs < 30 * MINUTE) return 2;
  return 3;
}

export function computeFatigueLevel(i: FatigueInput): FatigueLevel {
  return Math.min(
    3,
    Math.max(
      byCount(i.toolCallCount),
      byRepetition(i.maxConsecutiveSameTool),
      byErrors(i.toolErrorCount),
      byUnrecoverable(i.unrecoverableErrorCount),
      byElapsed(i.elapsedMs),
    ),
  ) as FatigueLevel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 单遍扫描 `thread.messages`,产出疲劳度的消息侧输入(§12)。
 *
 * 错误只看 `additional_kwargs.deerflow_tool_meta` 的结构化字段,**不从文本
 * 猜** —— 后端模块 docstring 明写消费者应读这个键而不是解析文本(§4.4(a))。
 * Task 0 Step 1 已确认它确实抵达前端。
 */
export function collectFatigueInput(messages: Message[]): FatigueSignals {
  let toolCallCount = 0;
  let maxConsecutiveSameTool = 0;
  let currentRun = 0;
  let previousToolName: string | null = null;

  let toolErrorCount = 0;
  let unrecoverableErrorCount = 0;

  for (const message of messages) {
    if (message.type === "ai" && hasToolCalls(message)) {
      for (const call of message.tool_calls ?? []) {
        toolCallCount += 1;
        if (call.name === previousToolName) {
          currentRun += 1;
        } else {
          currentRun = 1;
          previousToolName = call.name;
        }
        if (currentRun > maxConsecutiveSameTool) {
          maxConsecutiveSameTool = currentRun;
        }
      }
      continue;
    }

    if (message.type !== "tool") continue;
    const meta = message.additional_kwargs?.deerflow_tool_meta;
    if (!isRecord(meta) || meta.status !== "error") continue;
    toolErrorCount += 1;
    if (meta.recoverable_by_model === false) unrecoverableErrorCount += 1;
  }

  return {
    toolCallCount,
    maxConsecutiveSameTool,
    toolErrorCount,
    unrecoverableErrorCount,
  };
}
