import { describe, expect, test } from "@rstest/core";

import { derivePetState, type PetSignals } from "@/core/pet/state";

function signals(overrides: Partial<PetSignals> = {}): PetSignals {
  return {
    isLoading: false,
    wasLoading: false,
    hasError: false,
    hasOpenHumanInputRequest: false,
    activeToolNames: [],
    fatigue: 0,
    ...overrides,
  };
}

describe("derivePetState decision tree", () => {
  test("idle while nothing is happening", () => {
    expect(derivePetState(signals())).toEqual({
      base: "idle",
      workKind: null,
      fatigue: 0,
      oneShot: null,
    });
  });

  test("think while a run is in flight with no tool call out", () => {
    expect(derivePetState(signals({ isLoading: true }))).toEqual({
      base: "think",
      workKind: null,
      fatigue: 0,
      oneShot: null,
    });
  });

  test("work with the most significant in-flight tool kind", () => {
    expect(
      derivePetState(signals({ isLoading: true, activeToolNames: ["read_file", "bash"] })),
    ).toEqual({
      base: "work",
      workKind: "exec",
      fatigue: 0,
      oneShot: null,
    });
  });

  test("work falls back to generic for unknown in-flight tools", () => {
    expect(
      derivePetState(signals({ isLoading: true, activeToolNames: ["github_list_prs"] })),
    ).toEqual({
      base: "work",
      workKind: "generic",
      fatigue: 0,
      oneShot: null,
    });
  });

  test("wait while a human input request is open and nothing is running", () => {
    expect(
      derivePetState(signals({ hasOpenHumanInputRequest: true })),
    ).toEqual({
      base: "wait",
      workKind: null,
      fatigue: 0,
      oneShot: null,
    });
  });

  test("error while the thread is in error", () => {
    expect(derivePetState(signals({ hasError: true }))).toEqual({
      base: "error",
      workKind: null,
      fatigue: 0,
      oneShot: null,
    });
  });

  test("done plays on the falling edge of isLoading", () => {
    expect(derivePetState(signals({ wasLoading: true }))).toEqual({
      base: "idle",
      workKind: null,
      fatigue: 0,
      oneShot: "done",
    });
  });

  test("no done when the run was already settled", () => {
    expect(derivePetState(signals({ wasLoading: false })).oneShot).toBeNull();
  });

  test("carries the fatigue level through every branch", () => {
    const fatigue = 3;
    expect(derivePetState(signals({ fatigue })).fatigue).toBe(fatigue);
    expect(derivePetState(signals({ fatigue, isLoading: true })).fatigue).toBe(fatigue);
    expect(
      derivePetState(signals({ fatigue, isLoading: true, activeToolNames: ["task"] })).fatigue,
    ).toBe(fatigue);
    expect(
      derivePetState(signals({ fatigue, hasOpenHumanInputRequest: true })).fatigue,
    ).toBe(fatigue);
    expect(derivePetState(signals({ fatigue, hasError: true })).fatigue).toBe(fatigue);
  });

  test("only the work branch carries a work kind", () => {
    expect(derivePetState(signals({ isLoading: true })).workKind).toBeNull();
    expect(
      derivePetState(signals({ hasOpenHumanInputRequest: true })).workKind,
    ).toBeNull();
    expect(derivePetState(signals({ hasError: true })).workKind).toBeNull();
    expect(derivePetState(signals({ wasLoading: true })).workKind).toBeNull();
  });
});

// spec §5.3 pins these three; each has its own test so a neutered branch
// fails exactly one of them.
describe("derivePetState invariants (spec §5.3)", () => {
  test("1. error outranks everything and suppresses done", () => {
    const state = derivePetState(
      signals({
        hasError: true,
        wasLoading: true,
        isLoading: false,
        hasOpenHumanInputRequest: true,
        activeToolNames: ["bash"],
      }),
    );

    expect(state.base).toBe("error");
    expect(state.oneShot).toBeNull();
  });

  test("2. a running turn wins over an unanswered request", () => {
    const withTool = derivePetState(
      signals({
        isLoading: true,
        hasOpenHumanInputRequest: true,
        activeToolNames: ["read_file"],
      }),
    );
    expect(withTool.base).toBe("work");

    const withoutTool = derivePetState(
      signals({ isLoading: true, hasOpenHumanInputRequest: true }),
    );
    expect(withoutTool.base).toBe("think");
  });

  test("3. done fires only on the transition into idle", () => {
    const intoIdle = derivePetState(signals({ wasLoading: true }));
    expect(intoIdle.base).toBe("idle");
    expect(intoIdle.oneShot).toBe("done");

    const intoWait = derivePetState(
      signals({ wasLoading: true, hasOpenHumanInputRequest: true }),
    );
    expect(intoWait.base).toBe("wait");
    expect(intoWait.oneShot).toBeNull();

    const intoError = derivePetState(signals({ wasLoading: true, hasError: true }));
    expect(intoError.base).toBe("error");
    expect(intoError.oneShot).toBeNull();
  });
});
