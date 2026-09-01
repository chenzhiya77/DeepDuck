"use client";

/**
 * 题库视图（2026-08-27 spec §4.3，plan Task 6）：题目表格 + 详情 drawer +
 * 添加 dialog + 删除二次确认。造题主入口在召回测试面板「存为考题」（§7.1），
 * 这里的「添加考题」是辅助路径——简化表单不收锚定（§4.4），无锚定题走
 * Layer 1 既有降级语义（仅参与路径判定）。编辑不支持（§4.2 规则 5）：改题
 * = 删了重加。2026-08-29 UX 修订：造题入口按钮（添加/从文档生成）并入
 * eval-tab 常驻工具栏，本组件的添加/合成 dialog 改受控（addOpen/
 * synthesisOpen 由上层下发）；原工具行与表格尾部虚线按钮均移除。
 * 2026-09-01 B 方案：首列复选框选题 + 批量运行栏（双档携 question_ids，
 * 完整档复用 EvalFullRunDialog 成本确认；部分运行不隔离，照常进总览/趋势）。
 */
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/core/i18n/hooks";
import { useDeleteEvalQuestion, useEvalQuestions, useTriggerEvalRun } from "@/core/knowledge/hooks";
import type { EvalQuestion, EvalTriggerInput } from "@/core/knowledge/types";

import { EvalAddQuestionDialog } from "./eval-add-question-dialog";
import { EvalFullRunDialog } from "./eval-full-run-dialog";
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
  /** 搜索过滤词（2026-08-30：搜索框在 eval-tab 常驻工具栏，纯前端包含匹配）。 */
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

export function EvalQuestionBank({
  kbId,
  enabled = true,
  onReproduce,
  addOpen = false,
  onAddOpenChange = () => undefined,
  synthesisOpen = false,
  onSynthesisOpenChange = () => undefined,
  searchQuery = "",
}: EvalQuestionBankProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const qtk = etk.questions;
  const stk = etk.selection;
  const query = useEvalQuestions(kbId, enabled);
  const deleteMutation = useDeleteEvalQuestion(kbId);
  const triggerMutation = useTriggerEvalRun(kbId);

  const [drawerQuestion, setDrawerQuestion] = useState<EvalQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EvalQuestion | null>(null);
  // 选题集（2026-09-01 B 方案）：批量运行携 question_ids；触发成功后清空。
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkFullRunOpen, setBulkFullRunOpen] = useState(false);

  // 搜索过滤（2026-08-30）：题目文本不区分大小写包含匹配；题库数据已全量拉取，纯前端。
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const allQuestions = useMemo(() => query.data?.questions ?? [], [query.data]);
  const visibleQuestions = trimmedSearch
    ? allQuestions.filter((question) => question.query.toLowerCase().includes(trimmedSearch))
    : allQuestions;

  // 数据刷新后剔除已不存在的选中（删除/刷新不残留幽灵选择）。
  useEffect(() => {
    setSelectedIds((previous) => {
      const alive = allQuestions.filter((question) => previous.has(question.id));
      return alive.length === previous.size ? previous : new Set(alive.map((question) => question.id));
    });
  }, [allQuestions]);

  const toggleQuestion = (questionId: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  };

  const allVisibleSelected = visibleQuestions.length > 0 && visibleQuestions.every((question) => selectedIds.has(question.id));

  const toggleSelectAllVisible = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) visibleQuestions.forEach((question) => next.delete(question.id));
      else visibleQuestions.forEach((question) => next.add(question.id));
      return next;
    });
  };

  const handleBulkTrigger = (input: EvalTriggerInput) => {
    triggerMutation.mutate(input, {
      onSuccess: (response) => {
        // 202 语义分流与常驻工具栏同款；触发后清空选择（批量栏消失）。
        if (response.status === "enqueued") toast.success(etk.runStartedToast);
        else toast.info(etk.alreadyRunningToast);
        setSelectedIds(new Set());
      },
      onError: () => toast.error(etk.runFailedToast),
    });
  };

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
      {/* 候选审核区块：暂存非空或运行中时出现（组件内部判定）；
          隐藏时组件返回 null，:empty 即 hidden——不留 flex 间隙（表头上方不浮出空白）；
          显示时保持 px-4 内缩对齐工具栏内容边距 */}
      <div className="px-4 [&:empty]:hidden">
        <EvalSynthesisReview enabled={enabled} kbId={kbId} />
      </div>

      {/* 批量运行栏（2026-09-01 B 方案）：有选中即出现；双档触发携 question_ids，
          按钮锁 h-7 同档；部分运行不隔离，照常进总览/趋势 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border px-4 py-1.5" data-testid="eval-bulk-run-bar">
          <span className="text-xs">{stk.selected(selectedIds.size)}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              className="h-7 shrink-0 gap-1.5 px-2.5"
              onClick={() => handleBulkTrigger({ layers: "l1", question_ids: [...selectedIds] })}
            >
              {stk.runSelected}
            </Button>
            <Button
              className="h-7 shrink-0 gap-1.5 px-2.5"
              onClick={() => setBulkFullRunOpen(true)}
              variant="outline"
            >
              {stk.fullRunSelected}
            </Button>
            <Button className="h-7 shrink-0 px-2.5" onClick={() => setSelectedIds(new Set())} variant="ghost">
              {stk.clear}
            </Button>
          </div>
        </div>
      )}

      {query.isLoading ? (
        <div className="text-muted-foreground mx-4 rounded-lg border border-dashed p-6 text-center text-sm">
          {etk.loading}
        </div>
      ) : query.error ? (
        <div className="text-destructive mx-4 rounded-lg border border-dashed p-6 text-center text-sm">
          {etk.loadFailed}
        </div>
      ) : query.data && allQuestions.length > 0 ? (
        visibleQuestions.length === 0 ? (
          /* 无匹配（2026-08-30 搜索）：区别于空库引导——库里有题但过滤词无命中 */
          <div className="text-muted-foreground mx-4 rounded-lg border border-dashed p-6 text-center text-sm">
            {qtk.noMatch}
          </div>
        ) : (
        /* 表格样式对齐文档列表（2026-08-30）：表头去默认 h-10 降为 text-xs 自然高（32px），
           数据行同文档列表 px-2 py-2（36px）；松垮根源是 h-10 表头与行尾大图标按钮；
           表头同文档列表用 muted 色 */
        <Table>
          <TableHeader className="[&_tr]:text-muted-foreground">
            <TableRow>
              {/* 首列 pl-4 / 末列 pr-4：通栏表格的左右缘找齐工具栏内容边距（文档列表同款） */}
              <TableHead className="h-auto w-8 py-2 pl-4">
                <Checkbox aria-label={stk.selectAllAria} checked={allVisibleSelected} onCheckedChange={() => toggleSelectAllVisible()} />
              </TableHead>
              <TableHead className="h-auto px-2 py-2 text-xs">{qtk.columnQuery}</TableHead>
              <TableHead className="h-auto px-2 py-2 text-xs">{qtk.columnCategory}</TableHead>
              <TableHead className="h-auto px-2 py-2 text-xs">{qtk.columnExpectedPath}</TableHead>
              <TableHead className="h-auto px-2 py-2 text-xs">{qtk.columnAnchors}</TableHead>
              <TableHead className="h-auto w-8 py-2 pr-4 pl-2 text-right text-xs">{""}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleQuestions.map((question) => (
              <TableRow
                key={question.id}
                className="cursor-pointer"
                onClick={() => setDrawerQuestion(question)}
              >
                {/* 选题复选框（B 方案）：单元格 stopPropagation，勾选不开详情 drawer */}
                <TableCell className="w-8 py-2 pl-4" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    aria-label={stk.rowSelectAria(question.query)}
                    checked={selectedIds.has(question.id)}
                    onCheckedChange={(checked) => toggleQuestion(question.id, checked === true)}
                  />
                </TableCell>
                <TableCell className="max-w-52 truncate px-2 py-2" title={question.query}>
                  {question.query}
                </TableCell>
                <TableCell className="px-2 py-2">
                  <Badge variant="outline">{etk.category[question.category]}</Badge>
                </TableCell>
                <TableCell className="px-2 py-2">
                  {/* 多路预期（2026-08-28 §3）：全量 Badge，单路即一枚。 */}
                  <span className="inline-flex flex-wrap gap-1">
                    {question.expected_paths.map((path) => (
                      <Badge key={path} variant="secondary">
                        {path}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="px-2 py-2">{renderAnchors(question)}</TableCell>
                {/* 操作列：行内 ↗ 复现已移除（2026-08-30 占栏宽，入口留在详情 drawer），仅保留删除 */}
                <TableCell className="w-8 py-2 pr-4 pl-2 text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )
      ) : (
        <div className="text-muted-foreground mx-4 rounded-lg border border-dashed p-6 text-center text-sm">
          <p>{qtk.emptyBank}</p>
          {/* 双入口第二句（2026-08-28 §7）：合成造题引导 */}
          <p>{qtk.emptyBankSynthesis}</p>
        </div>
      )}

      {/* 添加/合成 dialog 受控（2026-08-29）：入口按钮在 eval-tab 常驻工具栏 */}
      <EvalAddQuestionDialog kbId={kbId} open={addOpen} onOpenChange={onAddOpenChange} />

      {/* 批量完整评测确认（B 方案）：复用常驻工具栏同款对话框，携 question_ids */}
      <EvalFullRunDialog
        open={bulkFullRunOpen}
        onOpenChange={setBulkFullRunOpen}
        onConfirm={() => handleBulkTrigger({ layers: "l1_l2", question_ids: [...selectedIds] })}
      />

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
