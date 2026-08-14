# RAG Phase-3 Batch-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver two isolated knowledge channels to enhance existing RAG indexing: (1) **Wiki dual-mode editing** (main content editable + permanent supplement layer), (2) **Manual knowledge card system** (user-created entries that can optionally join wiki search path). This plan only decomposes implementation tasks; all design decisions live in `docs/specs/2026-08-15-rag-phase3-editing-design.md`.

**Spec:** `docs/superpowers/specs/2026-08-15-rag-phase3-editing-design.md`（已定稿）  
**基线：** PR #XXXX / `aa11bb22` (RAG Phase-2 Batch-1 完成后)

**Architecture:** Backend changes focus on schema migrations (`wiki_entries` supplement_content column, new `manual_knowledge` table), API extensions (PATCH wiki/chunks, DELETE preview), and wiki-search integration. Frontend adds WikiEditDialog (dual-mode editor), ManualCardPanel (CRUD list), and citation hover cards with source_type badges. Zero external dependencies.

**Tech Stack:** FastAPI + SQLAlchemy/Alembic + Qdrant (backend); Next.js + TypeScript + Radix UI + rstest (frontend).

**Global Constraints:**
- Branch: `feat/rag-phase3-edition`; each task: RED → GREEN → regression proof (revert→RED→restore→GREEN) → commit (Conventional Commits).
- Backend TDD mandatory: `cd backend && uv run pytest <file> -q`；frontend DOM tests included (`pnpm test`), final `pnpm check` + `ruff` clean.
- Integration tests (`requires_qdrant`) require local Qdrant: `docker start qdrant`.
- Known code facts (verified pre-construction):
  - `WikiStore.upsert_entry` overwrites `content` without preserving versions → P1's supplement layer must be explicit nullable TEXT column.
  - `mark_dirty_for_titles` already exists and skips already-dirty rows → P1 re-generation preserves supplement unchanged.
  - `remove_chunk_contributions` in graph/store.py returns `(orphaned, affected)` tuples → P3/P5 can reuse/dry-run this pure function.
  - Citation resolver `parseRetrievalToolContent` has `toolName` field → `source_type` can be added frontend-side without backend changes.
  - No migration pattern beyond 0013 yet → P1/P6 migrations follow 0012 style (safe_add_column).

## Task 1: P1 Wiki 双模式编辑——数据库迁移（RED 阶段） ✅ 计划中（待实施）

**Files:**
- Create: `backend/packages/harness/deerflow/persistence/migrations/versions/0014_wiki_supplement_content.py`

- [ ] Write failing test: verify column missing after down → up, then present after down.
- [ ] Run `cd backend && uv run pytest tests/test_migration_0014_wiki_supplement_content.py -q` capture RED.
- [ ] Implement migration: add `supplement_content TEXT NULL` to `wiki_entries`, no index (low access frequency).
- [ ] Test GREEN; revert to prove RED; restore GREEN.
- [ ] Commit: `feat(rag): add supplement_content column to wiki_entries for dual-mode editing`.

## Task 2: P1 Wiki 双模式编辑——Store 参数扩展与重生成验证 ✅ 计划中（待实施）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/wiki/store.py`
- Modify: `backend/tests/knowledge/wiki/test_store.py`
- Modify: `backend/packages/harness/deerflow/knowledge/wiki/generator.py`

- [ ] RED test: `upsert_entry` ignores supplement_content; re-generation doesn't clear it.
- [ ] Implement: add `supplement_content: str | None = None` parameter; write to row; preserve during re-generation (only update `content`).
- [ ] Test: insert entry with supplement → call `upsert_entry` without supplement → row still has supplement; generator path verifies supplement survives dirty re-gen.
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(rag): extend WikiStore.upsert_entry to accept and preserve supplement_content`.

## Task 3: P1 Wiki 双模式编辑——前端 WikiEditDialog 组件 ✅ 计划中（待实施）

**Files:**
- Create: `frontend/src/components/workspace/knowledge/wiki/WikiEditDialog.tsx`
- Modify: `frontend/src/components/workspace/knowledge/wiki-panel.tsx` (edit button integration)
- Modify: `frontend/src/core/i18n/locales/types.ts` / `zh-CN.ts` / `en-US.ts`
- Create: `frontend/tests/unit/components/workspace/knowledge/wiki/WikiEditDialog.dom.test.tsx`

- [ ] RED test: render dialog with existing entry shows both textareas (main + supplement); audit badges display `last_edited_at` when updated.
- [ ] Implement: dual-mode form with validation (main required, supplement optional); save sends PATCH `/knowledge-bases/{kb_id}/wiki/entries/{entry_id}` body `{content, supplement_content}`; error toast on failure.
- [ ] Test GREEN; revert proof; restore.
- [ ] Commit: `feat(frontend): add WikiEditDialog with dual-mode editor and audit badges`.

## Task 4: P2 切片文本编辑 API + Qdrant 单向量重嵌入 ✅ 计划中（待实施）

**Files:**
- Create: `backend/packages/harness/deerflow/persistence/migrations/versions/0015_chunk_last_edited_at.py`
- Modify: `backend/app/gateway/routers/knowledge_bases.py`
- Modify: `backend/app/gateway/services/knowledge_service.py`
- Create: `backend/tests/knowledge/test_chunk_edit_api.py`
- Modify: `frontend/src/components/workspace/knowledge/document-panel.tsx`
- Create: `frontend/tests/unit/components/workspace/knowledge/document-panel.chunk-edit.dom.test.tsx`

- [ ] RED test: PATCH chunk fails with 404 if not found; 422 if empty text.
- [ ] Implement: `update_chunk_text` endpoint updates `chunks.text`, recalculates `token_count`, writes `last_edited_at`; triggers Qdrant upsert with same point ID but new dense vector.
- [ ] Test: submit edited text → DB row updated; Qdrant query returns new text (not old embedding); no change to `entities` JSON column (ID 引用 unchanged).
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(rag): enable chunk text editing with single-vector re-embedding`.

## Task 5: P5 删除失格预览（dry-run）✅ 计划中（待实施）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/graph/store.py` (extract pure calculation)
- Modify: `backend/app/gateway/routers/knowledge_bases.py`
- Modify: `backend/app/gateway/services/knowledge_service.py`
- Create: `backend/tests/knowledge/graph/test_delete_preview.py`
- Modify: `frontend/src/components/workspace/knowledge/document-panel.tsx` (delete confirmation dialog)
- Create: `frontend/tests/unit/components/workspace/knowledge/document-panel.delete-preview.dom.test.tsx`

- [ ] RED test: preview API returns wrong orphaned count if calculation logic flawed.
- [ ] Implement: refactor `remove_chunk_contributions` into `calculate_deletion_impact` pure function (read-only); preview POST endpoint calls this, displays results in Dialog before confirming true deletion.
- [ ] Test: send chunk IDs → API returns `{orphaned_entities, affected_entities, relation_deletions}`; delete confirmed only after user clicks "Yes" in warning Dialog.
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(rag): add chunk deletion impact preview with orphan detection`.

## Task 6: P3 单切片实体重抽取 ✅ 计划中（待实施）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/worker.py` (extract per-chunk extract function)
- Modify: `backend/app/gateway/routers/knowledge_bases.py`
- Modify: `backend/tests/knowledge/test_worker_per_chunk_extract.py`
- Modify: `frontend/src/components/workspace/knowledge/document-panel.tsx` (re-extract button + concurrency guard)

- [ ] RED test: per-chunk extraction fails if document worker is mid-flight.
- [ ] Implement: extract `_per_chunk_extract_entities(chunk_id, kb_id)` from `_reparse_and_chunk`; new endpoint triggers this only (no full doc re-parse); concurrency guard prevents parallel execution on same document.
- [ ] Test: click re-extract → calls endpoint; success toast; stale entity removed, new one created; other chunks' entities untouched.
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(rag): implement single-chunk entity re-extraction with document-level concurrency guard`.

## Task 7: P6 人工知识卡片系统——数据库模型与 CRUD API ✅ 计划中（待实施）

**Files:**
- Create: `backend/packages/harness/deerflow/persistence/migrations/versions/0016_manual_knowledge_table.py`
- Modify: `backend/packages/harness/deerflow/knowledge/models.py` (add `ManualKnowledgeRow`)
- Modify: `backend/app/gateway/routers/knowledge_bases.py`
- Modify: `backend/app/gateway/services/knowledge_service.py`
- Create: `backend/tests/knowledge/test_manual_knowledge_api.py`
- Modify: `frontend/src/core/knowledge/api.ts`
- Create: `frontend/src/components/workspace/knowledge/cards/ManualCardPanel.tsx`
- Modify: `frontend/src/components/workspace/knowledge/page.tsx` (tab container add second panel)
- Create: `frontend/tests/unit/components/workspace/knowledge/cards/ManualCardPanel.dom.test.tsx`

- [ ] RED test: create card fails without required fields; list paginated correctly.
- [ ] Implement: `ManualKnowledgeRow` model; CRUD endpoints POST/GET/PATCH/DELETE; default `include_in_wiki_search=false`; frontend CRUD panel with "New Card" button.
- [ ] Test: create card → stored with metadata; toggle "混入搜索" → database flag updated; list API includes/excludes based on flag.
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(rag): implement manual knowledge card CRUD with wiki search integration toggle`.

## Task 8: P6 人工知识卡片系统——Wiki 路混排检索实现 ✅ 计划中（待实施）

**Files:**
- Modify: `backend/packages/harness/deerflow/tools/builtins/wiki_search_tool.py`
- Create: `backend/packages/harness/deerflow/knowledge/vector_store.py` method `query_manual_cards`
- Modify: `frontend/src/components/chat/CitationHoverCard.tsx` (source_type badge)
- Modify: `frontend/src/core/knowledge/types.ts` (add `source_type: "manual"`)

- [ ] RED test: manual cards with include flag appear in top_k ranked by score.
- [ ] Implement: `wiki_search_impl` calls `query_manual_cards(kb_id, include_in_wiki_search=True, limit=top_k - len(ai_hits))`; merge arrays; sort by score desc; attach `source_type` field.
- [ ] Test: query matching both AI and manual → mixed results returned; manual entries show "My Card" badge in hover card.
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(rag): integrate manual cards into wiki retrieval path with shared top_k pool`.

## Task 9: P6 人工知识卡片系统——前端展示与引用标识完整流程 ✅ 计划中（待实施）

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/page.tsx` (add "我的知识卡片" collapsible section)
- Modify: `frontend/src/components/chat/MessageList.tsx` (citation rendering logic)
- Create: `frontend/tests/unit/components/workspace/knowledge/page.manual-cards-section.dom.test.tsx`

- [ ] RED test: card toggles visibility; citation badge renders correctly.
- [ ] Implement: tab container adds third section `<CollapsibleSection title="我的知识卡片">`; MessageList passes `source_type` to CitationHoverCard; badge component selects icon based on source.
- [ ] Test: open/collapse works; clicked card opens drawer; hover on `[n]` shows correct badge.
- [ ] GREEN; revert proof; restore.
- [ ] Commit: `feat(frontend): complete manual cards display and citation badge workflow`.

## Task 10: 文档同步与全量回归

**Files:**
- Modify: `backend/AGENTS.md` (RAG 小节新增补充层/手动卡片/混排检索描述)
- Modify: `docs/superpowers/specs/2026-08-15-rag-phase3-editing-design.md`（状态翻转 + 日期）
- Modify: `docs/superpowers/plans/2026-08-15-rag-phase3-edition.md`（本 Plan）

- [ ] Spec 状态翻转为「✅ 已落地」，标注 2026-08-15.
- [ ] `cd backend && uv run pytest tests/knowledge -q` 全量 GREEN; `make lint && make format` clean.
- [ ] `cd frontend && pnpm test && pnpm check` clean.
- [ ] Commit: `docs(rag): sync agent guides and spec status for phase-3 edition`.

## Final verification

- [ ] 后端 `uv run pytest tests/knowledge -q` 全量 GREEN（预期：较 Phase-2 Batch-1 基线 +12）。
- [ ] 前端 `pnpm test` 全量 GREEN（预期：较 Phase-2 Batch-1 基线 +18）。
- [ ] Live 冒烟（真实 key + Qdrant）：
  - 编辑任意 Wiki 条目，补充层添加内容 → 触发新文档入库 → 增量重生 → 检查补充层保留
  - 创建一张人工卡片，开启「混入搜索」开关 → 问答页提问 → 查看引用卡片显示「My Card」徽章
  - 截图留档至 `pr-build/issue-xxxx-rag-phase3-validation.png`
- [ ] 测试覆盖率报告 + 回归证明点提交记录归档。

### Live 冒烟结果摘要（待填充）

| 测试项 | 预期结果 | 实际结果 | 状态 |
|--------|----------|----------|------|
| Wiki 编辑双模式 | 补充层保留不变 | TBD | ⏳ |
| 切片编辑 + 向量更新 | Qdrant 返回新文本 | TBD | ⏳ |
| 删除预览弹窗 | 红色失格列表展示 | TBD | ⏳ |
| 单切片重抽取 | 仅改当前实体 | TBD | ⏳ |
| 人工卡片 CRUD | 列表/新建/删除正常 | TBD | ⏳ |
| Wiki 路混排 | source_type="manual"出现 | TBD | ⏳ |


**End of Plan** — Ready for TDD implementation cycle 🚀
