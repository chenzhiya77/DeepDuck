/**
 * 「app 的灯」的状态源(纯函数部分)。
 *
 * 外壳持有一条**薄订阅**(spec §10.3 的 J2):它只要 `messages` 与「在不在跑」,
 * 后者来自 **join 是否打开**,而不是 SDK 的 `isLoading` —— SDK 那个字段在
 * 「先订阅后跑」(最常见)时永远为 false,理由见 §10.3。
 *
 * 放 `core/threads/` 而不是 `core/pet/`:注册方是四个会话主面,概念是
 * 「app 当前跟着哪个会话」,宠物只是它的消费者。
 */

/**
 * 外壳订阅的目标:哪个会话的哪一条 run(注册协议必须带 runId,见 §10.3)。
 * `runId` 可为 null —— 「线程已确定但还没开跑」是合法状态(首次挂载、跑完之后),
 * 那时仍然要按 threadId 取一次状态,否则「在等你」说不出来。
 */
export interface ActivityTarget {
  threadId: string;
  runId: string | null;
}

export interface ActivityState {
  target: ActivityTarget | null;
  /** join 还开着 = 在跑 */
  running: boolean;
  messages: unknown[];
  /** 结束或缺口 ⇒ 重取一次 thread state,不靠回放重建消息(§10.3) */
  needsRefetch: boolean;
}

export const EMPTY_ACTIVITY: ActivityState = {
  target: null,
  running: false,
  messages: [],
  needsRefetch: false,
};

export type ActivityEvent =
  | { kind: "register"; target: ActivityTarget }
  | { kind: "unregister" }
  | { kind: "join-open"; threadId: string }
  | { kind: "snapshot"; threadId: string; messages: unknown[] }
  | { kind: "end"; threadId: string }
  | { kind: "gap"; threadId: string }
  | { kind: "join-error"; threadId: string }
  /** 重取 thread state 完成 —— 必须清标志,否则每帧都会再取一次 */
  | { kind: "refetched"; threadId: string };

/** 流事件必须属于当前目标 —— 旧 join 的收尾不能动到切换之后的状态 */
function isCurrent(state: ActivityState, threadId: string): boolean {
  return state.target?.threadId === threadId;
}

export function reduceActivity(
  state: ActivityState,
  event: ActivityEvent,
): ActivityState {
  if (event.kind === "register") {
    const previous = state.target;
    // 幂等:完全相同的注册不动状态 —— 否则一次无谓的重放会把正在跑的 join 抹成停跑
    if (
      previous?.threadId === event.target.threadId &&
      previous?.runId === event.target.runId
    ) {
      return state;
    }
    const sameThread = previous?.threadId === event.target.threadId;
    return {
      target: event.target,
      // 同一会话的新一轮:已有消息仍然有效,清空会让宠物闪一下 idle
      messages: sameThread ? state.messages : [],
      running: false,
      // 同一会话里挂着的重取请求要留着,否则它会输给这次注册而丢失
      needsRefetch: sameThread ? state.needsRefetch : false,
    };
  }

  if (event.kind === "unregister") return EMPTY_ACTIVITY;

  if (!isCurrent(state, event.threadId)) return state;

  switch (event.kind) {
    case "join-open":
      return { ...state, running: true };
    case "snapshot":
      // values 是完整快照,整体替换而不是合并
      return { ...state, messages: event.messages };
    case "end":
      return { ...state, running: false, needsRefetch: true };
    case "gap":
      // 缺口不代表 run 结束 —— 只标记要重取,running 保持原样
      return { ...state, needsRefetch: true };
    case "join-error":
      return { ...state, running: false, needsRefetch: true };
    case "refetched":
      return { ...state, needsRefetch: false };
  }

  return state;
}
