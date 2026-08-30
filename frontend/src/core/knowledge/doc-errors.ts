/**
 * Document error productization (2026-08-30): the raw ``doc.error`` the
 * worker persists is an English exception string ("retry limit reached (5
 * attempts)…"). Users never see it — known patterns map to a friendly kind
 * rendered through i18n copy (``tk.docErrors[kind]``); the raw text no
 * longer appears anywhere in the UI (not even as a hover title).
 */
export type DocErrorKind = "empty" | "unsupported" | "retryLimit" | "serviceUnconfigured" | "timeout" | "unknown";

/** Pattern-ordered classification; case-insensitive substring match. */
export function classifyDocError(error: string | null | undefined): DocErrorKind {
  const text = (error ?? "").toLowerCase();
  if (text.includes("file is empty")) return "empty";
  if (text.includes("unsupported file type")) return "unsupported";
  if (text.includes("retry limit reached")) return "retryLimit";
  if (text.includes("mineru_api_token")) return "serviceUnconfigured";
  if (text.includes("timed out") || text.includes("timeout")) return "timeout";
  return "unknown";
}
