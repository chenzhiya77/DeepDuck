"use client";

/**
 * 合成候选题审核面板（2026-08-28 spec §6.2，plan Task 11）：题库视图内联
 * 区块，暂存非空或运行中时出现。候选必须人工审核——采纳经题库唯一写路径
 * 入库（accept → add_question），忽略仅移出暂存；「全部忽略」逐条 reject。
 * 轮询由 useSynthesisStatus 的 refetchInterval 门控（in_progress 时 3s），
 * 本组件只消费数据。
 */
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { useAcceptSynthesisCandidate, useRejectSynthesisCandidate, useSynthesisStatus } from "@/core/knowledge/hooks";

export interface EvalSynthesisReviewProps {
  kbId: string;
  /** keep-alive 懒门控（与题库查询同开关）。 */
  enabled?: boolean;
}

export function EvalSynthesisReview({ kbId, enabled = true }: EvalSynthesisReviewProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const stk = etk.synthesize;
  const qtk = etk.questions;
  const status = useSynthesisStatus(kbId, enabled);
  const accept = useAcceptSynthesisCandidate(kbId);
  const reject = useRejectSynthesisCandidate(kbId);

  const data = status.data;
  // 暂存空且非运行中 → 不渲染（表格常态，无空面板噪音）。
  if (!data || (!data.in_progress && data.candidates.length === 0)) {
    return null;
  }

  const handleAccept = async (candidateId: string) => {
    try {
      await accept.mutateAsync(candidateId);
      toast.success(qtk.addedToast);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : stk.acceptFailed);
    }
  };

  const handleReject = async (candidateId: string) => {
    try {
      await reject.mutateAsync(candidateId);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : stk.rejectFailed);
    }
  };

  const handleRejectAll = async () => {
    // 逐条 reject（后端无批量端点——整体替换语义下暂存量小，串行足够）。
    for (const candidate of data.candidates) {
      await handleReject(candidate.candidate_id);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="eval-synthesis-review">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{stk.reviewTitle}</span>
        {data.in_progress && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" />
            {stk.generating}
          </span>
        )}
        {data.candidates.length > 1 && (
          <Button
            className="ml-auto"
            disabled={reject.isPending}
            onClick={handleRejectAll}
            size="sm"
            variant="ghost"
          >
            {stk.rejectAll}
          </Button>
        )}
      </div>
      {/* 元信息行：来源文档（多篇顿号连接，2026-09-02）· 生成时间 · 剩余候选 · 丢弃数（各自独立文本节点，可定位断言） */}
      {data.generated_at !== null && (
        <p className="text-muted-foreground text-xs">
          <span>{data.doc_ids.join("、")}</span>
          {" · "}
          <span>{data.generated_at}</span>
          {" · "}
          <span>{data.candidates.length}</span>
          {" · "}
          <span>{stk.metaLine(data.dropped)}</span>
        </p>
      )}
      {data.candidates.length === 0 && !data.in_progress && (
        <p className="text-muted-foreground text-sm">{stk.empty}</p>
      )}
      <div className="flex flex-col gap-2">
        {data.candidates.map((candidate) => (
          <div className="flex flex-col gap-1.5 rounded-md border p-2.5" key={candidate.candidate_id}>
            <p className="text-sm">{candidate.query}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{etk.category[candidate.category]}</Badge>
              {candidate.expected_paths.map((path) => (
                <Badge key={path} variant="secondary">
                  {path}
                </Badge>
              ))}
              <span className="text-muted-foreground text-xs">{qtk.anchorsChunks(candidate.relevant_chunk_ids.length)}</span>
            </div>
            {candidate.reference_answer !== null && (
              <p className="text-muted-foreground text-xs whitespace-pre-wrap">{candidate.reference_answer}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                disabled={accept.isPending || reject.isPending}
                onClick={() => handleAccept(candidate.candidate_id)}
                size="sm"
              >
                <Check className="size-3.5" />
                {stk.accept}
              </Button>
              <Button
                disabled={accept.isPending || reject.isPending}
                onClick={() => handleReject(candidate.candidate_id)}
                size="sm"
                variant="outline"
              >
                <X className="size-3.5" />
                {stk.reject}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
