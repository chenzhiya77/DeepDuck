"use client";

/**
 * 存为考题 dialog（2026-08-27 spec §7.1，plan Task 8）：召回面板勾选切片后
 * 的一键入题库——query 预填当前输入（可改），category 必填（shadcn Select，
 * 默认 fact），预期路径多路化（2026-08-28 §3，Task 9）：三项 Checkbox 组，
 * 默认勾选 = 勾选来源路径集合（混路即多勾，不再降级单路），至少一路才可
 * 提交；reference_answer 可选；relevant_chunk_ids = 勾选 chunk 集（造题主入
 * 口，题库随使用自然生长）。保存成功清勾选继续标注下一题——**不跳视图**。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { RecallPathName } from "@/core/knowledge/types";

export interface EvalSaveQuestionDialogProps {
  kbId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾选的 chunk id 集（提交体 relevant_chunk_ids）。 */
  selectedChunkIds: string[];
  /** 默认勾选路径集合：勾选来源路径；混路即多勾（面板推导，2026-08-28）。 */
  defaultPaths: RecallPathName[];
  /** query 预填值（当前检索输入）。 */
  prefillQuery: string;
  /** 保存成功回调（面板清勾选）。 */
  onSaved?: () => void;
}

const CATEGORY_OPTIONS = ["fact", "relation", "concept", "global"] as const;
const PATH_OPTIONS = ["vector", "graph", "wiki"] as const;

export function EvalSaveQuestionDialog({
  kbId,
  open,
  onOpenChange,
  selectedChunkIds,
  defaultPaths,
  prefillQuery,
  onSaved,
}: EvalSaveQuestionDialogProps) {
  const { t } = useI18n();
  const stk = t.knowledge.recallTest.saveAsQuestion;
  const etk = t.knowledge.eval;
  const addMutation = useAddEvalQuestion(kbId);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("fact");
  const [expectedPaths, setExpectedPaths] = useState<RecallPathName[]>(defaultPaths);
  const [referenceAnswer, setReferenceAnswer] = useState("");

  // 每次打开重置为预填值与默认勾选（上一题的选择不残留）
  useEffect(() => {
    if (open) {
      setQuery(prefillQuery);
      setCategory("fact");
      setExpectedPaths(defaultPaths);
      setReferenceAnswer("");
    }
  }, [open, prefillQuery, defaultPaths]);

  const togglePath = (path: RecallPathName) =>
    setExpectedPaths((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));

  // 至少勾一路（后端 min_length=1）+ query 非空 + 有勾选切片。
  const canSubmit = query.trim().length > 0 && selectedChunkIds.length > 0 && expectedPaths.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await addMutation.mutateAsync({
        query: query.trim(),
        category,
        // 勾选顺序即提交顺序；后端去重保序（§3）。
        expected_paths: expectedPaths,
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
              <span className="text-sm font-medium">{stk.expectedPathsLabel}</span>
              {/* 多路 Checkbox 组（2026-08-28 §3）：任一路承担即对，至少勾一路。 */}
              <div className="flex items-center gap-3 pt-1.5">
                {PATH_OPTIONS.map((path) => (
                  <label key={path} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <Checkbox checked={expectedPaths.includes(path)} onCheckedChange={() => togglePath(path)} />
                    {path}
                  </label>
                ))}
              </div>
            </div>
          </div>
          {/* 锚定辅助定位文案（2026-08-28 §5/§7）：勾选集即锚定集。 */}
          <p className="text-muted-foreground text-xs">{stk.anchorHint}</p>
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
