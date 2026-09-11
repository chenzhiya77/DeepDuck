import { describe, expect, it } from "@rstest/core";

import {
  EMPTY_ACTIVITY,
  reduceActivity,
  type ActivityState,
} from "@/core/threads/activity";

/** 注册到线程 A 并让 join 开着 —— 多数用例的起点 */
function runningOnA(): ActivityState {
  let state = reduceActivity(EMPTY_ACTIVITY, {
    kind: "register",
    target: { threadId: "A", runId: "run-1" },
  });
  state = reduceActivity(state, { kind: "join-open", threadId: "A" });
  return reduceActivity(state, {
    kind: "snapshot",
    threadId: "A",
    messages: [{ id: "m1" }],
  });
}

describe("外壳活跃 run:注册与重置", () => {
  it("注册一个新线程:目标设上,状态干净", () => {
    const state = reduceActivity(EMPTY_ACTIVITY, {
      kind: "register",
      target: { threadId: "A", runId: "run-1" },
    });

    expect(state.target).toEqual({ threadId: "A", runId: "run-1" });
    expect(state.running).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.needsRefetch).toBe(false);
  });

  it("同线程换 run:采纳新 runId,但保留已有消息(不闪空)", () => {
    const state = reduceActivity(runningOnA(), {
      kind: "register",
      target: { threadId: "A", runId: "run-2" },
    });

    expect(state.target?.runId).toBe("run-2");
    // 同一个会话的新一轮,历史仍然有效 —— 清空会让宠物闪一下 idle
    expect(state.messages).toEqual([{ id: "m1" }]);
    expect(state.running).toBe(false);
    expect(state.needsRefetch).toBe(false);
  });

  it("切到另一个线程:消息清空、running 归零(切线程重置契约)", () => {
    const state = reduceActivity(runningOnA(), {
      kind: "register",
      target: { threadId: "B", runId: "run-9" },
    });

    expect(state.target).toEqual({ threadId: "B", runId: "run-9" });
    expect(state.messages).toEqual([]);
    expect(state.running).toBe(false);
    expect(state.needsRefetch).toBe(false);
  });

  it("完全相同的注册是幂等的:不把在跑的 join 抹成停跑", () => {
    const running = runningOnA();

    const again = reduceActivity(running, {
      kind: "register",
      target: { threadId: "A", runId: "run-1" },
    });

    expect(again).toBe(running);
    expect(again.running).toBe(true);
  });

  it("同一会话里挂着的重取请求不会被一次重注册抹掉", () => {
    const afterEnd = reduceActivity(runningOnA(), { kind: "end", threadId: "A" });
    expect(afterEnd.needsRefetch).toBe(true);

    const reregistered = reduceActivity(afterEnd, {
      kind: "register",
      target: { threadId: "A", runId: "run-2" },
    });

    // run 结束时刚标记要重取,紧接着主面带着新 runId 重注册 —— 不能把标志吃掉
    expect(reregistered.needsRefetch).toBe(true);
  });

  it("注销(离开所有会注册的面)回到空态", () => {
    const state = reduceActivity(runningOnA(), { kind: "unregister" });

    expect(state).toEqual(EMPTY_ACTIVITY);
  });
});

describe("外壳活跃 run:join 生命周期", () => {
  it("join 打开 ⇒ running", () => {
    let state = reduceActivity(EMPTY_ACTIVITY, {
      kind: "register",
      target: { threadId: "A", runId: "run-1" },
    });
    state = reduceActivity(state, { kind: "join-open", threadId: "A" });

    expect(state.running).toBe(true);
  });

  it("快照整体替换消息(不是合并)", () => {
    const state = reduceActivity(runningOnA(), {
      kind: "snapshot",
      threadId: "A",
      messages: [{ id: "m1" }, { id: "m2" }],
    });

    expect(state.messages).toEqual([{ id: "m1" }, { id: "m2" }]);
  });

  it("终结帧 ⇒ 停止 + 要求重取一次 state", () => {
    const state = reduceActivity(runningOnA(), { kind: "end", threadId: "A" });

    expect(state.running).toBe(false);
    // 回放可能不全,所以结束时以重取的 state 为准
    expect(state.needsRefetch).toBe(true);
  });

  it("回放缺口 ⇒ 要求重取,但不改 running(run 可能还在跑)", () => {
    const state = reduceActivity(runningOnA(), { kind: "gap", threadId: "A" });

    expect(state.running).toBe(true);
    expect(state.needsRefetch).toBe(true);
  });

  it("join 出错 ⇒ 停止 + 要求重取", () => {
    const state = reduceActivity(runningOnA(), {
      kind: "join-error",
      threadId: "A",
    });

    expect(state.running).toBe(false);
    expect(state.needsRefetch).toBe(true);
  });

  it("重取完成后清掉标志(否则每帧都会再取一次)", () => {
    const afterEnd = reduceActivity(runningOnA(), { kind: "end", threadId: "A" });
    const refetched = reduceActivity(afterEnd, {
      kind: "refetched",
      threadId: "A",
    });

    expect(refetched.needsRefetch).toBe(false);
    expect(refetched.running).toBe(false);
  });
});

describe("外壳活跃 run:过期与空态", () => {
  it("过期的流事件被忽略(旧 join 的 end 不能复活已切换的状态)", () => {
    const onA = runningOnA();
    const onB = reduceActivity(onA, {
      kind: "register",
      target: { threadId: "B", runId: "run-9" },
    });

    const afterStale = reduceActivity(onB, { kind: "end", threadId: "A" });

    expect(afterStale).toEqual(onB);
    expect(afterStale.needsRefetch).toBe(false);
  });

  it("没有注册目标时收到流事件:原样返回,不抛错", () => {
    expect(
      reduceActivity(EMPTY_ACTIVITY, {
        kind: "snapshot",
        threadId: "A",
        messages: [{ id: "m1" }],
      }),
    ).toEqual(EMPTY_ACTIVITY);

    expect(
      reduceActivity(EMPTY_ACTIVITY, { kind: "join-open", threadId: "A" }),
    ).toEqual(EMPTY_ACTIVITY);
  });
});
