"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { getAPIClient } from "@/core/api/api-client";

import {
  EMPTY_ACTIVITY,
  reduceActivity,
  type ActivityState,
  type ActivityTarget,
} from "./activity";

interface ActivityContextValue {
  activity: ActivityState;
  register: (target: ActivityTarget | null) => void;
}

const ActivityContext = createContext<ActivityContextValue | undefined>(
  undefined,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** thread state / values 事件里取 raw messages(取不到交给调用方决定怎么处理) */
function messagesOf(payload: unknown): unknown[] | null {
  let bag: unknown = payload;
  if (typeof bag === "string") {
    try {
      bag = JSON.parse(bag);
    } catch {
      return null;
    }
  }
  if (!isRecord(bag)) return null;
  const messages = bag.messages;
  return Array.isArray(messages) ? messages : null;
}

/**
 * 「app 的灯」的外壳实现(spec §10.3 的 B+ / J2):
 * 持有一条**薄订阅**,只取 `messages` 与「在不在跑」,后者 = **join 是否打开**
 * —— 不是 SDK 的 `isLoading`(它在「先订阅后跑」时永远 false,Leg 0 已证)。
 *
 * 订阅**不随页面卸载而断**:目标由四个会话主面注册,外壳拿到就自己续订,
 * 这正是「换页后仍在跑 / 仍能说在等你」的来源。
 */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activity, dispatch] = useReducer(reduceActivity, EMPTY_ACTIVITY);

  const register = useCallback((target: ActivityTarget | null) => {
    dispatch(target ? { kind: "register", target } : { kind: "unregister" });
  }, []);

  const target = activity.target;
  const threadId = target?.threadId ?? null;
  const runId = target?.runId ?? null;

  // 目标变化 ⇒ 换订阅。旧订阅必须中止,否则两条流会同时喂一个状态。
  useEffect(() => {
    if (!threadId) return;
    const client = getAPIClient();
    const controller = new AbortController();
    let cancelled = false;

    const loadState = async () => {
      try {
        const snapshot = await client.threads.getState(threadId);
        const messages = messagesOf(snapshot);
        if (!cancelled && messages) {
          dispatch({ kind: "snapshot", threadId, messages });
        }
      } catch {
        // 没有 run 时拉不到状态不算失败:保持空态,别报成 join 出错
      }
    };

    // 没有 run 也要取一次:那条线程可能早就挂着一条未答的请求(wait 的来源)
    if (!runId) {
      void loadState();
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      dispatch({ kind: "join-open", threadId });
      try {
        const stream = client.runs.joinStream(threadId, runId, {
          signal: controller.signal,
          streamMode: ["values"],
        });
        for await (const chunk of stream) {
          // gap 不是 SDK 的枚举成员,统一按字符串比,避免版本耦合
          const event = String(chunk.event);
          if (event === "values") {
            const messages = messagesOf(chunk.data);
            if (messages) dispatch({ kind: "snapshot", threadId, messages });
          } else if (event === "gap") {
            dispatch({ kind: "gap", threadId });
          } else if (event === "error") {
            dispatch({ kind: "join-error", threadId });
            return;
          } else if (event === "end") {
            break;
          }
        }
        if (!cancelled) dispatch({ kind: "end", threadId });
      } catch {
        // abort 是正常的换目标/卸载,不算错误
        if (!cancelled) dispatch({ kind: "join-error", threadId });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [threadId, runId]);

  // 结束或缺口 ⇒ 重取一次 thread state 作为准绳,不靠回放重建消息
  const needsRefetch = activity.needsRefetch;
  useEffect(() => {
    if (!needsRefetch || !threadId) return;
    const client = getAPIClient();
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await client.threads.getState(threadId);
        const messages = messagesOf(snapshot);
        if (!cancelled && messages) {
          dispatch({ kind: "snapshot", threadId, messages });
        }
      } catch {
        // 拉不到就保持回放来的消息 —— 比重取失败还把消息清空好
      } finally {
        if (!cancelled) dispatch({ kind: "refetched", threadId });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsRefetch, threadId]);

  const value = useMemo(() => ({ activity, register }), [activity, register]);
  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

function useActivityContext(): ActivityContextValue {
  const value = useContext(ActivityContext);
  if (!value) {
    throw new Error("useActivity* must be used inside <ActivityProvider>");
  }
  return value;
}

/**
 * 会话主面挂载时登记自己代表的 (threadId, liveRunId, href)。
 *
 * **卸载不注销** —— 外壳订阅必须活过页面卸载,那正是「离开聊天页仍在跑 / 仍能说
 * 在等你」的来源。换会话由下一次注册覆盖,不做「谁卸载谁清空」的所有权争夺。
 * 依赖只取标量,所以调用方每次传新对象字面量也不会反复重订。
 */
export function useRegisterActivity(target: ActivityTarget | null): void {
  const { register } = useActivityContext();
  const threadId = target?.threadId ?? null;
  const runId = target?.runId ?? null;
  const href = target?.href ?? null;

  useEffect(() => {
    // 还没有线程(新会话、非会话页)时不登记,也不清掉上一个 —— 上一个可能还在跑
    if (!threadId) return;
    register({ threadId, runId, href: href ?? undefined });
  }, [register, threadId, runId, href]);
}

/** 消费者(宠物)读它 —— 只认这一条,与页面自己的富 hook 无关 */
export function useAppActivity(): ActivityState {
  return useActivityContext().activity;
}
