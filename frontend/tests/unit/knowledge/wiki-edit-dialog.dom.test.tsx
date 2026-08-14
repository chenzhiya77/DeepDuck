/**
 * Wiki entry dual-mode editor (Phase-3 Batch-1 P1): two textareas for main
 * content (replaceable) and supplement layer (persistent), with form validation
 * and audit timestamp display.
 */
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WikiEditDialog } from "@/components/workspace/knowledge/wiki-edit-dialog";
import { I18nContext } from "@/core/i18n/context";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import type { WikiEntryDetail } from "@/core/knowledge/types";

const MOCK_ENTRY: WikiEntryDetail = {
  id: "entry-1",
  kb_id: "kb-1",
  title: "Polymorphism",
  content: "Polymorphism is an OOP feature.",
  supplement_content: "User note: includes overloading and overriding",
  status: "ready",
  source_chunk_ids: ["chunk-1"],
  updated_at: "2026-08-15T10:00:00Z",
};

function renderDialog(entry: WikiEntryDetail | null = MOCK_ENTRY, open = true) {
  const onOpenChange = rs.fn();
  const onSave = rs.fn().mockResolvedValue(undefined);
  render(
    <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => undefined, t: zhCN }}>
      <WikiEditDialog entry={entry} open={open} onOpenChange={onOpenChange} onSave={onSave} />
    </I18nContext.Provider>,
  );
  return { onOpenChange, onSave };
}

afterEach(cleanup);

describe("WikiEditDialog", () => {
  it("renders both textareas when entry is provided", () => {
    renderDialog();
    expect(screen.getByLabelText(/主内容区/)).toBeTruthy();
    expect(screen.getByLabelText(/补充层/)).toBeTruthy();
  });

  it("pre-fills form with existing entry data", () => {
    renderDialog();
    const mainContent = screen.getByLabelText(/主内容区/) as HTMLTextAreaElement;
    const supplement = screen.getByLabelText(/补充层/) as HTMLTextAreaElement;
    expect(mainContent.value).toBe("Polymorphism is an OOP feature.");
    expect(supplement.value).toBe("User note: includes overloading and overriding");
  });

  it("calls onSave with trimmed content and supplement on submit", async () => {
    const { onSave } = renderDialog();

    const mainContent = screen.getByLabelText(/主内容区/) as HTMLTextAreaElement;
    const supplement = screen.getByLabelText(/补充层/) as HTMLTextAreaElement;

    fireEvent.change(mainContent, { target: { value: "Updated main content  " } });
    fireEvent.change(supplement, { target: { value: "Updated supplement  " } });

    const saveButton = screen.getByRole("button", { name: "保存" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("entry-1", "Updated main content", "Updated supplement");
    });
  });

  it("disables save button when main content is empty", () => {
    renderDialog();

    const mainContent = screen.getByLabelText(/主内容区/) as HTMLTextAreaElement;
    fireEvent.change(mainContent, { target: { value: "" } });

    const saveButton = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("shows audit timestamp when entry has updated_at", () => {
    renderDialog();
    expect(screen.getByText(/最后编辑时间/)).toBeTruthy();
  });

  it("closes dialog after successful save", async () => {
    const { onOpenChange } = renderDialog();

    const saveButton = screen.getByRole("button", { name: "保存" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("handles null supplement_content gracefully", () => {
    const entryWithNullSupplement: WikiEntryDetail = {
      ...MOCK_ENTRY,
      supplement_content: null,
    };
    renderDialog(entryWithNullSupplement);

    const supplement = screen.getByLabelText(/补充层/) as HTMLTextAreaElement;
    expect(supplement.value).toBe("");
  });

  it("sends null when supplement is trimmed to empty string", async () => {
    const { onSave } = renderDialog();

    const supplement = screen.getByLabelText(/补充层/) as HTMLTextAreaElement;
    fireEvent.change(supplement, { target: { value: "   " } }); // Only whitespace

    const saveButton = screen.getByRole("button", { name: "保存" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        "entry-1",
        "Polymorphism is an OOP feature.",
        null, // Should send null for empty supplement
      );
    });
  });
});
