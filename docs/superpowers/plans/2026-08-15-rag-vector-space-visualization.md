# RAG Vector Space Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth middle-column tab「向量空间」to the knowledge-base detail view, projecting the four Qdrant collections (chunks/entities/wiki/cards — one shared 1024-dim dense space) onto an interactive 2D/3D scatter, with a dual-channel retrieval overlay (recall test + normal RAG chat) as the differentiating capability. This plan only decomposes implementation tasks; all design decisions live in the spec.

**Spec:** `docs/superpowers/specs/2026-08-15-rag-vector-space-visualization-design.md`（已定稿）
**基线：** `342b71f4`（spec 提交，分支 `feat/rag-knowledge-base`）

**Architecture:** Backend gains a pure `knowledge/projection/` package (reducer / fetcher / cache) plus two endpoints on the existing `knowledge_bases` router. Frontend mounts a lazy-loaded echarts canvas behind a mockable adapter, extends `KnowledgeMiddleTab` with `vectors`, and lifts recall results + the latest chat turn's citations to page-level state for the overlay.

**Tech Stack:** numpy（PCA 自实现，SVD 走 `anyio.to_thread`）+ FastAPI（backend）；echarts + echarts-gl（`next/dynamic` 懒加载）+ rstest（frontend）。

**Global Constraints:**
- Branch: `feat/rag-knowledge-base`（沿用当前工作分支）; each task: RED → GREEN → regression proof (revert→RED→restore→GREEN) → commit (Conventional Commits).
- Backend TDD mandatory: `cd backend && uv run pytest <file> -q`；frontend DOM tests (`pnpm test`)，收尾 `pnpm check` + `ruff` 双净。
- Integration tests touching real Qdrant use marker `requires_qdrant`（本地 `docker start qdrant`）。
- Known code facts (verified 2026-08-15, pre-construction):
  - 四 collection 共享 1024 维 dense 空间；payload 均带 `kb_id`（chunks 另带 `doc_id/doc_name/entities`，entities 带 `name/type/description`，wiki/cards 带 title）——scroll 按 `kb_id` 过滤即可。
  - chunks payload **无正文** → hover preview 必须按 `chunk_id` 回业务 DB join `chunks.text[:120]` + `heading_path`。
  - `chunks` 表**无 `created_at`**，仅有 nullable `last_edited_at`（Phase-3 P2）→ 指纹公式 `count(*) + max(last_edited_at)`。
  - `KnowledgeCitation.chunk_id` 已存在，`sourcesForAssistantMessage`（citations.ts）已解析每轮引用 → 对话联动零后端取数。
  - `middle-tabs.tsx` 三 tab `forceMount` keep-alive；`KnowledgeMiddleTab = "documents" | "wiki" | "recall"` 需扩展 `"vectors"`。
  - numpy 当前仅由 qdrant-client 传递引入 → 必须在 harness `pyproject.toml` 显式声明。
  - 前端零图表库；`performance-budgets.json` 需为 echarts 异步 chunk 加预算条目。
  - blockbuster 纪律：PCA 的 SVD 是 CPU 密集计算，必须 `anyio.to_thread`，不得阻塞事件循环。

## Task 1: P1 降维引擎——numpy PCA 纯函数 + transform ✅ 已完成（2026-08-15）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/projection/__init__.py` ✅
- Create: `backend/packages/harness/deerflow/knowledge/projection/reducer.py` ✅
- Create: `backend/tests/knowledge/projection/__init__.py` + `test_reducer.py` ✅（tests/knowledge 子目录惯例带 __init__.py）
- Modify: `backend/packages/harness/pyproject.toml`（numpy 显式声明）+ `uv.lock` ✅

- [x] RED test: 11 用例（主方向余弦 >0.99 / variance_ratio 单调递减且主导 / transform 与手算一致 / 尺度不变性 / 未见过 query 投影 / dims 校验 / 空输入 / 点数少于 dims 零填充 / 零向量保护 / l2_normalize / umap 未装报错）。collection error 确认 RED。
- [x] Implement: 中心化 + `np.linalg.svd`；`PCAModel` frozen dataclass（transform 内重复 fit 期归一化，fit/transform 永不漂移）；`umap_reduce` 延迟 import 抛 `UmapUnavailableError`（带安装提示，供 API 层转 400）。
- [x] GREEN（11 passed）；revert proof：移走 reducer.py → collection error → 恢复 → 11 passed。
- [x] ruff check/format 双净；`uv lock` 同步（numpy 提升为直接依赖）。
- [x] Commit: `feat(rag): add PCA projection reducer with query transform support`（`5db87d50`）

## Task 2: P2 数据获取与采样层 ✅ 已完成（2026-08-15）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/projection/fetcher.py` ✅
- Create: `backend/tests/knowledge/projection/test_fetcher.py` ✅
- Modify: `backend/packages/harness/deerflow/knowledge/vector_store.py` ✅（Plan 外追加但属必然：fetcher 需要公开访问器——新增 `scroll_collection`（分页 id+payload）与 `retrieve_vectors`（按原生 point id 批量取 dense））
- Modify: `backend/tests/knowledge/test_vector_store.py`（追加 2 个 requires_qdrant 集成用例）✅

- [x] RED test: 11 fake 单测（四 collection 合并与 source_type 标注 / 阈值下不采样 / 超阈值 ID 先拉+子采样+确定性种子 / 仅 chunks 采样 / 预览截断 120 / DB 缺失回退 doc_name / 向量缺失静默丢弃且矩阵对齐 / 空 KB / collection 选择限定 / 10000 硬顶 / 未知 collection ValueError）+ 2 集成用例（scroll 分页+kb 过滤 / retrieve 对齐）——ModuleNotFoundError 与 AttributeError 双边 RED 确认。修正过一次测试自身 bug（模拟 scroll 后删除需 fake 支持 drop_on_retrieve）。
- [x] Implement fetcher（采样上限 10000 硬顶；返回 `total_points/shown_points/sampled`）。
- [x] GREEN（projection 24 + vector_store 13 = 35 passed，含真实 Qdrant）；revert proof 通过。
- [x] ruff check/format 双净。
- [x] Commit: `feat(rag): add projection fetcher with id-subsampling and preview join`（`a0b49031`）

## Task 3: P3 投影缓存与内容指纹 ✅ 已完成（2026-08-15）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/projection/cache.py` ✅
- Create: `backend/tests/knowledge/projection/test_cache.py` ✅
- Modify: `backend/packages/harness/deerflow/knowledge/store.py` ✅（Plan 外必然追加：指纹的 DB 侧信号源 `get_kb_content_stats`，一次 session 四条聚合查询；顺带把 `count_chunks` 的局部 func import 收进顶部）

- [x] RED test: 8 用例——指纹命中不重算（compute 计数断言）/ 指纹变化重算并替换（后续命中拿到新值）/ `refresh=True` 跳过比对 / 10 并发只算一次（1 False + 9 True）/ key 独立 / 指纹函数确定性+五路信号敏感 / store stats 聚合（含 kb 隔离、编辑翻转、空 kb 零值）。
- [x] Implement 进程内缓存 `{(kb_id, algo, dims, sample_size): CachedProjection}`（per-key 双检锁；fingerprint/created_at 由 cache 统一填，compute 只管算）。
- [x] GREEN（projection 29 passed）；revert proof 通过。修过一次测试数据 bug（graph_entities.id 是必填 String 主键）。
- [x] ruff check/format 双净。
- [x] Commit: `feat(rag): cache vector projections behind a content fingerprint`（`b56c691f`）

## Task 4: P4 API 契约——投影端点 + query 投影端点

**Files:**
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（GET `/vector-projection` + POST `/vector-projection/query`）
- Modify: `backend/app/gateway/services/knowledge_service.py`
- Create: `backend/tests/knowledge/test_vector_projection_api.py`

- [ ] RED test（对齐 `test_chunk_edit_api.py` 基建）: GET 200 契约（points schema / `cached` / `sampled` / `fingerprint` / `computed_ms`）；`algo=umap` 未装 → 400 带安装提示；`dims=4` → 400；未知 kb → 404；POST query：先 GET 建缓存 → 200 坐标；无缓存 → 409；非 PCA 模型 → 409。
- [ ] Implement service + router（SVD 走 `anyio.to_thread`；query embed 复用检索测试的 embedder 解析链；query 端点不触发投影计算）。
- [ ] GREEN；regression proof；restore。
- [ ] Commit: `feat(rag): expose vector projection and query-transform endpoints`

## Task 5: 前端 api client + 第四 tab 挂载

**Files:**
- Modify: `frontend/src/core/knowledge/api.ts` / `types.ts` / `hooks.ts`
- Modify: `frontend/src/components/workspace/knowledge/middle-tabs.tsx`（`KnowledgeMiddleTab` 扩 `"vectors"` + TabsTrigger/TabsContent）
- Modify: `frontend/src/core/i18n/locales/types.ts` / `zh-CN.ts` / `en-US.ts`（`tk.tabs.vectors`）
- Create: `frontend/tests/unit/knowledge/vector-tab.dom.test.tsx`

- [ ] RED test: 第四个 trigger 渲染「向量空间」；点击切 tab 触发 `onTabChange("vectors")`；pane `forceMount` keep-alive。
- [ ] Implement client/types/hook + tab 挂载（pane 先放空态占位）。
- [ ] `pnpm test` GREEN；regression proof；restore。
- [ ] Commit: `feat(frontend): mount the vector space tab in the knowledge middle column`

## Task 6: P5 2D 散点 + 着色 + hover/详情联动

**Files:**
- Modify: `frontend/package.json`（echarts + echarts-gl）与 `frontend/performance-budgets.json`（异步 chunk 预算）
- Create: `frontend/src/components/workspace/knowledge/vector-tab.tsx`（数据/交互）与 `vector-canvas.tsx`（echarts 适配层，`next/dynamic` 懒加载）
- Modify: `frontend/tests/unit/knowledge/vector-tab.dom.test.tsx`

- [ ] RED test（`vector-canvas` 整体 mock，断言 props）: 工具栏渲染（collection chips / 2D·3D / 算法 / 重新计算）；着色规则（chunk=doc_id、entity=type、wiki/card=source_type，图例可开关）；hover tooltip 数据（label + ≤120 字符 preview）；点击点 → 复用现有 chunk 抽屉 / wiki 条目 / 卡片抽屉打开链路；空 KB 空态引导；索引中提示。
- [ ] Implement 双组件 + echarts scatterGL 配置生成。
- [ ] `pnpm test` GREEN；regression proof；restore。
- [ ] Commit: `feat(frontend): render the 2D vector scatter with coloring and drill-down`

## Task 7: P5 3D 切换 + 采样徽标 + 重新计算

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/vector-tab.tsx` / `vector-canvas.tsx`
- Modify: `frontend/tests/unit/knowledge/vector-tab.dom.test.tsx`

- [ ] RED test: 切 3D → 请求 `dims=3` 且生成 scatter3D 配置；`sampled=true` → 徽标「已抽样 5000/12345 点」；「重新计算」→ 请求带 `refresh=true` 并刷新画布。
- [ ] Implement。
- [ ] `pnpm test` GREEN；regression proof；restore。
- [ ] Commit: `feat(frontend): add 3D projection mode and sampling controls`

## Task 8: P6 检索联动双通道

**Files:**
- Modify: recall 面板组件（结果区「在向量空间查看」按钮）
- Modify: `frontend/src/components/workspace/knowledge/page.tsx` / `chat-panel.tsx`（recall 结果 + 最新一轮对话引用提升到 page 层共享 state）
- Modify: `frontend/src/components/workspace/knowledge/vector-tab.tsx`（叠加层：query 菱形标记 + 命中点高亮/连线/score 色深 + 「跟随对话」开关）
- Modify: `frontend/tests/unit/knowledge/vector-tab.dom.test.tsx`（+ recall/chat 联动用例）

- [ ] RED test: recall 点击「在向量空间查看」→ 切 tab + overlay（query 点 + 命中高亮）；对话完成一轮（含引用）→ overlay 自动更新；`fingerprint` 不一致 → 丢弃旧 overlay 并提示；`algo=umap` → 联动禁用提示；「跟随对话」关闭 → overlay 冻结。
- [ ] Implement 状态提升 + 叠加渲染 + POST `/vector-projection/query` 调用。
- [ ] `pnpm test` GREEN；regression proof；restore。
- [ ] Commit: `feat(frontend): overlay retrieval context on the vector projection`

## Task 9: 文档同步 + 全量回归 + Live 冒烟

**Files:**
- Modify: `backend/AGENTS.md`（RAG 小节补投影段）
- Modify: `docs/superpowers/specs/2026-08-15-rag-vector-space-visualization-design.md`（状态翻转「已落地」+ 日期）
- Create: `pr-build/rag-vector-space-*.png`（冒烟截图）

- [ ] Spec 状态翻转为「✅ 已落地」；AGENTS.md 落档。
- [ ] `cd backend && uv run pytest tests/knowledge -q` 全量 GREEN；`ruff check/format` 双净。
- [ ] `cd frontend && pnpm test && pnpm check` 双净；echarts chunk 在性能预算内。
- [ ] Live 冒烟（真实 key + Qdrant）：
  | 冒烟项 | 步骤 | 预期 | 结果 | 证据 |
  |---|---|---|---|---|
  | 投影出图 | JVM 知识库 → 向量空间 tab | 四类点同图分色，hover 预览，点击开详情 | | |
  | 缓存命中 | 二次打开 + 改动文档后「重新计算」 | 命中 <200ms；重算后指纹变化 | | |
  | 检索联动 | recall 检索 → 「在向量空间查看」 | 一键切 tab + query 落点 + 命中高亮连线 | | |
  | 对话联动 | 右栏对话一轮（含引用）→ 切向量 tab | 该轮 query 落点与命中叠加可见 | | |
- [ ] Commit: `docs(rag): sync agent guides and spec status for vector space visualization`
