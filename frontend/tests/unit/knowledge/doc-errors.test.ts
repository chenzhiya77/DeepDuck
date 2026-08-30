/**
 * Document error productization (2026-08-30): the raw ``doc.error`` stored by
 * the worker is an English exception string ("retry limit reached (5
 * attempts)…"). Users never see it — the classifier maps known patterns to a
 * localized friendly kind, and everything renders through i18n copy.
 */
import { describe, expect, it } from "@rstest/core";

import { classifyDocError } from "@/core/knowledge/doc-errors";

describe("classifyDocError", () => {
  it("maps the empty-file rejection (backend upload gate)", () => {
    expect(classifyDocError("file is empty: 户号.pptx")).toBe("empty");
  });

  it("maps MinerU's exhausted-retry verdict — the original 户号.pptx failure", () => {
    expect(classifyDocError("retry limit reached (5 attempts), please try again later")).toBe("retryLimit");
  });

  it("maps the missing-token config error", () => {
    expect(classifyDocError("MINERU_API_TOKEN is not set; add it to .env (see .env.example)")).toBe("serviceUnconfigured");
  });

  it("maps parse timeouts", () => {
    expect(classifyDocError("MinerU parse timed out after 1800s (batch 123)")).toBe("timeout");
  });

  it("maps unsupported-type rejections", () => {
    expect(classifyDocError("unsupported file type '.exe'; supported formats: .csv, .doc")).toBe("unsupported");
  });

  it("classifies case-insensitively", () => {
    expect(classifyDocError("FILE IS EMPTY: x.PDF")).toBe("empty");
    expect(classifyDocError("Retry Limit Reached (5 attempts)")).toBe("retryLimit");
  });

  it("falls back to unknown for null/empty/unrecognized text", () => {
    expect(classifyDocError(null)).toBe("unknown");
    expect(classifyDocError(undefined)).toBe("unknown");
    expect(classifyDocError("")).toBe("unknown");
    expect(classifyDocError("some brand new explosion")).toBe("unknown");
  });
});
