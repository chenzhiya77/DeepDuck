"use client";

/**
 * 添加考题 dialog（2026-08-27 spec §4.4，plan Task 6）：简化表单——
 * query + category + expected_path 必填、reference_answer 可选；分类/路径
 * 默认取第一项，无空占位项（2026-08-28 用户反馈）。不暴露
 * relevant_chunk_ids / relevant_entities 输入：手填 chunk id 痛苦且无意义，
 * 锚定的正确来源是召回面板「存为考题」（§7.1）；提交体不含锚定键，后端补
 * 空数组即无锚定题（Layer 1 仅参与路径判定）。编辑不支持（§4.2 规则 5）。
 */
import { Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { useAddEvalQuestion } from "@/core/knowledge/hooks";

export interface EvalAddQuestionDialogProps {
  kbId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_OPTIONS = ["fact", "relation", "concept", "global"] as const;
const PATH_OPTIONS = ["vector", "graph", "wiki"] as const;

export function EvalAddQuestionDialog({ kbId, open, onOpenChange }: EvalAddQuestionDialogProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const dtk = etk.questions.addDialog;
  const addMutation = useAddEvalQuestion(kbId);

  // 分类/预期路径必填，默认取第一项——不设空占位项（2026-08-28 用户反馈：
  // 下拉框里的空行观感差且易误选）。
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("fact");
  const [expectedPath, setExpectedPath] = useState<(typeof PATH_OPTIONS)[number]>("vector");
  const [referenceAnswer, setReferenceAnswer] = useState("");

  const canSubmit = query.trim().length > 0;

  const handleClose = (next: boolean) => {
    if (!next) {
      setQuery("");
      setCategory("fact");
      setExpectedPath("vector");
      setReferenceAnswer("");
    }
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await addMutation.mutateAsync({
        query: query.trim(),
        category,
        expected_path: expectedPath,
        // 锚定键不出现在提交体（测试钉死）；无参考答案显式 null
        reference_answer: referenceAnswer.trim() ? referenceAnswer.trim() : null,
      });
      toast.success(etk.questions.addedToast);
      handleClose(false);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : etk.questions.saveFailed);
    }
  };

  return (
    <Dialog onOpenChange={handleClose} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dtk.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{dtk.queryLabel}</span>
            <textarea
              aria-label={dtk.queryLabel}
              className="border-input min-h-16 rounded-md border bg-transparent px-3 py-2 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              value={query}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{dtk.categoryLabel}</span>
              {/* shadcn Select（agent-settings-dialog 先例）——样式与选项悬停态与全站一致；默认首项无空占位（2026-08-28 反馈） */}
              <Select onValueChange={(value) => setCategory(value as typeof category)} value={category}>
                <SelectTrigger aria-label={dtk.categoryLabel} className="w-full">
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
              <span className="text-sm font-medium">{dtk.expectedPathLabel}</span>
              <Select onValueChange={(value) => setExpectedPath(value as typeof expectedPath)} value={expectedPath}>
                <SelectTrigger aria-label={dtk.expectedPathLabel} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PATH_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{dtk.referenceAnswerLabel}</span>
            <textarea
              aria-label={dtk.referenceAnswerLabel}
              className="border-input min-h-16 rounded-md border bg-transparent px-3 py-2 text-sm"
              onChange={(event) => setReferenceAnswer(event.target.value)}
              value={referenceAnswer}
            />
          </label>
          {/* ⓘ 说明：无锚定题的评测口径（不长篇 inline，spec §4.4） */}
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Tooltip>
              <TooltipTrigger asChild>
                <Info aria-label={dtk.unanchoredNote} className="size-3.5 shrink-0" />
              </TooltipTrigger>
              <TooltipContent className="max-w-60 text-pretty">{dtk.unanchoredNote}</TooltipContent>
            </Tooltip>
            {dtk.unanchoredNote}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => handleClose(false)} variant="outline">
            {dtk.cancel}
          </Button>
          <Button disabled={!canSubmit || addMutation.isPending} onClick={handleSubmit}>
            {dtk.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
