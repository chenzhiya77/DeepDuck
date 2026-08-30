/**
 * Doc failure notifications (2026-08-30): errors never live in the table —
 * when polling observes a document transition into ``failed``, one aggregated
 * toast fires (same-cycle failures fold into a single entry, a document is
 * announced once per failure episode, and already-failed rows at first load
 * never backfire). Mirrors mainstream transient-notification practice
 * (Drive/Explorer: summary + folded detail, dismissible, auto-expiring).
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";
import { toast } from "sonner";

rs.mock("sonner", () => ({
  toast: { error: rs.fn(), success: rs.fn(), info: rs.fn() },
}));

import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { KnowledgeDocument } from "@/core/knowledge/types";
import { useDocFailureToasts } from "@/core/knowledge/use-doc-failure-toasts";

function doc(partial: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: "doc-1",
    kb_id: "kb-1",
    uploader_id: "user-1",
    name: "户号.pptx",
    size_bytes: 0,
    storage_path: "p",
    status: "indexing",
    progress_percent: 50,
    chunk_count: null,
    error: null,
    path_status: null,
    content_hash: null,
    created_at: "2026-08-30T10:00:00Z",
    ...partial,
  };
}

function Harness({ documents }: { documents: KnowledgeDocument[] }) {
  useDocFailureToasts(documents);
  return null;
}

function renderHook(documents: KnowledgeDocument[]) {
  return render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <Harness documents={documents} />
    </I18nContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("useDocFailureToasts", () => {
  it("首次载入已失败的文档不补发通知（只报新发生的失败）", () => {
    renderHook([doc({ status: "failed", error: "retry limit reached (5 attempts)" })]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("轮询到新失败：一条汇总 toast，标题 + 友好文案，原始英文不外露", () => {
    const { rerender } = renderHook([doc({})]);
    rerender(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <Harness documents={[doc({ status: "failed", error: "retry limit reached (5 attempts), please try again later" })]} />
      </I18nContext.Provider>,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, options] = rs.mocked(toast.error).mock.calls[0] as [string, { description: string }];
    expect(title).toBe("文档处理失败");
    expect(options.description).toContain("户号.pptx");
    expect(options.description).toContain("解析服务多次重试仍失败");
    expect(options.description).not.toContain("retry limit");
  });

  it("同一周期多个失败折叠成一条（文件名 + 各自的友好原因）", () => {
    const { rerender } = renderHook([doc({}), doc({ id: "doc-2", name: "报告.docx" })]);
    rerender(
      <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
        <Harness
          documents={[
            doc({ status: "failed", error: "retry limit reached (5 attempts)" }),
            doc({ id: "doc-2", name: "报告.docx", status: "failed", error: "MinerU parse timed out after 1800s" }),
          ]}
        />
      </I18nContext.Provider>,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [, options] = rs.mocked(toast.error).mock.calls[0] as [string, { description: string }];
    expect(options.description).toContain("户号.pptx");
    expect(options.description).toContain("报告.docx");
    expect(options.description).toContain("解析超时");
  });

  it("同一失败只提醒一次；重试后再次失败会重新提醒", () => {
    const { rerender } = renderHook([doc({})]);
    const renderWith = (documents: KnowledgeDocument[]) =>
      rerender(
        <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
          <Harness documents={documents} />
        </I18nContext.Provider>,
      );

    renderWith([doc({ status: "failed", error: "retry limit reached" })]);
    expect(toast.error).toHaveBeenCalledTimes(1);

    // 相同数据再来一轮轮询：不重复
    renderWith([doc({ status: "failed", error: "retry limit reached" })]);
    expect(toast.error).toHaveBeenCalledTimes(1);

    // 用户点重试：状态离开 failed 回处理中，再次失败属于新的一轮，应重新提醒
    renderWith([doc({ status: "uploaded", error: null })]);
    renderWith([doc({ status: "failed", error: "retry limit reached" })]);
    expect(toast.error).toHaveBeenCalledTimes(2);
  });
});
