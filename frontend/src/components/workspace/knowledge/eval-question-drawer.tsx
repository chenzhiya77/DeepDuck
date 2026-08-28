"use client";

/**
 * 考题详情 drawer（2026-08-27 spec §4.5，plan Task 6）：Sheet 右侧覆盖式
 * （EvalRunDrawer 同款），只读展示完整字段——query 全文、分类/预期路径
 * badge、参考答案（无则「未填写」降级）、锚定清单（chunk id 可复制 +
 * 实体名）。底部「↗ 复现」主按钮（跳召回测试面板，§7.2）与「删除」次按钮
 * （回调给父级开确认框）。编辑不支持（§4.2 规则 5）。
 */
import { ArrowUpRight, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import type { EvalQuestion } from "@/core/knowledge/types";

export interface EvalQuestionDrawerProps {
  question: EvalQuestion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 删除次按钮：回调给父级（bank）关 drawer 并开确认框。 */
  onDelete: (question: EvalQuestion) => void;
  /** ↗ 复现主按钮：携带 query 跳召回测试面板预填（§7.2）。 */
  onReproduce?: (query: string) => void;
}

export function EvalQuestionDrawer({ question, open, onOpenChange, onDelete, onReproduce }: EvalQuestionDrawerProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const qtk = etk.questions;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
        <SheetHeader>
          <SheetTitle>{qtk.drawerTitle}</SheetTitle>
        </SheetHeader>
        {question !== null && (
          <div className="flex flex-col gap-4">
            <p className="text-sm whitespace-pre-wrap">{question.query}</p>

            <div className="flex items-center gap-2">
              <Badge variant="outline">{etk.category[question.category]}</Badge>
              {/* 多路预期（2026-08-28 §3）：与题库表格同口径全量渲染。 */}
              {question.expected_paths.map((path) => (
                <Badge key={path} variant="secondary">
                  {path}
                </Badge>
              ))}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">{qtk.addDialog.referenceAnswerLabel}</p>
              {question.reference_answer ? (
                <p className="text-sm whitespace-pre-wrap">{question.reference_answer}</p>
              ) : (
                <p className="text-muted-foreground text-sm">{qtk.noReferenceAnswer}</p>
              )}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">{qtk.columnAnchors}</p>
              {question.relevant_chunk_ids.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {question.relevant_chunk_ids.map((chunkId) => (
                    <li key={chunkId} className="font-mono text-xs break-all select-all">
                      {chunkId}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{qtk.unanchored}</p>
              )}
              {question.relevant_entities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {question.relevant_entities.map((entity) => (
                    <Badge key={entity} variant="outline">
                      {entity}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <Button onClick={() => onReproduce?.(question.query)} size="sm">
                <ArrowUpRight className="size-4" />
                {qtk.rowReproduce}
              </Button>
              <Button onClick={() => onDelete(question)} size="sm" variant="outline">
                <Trash2 className="text-destructive size-4" />
                {qtk.rowDelete}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
