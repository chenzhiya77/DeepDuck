"use client";

/**
 * 题库视图（2026-08-27 spec §4.3，plan Task 6）：题目表格 + 详情 drawer +
 * 添加 dialog + 删除二次确认。造题主入口在召回测试面板「存为考题」（§7.1），
 * 这里的「添加考题」是辅助路径——简化表单不收锚定（§4.4），无锚定题走
 * Layer 1 既有降级语义（仅参与路径判定）。编辑不支持（§4.2 规则 5）：改题
 * = 删了重加。2026-08-29 UX 修订：造题入口按钮（添加/从文档生成）并入
 * eval-tab 常驻工具栏，本组件的添加/合成 dialog 改受控（addOpen/
 * synthesisOpen 由上层下发）；原工具行与表格尾部虚线按钮均移除。
 * 2026-09-01 B 方案：首列复选框选题（双档携 question_ids，部分运行不隔离，
 * 照常进总览/趋势）。2026-09-02 批量运行栏退役：选题集上提 eval-tab 受控，
 * 工具栏运行键原位切换携 question_ids；行右键菜单承接快速评测/取消选择/
 * 删除所选（结构节奏同文档右键菜单规范）。
 */
import { Layers, MoreHorizontal, Play, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { EvalQuestionDrawer } from "./eval-question-drawer";
import { EvalSynthesisDialog } from "./eval-synthesis-dialog";
import { EvalSynthesisReview } from "./eval-synthesis-review";
import { runAfterMenuClose } from "./run-after-menu-close";

/** 吸顶表头单元格公共类（2026-09-02）：粘性 + 不透明底 + inset 阴影发丝线；
    h-9 钉死单元格高（与文档表头 36px 对齐）——单元格自然高（复选框 +
    内边距 ≈ 36.44）会撑破 tr 的 h-9，钉到单元格层才是唯一裁决者。
    字色钉 muted：ui/table 默认的 text-foreground 会压过 tr 的继承，
    「表头浅灰、内容深色」的层级语言（文档表 08-31 规范）从未生效——
    钉到单元格层才真正兑现。 */
const STICKY_HEAD = "sticky top-0 z-10 h-9 bg-background text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]";

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
  /** 选题集受控（2026-09-02 批量运行栏退役）：eval-tab 持有状态——
      工具栏原位切换要读选中态，本层右键菜单消费/清理。 */
  selectedIds: ReadonlySet<string>;
  onSelectedIdsChange: (next: ReadonlySet<string>) => void;
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
  selectedIds,
  onSelectedIdsChange,
}: EvalQuestionBankProps) {
  const { t } = useI18n();
  const rtk = t.knowledge;
  const etk = t.knowledge.eval;
  const qtk = etk.questions;
  const stk = etk.selection;
  const query = useEvalQuestions(kbId, enabled);
  const deleteMutation = useDeleteEvalQuestion(kbId);
  const triggerMutation = useTriggerEvalRun(kbId);

  const [drawerQuestion, setDrawerQuestion] = useState<EvalQuestion | null>(null);
  // 删除目标改数组（2026-09-02）：行内删除/drawer 删除 = 单元素，
  // 右键「删除所选」= 选中集；同一二次确认对话框承接。
  const [deleteTargets, setDeleteTargets] = useState<EvalQuestion[] | null>(null);

  // 搜索过滤（2026-08-30）：题目文本不区分大小写包含匹配；题库数据已全量拉取，纯前端。
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const allQuestions = useMemo(() => query.data?.questions ?? [], [query.data]);
  const visibleQuestions = trimmedSearch
    ? allQuestions.filter((question) => question.query.toLowerCase().includes(trimmedSearch))
    : allQuestions;

  // 数据刷新后剔除已不存在的选中（删除/刷新不残留幽灵选择）。
  useEffect(() => {
    const alive = allQuestions.filter((question) => selectedIds.has(question.id));
    if (alive.length !== selectedIds.size) {
      onSelectedIdsChange(new Set(alive.map((question) => question.id)));
    }
  }, [allQuestions, selectedIds, onSelectedIdsChange]);

  const toggleQuestion = (questionId: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(questionId);
    else next.delete(questionId);
    onSelectedIdsChange(next);
  };

  const allVisibleSelected = visibleQuestions.length > 0 && visibleQuestions.every((question) => selectedIds.has(question.id));

  const toggleSelectAllVisible = () => {
    const next = new Set(selectedIds);
    if (allVisibleSelected) visibleQuestions.forEach((question) => next.delete(question.id));
    else visibleQuestions.forEach((question) => next.add(question.id));
    onSelectedIdsChange(next);
  };

  const handleBulkTrigger = (input: EvalTriggerInput) => {
    triggerMutation.mutate(input, {
      onSuccess: (response) => {
        // 202 语义分流与常驻工具栏同款；触发后清空选择（原批量栏语义）。
        if (response.status === "enqueued") toast.success(etk.runStartedToast);
        else toast.info(etk.alreadyRunningToast);
        onSelectedIdsChange(new Set());
      },
      onError: () => toast.error(etk.runFailedToast),
    });
  };

  // 文件管理器惯例：右键未选中行只选中该行；右键已选中行保持批量上下文。
  const handleRowContextMenu = (questionId: string) => {
    if (!selectedIds.has(questionId)) {
      onSelectedIdsChange(new Set([questionId]));
    }
  };

  const selectedQuestions = () => allQuestions.filter((question) => selectedIds.has(question.id));

  const handleDeleteConfirm = async () => {
    if (deleteTargets === null) return;
    const removed = new Set(deleteTargets.map((question) => question.id));
    const results = await Promise.allSettled(deleteTargets.map((question) => deleteMutation.mutateAsync(question.id)));
    if (results.some((result) => result.status === "rejected")) {
      toast.error(qtk.deleteFailed);
    } else {
      toast.success(qtk.deletedToast);
    }
    onSelectedIdsChange(new Set([...selectedIds].filter((id) => !removed.has(id))));
    setDeleteTargets(null);
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

      {/* 批量运行栏退役（2026-09-02）：插入式条推挤表格产生抖动；选题运行
          由工具栏原位切换承接（运行所选/完整运行所选），取消选择/删除所选
          进行右键菜单 */}

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
           表头同文档列表用 muted 色。吸顶（2026-09-02）：表头单元格 sticky + inset
           阴影发丝线（折叠模式下 tr 边框随滚动丢失）；外壳不走 overflow-x-auto（
           它会接管纵向滚动破坏 sticky，横滚由内容区 eval-view-content 承担） */
        <Table containerClassName="relative w-full">
          <TableHeader className="[&_tr]:border-0 [&_tr]:text-muted-foreground">
            {/* h-9 钉高与文档表头对齐（36px，2026-09-02）；th 自然高低于 36，
                行高由 tr 裁决；发丝线是 th 的 inset 阴影（不参与布局），
                复选框状态切换不会引起表头高度重取整。 */}
            <TableRow className="group h-9">
              {/* 首列复选框 px-2 与文档表头对齐（2026-09-02）：复选框是悬浮即现的
                  瞬态控件，跨 tab 位置一致比找齐工具栏边距更重要；行复选框同文档表：
                  悬停/勾选/任一选中才显形，静止态不抢戏 */}
              <TableHead className={`${STICKY_HEAD} w-8 px-2`}>
                {/* 内层 flex 几何居中（2026-09-02）：与文档表头复选框同位；不给 th 自身挂
                    flex（th 会脱出表格布局），钉死 h-9 与表头等高 */}
                <div className="flex h-9 items-center">
                  <Checkbox aria-label={stk.selectAllAria} checked={allVisibleSelected} onCheckedChange={() => toggleSelectAllVisible()} />
                </div>
              </TableHead>
              <TableHead className={`${STICKY_HEAD} px-2 text-xs`}>{qtk.columnQuery}</TableHead>
              <TableHead className={`${STICKY_HEAD} px-2 text-xs`}>{qtk.columnCategory}</TableHead>
              <TableHead className={`${STICKY_HEAD} px-2 text-xs`}>{qtk.columnExpectedPath}</TableHead>
              <TableHead className={`${STICKY_HEAD} px-2 text-xs`}>{qtk.columnAnchors}</TableHead>
              <TableHead className={`${STICKY_HEAD} w-8 pr-4 pl-2 text-right text-xs`}>{""}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleQuestions.map((question) => {
              const isSelected = selectedIds.has(question.id);
              return (
              <ContextMenu key={question.id}>
                <ContextMenuTrigger asChild>
              {/* 行间去分割线（2026-09-02）：ui/table 行默认 border-b，与文档表
                  08-31「无框表、结构线只留表头发丝线」的决策不一致——文档行早已去掉
                  border-b，题库行却仍带，题目间那条线就是它。去掉后两表数据行同为
                  px-2 py-2 无框行，行高同基准（collapse 模式下这条内边框还会挤进
                  行间，一并收掉）。 */}
              <TableRow
                className="group cursor-pointer border-0"
                onClick={() => setDrawerQuestion(question)}
                onContextMenu={() => handleRowContextMenu(question.id)}
              >
                {/* 选题复选框（B 方案）：单元格 stopPropagation，勾选不开详情 drawer；
                    显隐同文档表（2026-09-02）：悬停/勾选/任一选中才显形 */}
                <TableCell className="w-8 px-2 py-2" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    aria-label={stk.rowSelectAria(question.query)}
                    checked={selectedIds.has(question.id)}
                    className={`opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100 ${selectedIds.size > 0 ? "opacity-100" : ""}`}
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
                {/* 末列悬浮三点（2026-09-02）：替换原 size-8（32px）删除按钮——它是题库行
                    48px 的裁决者，比文档行（40px，由三点 size-6=24px 撑起）高 8px；换成
                    文档 tab 同款 size-6 三点后行高落到 40px，两表逐像素对齐。菜单镜像右键的
                    行级子集：快速评测 / 完整评测 / 删除（行级语义，不依赖选择态）；
                    hover/选中/聚焦/菜单开时淡入，静止态不抢戏（同文档表三点）。 */}
                <TableCell className="w-10 py-2 pr-4 pl-1 text-right" onClick={(event) => event.stopPropagation()}>
                  <div
                    className={`flex justify-end transition-opacity opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 ${isSelected ? "opacity-100" : ""}`}
                    data-testid="bank-row-more"
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label={rtk.moreActions} className="size-6" size="icon" variant="ghost">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => handleBulkTrigger({ layers: "l1", question_ids: [question.id] })}>
                          <Play className="size-4" />
                          {stk.runSelected}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleBulkTrigger({ layers: "l1_l2", question_ids: [question.id] })}>
                          <Layers className="size-4" />
                          {stk.fullRunSelected}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTargets([question])}>
                          <Trash2 className="size-4" />
                          {qtk.rowDelete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-44">
                  {isSelected && selectedIds.size > 1 ? (
                    <>
                      <ContextMenuLabel>{rtk.selectedCount(selectedIds.size)}</ContextMenuLabel>
                      {/* 结构节奏同文档右键菜单（2026-09-02 定稿）：普通动作 →
                          取消选择（X）→ 分隔线 → 危险操作沉底单独隔离；
                          快速评测 = L1 档携选中集 question_ids */}
                      <ContextMenuItem onSelect={() => handleBulkTrigger({ layers: "l1", question_ids: [...selectedIds] })}>
                        <Play className="size-4" />
                        {stk.runSelected}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => handleBulkTrigger({ layers: "l1_l2", question_ids: [...selectedIds] })}>
                        <Layers className="size-4" />
                        {stk.fullRunSelected}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => onSelectedIdsChange(new Set())}>
                        <X className="size-4" />
                        {rtk.cancelSelection}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => runAfterMenuClose(() => setDeleteTargets(selectedQuestions()))}
                      >
                        <Trash2 className="size-4" />
                        {rtk.deleteSelected}
                      </ContextMenuItem>
                    </>
                  ) : (
                    <>
                      {/* 单选：快速/完整评测只跑该题；右键即选中，退出/删除措辞两态对称 */}
                      <ContextMenuItem onSelect={() => handleBulkTrigger({ layers: "l1", question_ids: [question.id] })}>
                        <Play className="size-4" />
                        {stk.runSelected}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => handleBulkTrigger({ layers: "l1_l2", question_ids: [question.id] })}>
                        <Layers className="size-4" />
                        {stk.fullRunSelected}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => onSelectedIdsChange(new Set())}>
                        <X className="size-4" />
                        {rtk.cancelSelection}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => runAfterMenuClose(() => setDeleteTargets([question]))}
                      >
                        <Trash2 className="size-4" />
                        {rtk.deleteSelected}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
              );
            })}
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

      {/* 添加/合成 dialog 受控（2026-08-29）：入口按钮在 eval-tab 常驻工具栏；
          批量完整评测确认已上提 eval-tab（工具栏原位切换，2026-09-02） */}
      <EvalAddQuestionDialog kbId={kbId} open={addOpen} onOpenChange={onAddOpenChange} />

      {/* 合成触发 dialog：文档 + 数量 → 202 幂等，候选落暂存待审 */}
      <EvalSynthesisDialog kbId={kbId} open={synthesisOpen} onOpenChange={onSynthesisOpenChange} />

      {/* 详情 drawer：行点击下钻（§4.5）；onDelete 关 drawer 再开确认框 */}
      <EvalQuestionDrawer
        onDelete={(question) => {
          setDrawerQuestion(null);
          setDeleteTargets([question]);
        }}
        onOpenChange={(open) => {
          if (!open) setDrawerQuestion(null);
        }}
        onReproduce={onReproduce}
        open={drawerQuestion !== null}
        question={drawerQuestion}
      />

      {/* 删除二次确认（§4.3）：单条展示 query 全文，批量展示已选计数；删除后不可恢复 */}
      <Dialog onOpenChange={(open) => !open && setDeleteTargets(null)} open={deleteTargets !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{qtk.deleteConfirm.title}</DialogTitle>
            <DialogDescription>
              {deleteTargets?.length === 1 ? deleteTargets[0]?.query : rtk.selectedCount(deleteTargets?.length ?? 0)}
              <br />
              {qtk.deleteConfirm.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleteTargets(null)} variant="outline">
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
