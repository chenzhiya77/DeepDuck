"use client";

/**
 * 存为考题 dialog（2026-08-27 spec §7.1，plan Task 8）：召回面板勾选切片后
 * 的一键入题库——query 预填当前输入（可改），category/expected_path 必填
 * （shadcn Select，默认 fact / 勾选来源路径，混路默认 vector），
 * reference_answer 可选；relevant_chunk_ids = 勾选 chunk 集（造题主入口，
 * 题库随使用自然生长）。保存成功清勾选继续标注下一题——**不跳视图**。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import { useAddEvalQuestion } from "@/core/knowledge/hooks";

export interface EvalSaveQuestionDialogProps {
  kbId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾选的 chunk id 集（提交体 relevant_chunk_ids）。 */
  selectedChunkIds: string[];
  /** 默认预期路径：勾选来源路径；混路默认 vector（面板推导）。 */
  defaultPath: "vector" | "graph" | "wiki";
  /** query 预填值（当前检索输入）。 */
  prefillQuery: string;
  /** 保存成功回调（面板清勾选）。 */
  onSaved?: () => void;
}

const CATEGORY_OPTIONS = ["fact", "relation", "concept", "global"] as const;

export function EvalSaveQuestionDialog({
  kbId,
  open,
  onOpenChange,
  selectedChunkIds,
  defaultPath,
  prefillQuery,
  onSaved,
}: EvalSaveQuestionDialogProps) {
  const { t } = useI18n();
  const stk = t.knowledge.recallTest.saveAsQuestion;
  const etk = t.knowledge.eval;
  const addMutation = useAddEvalQuestion(kbId);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("fact");
  const [expectedPath, setExpectedPath] = useState<"vector" | "graph" | "wiki">(defaultPath);
  const [referenceAnswer, setReferenceAnswer] = useState("");

  // 每次打开重置为预填值与默认选择（上一题的选择不残留）
  useEffect(() => {
    if (open) {
      setQuery(prefillQuery);
      setCategory("fact");
      setExpectedPath(defaultPath);
      setReferenceAnswer("");
    }
  }, [open, prefillQuery, defaultPath]);

  const canSubmit = query.trim().length > 0 && selectedChunkIds.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await addMutation.mutateAsync({
        query: query.trim(),
        category,
        expected_path: expectedPath,
        relevant_chunk_ids: selectedChunkIds,
        reference_answer: referenceAnswer.trim() ? referenceAnswer.trim() : null,
      });
      toast.success(stk.savedToast);
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : stk.saveFailed);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stk.button}</DialogTitle>
          <DialogDescription>{stk.selectedCount(selectedChunkIds.length)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{stk.queryLabel}</span>
            <textarea
              aria-label={stk.queryLabel}
              className="border-input min-h-16 rounded-md border bg-transparent px-3 py-2 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              value={query}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{stk.categoryLabel}</span>
              <Select onValueChange={(value) => setCategory(value as typeof category)} value={category}>
                <SelectTrigger aria-label={stk.categoryLabel} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {etk.category[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{stk.expectedPathLabel}</span>
              <Select onValueChange={(value) => setExpectedPath(value as typeof expectedPath)} value={expectedPath}>
                <SelectTrigger aria-label={stk.expectedPathLabel} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["vector", "graph", "wiki"] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{stk.referenceAnswerLabel}</span>
            <textarea
              aria-label={stk.referenceAnswerLabel}
              className="border-input min-h-16 rounded-md border bg-transparent px-3 py-2 text-sm"
              onChange={(event) => setReferenceAnswer(event.target.value)}
              value={referenceAnswer}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {stk.cancel}
          </Button>
          <Button disabled={!canSubmit || addMutation.isPending} onClick={handleSubmit}>
            {stk.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
