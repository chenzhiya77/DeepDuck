import { beforeEach, describe, expect, it, rs } from "@rstest/core";

rs.mock("@/core/api/fetcher", () => ({ fetch: rs.fn() }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));

import { fetch as fetcher } from "@/core/api/fetcher";
import { fetchConstitution } from "@/core/constitution/api";
import { parseConstitution } from "@/core/constitution/parse";

const mockedFetch = rs.mocked(fetcher);

/**
 * Reading the snapshot off the run events route.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §4.2.
 * The retry is the load-bearing part: the page learns a run's id from the live
 * stream and asks immediately, but that run's first `run.start` lands a moment
 * later (measured 0.17–2.2 s). A single empty answer would be held for the rest
 * of the run, because the caller caches the result for the run's lifetime.
 */
const RECORD = {
  schema_version: 1,
  stages: [
    { key: "intake", loop: false, members: 2, gates: 0, handoff_gates: 0 },
  ],
  middlewares: [{ name: "ThreadDataMiddleware", stage: "intake" }],
};

function rowsResponse(rows: unknown): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const runStartRow = {
  event_type: "run.start",
  content: { chain: "root", constitution: RECORD },
  seq: 1,
};

describe("fetchConstitution", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("reads the snapshot when the event is already there", async () => {
    mockedFetch.mockResolvedValue(rowsResponse([runStartRow]));

    expect(await fetchConstitution("t", "r")).toEqual(
      parseConstitution([runStartRow]),
    );
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("re-asks when the run has not published its run.start yet", async () => {
    let call = 0;
    mockedFetch.mockImplementation(async () => {
      call += 1;
      return rowsResponse(call >= 3 ? [runStartRow] : []);
    });

    expect(await fetchConstitution("t", "r")).not.toBeNull();
    expect(mockedFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives up on a run that truly has no snapshot", async () => {
    // A fresh Response per call: a body can only be read once.
    mockedFetch.mockImplementation(async () =>
      rowsResponse([{ event_type: "run.start", content: { chain: "root" } }]),
    );

    expect(await fetchConstitution("t", "r")).toBeNull();
    // Bounded: it stops rather than asking for the whole life of the run.
    expect(mockedFetch.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("fails loudly when the route rejects", async () => {
    mockedFetch.mockImplementation(
      async () =>
        new Response("nope", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    await expect(fetchConstitution("t", "r")).rejects.toThrow("500");
  });
});
