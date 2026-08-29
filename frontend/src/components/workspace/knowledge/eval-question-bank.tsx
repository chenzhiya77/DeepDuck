"use client";

/**
 * 题库视图（2026-08-27 spec §4.3，plan Task 6）：题目表格 + 详情 drawer +
 * 添加 dialog + 删除二次确认。造题主入口在召回测试面板「存为考题」（§7.1），
 * 这里的「添加考题」是辅助路径——简化表单不收锚定（§4.4），无锚定题走
 * Layer 1 既有降级语义（仅参与路径判定）。编辑不支持（§4.2 规则 5）：改题
 * = 删了重加。2026-08-29 UX 修订：造题入口按钮（添加/从文档生成）并入
 * eval-tab 常驻工具栏，本组件的添加/合成 dialog 改受控（addOpen/
 * synthesisOpen 由上层下发）；原工具行与表格尾部虚线按钮均移除。
 */
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/core/i18n/hooks";
import { useDeleteEvalQuestion, useEvalQuestions } from "@/core/knowledge/hooks";
import type { EvalQuestion } from "@/core/knowledge/types";

import { EvalAddQuestionDialog } from "./eval-add-question-dialog";
import { EvalQuestionDrawer } from "./eval-question-drawer";
import { EvalSynthesisDialog } from "./eval-synthesis-dialog";
import { EvalSynthesisReview } from "./eval-synthesis-review";

export interface EvalQuestionBankProps {
  kbId: string;
  /** keep-alive 懒门控（eval tab 激活才发请求）。 */
  enabled?: boolean;
  /** ↗ 复现：携带 query 跳召回测试面板预填（page 层通道，§7.2）。 */
  onReproduce?: (query: string) => void;
  /** 添加考题 dialog 受控开关（2026-08-29：入口按钮在 eval-tab 常驻工具栏）。 */
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  /** 合成触发 dialog 受控开关（同上）。 */
  synthesisOpen?: boolean;
  onSynthesisOpenChange?: (open: boolean) => void;
}

export function EvalQuestionBank({
  kbId,
  enabled = true,
  onReproduce,
  addOpen = false,
  onAddOpenChange = () => undefined,
  synthesisOpen = false,
  onSynthesisOpenChange = () => undefined,
}: EvalQuestionBankProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const qtk = etk.questions;
  const query = useEvalQuestions(kbId, enabled);
  const deleteMutation = useDeleteEvalQuestion(kbId);

  const [drawerQuestion, setDrawerQuestion] = useState<EvalQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EvalQuestion | null>(null);

  const handleDeleteConfirm = async () => {
    if (deleteTarget === null) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(qtk.deletedToast);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : qtk.deleteFailed);
    } finally {
      setDeleteTarget(null);
    }
  };

  const renderAnchors = (question: EvalQuestion) => {
    if (question.relevant_chunk_ids.length === 0) {
      return <span className="text-muted-foreground">{qtk.unanchored}</span>;
    }
    return (
      <span className="text-xs">
        <span>{qtk.anchorsChunks(question.relevant_chunk_ids.length)}</span>
        {question.relevant_entities.length > 0 && (
          <>
            {" · "}
            <span className="text-muted-foreground">{qtk.anchorsEntities(question.relevant_entities.length)}</span>
          </>
        )}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 候选审核区块：暂存非空或运行中时出现（组件内部判定） */}
      <EvalSynthesisReview enabled={enabled} kbId={kbId} />

      {query.isLoading ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {etk.loading}
        </div>
      ) : query.error ? (
        <div className="text-destructive rounded-lg border border-dashed p-6 text-center text-sm">
          {etk.loadFailed}
        </div>
      ) : query.data && query.data.questions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{qtk.columnQuery}</TableHead>
              <TableHead>{qtk.columnCategory}</TableHead>
              <TableHead>{qtk.columnExpectedPath}</TableHead>
              <TableHead>{qtk.columnAnchors}</TableHead>
              <TableHead className="w-20 text-right">{""}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.questions.map((question) => (
              <TableRow
                key={question.id}
                className="cursor-pointer"
                onClick={() => setDrawerQuestion(question)}
              >
                <TableCell className="max-w-52 truncate" title={question.query}>
                  {question.query}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{etk.category[question.category]}</Badge>
                </TableCell>
                <TableCell>
                  {/* 多路预期（2026-08-28 §3）：全量 Badge，单路即一枚。 */}
                  <span className="inline-flex flex-wrap gap-1">
                    {question.expected_paths.map((path) => (
                      <Badge key={path} variant="secondary">
                        {path}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>{renderAnchors(question)}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1">
                    <Button
                      aria-label={qtk.rowReproduce}
                      onClick={(event) => {
                        // stopPropagation：操作列不触发行点击的 drawer
                        event.stopPropagation();
                        onReproduce?.(question.query);
                      }}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ArrowUpRight className="size-4" />
                    </Button>
                    <Button
                      aria-label={qtk.rowDelete}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(question);
                      }}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 className="text-destructive size-4" />
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          <p>{qtk.emptyBank}</p>
          {/* 双入口第二句（2026-08-28 §7）：合成造题引导 */}
          <p>{qtk.emptyBankSynthesis}</p>
        </div>
      )}

      {/* 添加/合成 dialog 受控（2026-08-29）：入口按钮在 eval-tab 常驻工具栏 */}
      <EvalAddQuestionDialog kbId={kbId} open={addOpen} onOpenChange={onAddOpenChange} />

      {/* 合成触发 dialog：文档 + 数量 → 202 幂等，候选落暂存待审 */}
      <EvalSynthesisDialog kbId={kbId} open={synthesisOpen} onOpenChange={onSynthesisOpenChange} />

      {/* 详情 drawer：行点击下钻（§4.5）；onDelete 关 drawer 再开确认框 */}
      <EvalQuestionDrawer
        onDelete={(question) => {
          setDrawerQuestion(null);
          setDeleteTarget(question);
        }}
        onOpenChange={(open) => {
          if (!open) setDrawerQuestion(null);
        }}
        onReproduce={onReproduce}
        open={drawerQuestion !== null}
        question={drawerQuestion}
      />

      {/* 删除二次确认（§4.3）：展示 query 全文，删除后不可恢复 */}
      <Dialog onOpenChange={(open) => !open && setDeleteTarget(null)} open={deleteTarget !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{qtk.deleteConfirm.title}</DialogTitle>
            <DialogDescription>
              {deleteTarget?.query}
              <br />
              {qtk.deleteConfirm.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleteTarget(null)} variant="outline">
              {qtk.deleteConfirm.cancel}
            </Button>
            <Button onClick={handleDeleteConfirm} variant="destructive">
              {qtk.deleteConfirm.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
