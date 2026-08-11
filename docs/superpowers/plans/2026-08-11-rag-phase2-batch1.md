# RAG Phase-2 Batch-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the four phase-2 batch-1 items from the spec: recall-test API + middle-column「检索测试」tab (P1), citation UX rework (P2: type badges + superscript marks + collapsible sources), per-path document status (P3), and parsing extension with upload allowlist (P4) — plus the middle-column tab container with a read-only wiki tab that P1/P2 presuppose.

**Spec:** `docs/superpowers/specs/2026-08-11-rag-phase2-batch1-design.md`（所有设计决策的单一事实源；本 plan 只负责任务拆解，不复述设计论证）。主 spec `2026-08-07-rag-knowledge-base-design.md` 对应位置已含交叉引用。

**Architecture:** 后端改动集中在 `knowledge_bases.py` 路由 + `knowledge_service.py` + `parser.py` + worker/store（path_status）；召回测试复用三个检索 impl，不另起检索逻辑。前端改动集中在 `components/workspace/knowledge/`：中栏单面板改造为 tab 容器（文档/百科/检索测试），引用渲染链路（citations.ts → kb-citation-sources → 正文标记）全面翻新。

**Tech Stack:** 同一期（FastAPI + SQLAlchemy/Alembic + Qdrant；Next.js + react-query + Radix + rstest）。零新增外部依赖。

**Global Constraints:**
- 分支：沿用 `feat/rag-knowledge-base`；每个 task：RED → GREEN → 回归证明（revert→RED→restore→GREEN）→ commit（Conventional Commits）。
- Backend TDD mandatory：`cd backend && uv run pytest <file> -q`；frontend 组件随附 dom 单测（`pnpm test`），收尾 `pnpm check` + `make lint && make format` 干净。
- 集成测试（`requires_qdrant`）需要本地 Qdrant：`docker start qdrant`。
- 已知代码事实（施工前已核查，勿重复踩点）：
  - 中栏当前是 `DocumentPanel` 单面板，**无 tab 容器**；百科 tab 前端不存在（后端 `wiki/entries` API 已在一期落地）。
  - Alembic 在管 knowledge 表（`persistence/migrations/versions/0011_knowledge.py`）；新列走新 revision（`cd backend && make migrate-rev`）。
  - **路由顺序陷阱**：`GET /supported-formats` 必须注册在 `/{kb_id}` 之前，否则被路径参数吞掉。
  - 引用解析层 `citations.ts::parseRetrievalToolContent` 已持有 `toolName`，`source_type` 前端填充即可，**不改后端工具返回**。
  - `progress_percent` 只跟踪图谱路（最慢腿）；向量路完成状态无持久化——P3 的 `path_status` 列即载体。
  - rag agent SOUL 模板在 `backend/packages/harness/deerflow/agents/assets/rag/SOUL.md`（L14 已有 `[n]` 引用规则）。

## Task 1: 中栏 tab 容器 + 百科只读 tab（前端基础设施）✅ 已完成（2026-08-11）

**实施期偏差记录（契约修正）：**
1. `GET wiki/entries` 两个端点**一期并未落地**——存储层（`WikiStore.list_entries/get_entry`）存在但 HTTP 未透出。本 Task 一并补建：service `list_wiki_entries`（列表组装 summary=content[:120]，不含全文）/ `get_wiki_entry`（kb 归属校验，跨库 404）+ 两个 thin router 端点 + 3 个契约测试。
2. plan 原契约"DocumentPanel props 不变、既有测试零改动"**不成立**——三行结构必然要求 header 拆分：props 收窄（移除 onGenerateWiki/onRenameKb/onDeleteKb），库名+⋯菜单上移至 MiddleTabs 第一行；header 相关既有测试迁移至 wiki-panel.dom.test.tsx 的 MiddleTabs describe（覆盖不丢：rename/delete 对话框交互原样搬移）。上传按钮从 ⋯菜单移入文档 tab 工具行（文档动作归文档 tab）。
3. keep-alive 断言方式：Radix `forceMount` 保持挂载但**不加 hidden 属性**——可见性由 `data-[state=inactive]:hidden` 类承担，dom 测试以 `data-state` 断言。
4. `runAfterMenuClose` / 时间格式化抽为共享模块（`run-after-menu-close.ts` / `core/knowledge/format.ts`），DocumentPanel 改引用。
5. 副发现：Radix Tabs 在 happy-dom 中点击不激活（automatic 模式挂 mouseDown），测试用 `fireEvent.mouseDown`。

**验证结果**：后端 197 passed + 1 skipped；前端 knowledge 114 passed；`pnpm check` 干净；ruff check/format 干净。

**Files:**
- Modify: `frontend/src/app/workspace/knowledge/page.tsx`（中栏槽位改造为 tab 容器，`activeTab`/`activeEntryId` 状态提升到 page，供 P2 跳转复用）
- Create: `frontend/src/components/workspace/knowledge/middle-tabs.tsx`（tab 容器：文档 / 百科；P1 在 Task 3 加第三个 tab）
- Create: `frontend/src/components/workspace/knowledge/wiki-panel.tsx`（条目列表：title/summary/status(dirty 徽标)/updated_at；点击 → 右侧抽屉展示全文）
- Modify: `frontend/src/core/knowledge/hooks.ts`（`useWikiEntries` / `useWikiEntry`）、`frontend/src/core/knowledge/types.ts`（`WikiEntrySummary`/`WikiEntry`）
- Modify: i18n `types.ts` / `zh-CN.ts` / `en-US.ts`
- Create: `frontend/tests/unit/knowledge/wiki-panel.dom.test.tsx`、`middle-tabs.dom.test.tsx`

**接口契约（实现前冻结）：**
- `GET /api/knowledge-bases/{kb_id}/wiki/entries` → 列表（title/summary/status/updated_at，不含全文）；`GET .../wiki/entries/{entry_id}` → 全文（一期已落地，直接消费）。
- 中栏 tab 容器契约：`{ documents: <DocumentPanel/>, wiki: <WikiPanel/> }`；`activeTab: "documents" | "wiki"` 由 page 持有；**条目全文抽屉状态独立于 tab**（`entryDrawerId: string | null` 由 page 持有）：`openWikiEntry(entryId)` = 仅开右侧抽屉展示全文（不切 tab——引用点击是验证性动作，叠加层不劫持中栏状态，见 spec §4 修正说明），`revealWikiEntry(entryId)` = 切 tab + 定位条目（抽屉内「在百科 tab 中查看」二级入口用）。
- 百科 tab 只读：不做重生成/编辑等管理操作（"可视化管理"属后续项）。
- **中栏三行结构（层级归属决策）**：第一行 = 库名 + ⋯库级菜单（上传/生成百科/重命名/删除——库级动作，对所有 tab 可见，从 DocumentPanel header 拆分上移）；第二行 = tab 导航条；第三行起 = 各 tab 内容。文档 tab 工具行保持精简（搜索 + 排序）。〔2026-08-11 修正：上传从文档工具行挪回 ⋯菜单——用户反馈工具行拥挤；上传实为库级动作（往当前库加文档），与生成百科同级〕DocumentPanel 保持可独立渲染，既有 dom 测试迁移至 MiddleTabs。
- **tab 内容 keep-alive**：三个面板保持挂载（`hidden` 属性切换，不卸载）——文档 tab 的搜索词/排序/选中行/滚动位置与 indexing 轮询在切换时不丢；百科/检索测试的数据 hook 用 `enabled: activeTab === ...` 门控 lazy，首次激活才拉取。
- 窄窗口：三 tab 标签约 200px，中栏保底 `min-w-[20rem]` 下无溢出；既有横向滚动宪底不动。

- [x] 写失败测试：tab 切换渲染；条目列表渲染（含 dirty 徽标）；点击条目开抽屉加载全文；`openWikiEntry` 只开抽屉不切 tab；`revealWikiEntry` 切 tab + 定位；keep-alive（切换后文档 tab 的搜索词/选中行保留）；库名与⋯菜单（含上传）在第一行、文档 tab 工具行仅搜索+排序。
- [x] 运行 `pnpm test` 捕获 RED。
- [x] 实现组件 + hooks + i18n；测试 GREEN；`pnpm check` 干净。
- [x] Commit: `feat(frontend): add middle-column tabs with read-only wiki entries panel`。

## Task 2: P1 召回测试后端 API（TDD）✅ 已完成（2026-08-11）

**实施记录**：契约与 plan 一致，无偏差。单测 5 个（mock 三 impl 于 service 模块边界）+ 集成测试 1 个（requires_qdrant，`tools_env` 真实 impl 直调对比一致）。revert 证明点已执行：`_timed` 降级改为 re-raise → 降级用例 RED（500）→ restore → GREEN。实施中发现的一个坑：`_extract_query_entities` 期望 `{"entities": [...]}` dict 格式，测试 LLM stub 返回裸 list 会被静默丢弃为 []——stub 已对齐全仓 test_graph_search.py 的 `{"entities": ...}` 形态。

**Files:**
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（新增 `POST /{kb_id}/recall-test`；删除文件 docstring 中 "The recall-test endpoint is Phase 2 and deliberately absent" 一句）
- Modify: `backend/app/gateway/services/knowledge_service.py`（`recall_test(kb_id, user_id, query, top_k)`：构造 `SimpleNamespace(context={kb_id, user_id})` runtime → `asyncio.gather(return_exceptions=True)` 并行调三 impl → 组装响应）
- Create: `backend/tests/knowledge/test_recall_test_api.py`

**接口契约（实现前冻结）：**
- 请求体 `RecallTestRequest(BaseModel)`：`query: str`（strip 非空）、`top_k: int = 5`（ge=1, le=20）。
- 响应严格按 spec §3 schema：`paths.{vector,graph,wiki}` + `score_type` + `elapsed_ms`；vector `score` 可空（rerank 降级）；graph 的 top_k 映射 `evidence_limit`。
- 单路异常不拖垮整响应：该路降级为空 hits + 该路 `message` 注明失败（gather return_exceptions 收集）。
- 门禁复用 `_require_kb_access`；401/403/404 语义与现有一致。

- [x] 写失败测试（mock 三 impl）：200 组装正确（score 可空/score_type/elapsed_ms/top_k→evidence_limit 映射断言）；单路抛错降级；query 空白 422；越权 403；不存在 404。
- [x] 集成测试（`requires_qdrant`，tools fixture 真实 impl）：对一个已索引夹具 kb 发召回测试，三路返回结构与 impl 直调一致。
- [x] 运行捕获 RED → 实现 → GREEN；revert 单路降级为整响应 500，证明降级用例 RED，restore，GREEN。
- [x] Commit: `feat(rag): add recall-test API over the three retrieval impls`。

## Task 3: P1 前端「检索测试」tab ✅ 已完成（2026-08-11）

**实施记录**：契约与 plan 一致，两处实现期决策记录：① top_k 控件用 `Input type=number`（提交时 clamp 1–20）而非 Select——中栏窄、选项型交互在此无收益且 dom 测试更稳；② “请求去抖”落实为 isPending 禁用提交 + Enter/按钮同一入口（显式动作场景，输入去抖无意义）。组件自治（useRecallTest + 本地 state），keep-alive 下上次结果跨 tab 切换保留。wiki 命中点击经 page 的 `setDrawerEntryId` 走右侧抽屉（不切 tab，与 Task 1 叠加层设计一致）。

**Files:**
- Create: `frontend/src/components/workspace/knowledge/recall-test-panel.tsx`
- Modify: `middle-tabs.tsx`（加第三 tab）、`hooks.ts`（`useRecallTest`）、i18n
- Create: `frontend/tests/unit/knowledge/recall-test-panel.dom.test.tsx`

**接口契约：**
- UI：query 输入 + top_k 选择 + 成本提示文案（"会产生检索调用成本"）+ 三路分栏（各带 `score_type` 标注与 `elapsed_ms`）；命中项复用 `ChunkCard` 展开原文；wiki 命中点击 → `openWikiEntry`（右侧抽屉，不切中栏）。
- 请求去抖/进行中禁用提交；错误 toast。

- [x] 写失败测试 → RED → 实现 → GREEN → `pnpm check`。
- [x] Commit: `feat(frontend): add recall test tab with three-path result panes`。

## Task 4: P2 引用 UX 改造 ✅ 已完成（2026-08-11）

**实施记录**：
1. **MessageList 注入点**：新增可选 prop `renderMessageContent(message, content, isLoading)`，仅作用于 assistant group 正文渲染点；不传时行为与现状完全一致（通用面板零影响）。KnowledgeChatPanel 的实现对非 ai 消息返回 undefined（人类消息中的 `[1]` 不会误上标化）。
2. **`[n]` 分片走 rehype 插件**（`rehype-citation-marks.ts`，手写递归遍历、无新依赖）：hast text 节点 → `<sup data-citation-index>`；跳过 code/pre 子树；限 1–2 位数字（`[100]` 不误伤）。`sup` 组件覆写按消息 sources 闭包取数，无效 index 回退裸 `<sup>` 不崩溃。
3. **锚点联动用 CustomEvent**（`kb-citation-jump`，detail `{messageId, index}`）：正文标记与底部来源区分属 MessageList 的两个 render prop，无共同 React 状态祖先，事件总线自包含；来源区按 messageId 过滤，跳转 → 展开 + 高亮 2s + chunk 自动展开 ChunkCard（覆盖移动端 tap 契约）。
4. **一期 kb-citation-sources/chat-panel 既有测试迁移**到新交互（先展开再断言；摘录与 ChunkCard 全文同文多处匹配，断言改 `getAllByText` 计数）。
5. **工程教训**：Write 工具覆盖已存在文件两次出现旧内容残留（新内容+旧尾部拼接）；且 PowerShell `Get-Content/Set-Content` 截断含中文的 UTF-8 文件会按 GBK 误读造成乱码+BOM。修复方式：DeleteFile 后 Write 重建，并用 Read 验证中文完整性。
6. revert 证明点已执行：折叠默认态改 `useState(true)` → 10 个折叠相关用例 RED → restore → GREEN。

**Files:**
- Modify: `frontend/src/core/knowledge/citations.ts`（`toCitation` 填充 `source_type`：`toolName === "wiki_search" ? "wiki" : "chunk"`）、`types.ts`（`KnowledgeCitation.source_type?`）
- Create: `frontend/src/components/workspace/knowledge/citation-mark.tsx`（上标徽章 + Radix `HoverCard` 预览：徽标/文档名/页码路径/摘录——摘录取 `citation.text` 前 ~120 字符，无新 API）
- Modify: `frontend/src/components/workspace/knowledge/chat-panel.tsx`（ai 消息文本的 `[n]` 分片替换为 `CitationMark`——仅知识库面板启用，通用 `MessageList` 不动；**deferred**：仅流结束后渲染上标）
- Modify: `kb-citation-sources.tsx`（默认折叠一行入口「参考来源 · N + 类型统计」→ 展开卡片列表：编号联动 + 类型徽标 + 页码 + 摘录；上限 5 条 + 查看全部；同 doc_name 合并展示；百科条目点击 → `openWikiEntry` 右侧抽屉，不切中栏）
- Modify: `backend/packages/harness/deerflow/agents/assets/rag/SOUL.md`（引用纪律：每个论断最多 1 个标记，禁止一句多标）
- Modify: `backend/tests/knowledge/test_rag_agent_assembly.py`（断言纪律文本存在）
- i18n + `frontend/tests/unit/knowledge/citation-*.dom.test.tsx`

**接口契约（实现前冻结）：**
- 上标徽章：纯数字、`text-[0.7em]`、`align-super`、`text-muted-foreground`、淡底圆角；`aria-label="Source n: <doc_name>"`。
- HoverCard 遵守仓库规范：延迟打开（防划过闪烁）；关闭路径回归测试（防 body `pointer-events` 残留，参照 `document-panel.tsx::runAfterMenuClose` 注释的教训）。
- 锚点联动：点击标记 → 来源区展开并滚动到对应项短暂高亮；移动端 tap → 直接展开切片。
- 兼容：无 `source_type` 的历史引用按 `"chunk"` 渲染。

- [x] 写失败测试：`source_type` 填充；上标渲染（流式中不渲染、结束后渲染）；折叠/展开交互；徽标展示；wiki 点击回调；一句多标不崩溃。
- [x] RED → 实现 → GREEN；revert 折叠为默认展开，证明折叠用例 RED，restore，GREEN。
- [x] `pnpm check` + backend `test_rag_agent_assembly.py` GREEN。
- [x] Commit: `feat(frontend): rework citation UX with superscript marks and collapsible source cards`。

## Task 5: P3 文档状态三路子标记

**Files:**
- Create: `backend/packages/harness/deerflow/persistence/migrations/versions/0012_documents_path_status.py`（`documents ADD COLUMN path_status JSON NULL`；参照 0002 的 add-column 模式）
- Modify: `backend/packages/harness/deerflow/knowledge/models.py`（`DocumentRow.path_status`）
- Modify: `backend/packages/harness/deerflow/knowledge/store.py`（`update_document_status` 支持 `path_status` 局部合并更新；`_row_to_dict` 携带；`retry_document` 重置为 None）
- Modify: `backend/packages/harness/deerflow/knowledge/worker.py`（写入时机：进入 indexing → vector=graph=pending(wiki 除外)；`index_chunks` 完成 → vector=done；graph 开始 → graph=indexing；graph 完成 → done/degraded（与 `graph degraded` error 子标记同源判定）；wiki 为库级镜像——文档行不单独写 wiki 子状态）
- Modify: 路由/序列化：documents 列表响应携带 `path_status`；wiki 子状态由响应组装时按库级聚合（`wiki_entries` 是否有 ready 条目 / 是否生成中）注入，所有文档共享
- Modify: `frontend/src/components/workspace/knowledge/document-panel.tsx`（状态列悬停 Tooltip 展示三路，复用 `@/components/workspace/tooltip`；indexing 中悬停文案组合展示百分比，如「图谱 87%」；不新增列）+ i18n
- Create: `backend/tests/test_migration_0012_documents_path_status.py`（参照 `test_migration_0004_run_ownership_dedupe.py` 模式）；Modify: `test_worker.py`、`test_api` 相关断言 + 前端 tooltip 单测

**接口契约（实现前冻结）：**
- `path_status` 枚举严格按 spec §5；写入语义为**局部合并**（只更新当次阶段对应的 key，不覆盖其他路）。
- wiki 子状态库级判定：`pending`（库无 ready 条目且未在生成）/ `generating`（手动或自动触发进行中）/ `ready`（库存在 ready 条目）；`failed` 暂不启用（wiki 失败现有 error 通道）。
- 兼容：老行 `path_status` 为 `null` 时前端不展示悬停。

- [ ] 写失败测试：migration up/down；worker 各阶段写入断言（vector done 先于 graph done）；graph degraded 同源；retry 重置；列表响应携带；wiki 库级镜像。
- [ ] RED → 实现 → GREEN；revert 局部合并为整体覆盖，证明合并语义用例 RED，restore，GREEN。
- [ ] `pnpm check` + backend 全量 knowledge 测试 GREEN。
- [ ] Commit: `feat(rag): persist per-path document status with hover breakdown`。

## Task 6: P4 解析能力扩展第一批 + 上传白名单

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/parser.py`（导出 `SUPPORTED_UPLOAD_SUFFIXES: frozenset[str]`；本地直读集合扩为 `{.md, .markdown, .txt, .csv}`，UTF-8 严格解码 → GBK 回退 → 明确 `ValueError`；`is_local_suffix` / `is_supported_suffix` 辅助函数）
- Modify: `backend/app/gateway/services/knowledge_service.py`（`upload_document` 入口校验白名单，拒绝抛 `ValueError` 附支持集合文案）
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（`GET /supported-formats`——**注册在 `/{kb_id}` 之前**；返回 `{"suffixes": sorted(SUPPORTED_UPLOAD_SUFFIXES)}`）
- Modify: `frontend/src/core/knowledge/hooks.ts`（`useSupportedFormats`）、`document-panel.tsx`（上传 `accept` + 选择时拦截 toast）、i18n
- Create/Modify: `backend/tests/knowledge/test_parser.py`（utf8/gbk/坏编码/新后缀直读）、`test_api` 上传 400 用例、formats 端点用例；前端上传拦截单测

**接口契约（实现前冻结）：**
- 支持集合 = `.md/.markdown/.txt/.csv/.pdf/.doc/.docx/.ppt/.pptx/.png/.jpg/.jpeg`（spec §6，frozenset 小写含点号）。
- 拒绝文案列出支持集合；HTTP 400。
- CSV 不做表格结构理解（原文直读）。

- [ ] 写失败测试：GBK txt/csv 直读成功；坏编码明确报错；白名单外后缀上传 400；formats 端点返回与常量一致；前端超集选择被拦截。
- [ ] RED → 实现 → GREEN；revert GBK 回退，证明编码用例 RED，restore，GREEN。
- [ ] `pnpm check` + backend knowledge 测试 GREEN。
- [ ] Commit: `feat(rag): extend local parsing to txt/csv with upload allowlist`。

## Task 7: 文档同步与全量回归

**Files:**
- Modify: `backend/AGENTS.md` RAG 小节（补 recall-test 端点、path_status、白名单/formats 端点）、`docs/superpowers/specs/2026-08-11-rag-phase2-batch1-design.md`（状态：待评审 → 已落地，标注日期）、主 spec 交叉引用处如有措辞偏差顺手修正

- [ ] spec 状态翻转 + AGENTS.md 同步。
- [ ] `cd backend && uv run pytest tests/knowledge -q` 全量 GREEN；`make lint && make format` 干净；`cd frontend && pnpm test && pnpm check` 干净。
- [ ] Commit: `docs(rag): sync agent guides and spec status for phase-2 batch-1`。

## Final verification

- [ ] 后端 `uv run pytest tests/knowledge -q` 全量 GREEN（Qdrant 本地运行）；前端 `pnpm test` 全量 GREEN。
- [ ] Live 冒烟（真实 key + Qdrant）：上传 1 个 GBK 编码 `.txt` → 索引 ready → 召回测试 API 三路返回结构正确（`curl` 留档）→ 前端「检索测试」tab 实操 → 问答验证引用上标/折叠来源区/百科跳转。
- [ ] 改造前后引用 UX 截图对比留档（`pr-build/` 目录惯例），记入 PR 描述。
