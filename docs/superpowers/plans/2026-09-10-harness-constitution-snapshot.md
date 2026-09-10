# harness 构成观测台:构成快照 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"这个 run 实际装配出来的 harness 长什么样"成为可查询的事实。工厂在组装现场把已算出的局部变量(middleware 链、挂载工具、authorization 删除项、deferred setup、runtime flags)发布成一份**只读构成快照**,worker 取回后推给 `RunJournal`,挂在既有 `run.start` 事件上。零新端点、零新 event_type、零新 category、零 schema 变更、零新依赖、零执行语义改动。

**Architecture:** 本计划是构成观测台(流程可视化)线的数据地基,见 `../specs/2026-09-10-harness-constitution-snapshot-design.md`。载体是进程内 `WeakKeyDictionary` 注册表(spec §4):`make_lead_agent` 的返回类型受 LangGraph Server 签名契约约束不可改(`agent.py:644`),ContextVar 生命周期不够(`worker.py:819-820` 的 `with` 块当场退出),而注册表同时兼容 worker 的"每 run 组装一次"与 `DeerFlowClient` 的"每 cache key 一次",且不依赖 journal(TUI 无 journal 也能直读)。承载位选 `run.start` 是因为其 `content_schema` 只 `required: ["chain"]` 且 `additionalProperties: true`(契约 :78-83),加字段不是破坏性变更;且 `category: "trace"` 定义为"excluded from message projections"(契约 :64),天然不进 IM 通道的发布 allowlist。契约细节全在 spec,本计划只排步骤。

**Tech Stack:** 后端 Python 3.12 + LangChain `create_agent` + LangGraph;`WeakKeyDictionary`(标准库);既有 `RunJournal` / `RunEventStore` / `contracts/run_event_stream_contract.json` 契约体系。**前端本期零改动。**

**测试运行命令(全程统一):**
```bash
# 后端(离线全量 + 本计划新增)
cd backend && make test
cd backend && make lint
cd backend && make format        # 推送前必跑,CI 强制 ruff format --check
cd backend && PYTHONPATH=. uv run pytest tests/test_constitution_record.py tests/test_constitution_registry.py -v --basetemp .pytest-tmp
cd backend && PYTHONPATH=. uv run pytest tests/test_lead_agent_constitution.py tests/test_run_journal_constitution.py tests/test_run_worker_constitution.py -v --basetemp .pytest-tmp
cd backend && PYTHONPATH=. uv run pytest tests/test_run_event_stream_contract.py -v --basetemp .pytest-tmp
```

**关键事实(已核实,细节与行号见 spec §2):**
- `_make_lead_agent`(`agent.py:688`)有**两个** `create_agent` 返回点:bootstrap :835-862、常规 :916-946。两处的 middleware 表达式 `normalize_middleware_state_schemas(build_middlewares(...), mode)` 都**内联在关键字参数里、未绑定局部变量**(:838-850、:919-932)→ 这是本计划**唯一需要改动既有组装代码**的原因(Task 2)。
- 快照所需的全部事实**已在组装现场的局部作用域内**(spec §2.2 的行号对照表)→ **不需要任何新的解析逻辑**,因此丙1 那项"`get_available_tools()` 冷启动是否触发 MCP discovery"的前置核实**对本计划不适用**:我们搭在已经发生的组装上,零额外解析成本。
- `make_lead_agent` 的 docstring 明写 "keep the signature compatible with LangGraph Server"(`agent.py:644`)→ **返回类型不可改**。
- worker **每个 run 重新调工厂**(`worker.py:820`),harness 内**无 agent 缓存**(grep `_agent_cache|agent_cache|lru_cache.*make_lead|cached_graph` 零命中);缓存只在 `DeerFlowClient` 嵌入式路径。
- `RunJournal` 在 `worker.py:656-662` 创建,**早于**工厂调用(:820)与 `astream`(:922/:933)→ 接线窗口存在。
- `run.start` 唯一发射点是 `journal.py:325-333` 的 `on_chain_start(parent_run_id=None)`,回调只看得见 `serialized`/`metadata`/`tags`,**看不见组装结果** → 快照必须被**推进来**。`set_first_human_message`(:815-817)是"worker 显式推事实给 journal"的现成先例。
- `_put()`(`journal.py:646-656`)是**纯内存 buffer append**;`run_inline = True`(:218-222)+ `tests/blocking_io/test_run_journal_callbacks.py` 把"回调只做内存活"钉成 **CI 硬门禁** → `set_constitution` 必须是纯赋值。
- `deerflow_loop_bound = True`(`journal.py:212-216`):**subagent 不继承 journal**(`guardrails/middleware.py:102-103`、`safety_finish_reason_middleware.py:289` 均确认)→ 本计划的快照只覆盖 lead;subagent 侧的 `loop_capped`/`token_capped` 走**已存在**的 `stop_reason` → `subagent.end` 通道,**零后端改动**(spec §5)。
- 读取路径已存在:`GET /api/threads/{id}/runs/{rid}/events?event_types=run.start`(`thread_runs.py:1403-1426`,`event_types` 参数 :1407,逗号分割 :1418)。既有先例:`context:memory`。
- **契约同步 5 处**(`backend/AGENTS.md` 明文):producer 代码、`deerflow/constants.py`、`runtime/events/catalog.py`、`contracts/run_event_stream_contract.json`、`backend/docs/RUN_EVENT_STREAM.md`,加 `tests/test_run_event_stream_contract.py`。
- **术语已定死**(丙1 spec §3 + 本 spec §3):本线用 **构成**(Constitution);**禁用 装配/Assemble**(丙1 占用)、**能力清单**(丙1 的派生视图)、**Canvas / Studio / 单用 Flow**。因此代码命名统一 `constitution`,**不用 `assembly`**。
- **`middleware:{tag}` 接入率实测 4/35**(2026-09-10):四个调用点是 `guardrails/middleware.py:115`、`safety_finish_reason_middleware.py:320`、`skill_activation_middleware.py:300` 与 `:539`。**这修正了 `docs/HARNESS_EXECUTION_FLOW_MAP.md` §10 的过期记载**(该文档记 2/34 且只有 summarization 与 title,而这两者根本没有调用点)。⑧ 的埋点规划以实测为准;该文档是用户自己的参考料,**不要改它**,只在本 spec §2.7 记录修正。
- **wrap-only 中间件不成为编译图节点**,`HARNESS_EXECUTION_FLOW_MAP.md` §10 记为约 44%(15/34),**未独立复核** → Task 0 Step 4 实测。这是"构成必须在组装现场取、不能从编译图反解"的根本理由(spec §2.1、§11)。
- **记录内容纪律**:`safety_finish_reason_middleware.py:292-295` 明确不记 tool arguments。本计划沿用:**绝不记录** prompt 正文(含 `SOUL.md`)、tool schema、secret 的**值**、被 guardrail/safety filter 拦下的具体内容(spec §6.5)。

**机器特定(沿用上一轮实施记录):** 本机系统 Temp 对 pytest 权限异常 → 需要临时目录时统一 `--basetemp .pytest-tmp`(`.gitignore` 既有约定);host 侧 pnpm 一律经 `scripts/pnpm.py`;**本计划不新增任何 Python 依赖**——`tenki-sandbox` 已从 PyPI 下架,任何 `pyproject.toml` 改动都会触发注定失败的 universal 重解析。

---

## File Structure

**新建:**
- `backend/packages/harness/deerflow/agents/constitution_record.py`(注册表 + 记录构建纯函数 + stage 归属表)
- `backend/tests/test_constitution_record.py`(纯函数 + stage guard test)
- `backend/tests/test_constitution_registry.py`(发布/查询/弱引用降级)
- `backend/tests/test_lead_agent_constitution.py`(两个站点都发布 + hoist 等价性 + 返回类型未变)
- `backend/tests/test_run_journal_constitution.py`(setter 纯赋值 + `run.start` 承载 + 未 set 时逐字节不变)
- `backend/tests/test_run_worker_constitution.py`(接线 + 三条降级路径)

**修改:**
- `backend/packages/harness/deerflow/agents/lead_agent/agent.py`(两个 `create_agent` 站点:hoist middleware 局部变量 + `publish_constitution`)
- `backend/packages/harness/deerflow/runtime/journal.py`(`set_constitution` setter + `on_chain_start` 承载 + first-time-only 守卫)
- `backend/packages/harness/deerflow/runtime/runs/worker.py`(:820 之后接线)
- `backend/packages/harness/deerflow/runtime/events/catalog.py`(`run.start` 定义处的注释/形状说明)
- `contracts/run_event_stream_contract.json`(`run.start.content_schema.properties.constitution`)
- `backend/docs/RUN_EVENT_STREAM.md`(`run.start` 载荷说明)
- `backend/AGENTS.md`(Middleware Chain / Run event stream 段落补一句构成快照)
- `backend/tests/test_run_event_stream_contract.py`(加 `constitution` 形状断言)

**不新建、不修改**:任何前端文件;任何 `pyproject.toml`;任何 alembic 迁移;`deerflow/constants.py`(无新 event_type,上限常量不变——Task 3 Step 4 需确认这一点)。

---

## Task 0: 前置核实(**✅ 四项全部完成(2026-09-10),Task 1+ 解除阻塞**)

- [x] **Step 1(载体可行性,spec §8 风险 1 — 最高优先)——已完成(2026-09-10):判定②不成立,走条件①,按 spec §4 的注册表实施;§8 风险 1 关闭。** 结论已写回 **spec §4.1**。
  - 环境 `langgraph 1.2.9` / `langchain 1.3.14` / `langchain-core 1.4.9`;一次性脚本放 gitignored 的 `.deer-flow/probe_weakref.py`,测完已删。
  - **`create_agent(...)` 返回 `CompiledStateGraph`(与裸 `StateGraph.compile()` 同一个类):可弱引用 ✅、可哈希 ✅,且是身份哈希**(`type(g).__hash__ is object.__hash__`、无自定义 `__eq__`);注册表往返 ✅、两个图是两个不同键 ✅、**丢强引用 + `gc.collect()` 后条目消失(2→1→0)** ✅。→ worker"每 run 新建图"不泄漏,**不走** §11 的"图上挂属性"次选分支。
  - **两个降级分支独立且都可达**:`__slots__` 无 `__weakref__` → `TypeError`;**`__hash__ = None` → `TypeError`,但该对象仍可弱引用** → §4 的两个 `except TypeError` 是两种独立失败模式,不是冗余。
  - **带 middleware 的变体同样通过**(类型/弱引用/哈希全不变)——生产两站点恒定传 middleware,必须验这条。
  - MRO 原因:`CompiledStateGraph → Pregel → PregelProtocol → Runnable → ABC/Generic → object`,无 `__slots__`、实例带 `__dict__`。
  - **新增产出(我的判断,可推翻)**:身份哈希与弱引用是**上游实现细节**,而 §4 的两个函数刻意吞 `TypeError` → 未来 `langgraph` 给 `Pregel` 加 `__eq__`/`__slots__` 会让载体**静默降级**成"无快照"。故 spec §10 加了一条**载体看门测试**,对真实 `create_agent` 返回值钉住这三条属性,把上游升级变成显式失败。
- [x] **Step 2(`run.start` 发射次数,spec §8 风险 2)——已完成(2026-09-10):判定①,**多次** → spec §6.3 的 first-time-only 守卫是**必需**,Task 3 必须实现它并写强断言;§8 风险 2 关闭。** 结论已写回 **spec §6.3 + §8 风险 2**。
  - **静态链路**:`_stream_once` 用户轮调 1 次(`worker.py:979`)+ **continuation 循环每轮再调 1 次**(:996);每次恰好调 1 次 `agent.astream`(:922/:933);journal 只在基础 config 的 `callbacks` 里挂一次(:783-784),而 `_continuation_runnable_config()` 是 `dict(config)`(:805-812)→ **同一个 callbacks 列表**,每次 astream 都带着同一 journal。
  - **实测**(gitignored 的 `.deer-flow/probe_runstart.py`,已删;真实 `create_agent` 图 + 真实 `RunJournal` + `MemoryRunEventStore`,两次连续 `astream` = 用户轮 + 一次 continuation):根级 start 1 → **2**;**journal 实收 `run.start` = 2 条(seq 1 与 7)**;嵌套 chain start 6−2=4(被 journal 过滤)。
  - **附带边界**:① 图跑 model→tools→model 多超步(带 checkpointer),单次 astream 仍只 **1** 次根级 start → "一次 astream = 一条 `run.start`",与超步数无关;② `subgraphs=True` 单模式下仍是 **1** 次 → **子图流式不产生额外根级 start**;③ 多模式 `["values","messages"]` 变体**未能验证**——`GenericFakeChatModel` 在多模式流式下产不出 generation(探针假模型限制,非产品结论)。
  - **注意与既有测试的分工**:`tests/test_run_worker_delivery.py::test_delivery_event_is_singleton_across_goal_continuations` 用的 `ContinuingAgent` 是**假 agent**,不产生真实回调,所以它证明不了 `run.start` 的发射数——Step 2 必须用真图实测(本步已做)。
- [x] **Step 3(快照真实体积 + `build_middlewares` 返回类型,spec §8 风险 3/4)——已完成(2026-09-10):16KB **不紧**(真实载荷约 35%),返回类型是 **list**,两条风险均关闭。** 探针 gitignored 的 `.deer-flow/probe_size.py`(已删),结论写回 **spec §6.5.1 + §8 风险 3/4**。
  - **① 返回类型 = `list`** —— `isinstance(mws, list)` 为真 + docstring "Returns: List of middleware instances"。§6.2 的 hoist 写法与 Task 1 入参类型**无需调整**。
  - **② 载荷字节(本机真实 `config.yaml` + `extensions_config.json`,下界口径)**:合计 **5,656 B**(含 MCP 工具 5,742 B)= 16 KB 的 **35%**;其中 `middlewares[]` 25 条 **3,574 B**、`tools.mounted` 15 个名 ~1,000 B、其余 ~1,100 B。**`hooks[]` 增量约 1 KB(8%),不是主因** —— 之前把承压归给它是我写错了。
  - **③ 真实挂载条数远少于表的 34**:flags off **25**、plan+subagent **27**、`agent_name="rag"` **26**(含 `DeepResearchMiddleware`,证实按 agent 追加)。本机 25 条的分段是 intake 2 / context 9 / model 3+3 / tools 2+3+1 / epilogue 2 → **`stages[]` 的计数必须来自实际挂载的链**(spec §6.5.1 与 §10 已加关系不变量)。
  - **④ 发现文档与真名不一致**:槽 18 的真名是 **`DeerFlowSummarizationMiddleware`**(带前缀),spec 表与勘查文档 §4.1 都写成短名。已在 spec §6.6.3 加"命名要求(硬)"并改正该行 —— 这个名字同时是 `STAGE_OF_MIDDLEWARE` 键、guard test 断言、快照 `name`、前端 i18n 键,**差一字符四处失配**。
  - **⑤ hook 探测器独立复算**:真实链 12 个 wrap-only + 本机未挂载的 Guardrail / DeferredToolFilter / DeepResearch = **15**,与 Step 4 的 grep 口径一致 → 探测器可信。
  - **⑥ 顺带把上一轮留的问题定掉**:`MAX_TOOL_NAMES` **必须同时覆盖 `tools.mounted` 与 `tools.deferred_names`**;真正的承压变量是工具名清单,其中 `deferred_names` 由第三方 MCP server 决定长度,本仓无法约束(封顶 200 个名约 5 KB)。spec §6.5 与 §10 已写。
  - **残余**:本机是精简配置(3 个 MCP server 只启用 1 个、skills 0 条),"不紧"只在工具名 ≤ 数十个的量级成立,**MCP 重的部署未覆盖**。
- [x] **Step 4(wrap-only 比例,spec §8 风险 5)——已完成(2026-09-10,grep 全部 middleware 文件的 hook 定义):** 34 个具名 middleware 中**恰好 15 个只实现 `wrap_*`**,即 **15/34 ≈ 44%,与 `docs/HARNESS_EXECUTION_FLOW_MAP.md` §10 一致**;spec §2.1 的论据成立,已写回。
  **两项副产品(均已写回 spec):**
  - **纠正归属表三处 → stage 与 frequency 必须分成两个轴**(spec §6.6.2):槽 1 InputSanitization 实测 `wrap_model_call`(每圈)→ **从 `intake` 挪到 `context`**,`intake` 只剩两个纯 `before_agent`;槽 14 DynamicContext 实测 `before_agent` only(**每 run 一次**,原以为每圈);槽 21 Title 实测 `after_model`(**每圈检查**,原以为 `after_agent`)→ 保留在 `epilogue` 但必须独立记频率。快照因此新增 `frequency` 字段,当时的实测分布是 4/15/6/9(含 `mixed` 9)。
    **⚠ 2026-09-10 后续修订:`mixed` 已取消**(用户裁决)。payload 改为发**原始事实 `hooks[]`**(实测覆写的 hook 名,固定枚举顺序)+ 从它**派生的三值 `frequency`**(`once_per_run`/`per_model_call`/`per_tool_call`),派生规则见 spec §6.5。**旧分布 4/15/6/9 作废**,按现有 hook 表推算为 **4/23/7**(`Sandbox` 落 `per_tool_call`,其余 8 条旧 `mixed` 落 `per_model_call`),以 Task 1 实测为准。~~这条修订也意味着 `hooks[]` 会撑大 16KB 预算~~ —— **Step 3 实测纠正:`hooks[]` 只增约 1 KB(8%),不是承压主因;真正的变量是工具名清单,尤其 `deferred_names`**(spec §6.5.1)。
  - **`backend/AGENTS.md` 的 35 槽编号不完整**(spec §8 风险 6):`DeepResearchMiddleware`(只有 `wrap_model_call`)由 `_extra_agent_middlewares(agent_name)`(`agent.py:674-685`)追加,**仅 `rag` agent 会装**,位次表里没有它。**后果:Task 1 的 guard test 必须装配 `rag` 链,不能只装默认链**,否则"按 agent 追加"这类漏洞测不出来。具名 middleware 因此是 **34 个**(33 + DeepResearch),各段计数变为 `intake` 2 / `context` **12** / `model` 3 member+5 gate / `tools` 4 member+5 gate+1 handoff / `epilogue` 2。

## Task 1: 注册表 + 记录构建 + stage 表(TDD,**可独立验证,不碰组装路径**)

**Files:** Create `backend/packages/harness/deerflow/agents/constitution_record.py`;Create `backend/tests/test_constitution_record.py`、`backend/tests/test_constitution_registry.py`

- [x] **Step 1(先写红测试 — 记录构建):** 覆盖 ① 字段完整性(对照 spec §6.5 的 jsonc 样例逐项);② `authorization_candidates` 与 `authorized_tools` 的差集进 `tool_authorization.removed`;③ **spec §6.6.3 归属表逐项钉死**——**34 个具名 middleware**(33 + `DeepResearchMiddleware`)全覆盖,`intake`=2 / `context`=**12** / `model`=3 member+5 gate / `tools`=4 member+5 gate+1 handoff / `epilogue`=2,且 `overlay_kind="handoff"` 全链**有且仅有** Clarification 一项并带 `exits_run: true`;④ **`hooks[]` 轴钉死**(spec §6.5/§6.6.2,`mixed` 已取消)——**34 具名逐个断言其 `hooks[]` 集合**(等值,含顺序;集合是原始事实,分布是它的函数),并断言**派生规则三个分支各一例**:`Title`(`["after_model"]`→`per_model_call`)、`Clarification`(`["wrap_tool_call"]`→`per_tool_call`)、`ThreadData`(`["before_agent"]`→`once_per_run`),外加**单独断言 `Sandbox` 走"无 model 相位"那一支**(`["before_agent","after_agent","wrap_tool_call"]`→`per_tool_call`;它是旧 `mixed` 9 条里唯一的例外,不写这条就分不出"规则错"与"少写一个 hook");**断言 `mixed` 不出现**;聚合分布只作记录(旧 4/15/6/9 作废,预计 4/23/7,实测后写回,不作等值断言)。另单点断言三个反直觉项:`DynamicContext` 的 hooks 是 `["before_agent"]` 且 frequency `once_per_run`(不是每圈)、`Title=per_model_call`(不是 `after_agent`)、`InputSanitization` 的 stage 为 `context`(不是 `intake`);⑤ **策展投影不变量**——断言 `stages[]` 序列化文本里**不含任何 middleware 类名**,只允许 `key`、`loop` 与计数(这是"用户档不是开发者档的过滤版"的唯一保障,没有它某次重构把真名塞进 `stages[]` 不会有任何测试变红);⑥ extension middleware 按 placement 枚举映射(`MODEL_*→model`、`TOOL_*→tools`、`STANDARD→extension`),未映射落 `stage: "extension"`;⑦ `MAX_TOOL_NAMES` 截断置 `tools.truncated: true`;⑧ **16KB 超限的固定降级顺序**——先丢 `tools.mounted` 明细只留 `mounted_count`,再丢 `middlewares` 明细只留 `stages` 汇总,`tool_authorization.removed` **最后**才丢,且置 `truncated: true`;**`stages[]` 任何降级都不得削减**(它是用户档唯一输入);⑨ **禁内容断言**——序列化结果不含 prompt 正文、tool schema、secret 值(用带这些字段的桩输入,断言输出里搜不到);⑩ **`loop` 标记钉死**(spec §6.6.1 环形裁决的执行机制)——`intake` / `epilogue` 为 `false`,`context` / `model` / `tools` 为 `true`,且 `extension` 兜底段的 `loop` 取值必须被**显式断言为一个固定值**(不是"碰巧算出来"),因为它是前端无法从 key 顺序推导的那一段(spec §8 风险 11)。
- [x] **Step 2(先写红测试 — 注册表):** 覆盖 ① 发布→查询往返;② 注入一个 `__weakref__` 被禁的类型(如带 `__slots__` 且无 `__weakref__` 的类),断言 `publish_constitution` **不抛**且 `constitution_for` 返回 `None`;③ 不可哈希对象同样降级;④ 弱引用回收后条目消失(`gc.collect()` 后断言);⑤ `constitution_for` 对未发布的图返回 `None`。
- [x] **Step 3(先写红测试 — stage guard,防腐的唯一保障):** 装配**真实**链并断言每个 middleware 类名都在 `STAGE_OF_MIDDLEWARE` 里有归属,漏一个就红。**必须装配四条链**:① 默认 lead 链;② optional 全开的 lead 链;③ **`agent_name="rag"` 的链**——`DeepResearchMiddleware` 由 `_extra_agent_middlewares`(`agent.py:674-685`)按 agent 名追加,**只装默认链就测不到它**(spec §8 风险 6);④ subagent 链(`build_subagent_runtime_middlewares`)。脚手架已存在可参照:`tests/test_extension_ordering.py`、`tests/test_extension_placement_guarantees.py`、`tests/test_extension_stack_wiring.py`。**这个测试是构成图不会在一个月后开始说谎的唯一保障,不可省略;缺了 ③ 它对"按 agent 追加"这一整类漏洞是瞎的。**
- [x] **Step 4:** 实现 `constitution_record.py`:`_RECORDS: WeakKeyDictionary`、`publish_constitution`(吞 `TypeError`)、`constitution_for`(吞 `TypeError`)、`build_constitution_record(**facts)` 纯函数、`STAGE_OF_MIDDLEWARE` 归属表、`MAX_CONSTITUTION_BYTES = 16 * 1024`、`MAX_TOOL_NAMES = 200`。
  - **stage 轴**:按 **spec §6.6 的五段 + 覆盖层**实现(**不是**已否决的七段,**也不是**已否决的线性五格——布局于 2026-09-10 二次裁决为**环形**,spec §6.6.1)——环上阶段 `intake`/`context`/`model`/`tools`/`epilogue`,闸门作 `kind="overlay"` + `overlay_kind="guard"|"handoff"` 挂在 `model` 或 `tools` 上、**不占位次**;分类规则是 spec §6.6.2 的"按它改变了什么归类,不按它实现了哪个 hook 归类",因此 stage **写死在表里**。
  - **`loop` 标记(环形带出的新产出)**:`build_constitution_record` 还要给每个 `stages[]` 条目算一个 `loop` 布尔——`context`/`model`/`tools` 为 `true`(构成循环体),`intake`/`epilogue` 为 `false`(入口弧与出口弧),`extension` 兜底段取一个**显式写定的固定值**。**不让前端从 key 顺序推导**:spec §8 风险 11 记了理由(`extension` 是第六个合法 stage,推导必然在那一步猜错),且 spec §6.6.4 的"stage 由服务端拥有"原则同样适用于这个结构事实。布局最终是环还是线性折中(spec §8 风险 12),`loop` 都要发。
  - **`hooks[]` + `frequency` 轴**:**探测得出,不写第二张表**(spec §6.5)。理由是它与 stage 相反——stage 是语义判断(需要人裁决),hook 集合是代码事实(实现了什么就是什么);写死会与代码漂移,而 spec 的全部价值在于报告"实际装了什么"。**探测产出 `hooks[]`(原始事实,固定枚举顺序),再按 spec §6.5 的三条规则派生 `frequency`**——派生规则是**写死的常量逻辑**(不是第二张逐 middleware 的表,它只依赖 hook 成员资格,不依赖哪个 middleware):含 model 相位 hook(`before_model`/`wrap_model_call`/`after_model`)→`per_model_call`;否则含 `wrap_tool_call`→`per_tool_call`;否则→`once_per_run`。**`mixed` 不再是合法取值**(2026-09-10 取消);`hooks[]` 的顺序也是契约的一部分,因为它决定序列化字节(§6.5)。
  - **探测的坑(必须处理,否则结果全错)**:`AgentMiddleware` 基类很可能把所有 hook 都定义成 no-op,那么 `hasattr(mw, "before_model")` 恒为真。必须比较**是否被覆写**,例如 `type(mw).before_model is not AgentMiddleware.before_model`,并同时检查 sync 与 async 两个拼写(`before_model` / `abefore_model`)。**探测错了的后果不是"结果全是 `mixed`"(这个兜底值已取消),而是每个 `hooks[]` 都膨胀成全集、派生 frequency 全塌成 `per_model_call`** —— 一个看起来"有答案"的错答案,比 `mixed` 更隐蔽,所以对账必须验,不能靠肉眼。**对账用 Task 0 Step 4 已实测的 15/34 wrap-only 数字**:探测结果里"只有 `wrap_*`"(即 `hooks[]` ⊆ {`wrap_model_call`,`wrap_tool_call`})的应当恰好 15 个;对不上就是探测写错了。**这条对账在 `hooks[]` 口径下比在频率口径下更严格**(15 个的 `hooks[]` 具体是 `["wrap_model_call"]` 还是 `["wrap_tool_call"]` 也要一并核)。
  - **模块不得 import LangGraph,不得 import `app.*`**(`tests/test_harness_boundary.py` 会在 CI 抓)。frequency 探测只用到 middleware 实例与 `AgentMiddleware` 基类,不需要图对象,符合该约束。
- [x] **Step 5:** 转绿 + `cd backend && make lint`。

**交付纪要(Task 1,2026-09-10):**

- **新增**:`packages/harness/deerflow/agents/constitution_record.py`(~390 行);`tests/test_constitution_record.py`、`tests/test_constitution_registry.py`。
- **测试**:`49 passed`(两个新文件)+ `test_harness_boundary.py` 一并绿 = **50 passed**。命令:`PYTHONPATH=. .venv/Scripts/python.exe -m pytest tests/test_constitution_record.py tests/test_constitution_registry.py tests/test_harness_boundary.py -q --basetemp .pytest-tmp -p no:cacheprovider`。
  > 本机 `.pytest_cache` 有写权限问题,所以加 `-p no:cacheprovider` 消掉噪音;`--basetemp .pytest-tmp` 是既有约定。
- **revert 证明**:把 `_tools_block` 改成"只截断 `mounted`"(spec 警告的那个错法)→ `test_max_tool_names_caps_deferred_names_too` 当场红(`assert 207 == 200`);改回即绿。**用例有牙**。
- **门禁**:`ruff check` All checks passed;`ruff format --check` 三文件 already formatted(先跑了一次 `ruff format` 落格式)。
- **端到端复测(真实链,Task 2 接线前的预演)**:`build_middlewares`(plan+subagent 全开,27 条)+ `get_available_tools(include_mcp=False)`(15 个)→ `serialized_size` = **6,122 B = 16 KB 的 37.4%**,`stages` 求和 == 27,**不触发任何降级**。已写回 spec §6.5.1(把原来的"下界 5,656 B"标注为下界,实测值以 6.1 KB 为准)。
- **测试自己踩到的两个坑(都已修,且第二个被 guard test 当场抓住)**:
  1. `_FakeTool(name, func=some_func())` 传了**调用结果**而不是函数对象 → `__module__` 判定失效。修:传函数本身。
  2. `build_middlewares(cfg, None, **{"agent_name": "rag"})` 把 `agent_name` 塞进了 `configurable` → 静默装出**默认链**而不是 rag 链,于是 `DeepResearchMiddleware` 既不在链里、又变成"表里有但没有链能挂载"的孤儿。**guard test 一次报出这两个症状**,这就是它存在的意义。已把这条写进 spec §6.2 的实施约束。
- **`app_config` 是必需的入参**(`auto_promote_top_k` 与 `skills.deferred_discovery` 只能从它读),已补进 spec §6.2 的调用样例与实施约束——**Task 2 接线时别漏**。

## Task 2: 工厂侧发布(**唯一非旁路改动**)

**Files:** Modify `backend/packages/harness/deerflow/agents/lead_agent/agent.py`;Create `backend/tests/test_lead_agent_constitution.py`

- [x] **Step 1(先写红测试 — hoist 等价性,这是本 Task 的安全网):** 断言改动后传入 `create_agent(middleware=...)` 的列表**内容与顺序与改动前逐项相同**(对 lead 常规链、bootstrap 链、subagent 链各一次,optional 全开与全关各一次)。同时断言 `make_lead_agent` 的**返回类型与签名未变**(钉住 `agent.py:644` 的 LangGraph Server 契约)。**先写这个测试再动代码**——hoist 是纯表达式提取,任何顺序或内容变化都是回归。
- [x] **Step 2(先写红测试 — 发布):** 断言 ① **两个** `create_agent` 站点(bootstrap :835-862、常规 :916-946)都调用 `publish_constitution`(bootstrap 那条最易漏);② `constitution_for(graph)` 返回的快照字段与组装现场一致;③ **`build_constitution_record` 抛异常时 agent 仍然构建成功**(发布调用必须包 try/except,spec §7 最后一条)。
- [x] **Step 3:** 改常规站点(:916-946):把 `normalize_middleware_state_schemas(build_middlewares(...), mode)` 提为局部变量 `middlewares`,`create_agent` 结果提为 `graph`,然后 `publish_constitution(graph, build_constitution_record(...))`(包 try/except + warning),最后 `return graph`。入参按 spec §6.2 的清单传局部变量,**authorization 差集交给 `build_constitution_record` 算**,工厂侧只做"交出局部变量"。
- [x] **Step 4:** 改 bootstrap 站点(:835-862),同形状。**修正原描述**:bootstrap 分支其实**有** `skill_setup`(在 `if is_bootstrap:` 内自建)与作用域内的 `agent_name`,两个都传——事实列表与常规站点写成同一形状,只差 `is_bootstrap`(spec §6.2 已更正)。
- [x] **Step 5:** 转绿 + `cd backend && make test`(确认 hoist 没打破既有的位次钉死测试,如 ClarificationMiddleware 必须最后)+ `make lint`。

**交付纪要(Task 2,2026-09-10):**

- **新增**:`tests/test_lead_agent_constitution.py`(10 例)。**修改**:`agent.py`(唯一非旁路改动)、`constitution_record.py`(把 `is_mcp_tool` 改成函数级导入)。
- **改动形状**:`agent.py` **97 insertions / 31 deletions**,删掉的只有 2 行 `return create_agent(` 与 2 处内联 middleware 表达式——**没有任何 kwarg 被动过**,是纯 hoist。两个站点各自:`middlewares = normalize_middleware_state_schemas(build_middlewares(...), mode)` → `graph = create_agent(..., middleware=middlewares, ...)` → `_publish_constitution_snapshot(graph, **facts)` → `return graph`。
- **发布收敛到一处**:新增模块级 `_publish_constitution_snapshot(graph, **facts)`,把 build+publish 包在 try/except 里——避免 20 行抄两遍,也让"绝不影响构建"只有一个实现。
- **等价性安全网用的是身份而非等值**:断言同一个 list 对象必须流经 `build_middlewares` → `normalize_middleware_state_schemas` → `create_agent`(`is ` 断言)。身份无法被"内容恰好相同"的实现满足,比逐项比内容更强。
- **导入链的坑**:`constitution_record` 被 `agent.py` 模块级导入,**前提是它自己不 import `deerflow.tools`**。为此 `_tool_source` 里的 `is_mcp_tool` 改成函数级导入——`agent.py` 一直懒加载 `deerflow.tools` 正是在躲循环依赖。
- **测试**:`test_lead_agent_constitution.py` 10 例绿;四个宪法文件 **60 passed**;**工厂相邻门禁 413 passed / 0 failed**(`test_lead_agent_prompt` / `test_lead_agent_model_resolution` / `test_checkpoint_mode` / `test_extension_ordering` / `test_extension_placement_guarantees` / `test_extension_stack_wiring` / `test_create_deerflow_agent` / `test_subagent_executor` / `test_run_journal` + 四个宪法文件 + harness 边界)——**位次不变量(Clarification 必须最后)与 checkpoint 模式冻结都在其中**。
- **revert 证明**:把发布助手改成空操作 → **4 个用例当场红**(两个站点 + 两个记录内容用例),撤销即绿。
- **门禁**:`ruff check` / `ruff format --check` 干净。
- **全量套件的 149 个失败不是本任务的**:本机后端全量实测 `12133 passed / 149 failed / 109 skipped`。**做了受控 A/B**——把 `agent.py` + `constitution_record.py` 回退到提交态后,同一批 5 个失败文件仍是 `11 failed / 341 passed`(与改动后逐字相同),**证明与 Task 2 无关**。失败集中在环境相关模块(RAG 默认模型取自本机真实 `config.yaml` / Windows 不认 POSIX chmod 的 wechat / AST 递归深度的 skillscan / 本机没有 nginx),另一个来源是在飞的 RAG 那条线。**本任务一条测试都没红。**
  > **给后续 Task 的提醒**:本机后端全量**不能**当门禁用(149 红是环境基线,远多于旧记录的"3 个")。用上面那个**工厂相邻集合**当门禁,41 秒跑完且全绿。

## Task 3: journal 承载 + 契约 5 处同步

**Files:** Modify `backend/packages/harness/deerflow/runtime/journal.py`、`runtime/events/catalog.py`、`contracts/run_event_stream_contract.json`、`backend/docs/RUN_EVENT_STREAM.md`、`backend/tests/test_run_event_stream_contract.py`;Create `backend/tests/test_run_journal_constitution.py`

- [ ] **Step 1(先写红测试):** 覆盖 ① `set_constitution` 是**纯赋值**、无 IO(过 blocking-IO 门禁);② set 后 `run.start` 的 `content` 带 `constitution`,且 `content.chain` / `metadata.caller` **原样保留**;③ **未 set 时 `run.start` 与今天逐字节相同**(这是既有消费者的兼容保障);④ first-time-only 守卫——多次根 chain 触发只带一次(断言强度依 Task 0 Step 2 的结论)。
- [ ] **Step 2:** `journal.py` 加 `set_constitution(self, record: dict) -> None`(照抄 `set_first_human_message` :815-817 的形状,纯赋值,docstring 注明 no IO);`__init__` 加 `self._constitution: dict | None = None` 与 `self._constitution_emitted = False`。
- [ ] **Step 3:** 改 `on_chain_start` 的 `parent_run_id is None` 分支(:325-333),按 spec §6.3 组装 `content` 后再 `_put`。
- [ ] **Step 4:** 契约同步:① `contracts/run_event_stream_contract.json` 的 `run.start.content_schema.properties` 加 `constitution`(对象,含 `schema_version` 与各子字段形状;`required` **仍只有** `["chain"]`,保持向后兼容);② `runtime/events/catalog.py:58` 的 `RUN_START_EVENT` 处补形状说明注释;③ `backend/docs/RUN_EVENT_STREAM.md` 补 `run.start` 载荷段落;④ **确认 `deerflow/constants.py` 无需变动**(无新 event_type → 32/16/21 字符上限常量不涉及),若确实无需变动则在 spec §9 记一句"已确认";⑤ `tests/test_run_event_stream_contract.py` 加 `constitution` 形状断言,并确认既有"两个视图与全部 producer 组必须一致"的断言仍通过。
- [ ] **Step 5:** 转绿 + `cd backend && PYTHONPATH=. uv run pytest tests/test_run_event_stream_contract.py tests/test_run_journal_constitution.py -v --basetemp .pytest-tmp`。

## Task 4: worker 接线 + 降级路径

**Files:** Modify `backend/packages/harness/deerflow/runtime/runs/worker.py`;Create `backend/tests/test_run_worker_constitution.py`

- [ ] **Step 1(先写红测试):** 覆盖 ① 工厂发布后 worker 接线成功,`journal.set_constitution` 被调用且参数等于 `constitution_for(agent)`;② **自定义 `agent_factory` 不发布**时不炸、`run.start` 保持原样(`worker.py:815` 的 `_agent_factory_supports_app_config` 说明工厂可注入);③ `journal is None`(无 event store)时整段跳过;④ 接线发生在 `astream`(:922/:933)**之前**。
- [ ] **Step 2:** 在 `worker.py:820`(`agent = agent_factory(**agent_factory_kwargs)`)之后、`CheckpointStateAccessor.bind`(:822)附近插入 spec §6.4 的四行接线。
- [ ] **Step 3:** 转绿 + `cd backend && make test`(worker 测试面广,全量跑)。

## Task 5: 文档同步 + 全量验证

**Files:** Modify `backend/AGENTS.md`;Modify spec(写回 Task 0 三项结论)

- [ ] **Step 1:** `backend/AGENTS.md` 补两处:① Middleware Chain 段落加一句"组装结果由 `agents/constitution_record.py` 发布为 run 级构成快照,挂在 `run.start` 上";② Run event stream 段落(那句"changes must keep producer code, `deerflow/constants.py`, ... in sync")附近记录 `run.start.content.constitution` 的存在与 `additionalProperties: true` 的兼容依据。**根 `AGENTS.md` 无需改动**(本变更不涉及服务拓扑、命令或跨模块约定)。
- [ ] **Step 2:** 把 Task 0 三项实测结论写回 spec §8 风险 1/2/3/4(逐项标注"已核实"与实测数字),照丙1 spec §7 风险 6 的删除线 + 裁决记录风格。
- [ ] **Step 3:** 全量验证阶梯:
```bash
cd backend && make test
cd backend && make lint
cd backend && make format
cd backend && PYTHONPATH=. uv run pytest tests/blocking_io/ -v --basetemp .pytest-tmp   # run_inline 门禁
cd backend && PYTHONPATH=. uv run pytest tests/test_harness_boundary.py -v --basetemp .pytest-tmp
```
- [ ] **Step 4:** 手工验收(需真实 `config.yaml` 与凭据,不进 CI):起 Gateway,发一条消息,`curl` 该 run 的 `GET /api/threads/{tid}/runs/{rid}/events?event_types=run.start`,确认返回的 `content.constitution` 里 ① middleware 条数与 `STAGE_OF_MIDDLEWARE` 覆盖一致、② `tools.mounted` 与 `config.yaml` 的 `tool_groups` 展开吻合、③ 若 authorization 开启则 `tool_authorization.removed` 非空且解释得通、④ 整体字节数在 16KB 内且 `truncated: false`、⑤ **`frequency` 探测结果与 Task 0 Step 4 的实测对账**——"只有 `wrap_*`"的恰好 15 个,且 `DynamicContext=once_per_run` / `Title=per_model_call` / `InputSanitization` 落在 `context` 而非 `intake`。
- [ ] **Step 5:** 手工验收第二腿(**按 agent 追加的那一类**):用 `rag` agent 发一条消息,确认 `content.constitution.middlewares` 里出现 `DeepResearchMiddleware` 且 `stage="context"`。这条腿专门验 spec §8 风险 6——只测默认 agent 会漏掉它。

---

## 完成判据

- 两个 `create_agent` 站点都发布,且 hoist 等价性测试绿(内容与顺序逐项相同)
- `make_lead_agent` 签名与返回类型未变
- 未发布 / 无 journal / 自定义工厂 三条降级路径都静默通过,`run.start` 与改动前逐字节相同
- **stage guard test 绿,且覆盖四条链**:默认 lead、optional 全开 lead、**`agent_name="rag"`**、subagent
- **两个轴都钉死**:stage 归属表(34 具名,intake 2 / context 12 / model 3+5 / tools 4+5+1 / epilogue 2)+ **`hooks[]` 集合逐个钉死(等值,含顺序)+ 三值派生规则各分支有例可证,且 `mixed` 不出现**;聚合分布只作记录(旧 4/15/6/9 作废)
- **策展投影不变量绿**:`stages[]` 序列化文本里搜不到任何 middleware 类名(只允许 `key`、`loop` 与计数)
- **`loop` 标记钉死**:`intake`/`epilogue` = `false`、`context`/`model`/`tools` = `true`、`extension` 为显式写定的固定值(环形布局的循环体由服务端拥有,spec §6.6.1)
- 契约 5 处同步,`test_run_event_stream_contract.py` 绿
- blocking-IO 门禁与 harness 边界测试绿
- `make format` 干净(CI 强制 `ruff format --check`)
- spec §8 风险 1-5 全部写回实测结论(风险 5 已于 2026-09-10 写回)

## 不在本计划内(归属见 spec §5 / §12)

⑧ 六道闸门埋点(spec §12 第 1 项,另立,纯旁路)· subagent 侧 `loop_capped`/`token_capped`(通道已存在,零后端改动)· **前端构成视图与环形布局实现**(spec §12 第 2 项,另立 spec;布局已裁决为环形、`extension` 段的位置也已裁决(环外附加带),**只剩"环形怎么实现"未决**(spec §8 风险 12);**该 spec 还必须一并交付 i18n 文案表的两条 guard test**——前端钉"文案 ↔ 密钥清单"、后端钉 `STAGE_OF_MIDDLEWARE` 键集 ↔ 同一清单,约 78 条文案,spec §12 第 2 项)· 构成快照的跨 run diff 与聚合统计 · **实时脉冲**(spec §12 第 6 项;缺两个数据源——⑧ 闸门事件与前端零消费者的 `llm_call_index`)· **④⑥ 准入与预检失败的类型化呈现**(spec §12 第 5 项;后端状态码已类型化,缺口在前端那条 toast)· **subagent 的构成快照**(spec §12 第 7 项;**不是硬墙**——注册表是进程级的,子代理图本来就在里面,只差把记录经 `SubagentResult` 加性字段送出,同 `stop_reason` 先例;需要第二处非旁路改动,故单列)· **与既有 run 作用域 UI 的整合约束**(spec §12.1:闸门通知长在既有工具卡上、构成与交付层共用最后一条 assistant 气泡这个锚点、子代理构成应是 subtask 卡的展开内容而不是新卡)· 十段流图的 **②③⑨** 三段(管道,不画)与 **①** 的设计时预览(归丙1 的 capabilities 端点)
