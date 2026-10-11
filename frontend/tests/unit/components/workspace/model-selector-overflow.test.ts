import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

const FRONTEND_ROOT = path.resolve(__dirname, "../../../..");
// 名字 span 可带属性（面板的 D14 内容驱动窄档给 span 上了 ref/data-testid），
// 故 className 前容许属性段、不要求「一键字面量」。
const SELECTED_MODEL_WRAPPER_PATTERN =
  /<ModelPickerTrigger asChild>[\s\S]*?<div className="([^"]*)">\s*<span(?:\s[^>]*)?className="flex-1 truncate text-left text-xs font-normal"/;

function source(relativePath: string) {
  return readFileSync(path.join(FRONTEND_ROOT, relativePath), "utf8");
}

function selectedModelWrapperClasses(relativePath: string) {
  return SELECTED_MODEL_WRAPPER_PATTERN.exec(source(relativePath))?.[1]?.split(
    /\s+/,
  );
}

describe("selected model name truncation", () => {
  it.each([
    "src/components/workspace/input-box.tsx",
    "src/components/workspace/sidecar/sidecar-panel.tsx",
    "src/components/workspace/knowledge/chat-panel.tsx",
  ])("lets the selected model name stretch in %s", (relativePath) => {
    const classes = selectedModelWrapperClasses(relativePath);

    expect(classes).toEqual(
      expect.arrayContaining(["flex", "min-w-0", "flex-col"]),
    );
    expect(classes).not.toContain("items-start");
  });
});

describe("model picker integration", () => {
  it.each([
    {
      relativePath: "src/components/workspace/input-box.tsx",
      open: "modelDialogOpen",
      // 主树分叉（spec 2026-10-08 models-list-grouping §2④）：三处 chat picker
      // 的候选先过 chatPickerOptions（隐藏模型不进下拉）——上游裸传 models。
      models: "chatPickerOptions(models)",
      selectedModelName: "selectedModel?.name",
      onModelSelect: "handleModelSelect",
    },
    {
      relativePath: "src/components/workspace/sidecar/sidecar-panel.tsx",
      open: "open",
      models: "chatPickerOptions(models)",
      selectedModelName: "selectedModel.name",
      onModelSelect: "onModelSelect",
    },
    {
      relativePath: "src/components/workspace/knowledge/chat-panel.tsx",
      open: "modelDialogOpen",
      models: "chatPickerOptions(models)",
      selectedModelName: "selectedModelName ?? undefined",
      onModelSelect: "handleModelSelect",
    },
  ])(
    "uses ModelPickerContent inside the anchored picker in $relativePath",
    ({ relativePath, open, models, selectedModelName, onModelSelect }) => {
      const contents = source(relativePath);
      const picker = /<ModelPickerContent[\s\S]*?\/>/.exec(contents)?.[0];

      expect(contents).toMatch(/<ModelPicker\s/);
      expect(contents).toContain("<ModelPickerTrigger asChild>");
      expect(picker).toBeDefined();
      expect(picker).toMatch(
        new RegExp(`open=\\{${open.replace(/\?/g, "\\?")}\\}`),
      );
      expect(picker).toMatch(
        new RegExp(`models=\\{${models.replace(/[()]/g, "\\$&")}\\}`),
      );
      expect(picker).toMatch(
        new RegExp(
          `selectedModelName=\\{${selectedModelName.replace(/\?/g, "\\?")}\\}`,
        ),
      );
      expect(picker).toMatch(
        new RegExp(`onModelSelect=\\{${onModelSelect}\\}`),
      );
      for (const legacyComponent of [
        "ModelSelectorName",
        "ModelSelectorContent",
        "ModelSelectorInput",
        "ModelSelectorList",
        "ModelSelectorItem",
      ]) {
        expect(contents).not.toContain(`<${legacyComponent}`);
      }
    },
  );
});
