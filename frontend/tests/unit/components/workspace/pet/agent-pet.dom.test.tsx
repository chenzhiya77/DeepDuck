import type { BaseStream } from "@langchain/langgraph-sdk/react";
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ThreadContext } from "@/components/workspace/messages/context";
import { AgentPet } from "@/components/workspace/pet/agent-pet";
import {
  DEFAULT_LOCAL_SETTINGS,
  LOCAL_SETTINGS_KEY,
} from "@/core/settings/local";
import { updateLocalSettings } from "@/core/settings/store";
import type { AgentThreadState } from "@/core/threads";

const PANEL = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
// 只为还原,从不直接调用,故 unbound-method 在此不适用
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRect = Element.prototype.getBoundingClientRect;

function fakeThread(): BaseStream<AgentThreadState> {
  return {
    values: { title: "t", messages: [] },
    messages: [],
    isLoading: false,
    error: undefined,
  } as unknown as BaseStream<AgentThreadState>;
}

function renderPet(threadId = "thread-1") {
  return render(
    <ThreadContext.Provider value={{ thread: fakeThread() }}>
      <AgentPet threadId={threadId} />
    </ThreadContext.Provider>,
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
    Element.prototype.getBoundingClientRect = () => PANEL as DOMRect;
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
    Element.prototype.getBoundingClientRect = () => PANEL as DOMRect;
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
    Element.prototype.getBoundingClientRect = () => PANEL as DOMRect;
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
    Element.prototype.getBoundingClientRect = () => PANEL as DOMRect;
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
    Element.prototype.getBoundingClientRect = () => PANEL as DOMRect;
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
