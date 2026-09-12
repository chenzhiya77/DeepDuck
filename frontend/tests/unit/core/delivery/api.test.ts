import { beforeEach, describe, expect, it, rs } from "@rstest/core";

rs.mock("@/core/api/fetcher", () => ({ fetch: rs.fn() }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));

import { fetch as fetcher } from "@/core/api/fetcher";
import { fetchDelivery } from "@/core/delivery/api";

const mockedFetch = rs.mocked(fetcher);

/**
 * Reading the receipt off the run events route.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §5.
 * The retry is the load-bearing part: the receipt is written when the run ends,
 * while the card asks as soon as it knows the run id, and the query caches the
 * answer for the run's lifetime — so a single empty answer would hide the
 * verdict for the whole run.
 */
const RECEIPT_ROW = {
  event_type: "run.delivery",
  content: { presented: 0, paths: [], by_tool: {} },
  seq: 9,
};

function rowsResponse(rows: unknown): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchDelivery", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("asks only for the delivery receipt", async () => {
    mockedFetch.mockImplementation(async () => rowsResponse([RECEIPT_ROW]));

    await fetchDelivery("thread-1", "run-1");

    const url = mockedFetch.mock.calls[0]?.[0];
    expect(typeof url === "string" ? url : url?.url).toContain(
      "event_types=run.delivery",
    );
    expect(typeof url === "string" ? url : url?.url).toContain(
      "/api/threads/thread-1/runs/run-1/events",
    );
  });

  it("reads the receipt when it is already there", async () => {
    mockedFetch.mockImplementation(async () => rowsResponse([RECEIPT_ROW]));

    expect(await fetchDelivery("thread-1", "run-1")).not.toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("re-asks while the run has not written its receipt yet", async () => {
    let call = 0;
    mockedFetch.mockImplementation(async () => {
      call += 1;
      return rowsResponse(call >= 3 ? [RECEIPT_ROW] : []);
    });

    expect(await fetchDelivery("thread-1", "run-1")).not.toBeNull();
    expect(mockedFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives up on a run with no receipt, without asking forever", async () => {
    mockedFetch.mockImplementation(async () => rowsResponse([]));

    expect(await fetchDelivery("thread-1", "run-1")).toBeNull();
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

    await expect(fetchDelivery("thread-1", "run-1")).rejects.toThrow("500");
  });
});
