# 稀疏来源的模型级能力探测 —— 实施计划

**Spec:** [2026-09-16-rag-sparse-capability-probe-design.md](../specs/2026-09-16-rag-sparse-capability-probe-design.md)
**Status:** 未开工（2026-09-16 起草）
**前序:** [2026-09-16-rag-sparse-compatibility-guard.md](2026-09-16-rag-sparse-compatibility-guard.md)（已交付：provider 级能力下发 + 编辑期拦截 + 保存期同段判定 + `RagConfigurationError`）

**Architecture:** 把"这个模型能不能自己出稀疏"从**声明**变成**实测**：`dashscope` 保留允许名单那一行（方言支持），但"具体模型支不支持"由一次只读探针（照 `POST /api/models/config/validate` 的先例，不落盘、有界超时）给出**三态**结论；界面把"允许名单 + 探针"合成一个 `sparseCapability`，已知不支持就把「跟随向量模型」置灰，探测不支持就落值报红并挡 Save，探测不到（`unverifiable`）**放行**并标「未验证」。运行期再加一道兜底：`source=provider` 时若真实嵌入拿不到稀疏 ⇒ `RagConfigurationError`（每进程只判一次，与维度认证同模式），让"探不到的角落"也不再有静默降级。**默认值一个都不动。**

**依赖顺序**：Task 0（三项核实）→ Task 1（探针）与 Task 2（运行期兜底）可并行但按序提交 → Task 3 依赖 Task 1 → Task 4、Task 5 收尾。

---

## Task 0 — 开工前的三项核实（只读）

1. **照抄先例**：读 `POST /api/models/config/validate` 的实现（`app/gateway/routers/models.py`），确认它的鉴权、超时、以及"`detail` 绝不回显密钥"的做法，探针逐条对齐。
2. **RED 怎么立**：探针要能对着一个"只返 dense"的目标断言 `unsupported`。核实能否用 `httpx.MockTransport` 桩出这种响应（现有 `tests/knowledge/test_embedder_providers.py` 已有 `_openai_transport` 的先例）——**不要**去真找一个平台上的单路模型。
3. **三态放哪**：确认前端把合成逻辑放 `core/rag/config-form.ts` 的纯函数（可被 node 用例驱动），而不是组件里的 `useState` 派生——这决定 Task 3 的用例能不能立。

---

## Task 1 — 后端：只读探针端点（D3）

**RED**

- `backend/tests/test_rag_config_probe.py` 加：
  1. 桩一个**返回稀疏**的响应 ⇒ `200 {status: "supported"}`；
  2. 桩一个**只返 dense**（无 `sparse_embedding`）的响应 ⇒ `{status: "unsupported"}`，`detail` 含两个出路；
  3. 桩**网络失败 / 超时** ⇒ `{status: "unverifiable"}`（**不是** `unsupported`）；
  4. **非稀疏原因的失败也归 `unverifiable`**：桩一个**维度不是 1024** 的响应（维度守卫在返回前就抛，`embedder_factory.py:60`）⇒ `unverifiable` 且 `detail` 带真实原因——**不是** `unsupported`；
  5. **不落盘**：调用前后 `rag_config.json` 逐字节相同；
  6. **不回显密钥**：提交一个明显的假 key，断言响应体与 `detail` 里都不含它；
  7. 非 admin ⇒ 403。

**GREEN**

- `app/gateway/routers/rag_config.py` 加 `POST /rag/config/probe-embedding`：请求体带候选 `{embedding_provider, embedding_model, embedding_base_url?, embedding_api_key?}`；`api_key` 为掩码哨兵时取已存/环境的那把（复用 `preserve_secret` + `_secret_env_name` 的既有逻辑）。
- 实现走**同一段** `build_embedder(rag=<候选>)`，只发一次嵌入（1 条短文本），检查返回的 `EmbeddingResult.sparse.indices` 是否非空；据此给三态。
  - **`unsupported` 只在"调用成功且稀疏为空"时给**；**任何非稀疏原因的失败**（超时/连接/鉴权/限流/**维度不符**/缺地址）一律 `unverifiable`，`detail` 带上真实原因。探针**不替代保存期校验**（维度与地址仍归 PUT 那层）。
  - 探针会顺带写一次 `_PROBED_DIMENSIONS`（合法的维度认证）——不特殊处理，但要在代码注释里写明，免得以后有人以为它是脏数据。
- 超时沿用 validate 的 10s；`detail` 只带状态码 + 截断的响应片段。

**门禁**：`cd backend && make test`（窄面先跑该文件，再全量）。

---

## Task 2 — 后端：运行期兜底（D5）

**RED**

- `backend/tests/knowledge/test_embedder_providers.py` 加：
  1. `source=provider` + 桩"只返 dense" ⇒ `RagConfigurationError`，且消息含两条出路；
  2. **连续两次嵌入都抛**——**不**做 fail-open 缓存（不要照抄维度守卫的"先缓存后抛"：空稀疏是合法值，放过一次就真写进库，此后永久静默）；
  3. `source=bm25` / `external` + 空稀疏 ⇒ **不抛**（那一半本来被 `ComposedEmbedder` 丢弃）。

**GREEN**

- `embedder_factory.py` 加一个包装（结构上与 `_DimensionCheckedEmbedder` 相似，但**语义相反**）：`source=provider` 时每次真实嵌入都检查 `results[0].sparse.indices` 是否为空 ⇒ 空则抛 `RagConfigurationError`。
- **不要**加进程级"已判过"缓存；代码注释里写明为什么这里不能沿用维度那条先例（维度不符会被 Qdrant 拒收，空稀疏不会）。
- 注意**只在 `source=provider` 时包装**（其它来源不走这条）。

**门禁**：全量（动了共享层）。

---

## Task 3 — 前端：三态合成 + 置灰 + 自动探测（D2 / D4）

**RED**

- `frontend/tests/unit/rag/config-form.test.ts`（node）加三条纯函数用例：
  - `resolveSparseCapability` 的语义：允许名单 false ⇒ `unsupported`（**不需要探针**）；允许名单 true + 探针 `supported / unsupported / unverifiable` 各一条；**探针未跑或条件不全** ⇒ `unknown`。
  - **结论绑定**：`probe.key` 与当前表单值不符（换了 model / provider / base_url 任一）⇒ `unknown`，**不沿用旧结论**（`sparseProbeKey(values)` 的用例一并钉住键的构成）。
  - `isSparseProviderOptionDisabled(capability)`：只有 `unsupported` 为真——这是"选不了"的**可测落点**（Radix Select 在 happy-dom 里打不开选项，所以置灰不能靠端到端断言，见该文件既有注释）。
- `frontend/tests/unit/settings/functional-models.dom.test.tsx`（dom）加：
  1. 探针返回 `unsupported` ⇒ 落值 + `role="alert"` + Save 禁用（复用上一版断言）；
  2. `unverifiable` ⇒ 可保存 + 标「未验证」；
  3. **没填 model ⇒ 不发请求**（断言 mock 的 fetch 未被调用）；
  4. **密钥来自环境（`sources[field] === "env"`、输入框为空）⇒ 仍要发**——这条最容易漏，而它正是当前部署的形态；
  5. 渲染层可覆盖的部分：处于 `unsupported` 时该行/卡片的可见表现与置灰函数的输出一致（不断言下拉内部）。

**GREEN**

- `core/rag/config-form.ts`：三个纯函数——`sparseProbeKey(values)`、`resolveSparseCapability(values, providers, probe)`、`isSparseProviderOptionDisabled(capability)`。
- `core/rag/hooks.ts`：`useProbeSparseCapability`（TanStack mutation，调 Task 1 的端点，不 invalidate 配置；返回结论**带上它测的键**）。
- `functional-models-view.tsx`：按三态渲染（置灰 / 「检测中…」 / 「未验证」 / 复用既有告警与 Save 禁用）；触发条件写在代码注释里——`dashscope` **且** model 非空 **且** `sources.embedding_api_key !== "unset"`（**不是**"输入框非空"，env 形态下输入框就是空的）。
- i18n 三处：新增三个键（检测中 / 未验证 / 检测说明——"会产生一次真实调用"），中英各一句。

**门禁**：`pnpm check` + 全量 `pnpm test`。

---

## Task 4 — 前端：「稀疏模型」这一行的交代（D6）

**RED**：dom 用例断言该行带 ⓘ，且其可访问名说明"TEI 一个实例只服务一个模型，因此不下发"。

**GREEN**：给那一行加 `info`（复用 `RowLabel` 的 ⓘ）；i18n 三处加一句。**不改行为**。

**门禁**：同上（改了共享设置视图，全量）。

---

## Task 5 — 文档同步与真栈验收

- `backend/AGENTS.md`：RAG 配置一节补探针端点（形状、三态、不落盘、不回显密钥、**非稀疏失败一律 unverifiable**）与运行期兜底（**每次检查、判否定持续抛**、只作用 `provider`、为何**不**沿用维度那条 fail-open 缓存）。
- `frontend/AGENTS.md`：功能模型一节补三态与置灰规则、自动探测的触发条件（**含 env 形态**）、结论绑定到 `provider|model|base_url`、`unverifiable` 的放行语义。
- 真栈 —— **先分清它能验什么**：
  1. **已知不支持**：provider 切成 `openai-compatible` ⇒ 选项置灰 / 告警 + Save 灰；
  2. **`unverifiable`**：清空 model（或断开探测条件）⇒ 可保存 + 标「未验证」；
  3. **运行期兜底**：手工把 `rag_config.json` 写成 `source=provider` 且目标只出稠密 ⇒ 打一次会嵌入的接口 ⇒ `RagConfigurationError`（可读 400 或该路的降级说明）。每步之后把 `rag_config.json` **逐字节还原**并用 `GET /api/rag/config` 复核。
  4. **模型级的 `unsupported` 不加进真栈**：除非用户给出一个**真实存在的单路模型 id**，它只在测试层覆盖——用可控桩跑出来的不算真栈验收，这里如实写明，不冒充。

---

## 提交切分

| 提交 | 内容                                      |
| ---- | ----------------------------------------- |
| 1    | Task 1（探针端点）+ 用例                  |
| 2    | Task 2（运行期兜底）+ 用例                |
| 3    | Task 3（三态与界面）+ 用例                |
| 4    | Task 4 + Task 5（交代 + 文档 + 真栈结论） |

不改表、不改 `rag_config.json` schema、不动任何默认值。
