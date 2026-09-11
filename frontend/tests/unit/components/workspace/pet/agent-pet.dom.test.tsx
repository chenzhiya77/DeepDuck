import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import { AgentPet } from "@/components/workspace/pet/agent-pet";
import {
  DEFAULT_LOCAL_SETTINGS,
  LOCAL_SETTINGS_KEY,
} from "@/core/settings/local";
import { updateLocalSettings } from "@/core/settings/store";
import type { ActivityTarget } from "@/core/threads/activity";
import {
  ActivityProvider,
  useRegisterActivity,
} from "@/core/threads/activity-context";

const PANEL = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
// 只为还原,从不直接调用,故 unbound-method 在此不适用
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRect = Element.prototype.getBoundingClientRect;

interface StubClient {
  runs: {
    joinStream: (
      threadId: string,
      runId: string,
      options: { signal?: AbortSignal; streamMode?: unknown },
    ) => AsyncGenerator<{ event: string; data?: unknown }>;
  };
  threads: { getState: (threadId: string) => Promise<unknown> };
}

let client: StubClient;

// 工厂不能闭包用例内的变量(rs.mock 会被提升),走模块级槽位转接
rs.mock("@/core/api/api-client", () => ({
  getAPIClient: () => client,
}));

/** 一条真实的 ask_clarification 请求(v1 · free_text)—— 它就是 wait 的来源 */
const humanInputRequest = {
  type: "tool",
  name: "ask_clarification",
  content: "fallback",
  artifact: {
    human_input: {
      version: 1,
      kind: "human_input_request",
      source: "ask_clarification",
      request_id: "clarification:call-1",
      question: "Which file?",
      input_mode: "free_text",
    },
  },
};

/** 跑完的 run:先给一次快照,再给终结帧 */
function stubFinishedRun(messages: unknown[]): void {
  client = {
    runs: {
      joinStream: () =>
        (async function* () {
          yield { event: "values", data: { messages } };
          yield { event: "end", data: null };
        })(),
    },
    threads: { getState: async () => ({ values: { messages } }) },
  };
}

function PetHost({ target }: { target: ActivityTarget | null }) {
  useRegisterActivity(target);
  return <AgentPet />;
}

function renderPet(target: ActivityTarget | null = null) {
  return render(
    <ActivityProvider>
      <PetHost target={target} />
    </ActivityProvider>,
  );
}

function seedSettings(pet: Partial<(typeof DEFAULT_LOCAL_SETTINGS)["pet"]>) {
  updateLocalSettings("pet", pet);
}

function storedOffset() {
  const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as typeof DEFAULT_LOCAL_SETTINGS).pet.offset : null;
}

function shell(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) {
    throw new Error("AgentPet rendered no element");
  }
  return element;
}

function spriteUrl(container: HTMLElement): string {
  const sprite = container.querySelector(".pet-sprite");
  if (!(sprite instanceof HTMLElement)) {
    throw new Error("AgentPet rendered no sprite");
  }
  return sprite.style.backgroundImage;
}

beforeEach(() => {
  client = undefined as unknown as StubClient;
  Element.prototype.getBoundingClientRect = () => PANEL as DOMRect;
});

afterEach(() => {
  cleanup();
  // store 的 baseSettings 是模块级缓存,只清 localStorage 会留下上一条用例的值
  updateLocalSettings("pet", {
    enabled: DEFAULT_LOCAL_SETTINGS.pet.enabled,
    offset: DEFAULT_LOCAL_SETTINGS.pet.offset,
  });
  window.localStorage.clear();
  Element.prototype.getBoundingClientRect = originalRect;
});

describe("AgentPet 数据源(外壳那条薄订阅)", () => {
  it("活动里出现未答请求时显示 wait —— 迁移的核心断言", async () => {
    stubFinishedRun([humanInputRequest]);
    const { container } = renderPet({ threadId: "A", runId: "run-1" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(spriteUrl(container)).toContain("wait.webp");
  });

  it("没有注册目标时照常渲染 idle,不抛错", () => {
    const { container } = renderPet(null);

    expect(spriteUrl(container)).toContain("idle.webp");
  });
});

describe("AgentPet switch", () => {
  it("renders nothing once the pet is turned off", () => {
    seedSettings({ enabled: false });
    const { container } = renderPet();

    expect(container.firstElementChild).toBeNull();
  });

  it("renders the shell while the pet is on by default", () => {
    const { container } = renderPet();

    expect(container.firstElementChild).not.toBeNull();
  });
});

describe("AgentPet Alt+drag placement", () => {
  it("drags the box and persists the new offset", () => {
    const { container } = renderPet();
    const box = shell(container);

    expect(box.style.right).toBe("12px");
    expect(box.style.top).toBe("56px");

    fireEvent.pointerDown(window, {
      altKey: true,
      pointerId: 1,
      clientX: 400,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 360, clientY: 140 });

    // right 随鼠标左移而变大,top 随下移而变大
    expect(box.style.right).toBe("52px");
    expect(box.style.top).toBe("96px");

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 360, clientY: 140 });

    expect(storedOffset()).toEqual({ right: 52, top: 96 });
  });

  it("does not drag without Alt, so clicks pass through", () => {
    seedSettings({ enabled: true, offset: DEFAULT_LOCAL_SETTINGS.pet.offset });
    const { container } = renderPet();
    const box = shell(container);

    fireEvent.pointerDown(window, {
      altKey: false,
      pointerId: 2,
      clientX: 400,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 300, clientY: 200 });

    expect(box.style.right).toBe("12px");
    expect(box.style.top).toBe("56px");
    expect(storedOffset()).toEqual({ right: 12, top: 56 });
  });

  it("ignores an Alt gesture that never passes the drag threshold", () => {
    const { container } = renderPet();
    const box = shell(container);

    fireEvent.pointerDown(window, {
      altKey: true,
      pointerId: 3,
      clientX: 400,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 402, clientY: 101 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 402, clientY: 101 });

    expect(box.style.right).toBe("12px");
    expect(box.style.top).toBe("56px");
  });

  it("ignores a drag that starts outside the pet box", () => {
    const { container } = renderPet();
    const box = shell(container);

    fireEvent.pointerDown(window, {
      altKey: true,
      pointerId: 4,
      clientX: 4000,
      clientY: 4000,
    });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 3600, clientY: 4040 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 3600, clientY: 4040 });

    expect(box.style.right).toBe("12px");
    expect(box.style.top).toBe("56px");
  });

  it("swallows the click that follows a drag so it cannot hit the content underneath", () => {
    const { container } = renderPet();
    const underlying = container.parentElement ?? document.body;
    const onClick = rs.fn();
    underlying.addEventListener("click", onClick);

    fireEvent.pointerDown(window, {
      altKey: true,
      pointerId: 5,
      clientX: 400,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 360, clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 5, clientX: 360, clientY: 140 });
    fireEvent.click(underlying);

    expect(onClick).not.toHaveBeenCalled();

    // 没有拖拽的手势,点击照常送达
    fireEvent.click(underlying);
    expect(onClick).toHaveBeenCalledTimes(1);

    underlying.removeEventListener("click", onClick);
  });
});
