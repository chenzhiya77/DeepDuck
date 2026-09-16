# 稀疏来源的模型级能力探测 —— 实施计划

**Spec:** [2026-09-16-rag-sparse-capability-probe-design.md](../specs/2026-09-16-rag-sparse-capability-probe-design.md)
**Status:** 未开工（2026-09-16 起草）
**前序:** [2026-09-16-rag-sparse-compatibility-guard.md](2026-09-16-rag-sparse-compatibility-guard.md)（已交付：provider 级能力下发 + 编辑期拦截 + 保存期同段判定 + `RagConfigurationError`）

**Architecture:** 把"这个模型能不能自己出稀疏"从**声明**变成**实测**：`dashscope` 保留允许名单那一行（方言支持），但"具体模型支不支持"由一次只读探针（照 `POST /api/models/config/validate` 的先例，不落盘、有界超时）给出**三态**结论；界面把"允许名单 + 探针"合成一个 `sparseCapability`，已知不支持就把「跟随向量模型」置灰，探测不支持就落值报红并挡 Save，探测不到（`unverifiable`）**放行**并标「未验证」。运行期再加一道兜底：`source=provider` 时若真实嵌入拿不到稀疏 ⇒ `RagConfigurationError` 的子类 `SparseHalfMissingError`（**每次嵌入都判、不做 fail-open 缓存**，理由见 Task 2），让"探不到的角落"也不再有静默降级。**默认值一个都不动。**

**依赖顺序**：Task 0（三项核实）→ Task 1（探针）与 Task 2（运行期兜底）可并行但按序提交 → Task 3 依赖 Task 1 → Task 4、Task 5 收尾。

---

## Task 0 — 开工前的三项核实（只读）

1. **照抄先例**：读 `POST /api/models/config/validate` 的实现（`app/gateway/routers/models.py`），确认它的鉴权、超时、以及"`detail` 绝不回显密钥"的做法，探针逐条对齐。
2. **RED 怎么立**：探针要能对着一个"只返 dense"的目标断言 `unsupported`。核实能否用 `httpx.MockTransport` 桩出这种响应（现有 `tests/knowledge/test_embedder_providers.py` 已有 `_openai_transport` 的先例）——**不要**去真找一个平台上的单路模型。
3. **三态放哪**：确认前端把合成逻辑放 `core/rag/config-form.ts` 的纯函数（可被 node 用例驱动），而不是组件里的 `useState` 派生——这决定 Task 3 的用例能不能立。

---

## Task 1 — 后端：只读探针端点（D3）

**状态：已交付 2026-09-16。**

**交付纪要**

- **实现**（`app/gateway/routers/rag_config.py`）：`POST /api/rag/config/probe-embedding`，admin 门控；请求体 `extra="forbid"`；`api_key` 支持掩码哨兵（＝用已存/环境的那把，环境名按**候选 provider** 解析，复用 `_secret_env_name`）；`asyncio.wait_for` 有界超时 10s（沿用 validate 的常量）；`detail` 折叠空白并截断 200 字符（沿用 validate 的 `_ERROR_BODY_SNIPPET` 做法）；**只读不落盘**。
- **名单已知的答案不打网络**：`emits_sparse=false` 的 provider 直接回 `unsupported`，零次出网——只有真正未知的（`dashscope` + 具体模型）才发那一次真实调用。
- **用例 8 条**（`backend/tests/test_rag_config_probe.py`）。RED 时 6 红 1 绿：那条"绿"是 `test_probe_never_echoes_the_key`，当时它断言的是**404 的响应体**不含密钥——**空断言**，当场改成"先断言探针成功、再断言答复里没有 key"。
- **两次 neuter（都有牙）**：① 把失败一律报成 `unsupported`（抹掉三态区分）⇒ `unreachable` 与 `401` 两条红；② 把稀疏判空那步变成空判（任何答复都算支持）⇒ `dense-only` 那条红。
- **实现期更正了文档两处（spec §3 D3 + §5、本 plan 的 RED 第 4 条已同步）**：
  1. 初稿的"候选模型维度不是 1024 ⇒ `unverifiable`"**构造上不可达**——探针唯一会真调的 `dashscope` 是 `pins_dimension=True`（`providers/__init__.py:55`）⇒ `build_embedder` 那侧**不包维度守卫**；另一个 provider 是稠密单路、被名单短路。测试改测可达的 **401**（且断言 `detail` 带状态码）。
  2. 连带一条"探针会顺带写 `_PROBED_DIMENSIONS`"也是错的（同上原因）⇒ 更正为**无副作用**。
- **门禁**：`test_rag_config_probe.py` 8 passed（与 `test_rag_config_api.py` 同跑 37 passed）；`ruff check` / `ruff format --check` 干净；两份文档 prettier 各 0 脏行；**全量后端 144 failed / 12347 passed（+8 即本轮用例），与守卫那轮（Task 3）逐条比对双向差集为空**。

**RED**

- `backend/tests/test_rag_config_probe.py` 加：
  1. 桩一个**返回稀疏**的响应 ⇒ `200 {status: "supported"}`；
  2. 桩一个**只返 dense**（无 `sparse_embedding`）的响应 ⇒ `{status: "unsupported"}`，`detail` 含两个出路；
  3. 桩**网络失败 / 超时** ⇒ `{status: "unverifiable"}`（**不是** `unsupported`）；
  4. **非稀疏原因的失败也归 `unverifiable`**：桩一个 **401**（鉴权被拒，立即抛、不重试）⇒ `unverifiable` 且 `detail` 含 `401`——**不是** `unsupported`；
     - **实现时更正**：初稿这里写的是"维度不是 1024"，**构造上不可达**——探针唯一会真调的 `dashscope` 把维度钉在请求里（`pins_dimension=True`）⇒ 没有维度守卫；另一个 provider 是稠密单路、被名单短路（见下条）。已改测可达的 401；
  5. **名单已知的答案不打电话**：`embedding_provider="openai-compatible"` ⇒ 直接 `unsupported`，且 `recorded == []`；
  6. **不落盘**：调用前后 `rag_config.json` 逐字节相同；
  7. **不回显密钥**：提交一个明显的假 key，断言**成功响应**的 body 里不含它（不要只断言"没出现"——404 的 body 也不含，那种断言是空的）；
  8. 非 admin ⇒ 403。

**GREEN**

- `app/gateway/routers/rag_config.py` 加 `POST /rag/config/probe-embedding`：请求体带候选 `{embedding_provider, embedding_model, embedding_base_url?, embedding_api_key?}`；`api_key` 为掩码哨兵时取已存/环境的那把（复用 `preserve_secret` + `_secret_env_name` 的既有逻辑）。
- 实现走**同一段** `build_embedder(rag=<候选>)`，只发一次嵌入（1 条短文本），检查返回的 `EmbeddingResult.sparse.indices` 是否非空；据此给三态。
  - **`unsupported` 只在"调用成功且稀疏为空"时给**；**任何非稀疏原因的失败**（超时/连接/鉴权/限流/**维度不符**/缺地址）一律 `unverifiable`，`detail` 带上真实原因。探针**不替代保存期校验**（维度与地址仍归 PUT 那层）。
  - 探针会顺带写一次 `_PROBED_DIMENSIONS`（合法的维度认证）——不特殊处理，但要在代码注释里写明，免得以后有人以为它是脏数据。
- 超时沿用 validate 的 10s；`detail` 只带状态码 + 截断的响应片段。

**门禁**：`cd backend && make test`（窄面先跑该文件，再全量）。

---

## Task 2 — 后端：运行期兜底（D5）

**状态：已交付 2026-09-16。**

**交付纪要**

- **实现**（`embedder_factory.py`）：`_SparseHalfCheckedEmbedder`，**只在 `source=provider` 时**包在稠密实现外面；每次 `embed()` 拿到结果后判 `results[0].sparse.indices`，空则抛 `SparseHalfMissingError`。类 docstring 写明为什么不照抄 `_DimensionCheckedEmbedder` 的"先缓存后抛"（那个先例之所以安全是因为维度不符会被 Qdrant 拒收，而空稀疏是合法值、写进去就是永久静默）；模块 docstring 由"三件事"改为"四件事"。
- **新类型**（`embedder.py`）：`SparseHalfMissingError(RagConfigurationError)`——子类，**继承**网关那条 400 映射（无需第二次注册），并让**探针按它给出 `unsupported`**（`rag_config.py` 的 `except SparseHalfMissingError` 排在通用 `except` 之前）。这是**实现期才暴露的跨任务耦合**：探针原先靠自己再读一遍 `results[0].sparse.indices`，守卫先抛之后那条读法永远收不到结果。
- **用例 3 条**（`tests/knowledge/test_embedder_providers.py`）：空稀疏被拒（且断言那一次真实调用确实发生过，即"判定在调用之后、不是构造期"）、**连续两次都抛**、`source=bm25` + 稠密侧空稀疏**不抛**（控制组）。另有两处既有断言改动：默认路径那条由 `isinstance(embedder, DashScopeEmbedder)` 改成钉住**多出来的一层包装**（`_SparseHalfCheckedEmbedder`，`_inner` 才是 DashScope，且它自证维度）；探针那条补一句"答复来自守卫本身"的断言；`test_rag_configuration_error.py` 补一条子类继承 400 映射的用例。
- **RED 时 3 红 1 绿**：绿的那条是 bm25 控制组（本来就该绿）。**并且额外逮住一条没预料到的红**：`test_rag_config_probe.py::test_reports_a_model_that_returns_dense_only`——探针把"模型说不支持"错报成 `unverifiable`，正是上面那个耦合。
- **三次 neuter 全有牙**：① 加一个 fail-open「已判过」缓存 ⇒ **只有**重复那条红；② 把包装无条件套到稠密侧 ⇒ **7 红**（含 bm25 控制组与几条结构断言）；③ 守卫退回抛基类 ⇒ 探针那条红。
- **门禁**：窄面（`tests/knowledge/` + `test_rag_config_api/probe/configuration_error`）**1194 项 1 failed**（就是上面那条耦合，修好后 58 项全绿）；`ruff check` 干净，`ruff format --check` 干净——**一处既有例外**：`tests/knowledge/tools/test_graph_search.py` 在 HEAD 上就没被当前 ruff 版本格式化过（既非 CRLF 产物、内容也确实需要重排），与本次无关，未动。
- **全量后端 135 failed / 12360 passed / 109 skipped（1051s ≈ 17.5 分钟）**。与 Task 1 那轮基线（144 / 12347）**双向差集非空**：12 条由红转绿、3 条由绿转红，**15 条全在我没碰过的文件里**（`test_checkpointer` 打包、`test_dev_entrypoint` 元字符、`test_pnpm_script`、`test_thread_id_route_contract`、`test_invoke_acp_agent_tool`）。那 3 条新红的两类机制**都不是本次代码路径**：
  1. `test_pnpm_script` 两条：子进程 stderr 里带 GBK 字节（cmd.exe 的 AutoRun 把 `DOSKEY` 报错写进 stderr）⇒ `text=True` 的读线程抛 `UnicodeDecodeError` ⇒ `result.stderr` 成了 `None`（失败形态就是 `TypeError: argument of type 'NoneType' is not iterable`，pytest 的 `PytestUnhandledThreadExceptionWarning` 里有完整栈）。
  2. `test_invoke_acp_agent_tool` 一条：ACP 握手阶段抛了一个**消息为空**的 `TimeoutError`（`conn.initialize` 没有超时包装，`str(TimeoutError())` 就是空串），配置的 2s 超时分支根本没走到——`elapsed < 10` 那条断言是过的。
- 这三个文件在 HEAD 上都是未修改状态，且不被本次改动 import；`test_pnpm_script.py` 只 import `pathlib/json/os/subprocess/sys`。**RAG/嵌入相关用例零新增红**（失败集里 5 条带 knowledge 字样的全部在基线上就红：`local_skill_storage` 的三条 symlink 用例 + `migration_0016` 两条）。
- **提交**：本笔 `feat(rag): refuse a provider that promises sparse and returns none`（含 spec/plan 同步）。

**RED**

- `backend/tests/knowledge/test_embedder_providers.py` 加：
  1. `source=provider` + 桩"只返 dense" ⇒ `RagConfigurationError`，且消息含两条出路；
  2. **连续两次嵌入都抛**——**不**做 fail-open 缓存（不要照抄维度守卫的"先缓存后抛"：空稀疏是合法值，放过一次就真写进库，此后永久静默）；
  3. `source=bm25` / `external` + 空稀疏 ⇒ **不抛**（那一半本来被 `ComposedEmbedder` 丢弃）。
- **这一版还会改到一条既有断言**（契约可见的变化，要在提交信息里说明）：`test_build_embedder_defaults_to_dashscope_and_keeps_its_sparse` 现在钉的默认路径外面**多了一层守卫包装**（`_SparseHalfCheckedEmbedder`，里面才是 `DashScopeEmbedder`）——"不套组合层（甲）"这句仍然成立，只是外层不再裸装。

**GREEN**

- `embedder_factory.py` 加一个包装（结构上与 `_DimensionCheckedEmbedder` 相似，但**语义相反**）：`source=provider` 时每次真实嵌入都检查 `results[0].sparse.indices` 是否为空 ⇒ 空则抛 `SparseHalfMissingError`（`RagConfigurationError` 子类）。
- **不要**加进程级"已判过"缓存；代码注释里写明为什么这里不能沿用维度那条先例（维度不符会被 Qdrant 拒收，空稀疏不会）。
- 注意**只在 `source=provider` 时包装**（其它来源不走这条）。
- **实现时发现并补上的一处跨任务耦合**：拒绝类型用 `RagConfigurationError` 的**子类** `SparseHalfMissingError`，并让**探针按它给出 `unsupported`**（`except SparseHalfMissingError` 排在通用 `except` 之前）。原因是探针原先靠自己再读一遍 `results[0].sparse.indices`——加上这道守卫之后，空稀疏**在返回前就抛了**，那条读法永远收不到结果，探针会把"模型说不支持"错报成 `unverifiable`（已由 `test_rag_config_probe.py::test_reports_a_model_that_returns_dense_only` 当场变红逮住）。用子类而不是 `RagConfigurationError` 本身：探针必须把"模型答复了"与"没能查成"分开，两者都以异常形式出现。（提交时这一改动落在 Task 2 那笔，因为它是这道守卫引入的。）

**门禁**：全量（动了共享层）。

---

## Task 3 — 前端：三态合成 + 置灰 + 自动探测（D2 / D4）

**状态：已交付 2026-09-16。**

**交付纪要**

- **纯函数**（`core/rag/config-form.ts`）：`sparseProbeKey` / `resolveSparseCapability` / `isSparseProviderOptionDisabled`，加两个类型（`SparseCapability`、`SparseProbeVerdict`——后者**带 key**，没有它就会出现"把旧结论套到新值上"）。合成规则：名单 `emits_sparse=false` ⇒ `unsupported`（零次出网）；否则只在**探针的键 == 当前表单值**时才采纳结论；`unverifiable` 与非 `supported/unsupported` 一律折成 `unknown`。
- **`isSparseSourceUnsupported` 由两段并成一段**（同一文件）：加一个可选第三参 `probe`，内部改为委托 `resolveSparseCapability(...) === "unsupported"`。这样"稀疏来源必须是 provider"这条规则仍只有一处，视图不再自己拼条件；既有三条用例原样通过。
- **wire + hook**：`api.ts` 加 `probeEmbeddingCapability`（POST 新端点，失败仍抛 `RagConfigRequestError`）；`hooks.ts` 加 `useProbeSparseCapability`——mutation 的**入参**是"候选配置 + key"，**出参**是 `{key, status}`，`key` 在发请求前被解构掉（后端 `extra="forbid"`，多一个字段就是 422）；**不** invalidate 配置查询（没落盘），**不** toast（"没查成"是那一行要渲染的状态，不是给人关的弹窗）。
- **界面**（`functional-models-view.tsx`）：三态各有落点——`unsupported` ⇒ 复用上一版的卡底告警 + Save 旁同一句 + Save 禁用，并把「跟随向量模型」这一项 `disabled` 且**在标签里带一句原因**；探测中 ⇒ 该行「检测中…」；`unverifiable` ⇒ 该行「未验证」，**可保存**；`supported` ⇒ 无额外话。`OptionSelect` 因此多了一个可选 `disabledReasons`（值 → 原因），只有传了原因的项才灰。
- **i18n 四处不是三处**（实现期的小偏差，见下）：`sparseProbing` / `sparseUnverified` / `sparseProbeHint`（"会产生一次真实调用"，与既有 `sparseSourceHint` 合成同一个 ⓘ）+ **`sparseProviderDenseOnly`**（置灰项里那句短原因）。三份文件（zh / en / `locales/types.ts` 的形状声明）都补了。
- **两处实现期决定（plan 没写）**：
  1. **探测加了 400ms 防抖**。plan 的触发条件（dashscope + model 非空 + key 可用）在"刚敲下 model 的第一个字符"就成立 ⇒ 不防抖就是**一个字符一次真实（计费）调用**，六个字符六次。D7 那句"探测由用户动作触发、频率极低"本身就是防抖的依据。
  2. **别名新键而非复用长句**：置灰项里的原因若复用 `sparseProviderUnsupported`（60+ 字），下拉项会变成一堵墙；故加了一句短的 `sparseProviderDenseOnly`。真正拦人的那句长文案（卡底告警 + Save 旁）完全复用，没有新造第二套表现。
- **用例**：纯函数 9 条（三态语义 / 键绑定 / 键的构成 / 置灰判据）+ dom 9 条（`unsupported` 拦人、**换了 model 就丢掉旧结论**、不静默改写已选值、`unverifiable` 放行并标「未验证」、`supported` 无话、探测中、没 model 不发、来源不是 provider 不发、**key 来自环境仍要发**）。另修了第二个 dom 文件（`tests/unit/components/.../functional-models-view.dom.test.tsx`）的 hooks mock——它 mock 了整个 `@/core/rag/hooks`，不补 `useProbeSparseCapability` 会整文件红（这正是全量的价值：我先只跑了自己那两个文件）。
- **四处 neuter 全有牙**：① 去掉"键必须相等"⇒ `does not reuse a verdict` 与 dom 那条"换 model 丢结论"同时红；② 置灰判据改成 `!== "supported"` ⇒ 纯函数那条红（`unknown` 不再放行）；③ 触发条件里把 `sources[...] !== "unset"` 换成"输入框非空"⇒ **env 那条红**（plan 点名最容易漏的形态）；④ 去掉 `source === "provider"` 条件 ⇒ "来源不是 provider 不发"那条红。
- **门禁**：`eslint` 干净；`tsc` 只剩**一条既有红**（`tests/unit/components/workspace/pet/pet-sprite.dom.test.tsx:222` 把 `"greet"` 传给了一个还没纳入该联合的类型——**该文件与 `src/core/pet/` 都未被本次改动，属另一条在飞线的预存红**，判据：`git status` 对这两个路径为空）；prettier 逐文件比对**十一个文件全部与 HEAD 同数**（`tr -d '\r'` 后走 stdin 的口径，见 `project-env-test-failures`）⇒ 零新增格式债；**全量前端 `rstest run` = 238 文件 / 2516 用例 / 0 失败（2m40s）**。
  - ⚠️ 第一遍全量是**带毒的**：我在它跑到一半时补了第二个 dom 文件的 hooks mock，于是那一遍恰好 6 红、全在 `functional-models-view.dom.test.tsx`（= 我补的那 6 条）；补完重跑才是上面的全绿。**这也说明"只跑自己改的两个文件"不够**——那个文件 mock 了整个 `@/core/rag/hooks`，视图新增的 hook 一被调用就整文件红。

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

**状态：已交付 2026-09-16。**

**交付纪要**

- **改动面只有两处，行为零改动**（可逐行核对）：`functional-models-view.tsx` 给「稀疏模型」那一行的 `RowLabel` 加了 `info={F.sparseModelHint}`（复用 `RowLabel` 既有的 ⓘ）；i18n 三处（zh / en / `locales/types.ts` 的形状声明）各加一句。`buildRagConfigInput`、后端 `sparse.py` 的下发逻辑、字段本身**都没动**——值照存、请求照旧不带 `model`。
- **文案两句的落点**：中文「这一项会被保存到配置里，但从不发给服务：TEI 一个实例只服务一个模型，所以请求里不带 model 字段。」；英文同义。
- **用例 2 条**，落在两个 dom 文件里各一条（各取所长）：
  1. `functional-models-view.dom.test.tsx`（该行所在的「显示规则」文件，i18n 是 key→key 的代理）钉**接线**：`sparseModelHint` 这条可访问名在该面板里**恰好出现一次**——既是"这一行有交代"，也守住「不把『稀疏』沿格子重复一遍」那条既有规矩（同文件另有一条用例逐行断言 5 个行标签，两者互不冲突：ⓘ 是按钮，不进 `textContent`）。
  2. `functional-models.dom.test.tsx`（用真 zhCN）钉**内容**：句子必须点名理由是 `TEI` 且说明「一个实例只服务一个模型」——只断言"有个 ⓘ"会放过一句毫无信息量的提示。
- **两次 neuter 全有牙**：① 撤掉那一行的 `info` ⇒ 两条用例同时红；② 把中文那句换成「稀疏模型。」⇒ **只在真 locale 那条**红（证明内容守卫不是摆设，而接线那条本来就不该管措辞）。
- **门禁**：`eslint` 干净；`tsc` 仍只剩宠物线那条**既有红**（未改动的第三文件）；prettier 逐文件比对**六个文件全部与 HEAD 同数**；**全量前端 238 文件 / 2518 用例 / 0 失败（2m27s）**（= Task 3 的 2516 + 本轮 2 条）。
- **提交切分的一处偏差**：plan 的表把 Task 4 与 Task 5 并成一笔；实际按"每个 Task 独立门禁、独立提交"落成两笔——Task 5 要动 `AGENTS.md` 并跑真栈，混在一起会让那两项的结论无法单独回看。

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
