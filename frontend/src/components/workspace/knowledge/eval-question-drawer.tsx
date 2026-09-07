"use client";

/**
 * 考题详情 drawer（2026-08-27 spec §4.5，plan Task 6；2026-09-08 裸奔退役
 * 重设计）：Sheet 右侧覆盖式（EvalRunDrawer 同款），只读展示完整字段。
 * 容器化沿用图谱实体抽屉定案配方（09-05：bg-card + border + rounded-lg +
 * shadow-xs 卡 + 卡内分组头带 border-b；bg-muted/40 浅底被用户否决——米色
 * 底上 muted 是后退色、无包裹感）：
 * - sticky 紧凑头：query 作标题（line-clamp-2）承载身份，泛称「考题详情」
 *   沉 sr-only 描述（项目 Sheet 配方）；分类/预期路径芯片行随头不随滚；
 * - 参考答案卡 / 参考文档卡（按文档分组：标题 + 切片稳定序号徽章 + 切片
 *   计数徽章 ml-auto）/ 实体卡（仅有值显，Waypoints 图谱路词汇）；
 * - 动作栏在 ScrollArea 外（SheetContent flex 列：滚动区 flex-1 + footer
 *   shrink-0 border-t）——复现主/删除次钉底，不随滚、短内容不悬空。
 * 编辑不支持（§4.2 规则 5）。
 */
import {
  ArrowUpRight,
  FileText,
  HelpCircle,
  MessageSquareText,
  Trash2,
  Waypoints,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useDocuments } from "@/core/knowledge/hooks";
import type { EvalQuestion } from "@/core/knowledge/types";

/** 依据按文档分组（2026-09-07）：组头 = 文档标题，组内 = chunk id 中 `#` 后的
    稳定序号——注意不是切片抽屉的位置序号（删除留空洞后位置序会变，这里
    展示稳定身份）。 */
function groupChunksByDoc(
  chunkIds: string[],
): { docId: string; sequences: string[] }[] {
  const groups: { docId: string; sequences: string[] }[] = [];
  for (const chunkId of chunkIds) {
    const [docId, sequence] = chunkId.split("#");
    if (!docId) continue;
    const group = groups.find((entry) => entry.docId === docId);
    if (group) group.sequences.push(sequence ?? "");
    else groups.push({ docId, sequences: [sequence ?? ""] });
  }
  return groups;
}

/** 卡容器（图谱实体抽屉 09-05 定案配方）：bg-card + border + rounded-lg +
    shadow-xs；分组头卡内带 border-b，计数徽章 ml-auto。 */
const CARD = "bg-card text-card-foreground rounded-lg border shadow-xs";
const CARD_HEAD =
  "text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium";

export interface EvalQuestionDrawerProps {
  question: EvalQuestion | null;
  /** 依据分组的文档标题数据源（与文档 tab 同 queryKey）。 */
  kbId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 删除次按钮：回调给父级（bank）关 drawer 并开确认框。 */
  onDelete: (question: EvalQuestion) => void;
  /** ↗ 复现主按钮：携带 query 跳召回测试面板预填（§7.2）。 */
  onReproduce?: (query: string) => void;
}

export function EvalQuestionDrawer({
  question,
  kbId,
  open,
  onOpenChange,
  onDelete,
  onReproduce,
}: EvalQuestionDrawerProps) {
  const { t } = useI18n();
  const etk = t.knowledge.eval;
  const qtk = etk.questions;
  // 文档标题（与文档 tab 同 queryKey，缓存命中不新增请求）；抽屉关时不发请求。
  const docsQuery = useDocuments(open ? kbId : null);
  const docTitle = (docId: string) =>
    (docsQuery.data ?? []).find((doc) => doc.id === docId)?.name ??
    docId.slice(0, 8);
  const groups = question ? groupChunksByDoc(question.relevant_chunk_ids) : [];

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full overflow-hidden sm:max-w-xl" side="right">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 百科 Tab 容器同款 overlay 滚动条（2026-09-04，EvalRunDrawer 同款）：整抽屉经
              ScrollArea 滚动（type="scroll"、停 2s 淡出），取代原生 overflow-y-auto。 */}
          <ScrollArea
            className="min-h-0 flex-1"
            scrollHideDelay={2000}
            type="scroll"
          >
            {/* sticky 紧凑头（2026-09-08）：query 作标题承载身份（泛称沉 sr-only
                描述）；分类/预期路径芯片行随头——正文不再重复裸徽章行。 */}
            <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-4 py-2.5 backdrop-blur-sm">
              <div className="flex min-w-0 items-start gap-1.5 pr-8">
                <HelpCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <SheetTitle className="line-clamp-2 text-sm break-words">
                    {question?.query ?? qtk.drawerTitle}
                  </SheetTitle>
                  {question !== null && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">
                        {etk.category[question.category]}
                      </Badge>
                      {/* 多路预期（2026-08-28 §3）：与题库表格同口径全量渲染。 */}
                      {question.expected_paths.map((path) => (
                        <Badge key={path} variant="secondary">
                          {path}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <SheetDescription className="sr-only">
                {qtk.drawerTitle}
              </SheetDescription>
            </SheetHeader>
            {question !== null && (
              <div className="flex flex-col gap-3 px-4 py-3">
                <section className={CARD}>
                  <header className={CARD_HEAD}>
                    <MessageSquareText className="size-3.5" />
                    {qtk.answerSection}
                  </header>
                  <div className="p-3">
                    {question.reference_answer ? (
                      <p className="text-sm whitespace-pre-wrap">
                        {question.reference_answer}
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {qtk.noReferenceAnswer}
                      </p>
                    )}
                  </div>
                </section>

                <section className={CARD}>
                  <header className={CARD_HEAD}>
                    <FileText className="size-3.5" />
                    {qtk.columnRefDocs}
                    {question.relevant_chunk_ids.length > 0 && (
                      <Badge
                        className="ml-auto px-1.5 text-[10px]"
                        variant="secondary"
                      >
                        {qtk.drawerChunksCount(question.relevant_chunk_ids.length)}
                      </Badge>
                    )}
                  </header>
                  <div className="flex flex-col gap-2.5 p-3">
                    {groups.length > 0 ? (
                      groups.map((group) => (
                        <div key={group.docId} className="flex min-w-0 flex-col gap-1">
                          <p
                            className="truncate text-xs font-medium"
                            title={docTitle(group.docId)}
                          >
                            {docTitle(group.docId)}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {group.sequences.map((sequence) => (
                              <Badge
                                key={sequence}
                                className="font-mono text-[10px]"
                                variant="secondary"
                              >
                                #{sequence}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {qtk.unanchored}
                      </p>
                    )}
                  </div>
                </section>

                {/* 实体卡（2026-09-08）：仅有值显——空标注诚实缺省不摆空卡；
                    Waypoints 与召回面板图谱路 PATH_ICONS 同源词汇。 */}
                {question.relevant_entities.length > 0 && (
                  <section className={CARD}>
                    <header className={CARD_HEAD}>
                      <Waypoints className="size-3.5" />
                      {qtk.entitiesSection}
                      <Badge
                        className="ml-auto px-1.5 text-[10px]"
                        variant="secondary"
                      >
                        {question.relevant_entities.length}
                      </Badge>
                    </header>
                    <div className="flex flex-wrap gap-1 p-3">
                      {question.relevant_entities.map((entity) => (
                        <Badge key={entity} variant="outline">
                          {entity}
                        </Badge>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </ScrollArea>
          {/* 动作栏（2026-09-08）：ScrollArea 外钉底——短内容不悬空、长内容
              不随滚；复现主/删除次语义不变（删除回调父级开确认框）。 */}
          {question !== null && (
            <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
              <Button onClick={() => onReproduce?.(question.query)} size="sm">
                <ArrowUpRight className="size-4" />
                {qtk.rowReproduce}
              </Button>
              <Button
                onClick={() => onDelete(question)}
                size="sm"
                variant="outline"
              >
                <Trash2 className="text-destructive size-4" />
                {qtk.rowDelete}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
