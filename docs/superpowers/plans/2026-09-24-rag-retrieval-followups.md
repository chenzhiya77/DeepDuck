# 检索面三处收口：重建覆盖、召回标签、TEI 重排形状 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-24-rag-retrieval-followups-design.md](../specs/2026-09-24-rag-retrieval-followups-design.md)
**Status:** 📝 **已定稿（2026-09-24）—— 未开工**。三项已裁：**D1 甲**（四集合全补，含 `kb_manual_cards`）/ **D2 乙**（按配置派生 + 图谱 impl 回报 `score_source`）/ **D3 甲**（allowlist 新增独立一格 `tei-rerank`）。Task 0–7；spec 与 plan 本轮**均未提交**。
**审查后修订已并入（2026-09-25，对着现状逐条核完）**：① 文案提示条**已裁甲 ⇒ 取消 `rerankModelTeiHint`**（无专属落点，见硬约束）；② i18n 行号/目录、`rag_config_file.py`、`test_rag_provider_config.py` 坐标已刷新；③ **串行矩阵已更正**（三线共享 view 文件，见 Global Constraints）；④ **Task 0 八项已核完并回填**（结论见各行）。
**Parent:** [2026-09-14-rag-model-provider-adaptation-design.md](../specs/2026-09-14-rag-model-provider-adaptation-design.md)（provider 维度 + §5 重建入口；本对的三项都是它跑完后的运行期遗留）· [2026-09-14-rag-model-provider-adaptation.md](2026-09-14-rag-model-provider-adaptation.md)（其「运行期遗留」段 :208-216 逐条登记，三条分别在 :212 / :213 / :214）

**Architecture:** 四条后端 + 一条前端 + 文档 —— **① 共享嵌入文本助手**（新模块 `deerflow/knowledge/embed_texts.py`，写入侧四处与重建侧共用，消掉"抄一行字符串"）**② 重建入口三遍**（`reindex.py`：实体/百科/卡片各一遍，按 `page_size` 切批 + 单批失败继续 + 只 upsert；报告与进度各加三键）**③ 召回标签按请求派生**（删 `_RECALL_SCORE_TYPES` 常量；图谱 `_score_candidates` 回报实际尺子，payload 加 `score_source`）**④ TEI 客户端**（新模块 `reranker_tei.py` + allowlist 一行 + 两处 `Literal`）**⑤ 前端一处做完**（重建进度求和 + 重建两处文案 + TEI 下拉第三项/标签 + i18n 三文件）**⑥ 真栈验收**（重建链路 / 召回徽标 / TEI docker 腿按 operator 定）。

**硬约束（spec 已裁，实现时不许自行放松）**：

- **D1 甲**：四集合全补 —— 切片（既有）+ **实体 + 百科条目 + 人工卡片**。卡片遍**只取 `include_in_wiki_search=True`** 的行；条目遍**全状态**（向量与 dirty 记号无关）。
- **只 upsert、不删点、不改业务行**（条目状态/补充层/卡片开关都不碰）；点 id 本就确定性 ⇒ 重复跑幂等、原位覆盖。
- **写好文本与写入侧同源**：三函数落 `embed_texts.py`，**四个写入侧调用点一起改 import**（`graph/indexer.py` :187 / `graph/resolver.py` :116 / `wiki/generator.py` :295 / `knowledge_service.py` :905-907 删除、两处调用改用它）。实体那两处 `or ''` 分叉顺带统一为 `description or ""`。
- **D2 乙**：徽标 = 「这一跑实际参与打分的那个东西」，**服务端每次请求现算**（前端只显示字符串）。vector → `{rag.rerank_model} relevance`（模型串空 → `rerank relevance`）；graph → impl 回报 `"rerank"` → 同上，`"cosine"` / **缺键按配置兜底**（`graph_rerank` 开 → 模型名、关 → `embedding cosine`）；wiki → 恒 `embedding cosine`。**TEI 这格渲染配置里的模型名**（线上不带 model；那格正是"这个实例服务哪个模型"）。
- **D3 甲**：TEI 是**独立一格** `tei-rerank`（不改 `generic-rerank` 的行为）。请求 `{"query", "texts", "raw_scores": False}`（**不发 `model`/`documents`/`top_n`**）；响应裸数组 `[{index, score}]`；**`top_n` 本地截断**（TEI 没这个字段，而 vector 路把返回值直接当最终结果用）；错误复用 `RerankerError`/`RerankerAuthError`；**key 可选**（有值才发 `Authorization`）。
- **文案改动逐字照 spec §4.3 的表**（原文 → 改成），不许换词：`providerGenericRerank` 收窄为 `通用重排 (Cohere / Jina 形状)` / `Generic rerank (Cohere / Jina shape)`；新增 `providerTeiRerank` = `TEI 重排` / `TEI rerank`；`reindexHint` / `reindexConfirmDescription` 按表新文案（zh/en 各一处）。**`rerankModelTeiHint` 已裁甲取消（2026-09-25）**：rerank 与嵌入**共用一条 `RowLabel`**（`functional-models-view.tsx:617-633`）⇒ 提示无专属落点；**不加这个 key、不加任何条件提示**（spec §4.3 表下有取消条）。
- **不动**：切片遍既有行为（文档循环、终态过滤、`page_size`、`chunk_count` 收尾写法）· 三条检索链的检索/排序逻辑 · 四集合 schema 与 1024 维 · embedder/parse 两条腿 · `rag.rerank_model` 的语义与默认值 · `score_type` 的字面语言（英文技术串，不引 i18n）· `reindexChunksWritten` 的 key 名（文案本身就是"已写入向量"）。
- **scope fence（明确不做）**：孤儿点清扫 · 重建不重跑图谱抽取（不花 LLM）· `auto-分流`（D3 乙，已否）· 召回降级时分数 null 的既有合同（spec §8）· caption 401 / judge key / `vlm_model` 校验（spec §2 已登记为别处落点）。

**Global Constraints:**

- 分支 `feat/rag-knowledge-base`；每个 Task：**RED → GREEN → neuter（带 revert proof）→ 门禁 → commit**（Conventional Commits；每笔提交前看 `git status`，别把别线文件带进来）。
- **后端命令**：窄面 `cd backend && .venv/Scripts/python.exe -m pytest <文件/目录> -q --basetemp .pytest-tmp`（**basetemp 只用仓内 `.pytest-tmp`，跑完即删**）；ruff 双净 = `.venv/Scripts/python.exe -m ruff check .` + `-m ruff format --check .`（**别用 `make format`**，会扫全仓）。
- **前端命令**：`cd frontend && PYTHONIOENCODING=utf-8 python ../scripts/pnpm.py <script>`；门禁 = `pnpm check`（eslint + tsc）+ `pnpm test`（rstest：node + dom）。**prettier 只重排自己新写的行**（既有格式债不 `--write`；判定走 `tr -d '\r'` + 与 HEAD 比 hunk）。
- **每个 Task 的 `**实测**` 行必须回填**（RED 几条红 / GREEN 几条绿 / neuter 受害者 / 门禁数字）——未回写的 plan 不算交付。
- **真栈**：前端只驱动用户已在跑的 `:3000`（只读或按 Task 6 的动作面）；后端重建用可写库**「测试2」**（内有测试残留，可写）或新库；**不改 `config.yaml`**；需要改 `rag_config.json` 时先逐字节备份、结束后按原样还原（配方见 [[local-dev-stack]] 的 09-24 条目）。
- **同文件串行（2026-09-25 更正）**：**三条未开工线共享 `frontend/src/components/workspace/settings/functional-models-view.tsx`** —— 本对 / `2026-09-24-settings-responsive-layout`（plan 09-25 已立；也动它的 dom 用例，**不动 i18n**）/ 默认模型线（`2026-09-23-default-model`，**不动这个文件**，它动的是其 dom 夹具 `tests/unit/settings/functional-models.dom.test.tsx`）。**i18n 三文件**（`core/i18n/locales/`）才是与默认模型线共享的那组；`core/rag/*` + `core/knowledge/types.ts` 只有本对动；`knowledge_service.py` 与默认模型线共享。⇒ 谁先落，后者以先落者的行号为准；**本文件的行号基线 = 2026-09-25，Task 5 的前端行号以落笔当日复核为准**。

**依赖顺序**：Task 0（只读核实，✅ 2026-09-25 已核完）→ Task 1（文本助手 + 写入侧）→ Task 2（重建三遍）→ Task 3（召回标签）→ Task 4（TEI 后端）→ Task 5（前端一处做完）→ Task 6（真栈验收）→ Task 7（文档 + 回写）。

---

## Task 0 — 开工前八项核实（只读）

- [x] 1. **`tests/knowledge/test_reindex.py` 的调用缝** ⇒ **已核（2026-09-25）**：文件 314 行 / 10 例；现有 **7 处**调用（:113 / :133 / :154 / :169 / :199 / :217 / :245）**全部不传** `graph_store`/`wiki_store` ⇒ 签名改必填后这 7 处一起红（RED 面按这个写）。`_PROGRESS` / `ReindexReport` **没有键集断言**（最近的是 :250-251 只断两个键、:314 的 HTTP 体 `progress: None`）⇒ 加三键不会自己红。
- [x] 2. **写入侧四处逐字文本与边界** ⇒ **已核（2026-09-25）**：四处逐字如初核（`graph/indexer.py:187` 带 `or ''` / `graph/resolver.py:116` 不带 / `wiki/generator.py:295` 用 `EMBED_CONTENT_CHARS` / `knowledge_service.py:905-907`）；`merged['description']` **恒为 str**（`graph/store.py:37-43` 的 `_merge_text` 永远 join 出字符串）✔；⚠️ **但 `list_entities` 的原始行 `description` 可为 `None`**（`knowledge/models.py:101` 可空）⇒ 重建遍构造 `EntityUpsert` 要照写入侧 `or ""` 归一；`EMBED_CONTENT_CHARS` 全仓**仅 2 处**（`generator.py:62` 定义 / `:295` 使用；测试零引用）⇒ 搬家干净。
- [x] 3. **三个 store 的返回键** ⇒ **已核（2026-09-25）**：`list_entities(kb_id)`（`graph/store.py:107-111`，**无分页**、`to_dict()` 出全部列）/ `list_entries(kb_id, *, status=None)`（`wiki/store.py:91-98`，**省略 status = 全状态**）/ `list_manual_cards(kb_id, *, offset=0, limit=50, include_in_wiki_search=None)`（`store.py:449-470`，**唯一有游标分页的**）+ `count_manual_cards`（:472，同参）。⚠️ 实体/百科两遍**没有 offset/limit** ⇒ spec §4.1 的"分页"措辞已就地改为"切批"。
- [x] 4. **前端重建进度的消费面** ⇒ **已核（2026-09-25）**：三处夹具都是字面量、**不钉键集**（`reindex-status.test.ts:23` / `functional-models.dom.test.tsx:1324` / `knowledge/api.test.ts:270`；缺键/多键由 tsc 兜）；既有运行行用例 `functional-models.dom.test.tsx:1321-1333` 只断 `"3/7"` 与 `"42"` ⇒ **不会**因改求和而红，Task 5 的新求和用例是必需的。
- [x] 5. **召回标签消费面** ⇒ **已核（2026-09-25）**：后端**唯一**产出点 `knowledge_service.py:1216`；前端仅 `core/knowledge/types.ts:336`（类型）+ `recall-test-panel.tsx:567`（纯渲染 `score_type[path]`）；dom 用例 `recall-test-panel.dom.test.tsx:115`（夹具）/:254-262（`toContain` 断徽标文本）⇒ **无第二消费点、前端零改动**。
- [x] 6. **graph 工具返回键的断言面** ⇒ **已核（2026-09-25）**：`test_graph_search.py` **没有** payload 键集断言（最近的是 :179 子集断言、:642 只钉 `trace` 子对象）⇒ 加 `score_source` 不会红；`eval/runner.py` 的 `graph_fn` 只读 `raw.get("evidence")`（:397）⇒ 同样安全。
- [x] 7. **TEI 前端落点** ⇒ **已核（2026-09-25）**：`providerTeiRerank` / `rerankModelTeiHint` / `tei-rerank` / `TEIReranker` 在**代码里零命中**（只出现在本 spec/plan 文档里）；`asEnum`（`config-form.ts:132-134`）对未知值 ⇒ **回退 fallback**；⚠️ **`RERANK_PROVIDER_OPTIONS` 是一个常量驱动两路**：渲染（`functional-models-view.tsx:606`）与**载入归一**（`config-form.ts:159` 的 `asEnum`）⇒ 不加会静默回退 `dashscope`；⚠️ **模型行没有提示机制**：rerank 与嵌入**共用一条 `RowLabel`**（:617-633）⇒ 提示条已裁甲取消；三个 `RERANK_PROVIDERS` 夹具文件见 Task 5 的 ⚠️。
- [x] 8. **保存期/能力面** ⇒ **已核（2026-09-25）**：`_reject_unusable_after_save`（`rag_config.py:297-315`）三腿构造 ⇒ `tei-rerank` 缺地址自动 400；既有腿级用例**点名 `generic-rerank`**（`test_rag_config_api.py:607-619`）与 parse（:622-632）⇒ **要补一条 `tei-rerank` 缺地址 → 400**（Task 4 已写死要补，不再是"视"）；allowlist 行的 `path`/`secret_env_var` 只有 ark 那格被钉（`test_embedder_ark.py:33` + :221-222）。

**实测（2026-09-25，审查时八项全核、逐条结论见各行）**：开工时可直接从 Task 1 起；**唯需当日复核**的是受两条未开工线影响的前端行号（见 Global Constraints 的串行条）。

---

## Task 1 — 共享嵌入文本助手 + 写入侧四处切换

> 动到的文件：`packages/harness/deerflow/knowledge/embed_texts.py`（**新增**）、`tests/knowledge/test_embed_texts.py`（**新增**）、`graph/indexer.py`（:187 改用）、`graph/resolver.py`（:116 改用）、`wiki/generator.py`（:62 `EMBED_CONTENT_CHARS` 移出 / :295 改用）、`app/gateway/services/knowledge_service.py`（删 :905-907、两处调用 :931/:1021 改用）。
> **验收对应**：spec §5 的 1（"三遍的嵌入文本与写入侧逐字相等"的**结构**保证）。

- [x] **RED**：新建 `test_embed_texts.py`（四条）：① `entity_embed_text("X", None)` == `"X\n"`、`("X", "d")` == `"X\nd"`；② `wiki_entry_embed_text("T", "长"*600)` 只嵌前 500 字（`len(text.split("\n", 1)[1]) == 500`）；③ `manual_card_embed_text("T", "C")` == `"T\nC"`；④ **同源钉子（2026-09-25 审查加）**：在既有消费方用例里给**消费模块自己的名字**装 spy（配方 = 仓内先例 `test_worker.py:525` 的 `monkeypatch.setattr("deerflow.knowledge.worker.resolve_entity_aliases", spy)`），四处各一：`deerflow.knowledge.graph.indexer` / `deerflow.knowledge.graph.resolver` / `deerflow.knowledge.wiki.generator` / `app.gateway.services.knowledge_service`（后两者的既有驱动面：`tests/knowledge/wiki/` 与 `tests/knowledge/test_manual_knowledge_api.py`；resolver 走 `tests/knowledge/graph/test_resolver.py:114` 一带）—— 驱动各写入路径后断言 spy 被调用。此刻四处仍是内联 f-string ⇒ 红；这条是"改 import 真的发生"的唯一结构性保证（纯函数用例只测助手本身）。
- [x] **GREEN**：写 `embed_texts.py`（三函数 + `EMBED_CONTENT_CHARS = 500`，注释点明"与写入侧同源是重建的前提"）；四个调用点改 import（`knowledge_service.py` 删私有 `_manual_card_embed_text`；`wiki/generator.py` 的 `EMBED_CONTENT_CHARS`（:62，全仓唯一消费点 :295）删除、改从 `embed_texts` 取）。窄面转绿；**既有消费方用例（graph 索引/合并、wiki 生成、卡片创建/编辑）复跑证明行为不变**。
- [x] **neuter ①（截断）**：`wiki_entry_embed_text` 去掉 `[:EMBED_CONTENT_CHARS]` ⇒ ② 红。
- [x] **neuter ②（分隔）**：`entity_embed_text` 把 `description or ""` 换成 `description`（None 时产出 `"X\nNone"`）⇒ ① 红。
- [x] **门禁**：ruff 双净；窄面（`test_embed_texts.py` + `tests/knowledge/graph/` + `tests/knowledge/wiki/` + `tests/knowledge/test_manual_knowledge_api.py` 消费方）绿。

**实测（2026-09-25）**：**RED** = 1 collection error（`ModuleNotFoundError: deerflow.knowledge.embed_texts`）+ **5 红 / 53 绿**；5 红 = 钉子五处（`test_graph_indexer` / `test_resolver` / `test_generator` / `test_manual_knowledge_api` 的**创建 + 编辑两条**，均 `helper_calls` 空断言 —— 计划写"四处各一"，实际卡片模块两个调用点各装一条）。**GREEN** = 同批 **61 passed**。**neuter ①（去截断）** ⇒ 1 红（`..._truncates_content_to_embed_chars`，`assert 600 == 500`）另 2 绿；**neuter ②（`or ""` → 裸 `description`）** ⇒ 1 红（`..._normalizes_nullable_description`，`'X\nNone' == 'X\n'`）且 `tests/knowledge/graph/` **84 绿**（网格无第二受害者）——两次 revert 后 md5 均回到 `3bcdd0ce3f91267e0853cceb51b858aa`。**门禁** = ruff `All checks passed!` + `1292 files already formatted`；窄面（`test_embed_texts.py` + `tests/knowledge/graph/` + `tests/knowledge/wiki/` + `test_manual_knowledge_api.py`，另加 `test_worker.py` 因为它是生成器自动触发的驱动面）**156 passed / 0 failed**。脚手架 = `tests/knowledge/conftest.py::spy_embed_text`（`raising=False` + **装前**捕获真函数：装前"模块没这名字"是干净红、装后委托真函数使既有文本断言原样通过）。

---

## Task 2 — 重建入口补齐三条集合（`reindex.py` + 调用点）

> 动到的文件：`packages/harness/deerflow/knowledge/reindex.py`（三遍 + `ReindexReport`/`_PROGRESS` 各 +3 键 + 签名）、`app/gateway/services/knowledge_service.py`（:1726-1733 调用点补两个 store）、`tests/knowledge/test_reindex.py`（扩）。
> **验收对应**：spec §5 的 1 / 2 / 3 / 4。

- [ ] **RED**：`test_reindex.py` 扩用例：① 实体遍 —— `upsert_entities` 收到的文本 = `entity_embed_text(name, description)`、payload 的 `type`/`description` 与业务行一致（**原始行 `description` 可为 `None`（models.py:101）⇒ 期望值按写入侧的 `or ""` 归一**）；② 百科遍 —— 全状态（`ready` + `dirty` 都重嵌）、文本同源；③ 卡片遍 —— **只有 `include_in_wiki_search=True`**、分页走 `offset/limit`、关卡不放点；④ **失败政策** —— 某一遍（或某一批）抛错 ⇒ 其余遍/批照跑、计数只记写成、run 判定仍 `succeeded`；⑤ **报告/进度** —— 三键在 `ReindexReport` 与 `reindex_status()["progress"]` 里存在且 run 开始即为 0；⑥ **幂等** —— 重复跑不新增点（stub 记录 upsert 次数/点 id）。此刻签名与三遍都不存在 ⇒ 红。
- [ ] **GREEN**：`reindex_kb(store, vector_store, embedder, *, kb_id, graph_store, wiki_store, page_size)` —— 两个 store **必填**（漏传 = 静默不重嵌三类，正是本对要修的缺陷种类；**不做成可选/默认 `None` 跳过**）。文档循环不动，之后按 **实体 → 百科条目 → 人工卡片** 三遍：每遍把行按 `page_size` **切批** embed + upsert（⚠️ 实体/百科两 store **无 offset/limit**（`graph/store.py:107-111` / `wiki/store.py:91-98`），只有卡片遍是 `list_manual_cards(..., offset, limit)` 游标翻页）；单批失败 `logger.exception` 后继续。`_PROGRESS` 起手三键置 0、每批累加。**既有 7 处测试调用点（`test_reindex.py:113/:133/:154/:169/:199/:217/:245`）一并补两个 store**（真 `GraphStore`/`WikiStore` 复用同一 session factory，或最小 fake —— 但必须让"三遍被跑到"可观测）；生产调用点 `knowledge_service.py:1731` 补 `self.graph_store` / `self.wiki_store`。窄面转绿。
- [ ] **neuter ①（过滤）**：卡片遍去掉 `include_in_wiki_search=True` ⇒ ③ 红。
- [ ] **neuter ②（文本同源）**：实体遍改嵌 `row["name"]`（丢 description）⇒ ① 红。
- [ ] **neuter ③（失败政策）**：把某一遍的 `try/except` 去掉（异常上抛）⇒ ④ 红。
- [ ] **门禁**：ruff 双净；**`tests/knowledge` 全量**绿（这个目录就是 `reindex.py`/`knowledge_service.py` 的完整消费面）。

**实测（待回填）**：

---

## Task 3 — 召回标签随配置 + 图谱回报尺子

> 动到的文件：`app/gateway/services/knowledge_service.py`（删 :1063-1067 常量、新增 `_recall_score_types(...)`、:1216 改用）、`packages/harness/deerflow/tools/builtins/graph_search_tool.py`（`_score_candidates` :125-159 回报尺子、payload :320-334 加 `score_source`、docstring :140 顺带）、`tools/builtins/hybrid_search_tool.py`（docstring :3-4 顺带）、`tests/knowledge/test_recall_test_api.py`（:174-179 钉死断言改口径 + 新用例）、`tests/knowledge/tools/test_graph_search.py`（+尺子用例）。
> **验收对应**：spec §5 的 7 / 8。

- [ ] **RED**：① `test_recall_test_api.py` 加四格 —— 默认 dashscope → `qwen3-rerank relevance`；`generic-rerank` + Jina 模型名 → `jina-reranker-v2-base-multilingual relevance`；impl 回报 `rerank` → 模型名；回报 `cosine` / **缺键** → `embedding cosine`（缺键 = 既有 mock 形态，走配置兜底）；② `test_graph_search.py` 加三格 —— 小池（≤ `graph_rerank_threshold`）回报 `cosine`、大池回报 `rerank`、重排抛错回报 `cosine`。此刻常量写死、payload 无该键 ⇒ 红。
- [ ] **GREEN**：`_score_candidates` 返回 `(scores, "rerank"|"cosine")`；`_graph_search_impl` payload 加 `"score_source"`；服务层 `_recall_score_types(rag, graph_source)` 按硬约束 D2 的映射拼三路标签（TEI 格渲染配置模型名）；旧钉死断言改成按配置断言。⚠️ 调用点**唯一** = `graph_search_tool.py:270`（其返回值马上喂 `apply_source_caps` / `select_evidence`）⇒ 就地解包取 `score_source`，别把 tuple 当 scores 传下去。窄面转绿。
- [ ] **neuter ①（派生）**：把 vector 标签改回写死 `"qwen3-rerank relevance"` ⇒ 四格里 Jina 格红。
- [ ] **neuter ②（尺子）**：让 `_graph_search_impl` 恒写 `"cosine"` ⇒ 大池格红（小池格保持绿 —— 受害者不相交）。
- [ ] **门禁**：ruff 双净；窄面（`test_recall_test_api.py` + `tests/knowledge/tools/`）绿；`tests/knowledge` 全量绿。

**实测（待回填）**：

---

## Task 4 — TEI 重排分支（后端）

> 动到的文件：`packages/harness/deerflow/knowledge/reranker_tei.py`（**新增**）、`tests/knowledge/test_reranker_tei.py`（**新增**）、`knowledge/providers/__init__.py`（rerank leg +1 行）、`config/app_config.py:215` 与 `config/rag_config_file.py:106`（`Literal` +1）、`tests/knowledge/test_rag_provider_config.py:190`（元组断言同步；`:166` 是 parametrize 表）；`tests/test_rag_config_api.py` **补一条** `tei-rerank` 缺 `rerank_base_url` → 400（现有 :607 那条点名 `generic-rerank`，不覆盖新行）。
> **验收对应**：spec §5 的 10 / 11 / 13（13 的真栈腿在 Task 6）。

- [ ] **RED**：新建 `test_reranker_tei.py`：① **载荷逐字** —— `{"query", "texts", "raw_scores": False}`（**无** `model`/`documents`/`top_n`）；② 裸数组 `[{"index":1,"score":0.2},{"index":0,"score":0.9}]` 解析成 `[(0,0.9),(1,0.2)]`；③ **`top_n` 本地截断**（发 8 条、`top_n=3` → 3 对）；④ 非数组（dict / 字符串）→ `RerankerError`；⑤ 401 → `RerankerAuthError`；⑥ 429 → 重试（第 2 次 200 成功）、500 耗尽 → `RerankerError`；⑦ **无 key 不发 `Authorization`**（有 key 才发）。另加 allowlist/工厂：`resolve_provider("rerank","tei-rerank")` 命中、`build_reranker` 缺 `base_url` → `RagConfigurationError`。此刻模块与表行都不存在 ⇒ 红。
- [ ] **GREEN**：写 `reranker_tei.py`（`TEIReranker`，无 `model` 参数；`_read_api_key` 可选三级：显式 → `configured_rag_secret("rerank_api_key")` → `RAG_RERANK_API_KEY`；响应必须为数组、行缺 `index|score` → `RerankerError`）；allowlist 加行（`path="/rerank"`、`secret_env_var="RAG_RERANK_API_KEY"`、**无内置地址**）；两处 `Literal` +1；元组断言同步。窄面转绿。
- [ ] **neuter ①（载荷）**：载荷带上 `"model": 配置值` ⇒ ① 红（TEI 会 422）。
- [ ] **neuter ②（截断）**：`top_n` 不本地截 ⇒ ③ 红。
- [ ] **neuter ③（鉴权）**：无 key 时也发 `Authorization: Bearer ""` ⇒ ⑦ 红。
- [ ] **门禁**：ruff 双净；窄面（`test_reranker_tei.py` + `test_rag_provider_config.py` + `test_rag_config_api.py`）绿；`tests/knowledge` 全量绿。

**实测（待回填）**：

---

## Task 5 — 前端一处做完（重建进度 + 重建文案 + TEI 下拉/标签）

> 动到的文件：`components/workspace/settings/functional-models-view.tsx`（运行行求和 :1099-1101；`PROVIDER_LABELS` :501-510 +1 项）、`core/knowledge/types.ts`（`ReindexProgress` :143-147 +3 键）、`core/rag/types.ts:45`、`core/rag/config-form.ts`（:48 联合 + :73 选项表 —— ⚠️ 同一常量还驱动 `:159` 的载入归一，**一个常量、两路一起跟上**）、i18n 三文件（`frontend/src/core/i18n/locales/` 下 `zh-CN.ts` / `en-US.ts` / `types.ts`：**3 处改值**（`providerGenericRerank` / `reindexHint` / `reindexConfirmDescription`）+ **1 个新 key**（`providerTeiRerank`），逐字照 spec §4.3 表）；用例 `tests/unit/settings/functional-models.dom.test.tsx`（+4 条）。
> ⚠️ **三个既有用例文件各自带一份 `RERANK_PROVIDERS` 局部夹具**（写死的，不从服务端派生）：`tests/unit/settings/functional-models.dom.test.tsx:95-104`（:127 挂进 view）、`tests/unit/components/workspace/settings/functional-models-view.dom.test.tsx:107-118`（:126 挂进 view）、`tests/unit/rag/config-form.test.ts:993-1004`（专测 `resolveRerankEndpointRow`）—— 夹具里都只有 dashscope / generic-rerank ⇒ **选项表 +1 不会自动让它们红**；但 RED ④ 要在 `tei-rerank` 上断言端点行，须在所用文件的夹具里**补一行 `{ provider_id: "tei-rerank", has_fixed_endpoint: false, default_endpoint: null }`**（否则落到「未知不锁」分支，断言打不到目标）。
> **验收对应**：spec §5 的 4（界面部分）/ 12；文案 before→after 见 spec §4.3。

- [ ] **RED**：dom 用例加四条：① **进度求和** —— 假 `progress = {documents_done:3, documents_total:3, chunks_indexed:100, entities_indexed:20, wiki_entries_indexed:7, cards_indexed:1}` ⇒ 运行行文案含 `已写入向量 128`；② **重建文案** —— `reindexHint` / `reindexConfirmDescription` 按新文案逐字断言；③ **下拉三项** —— 驱动候选（先例配方 `models-capability-wizard.dom.test.tsx:123-129`）⇒ `[role=option]` 三项、第三项文案 = `TEI 重排`；④ **端点行** —— 选 `tei-rerank` 后端点行按 capability 出现（`has_fixed_endpoint=False`；需给所用夹具补一行 `tei-rerank`，见上文 ⚠️）；**无任何条件提示**（`rerankModelTeiHint` 已裁甲取消，spec §4.3 表下有取消条）。此刻全红。
- [ ] **GREEN**：运行行改四键求和（`reindexChunksWritten` 文案不动）；`PROVIDER_LABELS` 加 `"tei-rerank": F.providerTeiRerank`；`RERANK_PROVIDER_OPTIONS` / 两处联合类型 +1；i18n 三文件按 spec §4.3 表改/加（**缺 `types.ts` 即 tsc 红**）。窄面转绿。
- [ ] **neuter ①（求和）**：运行行只显示 `chunks_indexed` ⇒ ① 红。
- [ ] **neuter ②（下拉）**：`RERANK_PROVIDER_OPTIONS` 漏 `tei-rerank` ⇒ ③ 红。
- [ ] **门禁**：`pnpm check` 净（eslint + tsc）；窄面（`tests/unit/settings/functional-models.dom.test.tsx`）绿；更宽面（`tests/unit/settings/` 全目录 + `tests/unit/components/workspace/settings/`）绿。

**实测（待回填）**：

---

## Task 6 — 真栈验收

> 用户已在跑的 `:3000` + 可写库**「测试2」**（或新库）；后端重建是**写动作**（这正是验收内容），**不改 `config.yaml`**；改 `rag_config.json` 前逐字节备份、收尾还原。
> **验收对应**：spec §5 的 6 / 9 / 13。

- [ ] **① 重建链路（§5.6）**：记录重建前同一查询的三路读数（图谱证据数 / 百科最高分 / 向量命中）⇒ 触发「重建索引」202→`succeeded`；重建后复测 —— **图谱证据恢复（对照登记值 6）、百科分数量级恢复、向量腿不变或更好**；对照组 = 重建前。⚠️ 若库已被重建过不止一次，如实记录"当前空间 + 两次重建之间"的差，别把"本来就正常"当成修复证据（先造出跨空间状态：换一次嵌入 provider/模型 → 旧读数为 0/0.04 → 本对重建 → 恢复）。
- [ ] **② 召回徽标（§5.9）**：召回测试面板三路徽标 —— vector 显示**当前配置的模型名**（operator 现配 Jina）、graph/wiki = `embedding cosine`；若这轮把 `graph_rerank` 打开且池 > 阈值，graph 应显示模型名（改回后复原）。
- [ ] **③ TEI docker 腿（§5.13，operator 定）**：`docker run --rm -p 8080:80 ghcr.io/huggingface/text-embeddings-inference:cpu-1.9 --model-id BAAI/bge-reranker-base` → 配置 `tei-rerank`（地址 `http://127.0.0.1:8080`）→ 召回出分 + 网关日志 `POST /rerank 200`；**对照组** = `generic-rerank` 指同一地址 ⇒ 422 / 空榜（证明两种形状确实不同）。收尾：容器 `docker rm`、`rag_config.json` 逐字节还原。

**实测（待回填）**：

---

## Task 7 — 文档同步 + 交付后回写

> 动到的文件：`README.md:115`、`backend/AGENTS.md:876`（+ `:757-763` 的"恰好两个案例"名单）、`frontend/AGENTS.md`（仅措辞受影响时）；spec 与 plan 的 `**Status:**`。

- [ ] **README.md:115**：重建索引那句"重新嵌入现有切片" → 全部向量（切片/实体/百科条目/人工卡片），并补"不重跑图谱抽取"。
- [ ] **backend/AGENTS.md:876**：`POST /{kb_id}/reindex` 的描述同步（三条集合 + 三键进度）；`:757-763`：保存期检查"恰好两个案例"的措辞跟上（`generic-rerank` 缺地址那条此后是一族，`tei-rerank` 同规则）；**`:851`**（RAG 配置段末句 "it re-embeds the stored chunks and never re-parses" ⇒ 改成四类向量；2026-09-25 审查新发现的一处）。
- [ ] **frontend/AGENTS.md**：仅当重建状态/轮询说明的措辞受影响时改（初核：`:284` 一带只讲轮询节奏 ⇒ 大概率不动，据实）。
- [ ] **交付后回写**：spec 的 `**Status:**` 与 plan 本文件的 `**Status:**` 一起更新（交付的提交号 + 关键门禁数字），各 Task 的 `**实测**` 行补齐 —— **未回写的 plan 不算交付**。另：**开头"未提交"一句随之更新**（spec+plan 的第一笔提交号）。

**实测（待回填）**：