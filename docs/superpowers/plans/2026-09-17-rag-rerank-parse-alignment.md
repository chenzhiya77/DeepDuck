# 两条尾巴腿的对齐（G3 + G4 合并） —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-17-rag-rerank-parse-alignment-design.md](../specs/2026-09-17-rag-rerank-parse-alignment-design.md)
**Status:** 未开工（2026-09-17 起草）
**Parent:** [2026-09-17-rag-save-time-embedding-probe.md](2026-09-17-rag-save-time-embedding-probe.md)（那份 spec §6 把 G3/G4 判为「同因、本期不治」；本计划是它的**增量**）

**Architecture:** 把嵌入腿已经立好的两条规矩横向补到**重排 / 解析**两条腿上，全部是"把既有的判断换个出口/换个类型/换个数据来源"，**不新写判断**：

1. **G4-a（异常类型）**：两处 `raise ValueError` 改抛 `RagConfigurationError` ⇒ 网关那条 400 映射白拿。
2. **G4-b（保存期扩面）**：`PUT` 的静态检查从"只构造嵌入器"扩到"三条腿都构造一遍"（**纯离线，不新增任何网络调用**），并为此给 `build_reranker` / 解析构造各补一个 `rag=` 覆盖（照 `build_embedder` 的先例）。
3. **G3（能力块 + 界面）**：响应新开平行的 `rerank_providers`（纯加键），重排 allowlist 的 `dashscope` 行补两个字段；前端把 `resolveFixedEndpointRow` **参数化**（核心 + 两个薄包装），重排那一行改读能力块，含同款「恢复默认」。

**依赖顺序**：Task 1（G4）→ Task 2（G3，依赖 G4 定下的后端形状）→ Task 3（文档 + 真栈）。

---

## Task 0 — 开工前的五项核实（只读，不改代码）

- [ ] 1. 两处拒绝点的确切位置、文案与**触发路径**（`reranker_factory.py` / `parse_local.py`），以及**有没有既有用例钉住"裸 ValueError"或 500**——按**错误文案 + 界面词汇**两头 grep（别只按字段名扫）。
- [ ] 2. 两个构造点的签名：`build_reranker(config)` / `parser.py::_build_parse_provider(...)`（它现在连 config 都不收、直接读 `get_app_config().rag`）——补 `rag=` 覆盖要动几处；`parse_document` 怎么给 `model_version`，保存期校验用哪个值（**构造不能出网**，核清 cloud 那家的构造是否纯离线）。
- [ ] 3. 能力块的两条形状守卫现状（golden 夹具 + 允许集写法）：新键 `rerank_providers` 要登记在哪几行；`provider_ids("rerank")` 的顺序。
- [ ] 4. 前端重排那一行的现状（写死判据的确切行号）与**会被 G3 动到的既有 dom 断言**：按**界面词汇** grep（`由提供方固定`、`重排接口地址`、`恢复默认`、`重排提供方`），把行号列出来；spec §6 **S3** 已列了四处（`:511` / `:512` / `:600` / 夹具 `view()`），**要独立复核并补充**（别只信那张表）。
- [ ] 5. `resolveFixedEndpointRow` 的签名与它的 **5 处调用点**（`config-form.test.ts` 内 5 处、视图 1 处使用）——参数化（抽核心 + 两个薄包装）会不会改动嵌入那侧的调用形状；若会，先记清是哪几处。

**门禁**：无（只读）。

---

## Task 1 — G4：异常类型对齐 + 保存期扩到三条腿（D1–D2，D6）

- [ ] **RED**：
  1. `build_reranker(rag=<generic-rerank 无地址>)` ⇒ **`RagConfigurationError`**，且 `isinstance(exc, ValueError)` 仍为真；
  2. `MineruLocalParseProvider(base_url="")` ⇒ **`RagConfigurationError`**；未知 `backend` 同理（**防御性**：`parse_backend` 是 `Literal["vlm","hybrid"]`，配置到不了那里，用例只钉类型不钉可达性）；
  3. **保存期**：`PUT` 一份"重排选了通用但没地址"的配置 ⇒ **400**、正文点名重排、**文件未被写**（读回逐字节相同）；同一份在 HEAD 上是 200（用固定对照说明这是**收紧**）；
  4. **保存期**：`PUT` 一份"本地解析但没地址" ⇒ **400**；
  5. **反例**：三条腿都完整 ⇒ **200**，且**保存期零网络调用**（不出网的桩：任何出网即红）；
  6. **网关**（真实路由）：`rerank_provider=generic-rerank` 无地址时经 HTTP 得到 **400 + 可读正文**（而不是 500）。
- [ ] **GREEN**：
  - `reranker_factory.build_reranker(config=None, *, rag=None)`：`rag` 覆盖 + 改抛 `RagConfigurationError`；
  - `parse_local.MineruLocalParseProvider.__init__` 的两处改抛 `RagConfigurationError`；
  - `parser.py`：把解析 provider 的构造抽成收 `rag=` 的入口（`_build_parse_provider` 加 `rag=None`，内部 `rag or get_app_config().rag`），`parse_document` 照旧调用；
  - `rag_config._reject_unusable_after_save(pending)`：三条腿都构造（**判断逻辑一行不重写**），异常仍映射成 `提交后的配置仍不可用：<原因>`；
  - `embedder.py` 里 `RagConfigurationError` 的 docstring：语义从"嵌入腿"改成"任一条腿"。
- [ ] **neuter 三条（都必须有牙）**：① 只改解析那半、不改重排 ⇒ 用例 1 红；② 保存期仍只构造嵌入器 ⇒ 用例 3/4 红；③ 保存期把异常吞成 warning ⇒ 用例 3/4 红（且 5 仍绿 ⇒ 证明不是"一律拒"）。
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`tests/knowledge/` + `tests/test_rag_config_api.py` + 新文件）绿；**全量后端后台跑**，跑完抽全部 FAILED 的 node id 去 HEAD 跑同一批、双向 diff（`xargs -d '\n'`，别 pipe 长跑）。

## Task 2 — G3：能力块新键 + 重排行改读它（D3–D4）

- [ ] **RED**：
  1. `GET /api/rag/config` 的 `rerank_providers` 与 `provider_ids("rerank")` 同序、两个键逐条正确（`dashscope` = `True` + 默认地址、`generic-rerank` = `False` + `None`）；
  2. **防漂移**：`spec("rerank","dashscope").default_endpoint == reranker.DASHSCOPE_RERANK_BASE_URL`；
  3. 两条既有形状守卫按新契约**显式登记**新键后仍绿（改动即"加键"，不是改值）；
  4. 前端纯函数：重排行的判定按 `rerank_providers` 走（能力块说固定 ⇒ 锁、说没有 ⇒ 不锁、**旧响应（无该键）⇒ 不锁**）；
  5. dom：重排选 `dashscope` ⇒ 锁框显示**实际会用的地址**（无存量值时 = 默认地址）；选 `generic-rerank` ⇒ 可编辑 `Input`；有存量值时给「恢复默认」，点它清空；
  6. dom：**嵌入那两行行为不变**（参数化重构的回归保护）；
  7. **既有断言按新契约更新**（spec §6 S3 那四处：`:511` 单数 `getByText` 改 `getAllByText` + 个数、`:512` 的 chip 计数 1→0 改钉"重排行显示地址"、`:600` 的字形比对改钉一种**仍显示原因**的锁如 `F.lockedLocalOnly`、夹具 `view()` 补一份重排能力块）——**先按 Task 0 第 4 项的 grep 结果核对/补充这张表，再动手**。
- [ ] **GREEN**：
  - `providers/__init__.py`：rerank 的 `dashscope` 行补 `has_fixed_endpoint=True` + `default_endpoint="https://dashscope.aliyuncs.com"`；
  - `rag_config.py`：新增 `RerankProviderCapability`（`provider_id` / `has_fixed_endpoint` / `default_endpoint`，**无 `emits_sparse`**）与 `rerank_providers` 的填充函数（与 `_embedding_provider_capabilities` 同形，读 `provider_ids("rerank")`）；
  - `types.ts`：能力块类型加一个重排版；
  - `config-form.ts`：`resolveFixedEndpointRow` 拆成**一个核心 + 两个薄包装**（嵌入 / 重排），嵌入那侧**签名与 5 处调用点形状都不变**；
  - `functional-models-view.tsx`：重排那一行改读能力块（含「恢复默认」），删掉写死的 `=== "dashscope"`；
  - `functional-models.dom.test.tsx`：按 S3 更新那三处断言 + 夹具补 `RERANK_PROVIDERS`（与 `EMBEDDING_PROVIDERS` 同形，**不带 `emits_sparse`**）。
- [ ] **neuter 三条**：① 重排行改回写死判据 ⇒ dom 用例红；② 能力块不填两个新键 ⇒ 用例 1 红；③ 去掉「恢复默认」的渲染 ⇒ 用例 5 红。
- [ ] **门禁**：`pnpm check`（eslint + tsc，**应为零诊断**）；prettier 逐文件与 HEAD 比数字；**全量前端**；两条 `.md` 的 prettier 同数（Task 3 一起核）。

## Task 3 — 文档同步与真栈验收

- [ ] `backend/AGENTS.md`（RAG 配置节）：保存期的检查**覆盖面**从"嵌入"改成"三条腿"（**纯离线、不新增网络调用**）、`RagConfigurationError` 的语义扩大、新键 `rerank_providers`（条目形状与嵌入那条不同：**没有 `emits_sparse`**）、以及 §6 **S1** 那条收紧（**确切只有两种**：`generic-rerank` 缺 `rerank_base_url` / `mineru-local` 缺 `parse_base_url`；一旦 `config.yaml` 是那样，此后每次 PUT 都 400 + 逃生口是改 `config.yaml`）。
- [ ] `frontend/AGENTS.md`（功能模型节）：重排地址行与嵌入同行构（锁/显示实际地址/「恢复默认」/unknown ≠ cannot），并点名 `resolveFixedEndpointRow` 现在是"核心 + 两个薄包装"。
- [ ] **真栈腿①**：把重排配成「通用重排」但地址留空 ⇒ 保存**当场 400**（可读原因）；补上地址 ⇒ 200。
- [ ] **真栈腿②**：解析配成「本地 MinerU」但地址留空 ⇒ 保存**当场 400**。
- [ ] **真栈腿③（界面）**：重排选 `dashscope` ⇒ 锁框显示默认地址；选「通用重排」⇒ 变成可编辑；填一个地址保存成功后回到 `dashscope` ⇒ 出现「恢复默认」（存量值），点它 ⇒ 地址字段被清空。
- [ ] **收尾**：配置**逐字节还原**（md5 与动手前相同）、密钥不落盘、不新建文件、浏览器里被改过的表单重载丢弃；「重建索引」入口**只确认在、不实际重建**。
- [ ] **门禁**：两份 `AGENTS.md` 的 prettier 与 HEAD 同数（**量 `frontend/AGENTS.md` 必须在 `frontend/` 里跑**，否则给出假数字）；`rag_config.json` md5 未变。

---

## 提交切分

| 提交 | 内容                                                 |
| ---- | ---------------------------------------------------- |
| 0    | **本计划 + 它的 spec 成对**                          |
| 1    | Task 1（G4：异常类型 + 保存期三条腿 + 用例）         |
| 2    | Task 2（G3：`rerank_providers` + 前端参数化 + 用例） |
| 3    | Task 3（文档 + 真栈结论）                            |

不改表、不改 `rag_config.json` schema、**不动任何默认值**、**不新增网络调用**。
