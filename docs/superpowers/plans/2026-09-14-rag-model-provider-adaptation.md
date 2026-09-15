# RAG 模型 provider 适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 RAG 的三条外部依赖——**嵌入 / 重排 / 文档解析**——可以接**本地**或**外部其他**模型与服务，并保住既有的 dense+sparse 双路检索语义。交付物是一个**可独立合入的切片**：不依赖知识库主干，不改变既有默认行为。

**Spec:** `docs/superpowers/specs/2026-09-14-rag-model-provider-adaptation-design.md`（已定稿；四项裁定见其 §2，Task 0 结论见其 §8）

**Architecture:** 配置层补 **provider 维度**（扁平新增字段 + 受控 allowlist 映射，照抄 Models 设置的 `PROVIDER_ALLOWLIST` 模式，**绝不开自由文本类路径**）；三条腿各新增 provider 实现，**接口签名与调用侧一律不动**（现有客户端已是鸭子类型注入）。嵌入侧新增「稀疏由我方补齐」的三条路（同 provider 同出 / 另配稀疏 provider / 本地 BM25），全部产出 Qdrant `SparseVector` ⇒ **集合 schema 与检索代码零改动**。解析侧把云客户端抽成 `ParseProvider`，本地实现调 MinerU 本地服务，**复用既有的两步归一化**。新增**重建入口**（读现有 chunk → 重嵌入，不重解析）作为换 provider / 换维度的唯一出口。

**Tech Stack:** Python 3.12 / FastAPI / Pydantic / httpx / Qdrant / pytest（backend TDD 强制）/ Next.js + React（设置页）/ Alembic（若有字段落库需求）。

**Global Constraints:**
- **每个 Task：RED → GREEN → regression proof（revert→RED→restore→GREEN）→ commit（Conventional Commits）；收尾 `ruff check` / `ruff format` 双净。**
- **默认行为零变化**：`embedding_provider` / `rerank_provider` 默认 `dashscope`，`parse_provider` 默认 `mineru-cloud` ⇒ 只写 `embedding_model` 的老 `config.yaml` 行为完全不变（守护测试钉住）。
- **provider 走受控映射**：调用方交 provider id，服务端映射到实现类与端点键；**不接受自由文本类路径**（那是与 `plugins:` 同级的代码执行面）。
- **不改检索语义**：dense + sparse 双路命名向量 + `Fusion.RRF` 保持；集合 schema 不变。
- **维度**：`dense_dim != 1024` ⇒ **拒绝启用**（fail loud），不自动建新集合；维度**运行时探测为主**，`rag.embedding_dimension` 为可选覆盖。
- **交叉校验**：`sparse_source=provider` 只在 provider 能同出双路时成立；通用嵌入（OpenAI 兼容，只出 dense）必须改成 `external` 或 `bm25`，否则拒绝启用。
- **测试必须覆盖真实载荷**：现有用例大量用 fake embedder / reranker，新增实现要断言真实请求体与响应解析。
- **同步文档**：按仓库规矩，同一个 Task 内同步 `README.md`（用户可见变化）与 `AGENTS.md`（架构变化）。
- **非目标**（spec §6）：不变检索语义；不做非 1024 维；不支持 `pipeline` 后端与本机跑模型；`title_aided` 不进设置页；不做多 provider 并行/回退链。
- Known code facts (verified 2026-09-14，见 spec §3 与 §8，均带行号):
  - 嵌入 `knowledge/embedder.py:37/108/44/17/67`（DashScope 原生形状 + 单次同出 dense+sparse）
  - 重排 `knowledge/reranker.py:32/83-89/36`；通用形状已核：`/rerank`、`{model, query, documents}` + 可选 `top_n`、无 `instruct`、响应 `results[{index, relevance_score, document}]`
  - 解析 `knowledge/parser.py:46`（`MINERU_BASE_URL` 常量）、`:375/389/396`（三个网络函数）、`:659`（`model_version="vlm"`）、`:425`（`_relocate_trailing_title`）；`parse_document` 在 `:655`，**共 6 个云端调用点**（spec §8.3）
  - 向量 `knowledge/vector_store.py:122`（`dense_size=1024`）、`:180`、`:193`、`:225-228`（双 Prefetch + RRF）
  - 配置 `config/rag_config_file.py:44-48`（`SECRET_ENV_VARS`）、`:78-87`（字段表，**无 provider**）
  - 设置页 `components/workspace/settings/functional-models-view.tsx:134-172`（嵌入/重排 = 文本 + Key）、`:184-260`（三个 picker）、`:303`、`:312`（MinerU 只有 token）
  - 重建零件 `knowledge/indexer.py:43::index_chunks`，调用点 `worker.py:321` / `worker.py:754`；**无全量/按库重建入口**
  - MinerU 本地服务 `mineru/cli/fast_api.py`：`POST /file_parse`（同步）/ `POST /tasks` / `GET /tasks/{id}` / `GET /tasks/{id}/result` / `GET /health`；**multipart form**（`api_request.py::ParseRequestOptions`）；**无鉴权**；服务端并发 semaphore 默认 3（macOS 1）

---

## Task 1: 配置层——provider 维度 + 受控映射 ✅ 已完成（2026-09-14）

**Files:**
- Modify: `backend/packages/harness/deerflow/config/rag_config_file.py`（新增字段）
- Modify: `backend/packages/harness/deerflow/config/app_config.py`（`RagConfig` 同步新增）
- Create: `backend/packages/harness/deerflow/knowledge/providers/__init__.py`（provider 受控映射表）
- Create: `backend/tests/knowledge/test_rag_provider_config.py`
- Modify（计划外，仓库规矩要求）: `config.example.yaml`（`config_version` 37→38 + 新字段注释 + 三个 `RAG_*` env 名）
- Modify（计划外，随代码同步）: spec §4.1 —— `parse_backend` 的取值收成 `vlm | hybrid`，allowlist 对照表补 `sparse` 腿

- [x] RED test：新增字段的解析与默认值；**老配置守护**——只写 `embedding_model` 的 `config.yaml` 解析后 provider 一律取默认、行为与今天一致；**allowlist 拒绝**——非法 provider id 与自由文本类路径都报错；**密钥 env 按 provider 解析**（`dashscope` 仍读 `DASHSCOPE_EMBEDDING_API_KEY`，通用 provider 读新名）。
- [x] Run `pytest tests/knowledge/test_rag_provider_config.py -q`，记录 `ModuleNotFoundError: deerflow.knowledge.providers` RED。
- [x] Implement：两个模型加字段（`RagConfig` 带默认、`RagConfigFile` 全可选）；`knowledge/providers/__init__.py` 落 allowlist 与 `resolve_provider` / `provider_ids` / `secret_env_var`。
- [x] GREEN（**25 passed**）；revert proof 两半都做：① 移走 `providers/__init__.py` → 收集期 RED → 恢复 GREEN；② `git stash` 两个配置模型 → **7 failed** → 恢复 GREEN。
- [x] `ruff check` / `ruff format --check` 双净。
- [x] Commit: `feat(knowledge): add the rag provider dimension with a curated allowlist`

**实现期做出的两个判断**（已同步 spec）：
1. **补第 4 条腿 `sparse`**——`sparse_provider` 也必须受控，它不属于 embedding/rerank/parse 三条腿；其 `path` **刻意留空**（`None`），那个服务的请求形状未定，P3 再钉。
2. **`parse_backend` 只接受 `vlm | hybrid`**——D2 的直接落实（`pipeline` 没有 http-client 变体），spec §4.1 已同步。

**环境说明（非本 Task 引入）**：本机 `tmp_path` 夹具不可写（`AppData\Local\Temp\pytest-of-h7242` 权限拒绝），故测试运行加了 `--basetemp=<仓外可写目录>`；未改动的 `tests/test_rag_config_file.py` 同样 16 个 ERROR 可佐证是环境性。全量套件 160 failed 亦为本机既有基线——抽查与**同口径前后对比**（`git stash` 后回跑同样三条，失败集完全一致）确认与本次改动无关。

## Task 2: 设置页——provider 控件 + 说明 VLM 提示 ✅ 已完成（2026-09-14）

**Files:**
- Modify: `backend/app/gateway/routers/rag_config.py`（新字段随 `model_fields` 自动进 GET/PUT；`_SECRET_FIELDS` 加 `sparse_api_key`；**密钥 env 来源改为跟随所选 provider**）
- Modify: `backend/tests/test_rag_config_api.py`（扩，不新建——该 API 的既有测试文件）
- Modify: `frontend/src/core/rag/config-form.ts`、`frontend/src/core/rag/types.ts`
- Modify: `frontend/src/components/workspace/settings/functional-models-view.tsx`（嵌入/重排 + provider 下拉与端点；解析 + 云/本地开关与服务地址；说明 VLM 行加「限 OpenAI 兼容」提示）
- Modify: i18n `zh-CN.ts` / `en-US.ts` / `types.ts`（新文案 + 键声明）
- Create: `frontend/tests/unit/components/workspace/settings/functional-models-view.dom.test.tsx`
- Modify（计划外，随代码同步）: `frontend/AGENTS.md`（picker 规则的例外）、spec §4.5（甲裁定 + 端点按需出现）

- [x] RED test（后端）：新字段进 `config` 与 `sources`；PUT 往返；非法 provider / `pipeline` → 422；**`sparse_api_key` 脱敏 + sentinel 保留**；**密钥 env 来源跟随 provider**。
- [x] RED test（前端）：`config-form` 6 例（值映射、提交、带出文件覆盖、稀疏密钥是密钥、`isEmbeddingChange` 扩判据、`hasFormChanges`）；`functional-models-view.dom` 4 例（端点显隐规则 ×2、稀疏来源常显、解析云/本地的 token ↔ 地址互换）。
- [x] Implement：按 spec §4.5 的表；端点输入只在 provider 无内置默认时出现；文案从 provider 映射派生。
- [x] GREEN：**后端 21 passed**、`config-form` **36 passed**、视图 dom **4 passed**。
- [x] revert proof：后端（路由退 HEAD → 5 failed → 恢复 21 passed）；视图（拆掉端点显隐守卫 → **1 failed** → 恢复 4 passed）。
- [x] `ruff` 双净；`pnpm check` 的 eslint 与 tsc **对本轮文件全清**（唯一残留是**既有的** pet `greet` 类型错误，见下）。
- [x] Commit: `feat(workspace): expose the rag provider settings`

**两处实现时的补充（已同步 spec §4.5）**：
1. **稀疏来源进 UI**（用户裁定「甲」）——它是决定「换成只出稠密的 provider 后配置是否成立」的字段；不暴露会让用户在启用或检索时才发现问题。
2. **端点按需出现**——只在 provider 没有内置默认时显示（`openai-compatible` / `generic-rerank` / `mineru-local`），`dashscope` / `mineru-cloud` 不显示。

**环境说明（非本 Task 引入）**：`pnpm check` 在本分支**恒红**，唯一原因是 `tests/unit/components/workspace/pet/pet-sprite.dom.test.tsx:222` 的 `"greet"` 不在组件 prop 联合里——那是**宠物线的在飞改动**，本轮**未触碰**该文件，也未代为修复。

## Task 3: 重排——`generic-rerank` provider（P1）✅ 已完成（2026-09-14）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/reranker_generic.py`
- Create: `backend/packages/harness/deerflow/knowledge/reranker_factory.py`（计划外：**三处构造点需要一个共同入口**，见下）
- Modify: `tools/builtins/hybrid_search_tool.py`、`tools/builtins/graph_search_tool.py`、`knowledge/eval/runner.py` 改为经工厂解析
- Create: `backend/tests/knowledge/test_reranker_generic.py`

- [x] RED test：**真实载荷断言**——路径 `/rerank`、body 恰为 `{model, query, documents, top_n}` 且**不含 `instruct`**；响应 `results[{index, relevance_score, document}]` 解析与百炼分支同形（按分数降序）；`top_n` 被裁剪到文档数；空文档不发请求；5xx 重试后成功；401 **不重试**且分类为 `RerankerAuthError`；重试耗尽抛 `RerankerError`；`base_url` 缺省即构造失败。
- [x] Implement `GenericReranker`：**复用** `reranker.py` 的 `RerankerError` / `RerankerAuthError`（换一套异常会让调用侧的 RRF 降级静默失效）；env 回退名从 allowlist 取（`secret_env_var("rerank", "generic-rerank")`），避免与 API 上报的名字漂移。
- [x] GREEN（**7 passed**）；revert proof：移走 `reranker_generic.py` → 收集期 RED → 恢复 → 7 passed。
- [x] 窄门禁：**`tests/knowledge` 1103 passed / 2 skipped**（较 Task 2 的 1096 多出 7 条新用例）。
- [x] `ruff check` / `ruff format` 双净。
- [x] Commit: `feat(knowledge): add a generic rerank provider`

**计划修正（2026-09-14）**：计划写的是「检索两处构造点」，实际有**三处**——`eval/runner.py:378` 也 new 了 `DashScopeReranker`。三处都改经 `build_reranker()`，理由是**评测必须量到线上同款重排器**，否则报告与线上不是同一回事。工厂在缺端点且 provider 非 `dashscope` 时抛 `ValueError`（只有百炼有内置地址）。

## Task 4: 解析——本地 MinerU provider（P2）

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/parse_local.py`（本地服务客户端）
- Modify: `backend/packages/harness/deerflow/knowledge/parser.py`（`parse_document` 按 `parse_provider` 分流；抽出云端实现为同接口）
- Create: `backend/tests/knowledge/test_parse_local.py`

- [ ] RED test（httpx mock，**断言真实 multipart 形状**）：`POST /file_parse` 或 `POST /tasks` + 轮询 `GET /tasks/{id}` / `GET /tasks/{id}/result`；产物解析出 markdown + images；**两步归一化被复用**（`_normalize_tables_to_gfm` + `_relocate_trailing_title` —— 构造一个含 HTML 表与文末标题的假产物，断言输出为 GFM 且标题归位）；服务不可用时抛错且文档落 `failed`。
- [ ] Implement `ParseLocalProvider.parse(path) -> ParsedDocument`：multipart 上传 + 轮询（超时/重试与云端对齐）；`parse_document` 内按 provider 分流，**云端分支一行不动**。
- [ ] GREEN；revert proof；`ruff` 双净。
- [ ] Commit: `feat(knowledge): add a local MinerU parse provider`

## Task 5: 重建入口（P4）——换 provider / 换维度的唯一出口

**Files:**
- Create: `backend/packages/harness/deerflow/knowledge/reindex.py`（纯编排：遍历文档 → 分页读 chunk → `index_chunks`）
- Modify: `backend/app/gateway/services/knowledge_service.py` + `routers/knowledge_bases.py`（触发与进度）
- Modify: `frontend/src/components/workspace/settings/functional-models-view.tsx` + i18n（**设置页的重建入口与确认弹窗**，自 Task 2 挪来）
- Create: `backend/tests/knowledge/test_reindex.py`

- [ ] RED test：**幂等自检**——用同一个（fake）embedder 重建后，向量点集合与重建前逐点一致；**不重解析**——断言重建过程中 parser **零调用**（这是与 `retry` 的关键区别）；分页读 chunk；单文档失败不中断整库（沿用既有降级契约）。
- [ ] Run focused test 确认 RED。
- [ ] Implement `reindex.py` + Gateway 触发（202 + 进度；与现有 wiki 重建同形态的可观测）。
- [ ] GREEN；revert proof；`ruff` 双净。
- [ ] Commit: `feat(knowledge): add a re-embed reindex entry`

## Task 6: 嵌入——provider 抽象 + 稀疏补齐（P3）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/embedder.py`（抽出接口；`DashScopeEmbedder` 保留为默认实现）
- Create: `backend/packages/harness/deerflow/knowledge/embedder_openai.py`（通用 dense-only）
- Create: `backend/packages/harness/deerflow/knowledge/sparse.py`（BM25 实现 + `external` provider 客户端）
- Create: `backend/tests/knowledge/test_embedder_providers.py`、`test_sparse_backfill.py`

- [ ] RED test：**维度探测**（探测成功取回长度；`embedding_dimension` 覆盖生效）；**非 1024 拒绝启用**；**交叉校验**（`openai-compatible` + `sparse_source=provider` ⇒ 拒绝；改成 `external`/`bm25` ⇒ 通过）；**三条稀疏路**各自产出 `SparseVector(indices, values)`；**query / document 两侧口径一致**（同一 provider 对同一文本、两种 `text_type` 的行为）；**中文分词**处理。
- [ ] Run focused test 确认 RED。
- [ ] Implement：`embedder.py` 抽接口 + 默认实现不动；`embedder_openai.py`；`sparse.py` 的 BM25 与 `external` 客户端；「同出」按**接口语义**实现（provider 内部可以打两次 HTTP）。
- [ ] GREEN；revert proof；`ruff` 双净。
- [ ] Commit: `feat(knowledge): add pluggable embedding providers with sparse backfill`

## Task 7: 文档同步与收尾

**Files:**
- Modify: `README.md`（摄取与解析 / 模型配置两节的用户可见变化）
- Modify: `backend/AGENTS.md`（Knowledge Base / RAG 与配置系统两节）
- Modify: spec 头部状态 + 本 plan 的 Task 勾选

- [ ] README：新增 provider 选择说明、三处缺口的最新口径、重建入口的说明。
- [ ] AGENTS.md：新增 provider 机制（与 Models 机制**互不相通**）、稀疏三条路、重建入口、以及「说明 VLM 限 OpenAI 兼容」这条现状约束。
- [ ] 回归：`make test`（全量）+ `pnpm check`；确认老配置守护用例在整仓范围内也绿。
- [ ] Commit: `docs(rag): sync README and AGENTS for the provider adaptation`

---

## Final verification

- [ ] `cd backend && make test` 全量绿（含新增 6 个测试文件）
- [ ] `cd frontend && pnpm check` 双净
- [ ] 老配置回归：只用 `config.yaml` 原有字段启动，三条腿行为与改造前一致（守护测试 + 手工起栈确认）
- [ ] 三条腿各接一次真实本地/外部服务（重排用任一 OpenAI 兼容 rerank；解析用本地 MinerU 服务；嵌入用 1024 维的兼容端点），确认端到端可用
- [ ] 换 provider → 触发重建 → 检索结果正常的完整链路走通一次

## 运行期遗留（不属本 plan 交付，供后续决策）

- **本地 MinerU 的并发配合策略**：服务端 semaphore 默认 3（macOS 1），我们的 `rag.worker_concurrency` 默认 2 ⇒ 默认不撞闸；谁高谁低、撞闸时排队还是超时，本 plan 只保持默认，不引入新配置。
- `openai-compatible` 嵌入的 `/v1/embeddings` 路径是**通用约定、未逐字核**（spec §4.1 已标注）——接入真实服务时按实际文档校正。
- `sparse_source=external` 与 `bm25` 的质量差异需要评测集回归才有结论（仓库已有 Layer-1 门禁，可作工具）。
- 非 1024 维的支持（集合命名带维度 / 换维度自动建集合）明确留二期。
