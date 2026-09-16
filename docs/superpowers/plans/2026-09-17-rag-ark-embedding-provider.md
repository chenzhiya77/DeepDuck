# 火山方舟嵌入 provider（第二家双路） —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-17-rag-ark-embedding-provider-design.md](../specs/2026-09-17-rag-ark-embedding-provider-design.md)
**Status:** 未开工（2026-09-17 起草）
**Parent:** [2026-09-16-rag-sparse-capability-probe.md](2026-09-16-rag-sparse-capability-probe.md)（模型级能力探针；探针本身**零改动**，本计划只是让它多覆盖一行 provider）

**Architecture:** 把「一次调用同时给稠密+稀疏」这条**已有的机制**（今天只有 `dashscope` 一家）补上第二个实现。落点是三层、全是加法：**allowlist 加一行**（`emits_sparse=True` 就是"第二家双路"的全部声明）、**一个新适配器**（走火山的多模态端点、一次一条、无条件发 `dimensions: 1024`）、**前端那个写死的选项常量加一个值**。保存期交叉校验、能力探针、空稀疏兜底、密钥 env 提示**都已经是 provider 无关的**，不改。

**依赖顺序**：Task 1（后端）→ Task 2（前端）→ Task 3（文档 + 真栈）。Task 2 依赖 Task 1 的字段（前端选项要能通过 PUT）。

---

## Task 0 — 开工前的七项核实（只读，不改代码）

- [ ] 1. `Embedder` Protocol 的确切成员（`batch_size` / `embed` 的签名与 `text_type` 是否必须 / `EmbeddingResult` 的字段名）——**以 `OpenAICompatibleEmbedder` 为准对齐**，别照 `_SparseHalfCheckedEmbedder` 那个包装类的签名抄。
- [ ] 2. `EMBEDDING_PROVIDER_OPTIONS` 与 `PROVIDER_LABELS` 的**全部消费点**（grep 前后端）：加一个值会不会漏改别处；`tsc` 是否会逼出别的文件（表单值类型是从常量派生的）。
- [ ] 3. 地址那一行的判据现状（`=== "dashscope" ? LockedBox : Input`）与 `core/rag/types.ts` 里能力块的类型定义位置（要加 `has_fixed_endpoint`）；确认 **rerank 那一行的同名判据不在本期改动范围**（**保持不动**，只在 spec §6 G3 记一行）。
- [ ] 4. 确认**密钥的环境回退与界面 env 提示对新 provider 自动生效**（预期：靠 `_SECRET_LEGS["embedding_api_key"]` + allowlist 的 `secret_env_var`）。若不生效，这一步要变成 Task 1 的一小项。
- [ ] 5. 除 `test_get_returns_the_embedding_provider_capabilities` 之外，**还有没有别处钉住 `embedding_providers` 的长度/内容**（后端 + 前端 dom 都要 grep）；有就一并列进 Task 1/2。
- [ ] 6. `ARK_API_KEY` 这个 env 名与仓库既有 env 约定**不冲突**（grep `ARK_`）。
- [ ] 7. `ProviderSpec` 是 `@dataclass(frozen=True, slots=True)`：确认现有行**全部用关键字构造**（加两个带默认的字段才安全），以及**能力块每条新增 `has_fixed_endpoint` / `default_endpoint`** 是否仍是纯加法（预期：是——两条形状守卫把 `embedding_providers` 整键排除在深层比较之外）。

**门禁**：无（只读）。

---

## Task 1 — 后端：allowlist 一行 + 适配器 + `Literal` 加值（D1–D4）

- [ ] **RED**：新建 `backend/tests/knowledge/test_embedder_ark.py`，桩一个本地 HTTP 端点（照 `tests/test_rag_config_sparse_probe.py` 的桩法）：
  1. **请求形状守卫**：body 恰好是 `model` / `input`（**恰好一条** `{"type":"text","text":…}`）/ `dimensions`（**恰为 1024**）/ `sparse_embedding`（恰为 `{"type":"enabled"}`），且路径 `/api/v3/embeddings/multimodal`；
  2. **一次一条**：喂 3 条 ⇒ **恰好 3 次**请求（桩记数），且 `batch_size == 1`；
  3. **解析**：`data.embedding` + `data.sparse_embedding[]` ⇒ dense 长度与 `sparse.indices/values` 一一对应；
  4. **空稀疏**：`sparse_embedding: []` ⇒ **`SparseHalfMissingError`**（证明适配器自己不吞空稀疏，是外层兜的）；
  5. **失败类型**：401 ⇒ `EmbedderAuthError`；500 ⇒ `EmbedderError`；形状不符 ⇒ `EmbedderError`；
  6. **无条件发 1024**：即使 `rag.embedding_dimension` 为 `None`，请求里仍有 `dimensions: 1024`（**1024 由工厂通过构造参数注入，适配器不 import `COLLECTION_DIMENSION`**——那个常量只在 `embedder_factory.py`，实现模块反向 import 会破坏分层）；
  7. **默认值未动**：`RagConfig().embedding_provider == "dashscope"`；
  8. **建得出来**：`build_embedder(config, rag=<火山 + sparse_source=provider>)` 不抛；
  9. **`text_type` 接受但不发送**：打桩断言 `text_type="query"` 与 `"document"` 发出的请求体**逐字节相同**，且都不抛（防的是签名不符的 `TypeError`——`_SparseHalfCheckedEmbedder` 会把 `text_type` 透传下来）；
  10. **env 名**：`secret_env_var("embedding", "volcengine-ark") == "ARK_API_KEY"`；
  11. **`has_fixed_endpoint` / `default_endpoint`**：`dashscope` 与 `volcengine-ark` 为 `True` + 各自的默认地址、`openai-compatible` 为 `False` + `None`（默认关没被带偏）；**能力块每条也带这两个键**；**并对每一行断言 `has_fixed_endpoint == (default_endpoint is not None)`**（⑥甲：两个键不可能默默矛盾）；
  12. **⑤-4 的回归保护（最重要的一条）**：把 `rag.embedding_base_url` 指向**本地桩的地址**（当作"自定义地址"）⇒ `dashscope` / `volcengine-ark` 的构造**把它传给了实现**、请求确实落在桩上（**不是**默认 host）——**证明 workspace 级地址没被砍掉**；而 `openai-compatible` 不填时仍抛 `RagConfigurationError`；
  13. **防漂移**：`resolve_provider("embedding","dashscope").default_endpoint == embedder.DASHSCOPE_BASE_URL`（两处不会各自漂走，**也不必为此 import**——那个模块要 import-light）。
     另在 `backend/tests/test_rag_config_api.py` 把那条字面量用例更新成三项（顺序仍 `== list(provider_ids("embedding"))`）。
- [ ] **GREEN**：
  - `knowledge/providers/__init__.py`：加 `volcengine-ark` 一行（`emits_sparse=True`、`pins_dimension=True`、`has_fixed_endpoint=True`、`default_endpoint="https://ark.cn-beijing.volces.com"`、`path="/api/v3/embeddings/multimodal"`、`secret_env_var="ARK_API_KEY"`）；`dashscope` 那一行补 `has_fixed_endpoint=True` + `default_endpoint="https://dashscope.aliyuncs.com"`（**写字面量、不 import `embedder`**——本模块要 import-light，理由写进注释）；**新增 `ProviderSpec.has_fixed_endpoint: bool = False` 与 `default_endpoint: str | None = None`**。
  - `knowledge/embedder_ark.py`（新）：`ArkEmbedder`，顺序循环、`batch_size = 1`、**宽度从构造参数收（每次请求都发 `dimensions`；不 import 工厂的 `COLLECTION_DIMENSION`）**、**显式收下 `text_type` 但不发送**（照 `embedder_openai.py` 那句 docstring 的写法）、解析 `data.sparse_embedding[]`、失败复用 `EmbedderError` / `EmbedderAuthError`。
  - `knowledge/embedder_factory.py`：有固定地址的 provider 用 `rag.embedding_base_url or spec.default_endpoint`（**存量值优先 ⇒ 行为与今天等价**）；**对它每次都注入 `dimension=`（= `rag.embedding_dimension or COLLECTION_DIMENSION`）**；那句「（只有 dashscope 有内置地址）」改成**不枚举 provider** 的措辞。
  - `app/gateway/routers/rag_config.py`：能力块每条**新增 `has_fixed_endpoint` / `default_endpoint`**（纯加键，走 allowlist）。
  - `config/app_config.py` 与 `config/rag_config_file.py` 的 `embedding_provider` `Literal` 各加一个值。
- [ ] **neuter 三条（都必须有牙）**：① 把 `sparse_embedding` 从请求体里去掉 ⇒ 形状守卫红；② 把 `dimensions` 改回"只在声明时才发" ⇒ 用例 6 红（这正是 spec §3 D3 要防的那个坑）；③ 能力块不填 `has_fixed_endpoint` / `default_endpoint` ⇒ 用例 11 红。
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`tests/knowledge/` + `tests/test_rag_config_api.py` + 探针两个文件）绿；**全量后端后台跑**（≈23 分钟），跑完与上一轮 FAILED 集合**双向 diff**。

## Task 2 — 前端：选项加一个值 + 地址那一行改读 allowlist（D5）

- [ ] **RED**：
  1. `frontend/tests/unit/rag/config-form.test.ts`：`EMBEDDING_PROVIDER_OPTIONS` 含 `volcengine-ark`，且表单值类型可赋值；
  2. `tests/unit/settings/functional-models.dom.test.tsx`：切到火山 ⇒ **不出现**「只输出稠密」那条 `role="alert"`、**Save 不被拦**（与 `openai-compatible` 的行为做对照）；
  3. **地址那一行**：火山 **与 dashscope** ⇒ 都是 `LockedBox`，框里显示**实际会用的地址**（无存量值时 = 能力块给的 `default_endpoint`）；`openai-compatible` ⇒ 仍是可编辑 `Input`（对照组，证明改动没有波及它）；
  4. **「恢复默认」**：造一个**有存量 `embedding_base_url`** 的配置 ⇒ 锁框旁出现该动作；点它 ⇒ 该字段清空、框里改显示该 provider 的默认地址；**无存量值时它不出现**（而不是渲染成一个点了没反应的按钮）。
- [ ] **GREEN**：`core/rag/types.ts`（能力块类型加 `has_fixed_endpoint` / `default_endpoint`）、`core/rag/config-form.ts`（`EMBEDDING_PROVIDER_OPTIONS` 加值）、`functional-models-view.tsx`（`PROVIDER_LABELS` 加一行 + **地址那一行改读能力块** + **「恢复默认」动作**（清空 `embedding_base_url`））、i18n 三处（`zh-CN` / `en-US` / `types`）加键（含「恢复默认」）。
- [ ] **neuter 三条**：① 把新值从 `EMBEDDING_PROVIDER_OPTIONS` 撤掉 ⇒ dom 用例红；② 把地址那一行改回写死 `=== "dashscope"` ⇒ 用例 3 的火山那半红；③ 去掉「恢复默认」的渲染 ⇒ 用例 4 红。
- [ ] **门禁**：`pnpm check`（eslint + tsc，tsc 仅宠物线那条预存红）+ prettier **逐文件与 HEAD 比数字**（别对本来有格式债的文件跑 `--write`）+ **全量前端**。

## Task 3 — 文档同步与真栈验收

- [ ] `backend/AGENTS.md`（嵌入 provider 段）：补 `volcengine-ark` 一行——**稀疏只在多模态端点、文本端点没有该参数**、**一次一条所以 `batch_size=1`**（代价按**实测 ~1.3 倍**写，不按"请求数 × 20"的直觉）、**无条件发 `dimensions:1024` 的理由**（born 2048 + 维度守卫不在保存期跑）、**`text_type` 收下但不发送**；另补**`has_fixed_endpoint` / `default_endpoint` 这条规则**——地址由提供方固定 ⇒ 界面锁、**存量值仍然生效（workspace 级地址保留）**、界面给「恢复默认」；并记 §6 的 G3（rerank 那行仍写死）。
- [ ] `frontend/AGENTS.md`（功能模型段）：补新选项，以及"它 `emits_sparse=true` ⇒ 不出现 dense-only 告警"。
- [ ] **真栈腿 A①（配置与探针）**：设置页选火山（模型 `doubao-embedding-vision-250615`）+ 密钥 ⇒ 保存成功、无告警；`POST /api/rag/config/probe-embedding` 回 **`supported`**（"双路"在真栈上的证据）。
- [ ] **真栈腿 A②（真调用）**：用真端点跑一次 `build_embedder(...).embed([...])` ⇒ `dense` 非空且 **`sparse.indices` 非空**。
- [ ] **真栈腿 A③（地址那一行的规则）**：选火山 ⇒ 锁框显示**火山的默认地址**、「恢复默认」**不出现**（没有存量值）；手工在 `rag_config.json` 塞一个**自定义地址**（就用百炼的 workspace 级地址试）⇒ 重载页面后锁框显示**那个自定义地址**、且「恢复默认」**出现** ⇒ 点它，框改回默认，`embedding_base_url` 被清空。**这一步专门证"workspace 级地址没被砍"**（前提：前端**不会**回退/重置这个字段——实现时确认一次）。
- [ ] **真栈腿 A④（收尾）**：配置**逐字节还原**（md5 与动手前相同）、密钥不落盘、不新建任何文件；「重建索引」入口**只确认在、不实际重建**（重建会改数据）。
      > 「不切 provider ⇒ 零影响」**不在真栈重复**——它由后端那两条纯加法形状守卫在用例层钉住。原先把它写成真栈的一条是**自相矛盾**的（同一条腿里既要切又要求不切）。
- [ ] **门禁**：文档过 prettier（worktree 与 HEAD 数字相同）；`rag_config.json` md5 与动手前相同。

---

## 提交切分

| 提交 | 内容                                                        |
| ---- | ----------------------------------------------------------- |
| 0    | **本计划 + 它的 spec 成对**（本线先例：spec/plan 成对一笔）  |
| 1    | Task 1（allowlist + 适配器 + `Literal` + 用例）              |
| 2    | Task 2（前端选项 + i18n + 用例）                             |
| 3    | Task 3（文档 + 真栈结论）                                    |

不改表、不改 `rag_config.json` schema、**不动任何默认值**。
