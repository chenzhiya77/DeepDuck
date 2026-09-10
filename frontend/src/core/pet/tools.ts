import type { Message } from "@langchain/langgraph-sdk";

import { hasToolCalls } from "@/core/messages/utils";

import type { PetWorkKind } from "./state";

/**
 * 在飞的工具名 = 有 tool_call 但没有对应 ToolMessage 的那些。
 *
 * 不走 `findToolCallResult`(`core/messages/utils.ts:706`):它在 ToolMessage
 * 存在但内容为空时同样返回 `undefined`,会把「已完成的空结果」误读成「仍在飞」。
 * 也不从 `getMessageGroups` 派生(见 spec §6.1):三类互斥拆分会让 `task` /
 * `present_files` 永远不可见。
 */
export function collectActiveToolNames(messages: Message[]): string[] {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.type === "tool" && m.tool_call_id) answered.add(m.tool_call_id);
  }

  const active: string[] = [];
  for (const m of messages) {
    // `m.type !== "ai"` 只为让 TS 收窄到 AIMessage(`hasToolCalls` 本身不做
    // 类型谓词,与既有 `extractPresentFilesFromMessage` 同一写法)。
    if (m.type !== "ai" || !hasToolCalls(m)) continue;
    for (const call of m.tool_calls ?? []) {
      if (call.id && !answered.has(call.id)) active.push(call.name);
    }
  }
  return active;
}

const TOOL_WORK_KINDS: Record<string, PetWorkKind> = {
  bash: "exec",
  invoke_acp_agent: "exec",
  read_file: "read",
  ls: "read",
  glob: "read",
  grep: "read",
  view_image: "read",
  write_file: "write",
  str_replace: "write",
  present_files: "write",
  web_search: "browse",
  web_fetch: "browse",
  image_search: "browse",
  web_capture: "browse",
  browser_navigate: "browse",
  browser_snapshot: "browse",
  browser_click: "browse",
  browser_type: "browse",
  browser_get_text: "browse",
  browser_back: "browse",
  browser_screenshot: "browse",
  browser_close: "browse",
  hybrid_search: "recall",
  graph_search: "recall",
  wiki_search: "recall",
  memory_search: "recall",
  describe_skill: "recall",
  tool_search: "recall",
  task: "delegate",
};

/** MCP 工具名是 `<server>_<tool>` 的无界命名空间,未知一律落 `generic`。 */
export function classifyTool(name: string): PetWorkKind {
  return TOOL_WORK_KINDS[name] ?? "generic";
}

/** 多个工具并行在飞时谁赢。数值越小越显著。 */
const WORK_KIND_PRECEDENCE: Record<PetWorkKind, number> = {
  delegate: 0,
  exec: 1,
  write: 2,
  browse: 3,
  recall: 4,
  read: 5,
  generic: 6,
};

export function pickWorkKind(names: string[]): PetWorkKind | null {
  if (names.length === 0) return null;
  const ranked = names
    .map(classifyTool)
    .sort((a, b) => WORK_KIND_PRECEDENCE[a] - WORK_KIND_PRECEDENCE[b]);
  return ranked[0] ?? null;
}
