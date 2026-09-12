import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

import { parseDeliveryReceipt } from "./parse";
import type { DeliveryReceipt, RunEventRow } from "./types";

/**
 * The one read the delivery line needs: the run's terminal receipt.
 *
 * Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §5.
 * `run.delivery` is written once per run through an idempotent write, so a small
 * limit is enough.
 */
const DELIVERY_LIMIT = 5;
/**
 * The receipt is written when the run ends, while the card asks as soon as it
 * knows the run id — so an empty answer means "not yet" far more often than it
 * means "never". The caller caches the result for the run's lifetime
 * (`staleTime: Infinity`: a receipt is a terminal fact), which would otherwise
 * freeze a raced empty answer and hide the verdict for the whole run. Bounded: a
 * run that truly has no receipt costs these attempts once.
 */
const RECEIPT_ATTEMPTS = 6;
const RECEIPT_RETRY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The run's delivery receipt, or null when this run published none. */
export async function fetchDelivery(
  threadId: string,
  runId: string,
): Promise<DeliveryReceipt | null> {
  const params = new URLSearchParams({
    event_types: "run.delivery",
    limit: String(DELIVERY_LIMIT),
  });
  const url = `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/events?${params.toString()}`;

  for (let attempt = 1; attempt <= RECEIPT_ATTEMPTS; attempt += 1) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch run events: ${res.status}`);
    }
    const receipt = parseDeliveryReceipt((await res.json()) as RunEventRow[]);
    if (receipt !== null || attempt === RECEIPT_ATTEMPTS) {
      return receipt;
    }
    await delay(RECEIPT_RETRY_MS);
  }
  return null;
}
