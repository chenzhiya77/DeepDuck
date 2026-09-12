import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";

import type { ActivityTarget } from "@/core/threads/activity";
import {
  ActivityProvider,
  useAppActivity,
  useRegisterActivity,
} from "@/core/threads/activity-context";

type Chunk = { id?: string; event: string; data?: unknown };

interface Recorder {
  joins: { threadId: string; runId: string; streamMode: unknown }[];
  getState: number;
  signals: AbortSignal[];
}

let client: {
  runs: {
    joinStream: (
      threadId: string,
      runId: string,
      options: { signal?: AbortSignal; streamMode?: unknown },
    ) => AsyncGenerator<Chunk>;
  };
  threads: { getState: (threadId: string) => Promise<unknown> };
};

// 工厂不能闭包测试内的变量(rs.mock 会被提升),所以拿一个模块级槽位转接
rs.mock("@/core/api/api-client", () => ({
  getAPIClient: () => client,
}));

/**
 * `open` = values 之后挂住不结束(模拟 run 还在跑);
 * `closed` = values 之后给终结帧(模拟跑完)。
 */
function stubClient(
  mode: "open" | "closed",
  messages: unknown[] = [{ id: "m1" }],
): Recorder {
  const rec: Recorder = { joins: [], getState: 0, signals: [] };
  client = {
    runs: {
      joinStream: (threadId, runId, options) => {
        rec.joins.push({
          threadId,
          runId,
          streamMode: options.streamMode,
        });
        if (options.signal) rec.signals.push(options.signal);
        return (async function* () {
          yield { id: "1-0", event: "values", data: { messages } };
          if (mode === "closed") {
            yield { id: "1-1", event: "end", data: null };
            return;
          }
          await new Promise<void>((resolve) => {
            options.signal?.addEventListener("abort", () => resolve());
          });
        })();
      },
    },
    threads: {
      getState: async () => {
        rec.getState += 1;
        return { values: { messages: [{ id: "from-state" }] } };
      },
    },
  };
  return rec;
}

function Probe({ target }: { target: ActivityTarget | null }) {
  useRegisterActivity(target);
  const activity = useAppActivity();
  return (
    <output
      data-running={String(activity.running)}
      data-count={String(activity.messages.length)}
      data-thread={activity.target?.threadId ?? "none"}
    />
  );
}

interface ProbeAttrs {
  running: string | null;
  count: string | null;
  thread: string | null;
}

function read(selector = "output"): ProbeAttrs {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element matched ${selector}`);
  return {
    running: el.getAttribute("data-running"),
    count: el.getAttribute("data-count"),
    thread: el.getAttribute("data-thread"),
  };
}

/** 只读、不注册的消费者 —— 用来观察「注册面卸载之后」外壳还剩什么 */
function Consumer() {
  const activity = useAppActivity();
  return (
    <output
      data-consumer="1"
      data-running={String(activity.running)}
      data-count={String(activity.messages.length)}
      data-thread={activity.target?.threadId ?? "none"}
    />
  );
}

function renderWith(target: ActivityTarget | null): void {
  render(
    <ActivityProvider>
      <Probe target={target} />
    </ActivityProvider>,
  );
}

/** 冲掉挂起的 effect 与微任务(异步订阅是生成器,得让它转起来) */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  client = undefined as unknown as typeof client;
});

afterEach(() => {
  cleanup();
});

describe("ActivityProvider:订阅", () => {
  it("注册目标后按 runId 建立订阅,且只要 values 模式", async () => {
    const rec = stubClient("open");
    renderWith({ threadId: "A", runId: "run-1" });
    await flush();

    expect(rec.joins).toHaveLength(1);
    expect(rec.joins[0]?.threadId).toBe("A");
    expect(rec.joins[0]?.runId).toBe("run-1");
    expect(rec.joins[0]?.streamMode).toEqual(["values"]);
  });

  it("values 事件填消息,join 开着就是在跑", async () => {
    stubClient("open");
    renderWith({ threadId: "A", runId: "run-1" });
    await flush();

    expect(read().running).toBe("true");
    expect(read().count).toBe("1");
    expect(read().thread).toBe("A");
  });

  it("终结帧 ⇒ 停跑,并重取一次 thread state 作为准绳", async () => {
    const rec = stubClient("closed");
    renderWith({ threadId: "A", runId: "run-1" });
    await flush();

    expect(read().running).toBe("false");
    expect(rec.getState).toBe(1);
    // 重取的 state 覆盖回放来的消息
    expect(read().count).toBe("1");
  });

  it("没有 run 也要取一次状态(回到一条正在等你的线程)", async () => {
    const rec = stubClient("open");
    renderWith({ threadId: "A", runId: null });
    await flush();

    expect(rec.joins).toHaveLength(0);
    expect(rec.getState).toBe(1);
    expect(read().thread).toBe("A");
  });

  it("取状态拿到的消息要真的进状态 —— 形状是 {values:{messages}},不是顶层 messages", async () => {
    // 只数「取了一次」会漏掉这件事:真实 GET /threads/{id}/state 的顶层没有 messages,
    // 消息在 values 里;不拆这层信封的话「回到一条正在等你的线程」永远是空态(2026-09-12 浏览器阶梯抓到)
    stubClient("open");
    renderWith({ threadId: "A", runId: null });
    await flush();

    expect(read().count).toBe("1");
  });

  it("切目标会中止旧订阅(不能两条流同时喂一个状态)", async () => {
    const rec = stubClient("open");
    const view = render(
      <ActivityProvider>
        <Probe target={{ threadId: "A", runId: "run-1" }} />
      </ActivityProvider>,
    );
    await flush();
    expect(rec.signals[0]?.aborted).toBe(false);

    view.rerender(
      <ActivityProvider>
        <Probe target={{ threadId: "B", runId: "run-2" }} />
      </ActivityProvider>,
    );
    await flush();

    expect(rec.signals[0]?.aborted).toBe(true);
    expect(rec.joins.map((j) => j.threadId)).toEqual(["A", "B"]);
    expect(read().thread).toBe("B");
  });

  it("没有注册目标时是稳定空态,且一个请求都不发", async () => {
    const rec = stubClient("open");
    renderWith(null);
    await flush();

    expect(rec.joins).toHaveLength(0);
    expect(rec.getState).toBe(0);
    expect(read().running).toBe("false");
    expect(read().count).toBe("0");
    expect(read().thread).toBe("none");
  });

  it("注册面卸载后订阅仍在 —— 外壳活过页面,这正是「离开聊天页仍在跑」", async () => {
    const rec = stubClient("open");
    const view = render(
      <ActivityProvider>
        <Consumer />
        <Probe target={{ threadId: "A", runId: "run-1" }} />
      </ActivityProvider>,
    );
    await flush();
    expect(read("[data-consumer]").running).toBe("true");

    // 离开会话页:注册面没了,但目标与订阅都得留下
    view.rerender(
      <ActivityProvider>
        <Consumer />
      </ActivityProvider>,
    );
    await flush();

    expect(read("[data-consumer]").thread).toBe("A");
    expect(read("[data-consumer]").running).toBe("true");
    expect(read("[data-consumer]").count).toBe("1");
    expect(rec.signals[0]?.aborted).toBe(false);
  });
});
