"use client";

/**
 * 合成考题触发 dialog（2026-08-28 spec §6.1，plan Task 11）：单篇文档 +
 * 候选题数（1–10，默认 5）→ POST /eval/questions/synthesize（202 幂等）。
 * 文档下拉只列已索引（ready）文档——后端对无切片文档回 409，前端预过滤
 * 减少误触发。enqueued → success toast 并关闭；already_running → info
 * toast 不关闭（用户可等当前一轮落完）。
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
import { useDocuments, useTriggerSynthesis } from "@/core/knowledge/hooks";

export interface EvalSynthesisDialogProps {
  kbId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function EvalSynthesisDialog({ kbId, open, onOpenChange }: EvalSynthesisDialogProps) {
  const { t } = useI18n();
  const stk = t.knowledge.eval.synthesize;
  const trigger = useTriggerSynthesis(kbId);
  // dialog 打开才拉文档列表（懒门控）；只列已索引文档（无切片必 409）。
  const documents = useDocuments(open ? kbId : null);
  const readyDocs = (documents.data ?? []).filter((doc) => doc.status === "ready");

  const [docId, setDocId] = useState("");
  const [count, setCount] = useState<number>(5);

  // 每次打开重置（上一轮选择不残留）。
  useEffect(() => {
    if (open) {
      setDocId("");
      setCount(5);
    }
  }, [open]);

  const canSubmit = docId !== "" && !trigger.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const response = await trigger.mutateAsync({ doc_id: docId, count });
      if (response.status === "enqueued") {
        toast.success(stk.generating);
        onOpenChange(false);
      } else {
        toast.info(stk.generating);
      }
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : stk.triggerFailed);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stk.dialogTitle}</DialogTitle>
          <DialogDescription>{stk.docPlaceholder}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{stk.docLabel}</span>
              <Select onValueChange={setDocId} value={docId}>
                <SelectTrigger aria-label={stk.docLabel} className="w-full">
                  <SelectValue placeholder={stk.docPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {readyDocs.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{stk.countLabel}</span>
              <Select onValueChange={(value) => setCount(Number(value))} value={String(count)}>
                <SelectTrigger aria-label={stk.countLabel} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNT_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t.knowledge.eval.questions.addDialog.cancel}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {stk.generate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
