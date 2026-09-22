/**
 * Eval tab phase 2 (plan 2026-08-27 Task 9): the bank view renders the question
 * table, a mocked 202 trigger enters the running state, and the drain edge flips
 * the banner back to the idle summary and refetches the eval queries.
 *
 * Why the drain case lives here: the live smoke could not observe it — the
 * in-app browser window stays hidden, and TanStack Query pauses
 * `refetchInterval` while the window is unfocused, so the poll never sees
 * `in_flight: true → false`. Playwright's page is visible, so the interval runs.
 */

import { expect, test, type Page } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const KB_ID = "kb-eval-e2e";
const KB_NAME = "E2E KB";
const RUN_ID = "rag-20260923T000000Z-e2e";
const QUESTION = "Which sensor row is anchored?";

const RUNNING_PROGRESS = {
  run_id: RUN_ID,
  phase: "layer1" as const,
  done: 0,
  total: 1,
  failed: 0,
  started_at: "2026-09-23T00:00:00+00:00",
  updated_at: "2026-09-23T00:00:00+00:00",
  phase_started_at: "2026-09-23T00:00:00.000+00:00",
};

const COMPLETED_RUN = {
  run_id: RUN_ID,
  created_at: "2026-09-23T00:00:00+00:00",
  completed_at: "2026-09-23T00:00:06+00:00",
  environment: "local" as const,
  status: "completed" as const,
  is_baseline: false,
  has_layer1: true,
  has_layer2: false,
  regression_detected: false,
  langfuse_trace_url: null,
};

type EvalState = {
  triggered: boolean;
  listReadsAfterTrigger: number;
  triggers: number;
  lastTriggerBody: unknown;
};

/** Mocks every knowledge-base endpoint the eval tab touches; nothing escapes to the real backend. */
async function mockEvalBackend(page: Page): Promise<EvalState> {
  mockLangGraphAPI(page, { threads: [] });
  const state: EvalState = {
    triggered: false,
    listReadsAfterTrigger: 0,
    triggers: 0,
    lastTriggerBody: null,
  };

  const kbPath = (suffix: string) => (url: URL) =>
    url.pathname === `/api/knowledge-bases/${KB_ID}${suffix}`;

  await page.route(
    (url) => url.pathname === "/api/knowledge-bases",
    (route) =>
      route.fulfill({
        json: [
          {
            id: KB_ID,
            owner_id: "default",
            name: KB_NAME,
            description: "",
            visibility: "private",
            created_at: "2026-09-22T00:00:00+00:00",
          },
        ],
      }),
  );

  await page.route(kbPath(""), (route) =>
    route.fulfill({
      json: {
        id: KB_ID,
        owner_id: "default",
        name: KB_NAME,
        description: "",
        visibility: "private",
        created_at: "2026-09-22T00:00:00+00:00",
      },
    }),
  );

  await page.route(kbPath("/documents"), (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(kbPath("/wiki/entries"), (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(kbPath("/wiki/generate-status"), (route) =>
    route.fulfill({
      json: { in_progress: false, generated_at: null, entry_count: 0 },
    }),
  );

  await page.route(kbPath("/eval/questions"), (route) =>
    route.fulfill({
      json: {
        questions: [
          {
            id: "q_e2e",
            query: QUESTION,
            expected_paths: ["vector"],
            relevant_chunk_ids: ["doc-e2e#0000"],
            relevant_entities: [],
            category: "fact",
            reference_answer: null,
          },
        ],
        total: 1,
      },
    }),
  );

  await page.route(kbPath("/eval/questions/synthesize"), (route) =>
    route.fulfill({
      json: {
        in_progress: false,
        candidates: [],
        generated_at: null,
        doc_id: null,
        dropped: 0,
      },
    }),
  );

  await page.route(kbPath("/eval-runs"), (route) => {
    if (route.request().method() === "POST") {
      state.triggers += 1;
      state.lastTriggerBody = route.request().postDataJSON();
      state.triggered = true;
      return route.fulfill({ status: 202, json: { status: "enqueued" } });
    }
    if (state.triggered) state.listReadsAfterTrigger += 1;
    const running = state.triggered && state.listReadsAfterTrigger <= 1;
    return route.fulfill({
      json: running
        ? { in_flight: true, progress: RUNNING_PROGRESS, runs: [], total: 0 }
        : {
            in_flight: false,
            progress: null,
            runs: state.triggered ? [COMPLETED_RUN] : [],
            total: state.triggered ? 1 : 0,
          },
    });
  });

  await page.route(kbPath("/eval-runs/latest"), (route) =>
    route.fulfill({ json: { kb_id: KB_ID, layer1: null, layer2: null } }),
  );
  await page.route(kbPath("/eval-runs/trend"), (route) =>
    route.fulfill({
      json: {
        points: [],
        baseline: null,
        has_data: false,
        sparks: {
          faithfulness: [],
          answer_relevancy: [],
          context_precision: [],
          context_recall: [],
          citation_precision: [],
          citation_recall: [],
          seed_hit_rate: [],
          routing_hit_rate: [],
        },
      },
    }),
  );

  return state;
}

/**
 * `/workspace/*` is guarded by a **server-side** `getServerSideUser()` redirect
 * that `page.route` cannot intercept, so an auth-enabled server needs a real
 * session. Register a throwaway account, exactly like
 * `tests/e2e-real-backend/real-backend-render.spec.ts` does. An auth-disabled
 * server (CI) asks for no session and has no gateway behind the route, so any
 * failure here is tolerated.
 */
async function ensureSession(page: Page) {
  const email = `e2e-eval-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.request
    .post("/api/v1/auth/register", {
      data: { email, password: "very-strong-password-123" },
      failOnStatusCode: false,
    })
    .catch(() => null);
}

async function openEvalTab(page: Page) {
  // The eval toolbar collapses its action buttons into a ⋯ menu once it overflows
  // (`useToolbarTier`); a wide viewport keeps the run button visible.
  await page.setViewportSize({ width: 1680, height: 960 });
  await ensureSession(page);
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: KB_NAME }).first().click();
  await page.getByRole("tab", { name: "Evaluation" }).click();
  await expect(page.getByTestId("eval-tab")).toBeVisible();
}

test("eval tab renders the question bank table", async ({ page }) => {
  await mockEvalBackend(page);
  await openEvalTab(page);

  await page.getByRole("radio", { name: "Questions" }).click();
  await expect(page.getByTestId("eval-questions-content")).toContainText(
    QUESTION,
  );
  await expect(page.getByTestId("eval-questions-content")).toContainText(
    "Fact",
  );
});

test("triggering a run enters the running state and the drain edge restores the idle summary", async ({
  page,
}) => {
  const state = await mockEvalBackend(page);
  await openEvalTab(page);

  // Idle before any run: the never-evaluated line, no progress UI.
  await expect(page.getByTestId("eval-run-banner")).toContainText(
    "Not yet evaluated",
  );
  await expect(page.getByTestId("eval-banner-log")).toHaveCount(0);

  await page.getByRole("button", { name: "Quick evaluation" }).click();

  // Running state: the optimistic in_flight flip turns the bar into the progress
  // variant and swaps the tier chevron slot for the two-step cancel button.
  await expect(page.getByTestId("eval-banner-log")).toBeVisible();
  await expect(page.getByTestId("eval-cancel-button")).toBeVisible();
  expect(state.triggers).toBe(1);
  expect(state.lastTriggerBody).toMatchObject({ layers: "l1" });

  // Drain edge (poll sees in_flight true → false): banner morphs back and the
  // three eval queries are invalidated, so the completed run reaches the slot.
  await expect(page.getByTestId("eval-cancel-button")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("eval-slot-text")).toContainText(
    /Quick evaluation · took/,
  );

  await page.getByRole("radio", { name: "History" }).click();
  await expect(page.getByTestId(`eval-run-row-${RUN_ID}`)).toBeVisible();
});
