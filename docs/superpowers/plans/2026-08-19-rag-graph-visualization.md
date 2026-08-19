# RAG Knowledge Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth middle-column tab「知识图谱」to the knowledge-base detail view, rendering `graph_entities` / `graph_relations` as an interactive force-directed graph (Louvain community coloring, mention-count sizing, drill-down to chunks/documents), with a differentiating graph_search retrieval-path overlay (seed → expansion → evidence three-layer highlighting).

**Spec:** `docs/superpowers/specs/2026-08-19-rag-graph-visualization-design.md`（已定稿）

**基线：** `0a1b5ec6`（向量空间 Task 9 docs 提交，分支 `feat/rag-knowledge-base`）

**Architecture:** Backend adds a pure `graph/communities.py` (Louvain wrapper) plus one read-only endpoint on the existing `knowledge_bases` router — no cache, no migration, no new dependency. Frontend mounts a lazy-loaded echarts `graph` (force) canvas behind the vector-space adapter pattern, extends `KnowledgeMiddleTab` with `"graph"`, and lifts graph_search retrieval traces to page-level state for the overlay (mirroring the `vectorOverlay` precedent).

**Tech Stack:** networkx Louvain（已有显式依赖）+ FastAPI（backend）；echarts `graph` 系列 force layout（已有依赖，**零新增**）+ rstest（frontend）。

**Global Constraints:**
- Branch: `feat/rag-knowledge-base`（沿用当前工作分支）; each task: RED → GREEN → regression proof (revert→RED→restore→GREEN) → commit (Conventional Commits).
- Backend TDD mandatory: `cd backend && uv run pytest <file> -q`；frontend DOM tests (`pnpm test`)，收尾 `pnpm check` + `ruff` 双净。
- Integration tests touching real Qdrant use marker `requires_qdrant`（本 plan 预计用不上——图数据全在 SQLite）。
- Known code facts (verified 2026-08-19, pre-construction):
  - `GraphStore.list_entities/list_relations(kb_id)` 现成返回全量 dict；**无 mention_count 列**——`len(source_chunk_ids)` 即提及数。
  - 实体名即节点 id（KB 内唯一，`uq_graph_entities_kb_name`）；关系端点是实体名；**关系有向**（渲染必须带箭头）。
  - `nx.community.louvain_communities(G, seed=42)` 内置可用；**固定种子**保着色稳定；社区 id 按规模降序重编号。
  - 检索轨迹现成：`graph/retrieval.py::ExpansionResult`（seen/entity_scores/hop）；P4 仅需 tool 层透传，不动检索逻辑。
  - `KnowledgeMiddleTab = "documents" | "wiki" | "recall" | "vectors"`（middle-tabs.tsx），四 pane `forceMount` keep-alive；扩 `"graph"` 纯增量。
  - echarts 5.6 + echarts-gl 2.1 已在依赖中；`graph` 系列 + `layout:"force"` 开箱即用，**本 plan 零新前端依赖**。
  - 向量空间留下的可复用资产：`buildTooltipHtml` / `truncate` / `escapeHtml` / `DIMMED_OPACITY` / FNV-1a 调色板 / 叠加徽标模式 / `next/dynamic ssr:false` 适配层模式 / canvas mock 测试基建。
  - blockbuster 纪律：Louvain 百节点 <10ms 无需 to_thread；**端点不做缓存**（现算永远最新，spec §3）。

## Task 1: P1 图数据端点——社区检测纯函数 + GET /graph ✅ 已完成（2026-08-19）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/graph/communities.py`（Louvain 包装纯函数）
- Create: `backend/tests/knowledge/graph/test_communities.py`
- Modify: `backend/app/gateway/services/knowledge_service.py`（+`get_knowledge_graph`）
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（+GET `/{kb_id}/graph`）
- Create: `backend/tests/knowledge/test_graph_api.py`（对齐 test_vector_projection_api.py 基建）

- [x] RED test（communities 纯函数）: 固定种子确定性（同输入两次同社区划分）/ 孤立节点独立社区 / 社区 id 按规模降序（0=最大）/ 空图返回空 / 单节点 / 自环边剔除 / 幽灵端点跳过（7 用例）。
- [x] Implement `assign_communities(entities, relations) -> dict[name, int]`（有向转无向参与 Louvain；seed=42 钉死；规模降序重编号，同数按最小名字典序保完全确定性）。
- [x] RED test（API）: nodes/edges 契约 schema / `mention_count == len(source_chunk_ids)` / 空 KB 200 空图 + stats 零值 / 未知 kb 404 / 两次请求社区一致（4 用例，初始 3 failed 确认）。
- [x] Implement service + router（全量读 → 内存建图 → 社区检测 → 响应；无缓存无 to_thread）。
- [x] GREEN（graph/ 全套 86 passed 含既有回归）；revert proof：stash 实现 + 移走 communities.py → collection error RED → 恢复 → GREEN。
- [x] ruff check/format 双净。
- [x] Commit: `feat(rag): expose the knowledge graph endpoint with Louvain communities`（`d25754cc`）

## Task 2: 前端 api client + 第五 tab 挂载 ✅ 已完成（2026-08-19）

**Files:**
- Modify: `frontend/src/core/knowledge/types.ts`（`KnowledgeGraphNode/Edge/Response`）/ `api.ts`（`getKnowledgeGraph`）/ `hooks.ts`（`useKnowledgeGraph` lazy 门控，对齐 useVectorProjection 先例）
- Modify: `frontend/src/components/workspace/knowledge/middle-tabs.tsx`（`KnowledgeMiddleTab` 扩 `"graph"` + 第五 TabsTrigger/TabsContent + 必填 `graph: ReactNode` prop）
- Modify: `frontend/src/core/i18n/locales/types.ts` / `zh-CN.ts` / `en-US.ts`（`tk.tabs.graph` = 知识图谱 / Knowledge graph）
- Modify: `frontend/src/app/workspace/knowledge/page.tsx`（占位 pane，Task 3 填本体）+ 既有 tab 测试文件补 graph prop（必填 prop 编译强制）
- Create: `frontend/tests/unit/knowledge/graph-tab.dom.test.tsx`

- [x] RED test: 第五个 trigger 渲染「知识图谱」；点击切 tab pane active；五 pane forceMount keep-alive（3 用例确认 RED——TS 编译错 + 断言失败）。踩坑：Radix Tabs automatic 激活在 **mousedown** 触发（fireEvent.click 不切换），断言锁定 `[data-slot='tabs-content']`（对齐 vector-tab 先例）。
- [x] Implement client/types/hook + tab 挂载（pane 空态占位 `graph-space-placeholder`）。query key 走函数族惯例 `knowledgeGraphKey(kbId)`。
- [x] `pnpm test` GREEN（3 新 + 56 相关回归）；revert proof（stash 6 实现文件 → 编译/断言 RED → 恢复 → 3 passed）；`pnpm check` 双净（eslint import/order 自动修复一次）。
- [x] Commit: `feat(frontend): mount the knowledge graph tab in the knowledge middle column`（`0b33c9e2`）

## Task 3: P2 力导向图渲染 + 编码 + hover/点击钻取 ✅ 已完成（2026-08-19）

**Files:**
- Create: `frontend/src/components/workspace/knowledge/graph-canvas.tsx`（echarts 适配层：`graph` 系列 force layout，`next/dynamic ssr:false`）
- Create: `frontend/src/components/workspace/knowledge/graph-tab.tsx`（数据/工具栏/图例/钻取分发）
- Modify: `frontend/src/app/workspace/knowledge/page.tsx`（接线：enabled 懒门控 + 实体点击 → 关联切片列表 → 文档抽屉，复用向量空间 drill-down 链路）
- Modify: i18n 三处（`tk.graphSpace.*`）
- Create: `frontend/tests/unit/knowledge/graph-canvas.unit.test.ts`（编码纯函数）
- Modify: `frontend/tests/unit/knowledge/graph-tab.dom.test.tsx`

- [x] RED test: 编码纯函数——mention_count √开方 → symbolSize 10–28 档位 / type FNV-1a 稳定着色 / 边有向箭头配置 / tooltip 复用 buildTooltipHtml（label+preview 各 20 字）；tab 三态（加载/空/错误）；点击实体 → 抽屉 → onOpenChunk 分发（12 用例）。后端补 RED 断言：节点透传 source_chunk_ids（钻取链路唯一数据源）。
- [x] Implement 双组件 + force 配置（repulsion 120 / edgeLength 40–120 / gravity 0.1；roam/draggable/layoutAnimation: true；emphasis.focus=adjacency 邻居高亮 echarts 内置）。范围微调：GET /graph 节点补 source_chunk_ids（spec §5 钻取必需，Task 1 遗漏）；chunk_id 内嵌 doc_id 直接解析，零新端点。
- [x] `pnpm test` GREEN（23 = 12 新 + 挂载回归；knowledge 全量 363 passed）；revert proof（移走双组件+stash 修改 → 编译 RED → 恢复 → GREEN）；`pnpm check` 双净（next/dynamic 懒加载需 waitFor 异步挂载断言；eslint --fix import/order 一次）。
- [x] 浏览器实测（286 实体 · 255 关系 · 80 社区）：出图分色成簇 / 边箭头 / 节点+边 tooltip / 点击实体 → 抽屉 → 切片 → 文档预览抽屉全链路通；console 干净。
- [x] Commit: `feat(frontend): render the force-directed knowledge graph with drill-down`（`82ffb271`）

## Task 4: P3 搜索定位 + 局部图模式 + 着色切换 ✅ 已完成（2026-08-19）

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/graph-tab.tsx`（搜索框 + 着色 ToggleGroup + 局部图面包屑）
- Modify: `frontend/src/components/workspace/knowledge/graph-canvas.tsx`（搜索聚焦居中 / 邻居模式数据裁剪 / 社区色板）
- Modify: `frontend/tests/unit/knowledge/graph-tab.dom.test.tsx` / `graph-canvas.unit.test.ts`

- [x] RED test: 搜索命中 → 聚焦+居中 / 无命中提示；着色切换 type↔community 两色板互斥（默认社区）；局部图模式只留 N 跳邻居（默认 1 跳）+ 面包屑返回；hover 邻居高亮（echarts adjacency 内置，Task 3 已钉断言）。纯函数 9 新用例（colorBy/matchEntityNames/filterNeighborhood）。
- [x] Implement。踩坑：dom 测试整体 mock graph-canvas 会把 tab import 的纯函数一并换掉 → **纯函数拆到独立 `graph-utils.ts`**（echarts-free，jsdom 直测），canvas 仅留组件层并 re-export 保持测试路径不变。搜索居中用 `getItemLayout`（内部 API，类型收窄断言）+ 500ms 布局稳定窗；双击进入局部图（单击=抽屉保留，Obsidian 惯例）。
- [x] `pnpm test` GREEN（37 passed）；revert proof 通过；`pnpm check` 双净（删多余 eslint-disable）。
- [x] 浏览器实测：搜索「JVM」→ 居中放大 + 邻居高亮其余淡化；按类型着色切换生效；双击「跨平台」→ 局部图 2 跳（Java 中心放射图）→ 面包屑返回全局。
- [x] Commit: `feat(frontend): add graph search, neighborhood mode, and coloring modes`（`cece5869`）

## Task 5: P4 graph_search 路径高亮联动（三层染色）

**Files:**
- Modify: `backend/packages/harness/deerflow/tools/builtins/graph_search_tool.py`（响应透传 trace：seed_entities / expanded_nodes(+hop) / evidence_entities——**只序列化输出，不动检索逻辑**）
- Modify: `backend/tests/knowledge/tools/test_graph_search.py`（trace 字段断言）
- Modify: `frontend/src/components/workspace/knowledge/chat-panel.tsx`（graph trace 上报，对齐 latestRetrievalTurn 先例）+ `page.tsx`（`graphOverlay` state 提升）
- Modify: `frontend/src/components/workspace/knowledge/graph-canvas.tsx`（overlay 三层染色）/ `graph-tab.tsx`（徽标 + 清除 + 指纹漂移清除，指纹=node_count+edge_count）
- Modify: i18n 三处（徽标文案「种子 m / 扩展 n / 证据 k」）
- Modify: `frontend/tests/unit/knowledge/graph-tab.dom.test.tsx` / `graph-canvas.unit.test.ts`

- [ ] RED test（后端）: graph_search 响应含三层 trace 字段，hop 信息完整。
- [ ] RED test（前端）: overlay 三层染色（种子红描边放大 #f5222d / hop-1 橙 hop-2 黄 / 证据红星标 / 其余 0.12 淡化）；徽标计数 + × 清除；指纹漂移清除；「跟随对话」开关共享语义。
- [ ] Implement 后端透传 + 前端 overlay（叠加系列 merge 稳定性对齐向量空间槽位教训）。
- [ ] `pnpm test` GREEN + `uv run pytest tests/knowledge -q` GREEN；revert proof；双净。
- [ ] Commit: `feat(rag): overlay graph_search retrieval paths on the knowledge graph`

## Task 6: 文档同步 + 全量回归 + Live 冒烟

**Files:**
- Modify: `backend/AGENTS.md`（RAG 小节补图可视化段）
- Modify: `docs/superpowers/specs/2026-08-19-rag-graph-visualization-design.md`（状态翻转「已落地」+ 日期）
- Create: `pr-build/rag-graph-*.png`（冒烟截图）

- [ ] Spec 状态翻转为「✅ 已落地」；AGENTS.md 落档。
- [ ] `cd backend && uv run pytest tests/knowledge -q` 全量 GREEN；`ruff check/format` 双净。
- [ ] `cd frontend && pnpm test && pnpm check` 双净。
- [ ] Live 冒烟（真实数据）：
  | 冒烟项 | 步骤 | 预期 | 结果 | 证据 |
  |---|---|---|---|---|
  | 图出图 | JVM 知识库 → 知识图谱 tab | 力导向图出图，大小/颜色编码正确，hover 详情 | | |
  | 点击钻取 | 点击实体 → 切片列表 → 文档 | 抽屉链路走通 | | |
  | 搜索+局部图 | 搜索实体名 → 邻居模式 | 定位居中 + N 跳裁剪 + 面包屑返回 | | |
  | 路径高亮 | 对话一轮（图谱路有命中）→ 切图谱 tab | 种子/扩展/证据三层染色 + 徽标计数 | | |
- [ ] Commit: `docs(rag): sync agent guides and spec status for graph visualization`
