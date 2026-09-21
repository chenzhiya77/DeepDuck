# 界面模型条目：补齐被丢弃的字段 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-21-model-entry-field-parity-design.md](../specs/2026-09-21-model-entry-field-parity-design.md)
**Status:** 🚧 **Task 0 已完成（2026-09-21，只读核实 6/6、结果已回填）** —— **实现从 Task 1 开始、尚未动工**。spec 已定稿（**经多轮审查修订**：必改×3 / 应改×4 / 缺口×2 / 可选×2 / **范围×1** 全部落进两份文档，验收编号 1–19）。

> **2026-09-21 范围扩一次（他裁甲）**：`max_tokens` / `use_responses_api` **从"既有受害者"升为交付项** —— 它们**写侧早已完整**（`ManagedModelInput:206-207`、`entry:652-653`、`types.ts:83-84`、编辑弹窗真有 `max_tokens` 那格），缺的**只有读侧** ⇒ 归 D6 一并接上。**Task 1 多一个 RED 项（读回这两个）、Task 3 多两条 RED（`toManagedInput` 往返 + 编辑弹窗补「API 类型」与 `max_tokens` 预填）、Task 4 多一条真栈**；验收重排为 **1–19**。⚠️ **唯一新控件**=「API 类型」进编辑弹窗（文案 key 复用添加弹窗那三个，**不新增 i18n**）；⚠️ **一条新规则**=`use_responses_api` 的**假值归一**（Chat ⇒ 不写键；显式 `false` 会被归一成缺键，且**任何界面动作都不许把"缺键"变成 `false`**）。

> **2026-09-21 两条"可选"也收**：⑩ **Task 2 的 UI 用例改成直接 `render(<ModelCapabilityEditor provider=… />)`**（环比 `functional-models-view.dom.test.tsx`：渲染组件、不驱动 Radix；断言只钉"行在不在"）⇒ **Task 0 第 2 项从"Task 2 / 3 的前置"缩成"只卡 Task 3"**；⑪ 真栈第 1 / 2 条的措辞统一成"**四个模式收敛成两个请求体**"，并补上它的**前置条件** —— 样本还得**不勾档位能力**（否则 `modeHeuristicEffort` 给 flash/thinking/pro/ultra 四个不同档位，请求体根本收敛不了；关掉后 `factory.py:373-375` 把 `reasoning_effort` 整个 pop 掉）。

> **2026-09-21 缺口两条也补完**：⑧ **i18n 三个文件进 Task 2 / Task 3 的文件清单**（`locales/types.ts` 手写 interface + `en-US` / `zhCN` 各自 `: Translations`，**缺一 `pnpm check` 红、`pnpm test` 拦不住**）；⑨ **真栈第 4 项点名 `minimax-m3` 的形态**（本机唯一 `anthropic` 条目 ⇒ "编辑既有条目 ⇒ 自动获得形状 ③"的真实样本；**在 scratch 根里复刻、不许动他本机那条**），并写明**本对验不了的那半**（代理端点收不收形状 ③ ⇒ spec §6 第 8 条登记）。

> **2026-09-21 必改三条（与 spec 同步改完）**：① **加读路径**（Task 1 的响应模型 + Task 3 的 `toManagedInput` + Task 2/3 的预填）—— 实测的机制是"GET 不返回这三个字段 + `toManagedInput` 是白名单 + 整集合 PUT" ⇒ **不读就"保存任意一条即抹掉全部"**；② Task 2 的落点**多两个弹窗的调用点**（`ModelCapabilityEditor` 要新增 `provider` prop）；③ 真栈第 1 条**要勾「思考模式」**（否则开思考那条在界面上不可达）。验收编号对 spec 重排后的 1–17。

**Parent:** [2026-09-10-web-model-provider-config-design.md](../specs/2026-09-10-web-model-provider-config-design.md)（界面模型管理，Task 1–5 已交付）——本 plan 是它的**字段集**增量。

**Architecture:** 五件事 —— **① 后端契约加 3 个字段**（`ManagedModelInput` + 路由的 `entry` dict，这是"三处写死的门"里的两道）；**② 后端把 5 个字段读回来**（`ManagedModelResponse` + `_managed_response` + GET/PUT 响应：3 个新增 + `max_tokens` / `use_responses_api` 两个既有，spec D6 —— 不读就"保存任意一条即抹掉"）；**③ 前端把那 3 个字段填出来、并回显**（一个形状下拉（含**反推**）+ 一个请求头表，按 `use:` 类自动推 `anthropic` / `deepseek` 的形状）；**④ 编辑弹窗补「API 类型」+ `max_tokens` 预填**（把两个既有字段的读侧接到底）；**⑤ 文档 + 真栈**。**`models/factory.py` 一个字都不改** —— 它本来就认得那三个形状（`models/factory.py:357-370`），本 plan 只是把界面接上。

**硬约束（spec D1/D2/D3 已裁）**：
- **`anthropic` / `deepseek` 的配方自动写、不给控件**（选甲）；**`openai-compatible` 默认「不设置」**。
- **两个配方字段都写**（不靠工厂的隐式合成 —— 形状① 的合成会多压一次档位 `minimal`，见 spec D1）。
- **`budget_tokens` 固定 `4096`**（与向导一致），v1 不暴露控件。
- **自动推配方不碰 `supports_thinking` chip**（spec D3 第 4 行）—— 向导常量里带的 `"supports_thinking": True` **不抄**（能力声明归用户）。
- **三个字段必须能读回来**（spec D6 甲）：`ManagedModelResponse` / 前端 `ManagedModel` / `toManagedInput` / 编辑弹窗预填 —— 缺任一，"保存任意一条"就会抹掉它们。**并同批接上两个既有的 write-only 字段**（`max_tokens` / `use_responses_api`：写侧通、读侧断，spec D1 第 4 / 5 条）。
- **`use_responses_api` 的假值归一**（spec D6）：下拉 Chat ⇒ **不写这个键**；**任何界面动作都不许把"缺键"变成 `false`**（`ManagedModelInput` 的布尔默认 `False` 会被真写进文件 —— `supports_vision` 上已有同款先例）。文件里显式 `false` 会被归一成缺键，这是**已裁的等价归一**。

**Global Constraints:**
- 分支 `feat/rag-knowledge-base`；每个 Task：**RED → GREEN → neuter（带 revert proof）→ 门禁 → commit**（Conventional Commits）。
- **后端 TDD 命令**（照 `backend/Makefile` 的 `RUN` 变量）：窄面 `cd backend && PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync pytest tests/<file>.py -q`；全量 `cd backend && make test`（≈23 分钟 ⇒ **后台跑，没跑完别默认是绿的、先别提交**）。
- **前端命令**：窄面 `cd frontend && pnpm test <path>`（若 rstest 不接受路径过滤，则跑整个 `tests/unit/models/`）；全量 `cd frontend && pnpm test`。⚠️ **Task 0 要先核实 rstest 的窄面跑法**。
- **密钥**：本对真栈**不碰任何真实密钥** —— 隔离实例的 scratch 配置里用**现造的假值**。
- **scope fence（明确不做）**：不扩 `PROVIDER_ALLOWLIST`（8 个本仓适配类选不出的问题，**另一条线**）；不做 `temperature` / `default_query` / `output_version` / `pricing` / 超时重试（spec D1 的"不补"清单）；不做 caption（VLM）腿吃 `default_headers`（spec §6 第 7 条，另一条线）；不做同名整条替换的静默提示（spec §6 第 5 条）。⚠️ **`max_tokens` / `use_responses_api` 不在此列** —— 他裁甲后它们是**本对交付项**（只补读侧）。
- **不落任何残留**：真栈用的隔离实例与 recorder 跑完 `taskkill /T`、scratch 目录删净；`models_config.json` / `config.yaml` md5 必须与动手前相同。
- **每个 Task 的 `**实测**` 行必须回填**（RED 几条红 / GREEN 几条绿 / neuter 的受害者 / 门禁数字）——**未回写的 plan 不算交付**。

**依赖顺序**：Task 0（六项核实，只读）→ Task 1（后端契约）→ Task 2（前端形状）→ Task 3（前端请求头）→ Task 4（文档 + 真栈）。

✅ **Task 0 第 2 项已答（2026-09-21）：Radix `Dialog` 在 `dom` project 里能渲染**（临时探针跑通、已删）⇒ **Task 3 的 RED 落 dom 层**，那条「退回接线层」的 contingency 作废。⛔ 仍成立：Task 2 的 UI 用例**直接渲染 `ModelCapabilityEditor`**（不经过弹窗）。

---

## Task 0 — 开工前的六项核实 ✅ **已完成（2026-09-21）**

> 动到的文件：**无**（只读）。⚠️ 第 2 项用过一个**一次性探针**（`frontend/tests/unit/components/__scratch__/radix-dialog-smoke.dom.test.tsx`），**跑完即删、仓里无残留**（该目录现在不存在）。

- [x] 1. **前端窄面测试的确切跑法 + `dom` / `node` 两个 project 的分界**：`rstest.config.ts` 把测试分成两个 project —— `node` 匹配 `tests/unit/**/*.test.ts(x)`（**排除** `*.dom.test.*`），`dom` 匹配 `tests/unit/**/*.dom.test.(ts|tsx)`（happy-dom）。⚠️ **Task 2 / Task 3 的渲染断言必须落在 `*.dom.test.tsx`**。核清窄面怎么单跑一个文件（若 rstest 不接受路径过滤，窄面就是整个 `tests/unit/` 或 `tests/unit/components/workspace/`）。
      **实测（2026-09-21，✅ 核完）**：① **窄面跑法 = `cd frontend && pnpm test <路径>`，rstest 接受路径过滤** —— 实跑一条单文件：`Test Files 1 passed / Tests 1 passed`（含启动共 41.4s ⇒ **dom 项目启动很贵，单文件也要约 40s**）。`package.json` 的 `test` 就是 `rstest`。
      ② **两个 project 分界与计划一致**（`rstest.config.ts`）：`node` = `tests/unit/**/*.test.ts(x)` 且 **exclude `**/*.dom.test.*`**；`dom` = `tests/unit/**/*.dom.test.(ts|tsx)` + `testEnvironment: "happy-dom"`。
      ③ ⚠️ **`dom` 还挂了 `setupFiles: tests/setup-dom.ts`** —— happy-dom 没有 `ResizeObserver`，而这个文件装了**全局 no-op stub**（注释点名 Radix ScrollArea / react-resizable-panels / echarts）⇒ **Task 2/3 的 dom 用例不需要自己 stub ResizeObserver**（各文件自带的 `??=` 桩会幂等跳过）。
- [x] 2. **Radix `Dialog` 在 `dom` project 里能不能渲染** —— **这一项只卡 Task 3**（Task 2 已改成直接渲染组件，见它那条 UI RED）。先例已核：`tests/unit/components/workspace/composer-reasoning-controls.dom.test.tsx` 用 `@testing-library/react` 的 `render` / `fireEvent` / `screen`，测的正是「模式 + 推理深度」菜单的三种观察形态 ⇒ **普通控件有先例**。要看的是**弹窗**（`models-add-dialog.tsx` / `models-edit-dialog.tsx` 用 Radix `Dialog` + Portal + focus trap）在 happy-dom 里能不能挂载。
      ⛔ **已作废（实测=能渲染）** —— 若不能：Task 3 的 RED 退回**能观测到的东西**（`batch.ts` 的展开），并且 **neuter 要相应改成守那个东西**，**不要让 neuter 去守一个它测不到的分支**。
      ⚠️ **同时核一个替代口径（省钱）**：仓内 settings 的两个 dom 用例**都不经过弹窗** —— `functional-models-view.dom.test.tsx` 渲染**视图组件本身**，它的注释写明"renders the view once with a different stored provider **instead of driving the Radix dropdown** … keeps the test about the rule rather than about Radix's portal behavior"；`tool-settings-page.dom.test.tsx` 同理。⇒ 当时写的是"**若弹窗挂不上**就不该硬做 dom 用例"，**实测=能渲染 ⇒ 这条也用不上**（保留原句只为记录判断依据：Task 2 直接渲染组件正是借这个先例）。
      **实测（2026-09-21，✅ 核完：能渲染）**：写了一个**临时探针**（`tests/unit/components/__scratch__/radix-dialog-smoke.dom.test.tsx`，**跑完已删、仓里无残留**）：`render(<Dialog open><DialogContent><DialogTitle>…` 在 `dom` project 下**挂载成功** —— `screen.getByText("probe-title")` 命中、`document.querySelector('[role="dialog"]')` 也有 ⇒ **Portal + overlay + focus trap 都过得去**（ResizeObserver 由上面那个全局 stub 兜住）。
      ⇒ **Task 3 的 RED 落在 dom 层**（不进"退回接线层"那条分支）；⚠️ **那条"若不能"的 contingency 就此作废** —— 别把两套都写进用例。
      ⚠️ **同时确认了一件没先例的事**：**仓内此前没有任何 dom 用例渲染过 Radix Dialog**（`grep -rln "components/ui/dialog\|<Dialog\|DialogContent" tests/` **零命中**；settings 那两个 dom 用例都是直接渲染视图/页面组件）⇒ 这是**首次确立先例**，所以上面那次探针是必要的。
      ⚠️ 两个弹窗的 `open` / `onOpenChange` **都是受控 prop**（`models-add-dialog.tsx:38-44` / `models-edit-dialog.tsx:36-49`，另各需 `existingNames`+`onAdd` / `model`+`onSave`），**mount 时零网络调用**（add 的探针只在提交时发）⇒ 用例可直接 `open={true}` 渲染、只需 mock `@/core/i18n/hooks`。
- [x] 3. **`ModelCapabilityEditor` 的 props 契约 + 编辑腿的 payload 组装点**：它现在收 `value` / `onChange` / `suggested`（`models-add-dialog.tsx:334` 与 `models-edit-dialog.tsx:162` 两处调用），**不收 `provider`**。核清**新下拉要挂在哪一层** —— 是并入它现有的 `value`（`capability.ts` 的 `CapabilityValue`），还是**另开一个 prop**。⚠️ **判据**：`capability.ts:170` 的 `supportsReasoningEffort` 是从 `supportedEfforts.length > 0` **派生**的 ⇒ 新字段若并入同一个 value，要确认不会破坏那条派生。**并顺带定死两件事**：
      - (a) 组件**必须**新增 `provider` prop（下拉按提供商显隐，spec §3.4）⇒ **两个弹窗的调用点各补一行**；
      - (b) **编辑腿的 payload 组装点** —— `capabilityInputFromValue`（`capability.ts:204`）今天**不知道 provider**，而"按类自动推"必须知道 ⇒ 定它（给它加参数，或由弹窗合并）。**这是"接线层"用例能落在 `node` project 的前提**。⚠️ **顺带把它扩成"编辑腿的完整组装规则"**：`max_tokens`（数字，空 ⇒ 不写）与 `use_responses_api`（**Chat ⇒ 不写这个键；Responses ⇒ `true`**，**绝不允许出现 `false`**）也走这里 —— Task 3 若遇到"弹窗渲染不了"，回落断言就落在这个纯函数上（spec D6 的假值归一）。
      **实测（2026-09-21，✅ 核完 + 定死）**：
      - (a) 确认：组件 props 只有 `value` / `onChange` / `suggested`（`model-capability-editor.tsx`），**必须新增 `provider`**；调用点两处：`models-add-dialog.tsx:334`、`models-edit-dialog.tsx:162`（各补一行）。
      - (b) **定死：`capability.ts` 一个字不改。** 理由：`capabilityInputFromValue`（`capability.ts:204`）**全仓只有一个调用点** —— `models-edit-dialog.tsx:91` 把它 spread 进 `onSave` 的 payload；而配方与 `use_responses_api` **不属于"能力组"**（它是连接/请求体组）⇒ 硬塞进它会把两组的语义混在一起、还会让 `capability.ts` 的既有用例跟着动。
      ⇒ **落法**：新增的 `thinking-shape.ts` 出**两个纯函数** —— ① `thinkingRecipeFor(provider, shape, existing?)`（**生成 + 反推**，`existing` 用于"未命中三字面量时原样保留"）；② `apiTypeToUseResponsesApi(apiType)`（Responses ⇒ `true`；Chat ⇒ `undefined`，**永不 `false`**）。**消费方两处**：`expandBatchToEntries`（添加腿，用 `shared.provider` + `shared.apiType`）与 `models-edit-dialog.handleSubmit`（编辑腿）。
      - ⚠️ **这条改写了 plan 原文一句**：Task 2 那条"**编辑腿单独一条（node project）**"的接线断言**移到 Task 3 的 dom 用例**（弹窗能渲染 ⇒ 直测真接线比 node 层代理断言强）；Task 2 只保留"**添加腿**（`expandBatchToEntries`，node）"。已同步改 Task 2 / Task 3 的文字。
- [x] 4. **`ManagedModelInput` 的字段顺序与 `entry` 的键顺序**：核清两个 dict literal 现在各有多少键、新键插在哪（保持与既有顺序一致，避免无意义的 diff 位移）。
      **实测（2026-09-21，✅ 核完）**：① `ManagedModelInput`（`routers/models.py:183-207`）**16 个字段**，末两个是 `max_tokens`（`:206`）/ `use_responses_api`（`:207`）⇒ **三个新键追加在这两个之后**（`:208-210`），**16 → 19**。
      ② `entry: dict`（`:638-654`）**15 个键**，末两个同为 `"max_tokens"`（`:652`）/ `"use_responses_api"`（`:653`）⇒ **三个新键追加在 `:653` 之后、`:655` 那条条件行之前**（条件行是 `if item.endpoint: entry[endpoint_key] = ...`，**必须留在最后**），**15 → 18**（+ 设了端点时 19）。
- [x] 5. **`backend/AGENTS.md` 的 Models Configuration 一节有没有列字段清单**（决定 Task 4 是"改"还是"记一句无需改动"）——**提前到这一步核，省一次往返**。
      **实测（2026-09-21，✅ 核完）**：**该节没有字段清单** —— `backend/AGENTS.md:564-603` 讲的是机制（独立文件 / 按 name 合并 UI 赢 / 安全边界与 allowlist / 掩码哨兵 / 原子写 / 解析顺序 / 热重载 / doctor + support-bundle）＋一段 "Structured model capabilities"（子集与默认档那两个）。
      ⇒ **字段集无需同步**（Task 4 按"记一句无需改动"走）；⚠️ **但有一句该补**：安全边界那段写着「API keys … are masked behind a sentinel on read」，而本对之后**读侧会原样返回 `default_headers` 的值**（头值不遮罩，可能含 token）⇒ Task 4 在该段**补一句**（一句话，不是清单）。
- [x] 6. **既有断言的载荷扫描**（动手前必做）：把将被改动的测试文件里**所有**带 `ManagedModelInput` / `entry` 载荷的用例列出来，逐条判"加 3 个字段后它会不会红"：
      - `backend/tests/test_models_config_api.py`（PUT 的载荷）
      - `backend/tests/test_models_config.py`
      ⚠️ **判据**：`extra="forbid"` 只管"多传未知键"，**新键现在是已知的** ⇒ 既有用例只要不带这 3 个键就**保持绿**。⚠️ **但两条既有测试用例是「部分载荷」**（历史上撞过）⇒ 逐条核它们的 payload 是否会被新字段的默认 `None` 影响。⚠️ **新接的两个既有字段（`max_tokens` / `use_responses_api`）本来就是已知键**（入参、`entry`、前端类型都有）⇒ 对既有载荷零影响；本轮只是**响应多两个键** ⇒ 顺带核一遍"有没有用例断言响应整 dict"（今天没有；唯一那条 `response.json() == {...}` 在 `/validate`，`test_models_config_api.py:286`）。
      **实测（2026-09-21，✅ 扫完：零风险）**：
      - **没有任何"整 entry / 整响应 dict 相等"的断言** —— 两个文件里唯一一条整 dict 相等是 `test_models_config.py:189`（原子写测试拿自己的合成条目 `_model("written")` 比，**不经路由**）⇒ **把 3 个键加进入参、5 个键加进响应，不会打红任何既有用例**。
      - **既有风格 = 逐键 + 负向键**：`stored["supported_context_windows"] == [...]`（`:509-513`）、`assert key not in stored`（`:524-529`）、`assert "supported_reasoning_efforts" not in stored`（`:597-599`）⇒ 我们的"**不填就不写：键不存在（不是 `null`）**"直接沿用这个现成写法。
      - **"部分载荷"三条已点名**（历史撞过的就是它们）：`_CAPABILITY_MODEL`（`:490-500`，6 键）· 4 键极简 payload（`:524`）· `_ANTHROPIC_BASE`（`:561-566`）⇒ 三者都不带新键，新字段默认 `None` 被 `stored_entry` 丢掉 ⇒ **保持绿**。
      - 另：`test_public_models_expose_effort_capabilities`（`:605-612`）读的是 `GET /api/models`（**公开列表，另一个端点**）⇒ 本对不碰它。

---

## Task 1 — 后端契约：3 个字段进得来、读得回

> 动到的文件：`backend/app/gateway/routers/models.py`（`ManagedModelInput` +3 字段、`entry` +3 键、**`ManagedModelResponse` / `_managed_response` / GET·PUT 响应各 +5 字段**（3 新 + `max_tokens` / `use_responses_api` 两个既有））；测试 `backend/tests/test_models_config_api.py`。

**验收对应**：spec §4 的第 1 / 2 / 3 / 4（读路径）/ 5（两个既有字段的读路径）/ 6 / 7 条。

- [ ] **RED**：在 `test_models_config_api.py` 加用例，**先红**：
      1. `PUT` 带 `when_thinking_enabled` + `when_thinking_disabled` + `default_headers` ⇒ **`models_config.json` 里逐字出现**（今天会 422 ⇒ 红）。
      2. **只填其中一个** ⇒ 另外两个**键不存在**（不是 `null`）—— 钉住 `stored_entry = {k: v for k, v in entry.items() if v is not None}` 那条过滤。
      3. **未知键仍被拒**：带一个清单外的键 ⇒ **422**（钉住 `extra="forbid"` 没被放宽）。
      4. **读得回来（D6 读侧）**：`PUT` 这条条目之后 `GET /api/models/config` ⇒ 三个字段**原样返回**。今天 PUT 就 422 ⇒ 红；**只做完写路径时它仍然红** —— 这正是它守的东西。
      5. **两个既有字段也读得回来**（甲扩的那两个）：`PUT` 一个带 `max_tokens: 8192` + `use_responses_api: true` 的条目 ⇒ `GET` 响应里 `max_tokens == 8192`、`use_responses_api is True`；**没设过的条目** ⇒ 两个都是 `None`（不是 `False` / `0`）。今天这两条恒红（响应模型没这两个字段，值取不到）。
      **实测**：
- [ ] **GREEN**：`ManagedModelInput` 加 3 个字段（`when_thinking_enabled: dict | None = None` / `when_thinking_disabled: dict | None = None` / `default_headers: dict[str, str] | None = None`）；路由的 `entry: dict = {...}` 加 3 行；**`ManagedModelResponse` 加 5 个字段**（3 新 + `max_tokens: int | None` / `use_responses_api: bool | None`）、`_managed_response` 加 5 个参数、**`get_models_config` 与 `put_models_config` 的响应各传一次**（D6 读侧；GET 那侧两个既有字段从 `dumped = model.model_dump()` 取）。窄面转绿。
      **实测**：
- [ ] **形状对齐取证 —— ⚠️ 首跑即绿，不是 RED**（spec §4 的第 6 / 7 条）：在 `test_model_factory.py` 加用例 —— 把 spec §3.3 那张表的**三个形状**各构造一次，喂给 `create_chat_model`，断言 `factory.py:357-370` 三段 `elif` 各自命中（形状① ⇒ `extra_body.thinking.type`；形状② ⇒ `chat_template_kwargs`；形状③ ⇒ `thinking`）。用现有 `test_model_factory.py` 的 `_patch_factory` 桩法。
      ⚠️⚠️ **工厂一个字都不改**（见 Architecture）⇒ **这三条必然首跑就绿**，它们**不是 RED、也不构成回归防线** —— 它们回答的是「**我们选的形状对不对**」（**取证**）。**别为了让它红去改工厂。**
      **实测**：
- [ ] **neuter（带 revert proof）**：把 `entry` 里新加的一行**改回不写**（模拟"只改了入参没改写盘"）⇒ 第 1 条用例必须**转红**（证明它守的是"真进了文件"，不是"入参收了"）。改回。
      **实测**：
- [ ] **neuter（读路径 · 带 revert proof）**：把 `ManagedModelResponse` 的三个字段（或 `_managed_response` 的传参）删掉 ⇒ **第 4 条必须转红**。改回。
      **实测**：
- [ ] **neuter（两个既有字段 · 带 revert proof）**：把 `ManagedModelResponse` 里 `max_tokens` / `use_responses_api` 两行（或它们的传参）删掉 ⇒ **第 5 条必须转红**。改回。⚠️ **与上一条不同点**：这两行的写侧今天就在（`entry` 里早有两行）⇒ 这条 neuter **只可能**打红读侧断言；若它把第 1 条也打红了，说明改错了地方。
      **实测**：
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`test_models_config_api.py` + `test_model_factory.py`）绿。
      **实测**：

---

## Task 2 — 前端：形状下拉 + 两格自动推

> 动到的文件：**新增** `frontend/src/core/models/thinking-shape.ts`（纯函数：形状表 + **反推**）+ `frontend/tests/unit/models/thinking-shape.test.ts`；改 `frontend/src/components/workspace/settings/model-capability-editor.tsx`（**+`provider` prop** + 挂下拉）、**两个调用点** `models-add-dialog.tsx` / `models-edit-dialog.tsx`（各传 `provider`）；`frontend/src/core/models/capability.ts` / `batch.ts`（把两个配方字段带进 payload）；`frontend/src/core/models/types.ts`（`ManagedModel` 的**读侧**：两个配方字段）；**文案**：`frontend/src/core/i18n/locales/{types,en-US,zh-CN}.ts`（key 沿用 `M.*` 家族、紧挨 `apiType` 那一组）。

⚠️ **文案是三个文件**（`Translations` 是手写 interface、两个 locale 各自 `: Translations`）⇒ 只改一边 `pnpm check` 就红。`pnpm test` **替它兜不住**：`tests/unit/core/i18n/translations.test.ts` 只钉 disclaimer 一条；有"键齐平"守卫的是四个**别的**命名空间（`tests/unit/support/i18n-key-manifest.ts` 的四份 manifest：constitution / delivery / pulse / run-status），**`settings.models` 不在其中** —— 而那套机制自己的注释写着"`types.ts` 与两个 locale 在编译期互相约束"，所以**只有 tsc 拦得住**。

**验收对应**：spec §4 的第 8 / 9 / 10 / 13 / 14 条。

- [ ] **RED（纯函数 · `node` project）**：新建 `frontend/tests/unit/models/thinking-shape.test.ts`（**node project** —— 纯函数不需要 DOM），**先红**。要钉住的规则（spec §3.3 那张表 + D3）：
      1. **形状①**（`openai-compatible` 选「OpenAI 兼容网关」）⇒ 生成 `{"extra_body": {"thinking": {"type": "enabled"}}}` / `{... "type": "disabled"}`。
      2. **形状②**（选 vLLM / SGLang）⇒ 生成 `{"extra_body": {"chat_template_kwargs": {"enable_thinking": True}}}` / `{... False}`。
      3. **形状③**（`anthropic` 自动）⇒ 生成 `{"thinking": {"type": "enabled", "budget_tokens": 4096}}` / `{"thinking": {"type": "disabled"}}`，⚠️ **`budget_tokens` 恰为 `4096`**（spec §4 第 9 条点名那个值）。
      4. **`anthropic` / `deepseek` 自动推**：给定 `use:` 类 ⇒ 直接得到两个字段（不需要用户操作）。**`deepseek` ⇒ 形状①**。
      5. **「不设置」⇒ 两个字段都不生成**（不是生成 `null`）。
      6. **反推（D6 读侧）**：给定文件里的 dict ⇒ 得到下拉的当前值（形状①/②/③ 各一条）；**未命中三个字面量 ⇒ 落「不设置」且标记"原样保留"**（保存时必须把它带回去，不能推成 `undefined` ⇒ 那等于删）。
      ⚠️ **推导规则写成一张表**（`ChatAnthropic` 系含 `ClaudeChatModel` ⇒ ③；`VllmChatModel` ⇒ ②；**其余** ⇒ ①）——**别散在 if/else 里**。
      **实测**：
- [ ] **GREEN（纯函数）**：实现 `thinking-shape.ts`。窄面绿。
      **实测**：
- [ ] **neuter（纯函数）**：把 `budget_tokens` 从 `4096` 改成别的值 ⇒ 第 3 条必须**转红**。改回。
      **实测**：
- [ ] **RED（接线层 —— 验收 9 / 10 的真正落点）**：`capability.ts` / `batch.ts` 的测试（node project），**先红**：**给定一个 `anthropic` 条目 ⇒ 展开出来的 entry 里带形状③的两个字段；给定「不设置」⇒ entry 里这两个键不存在**。**编辑腿这条不在这里做**（Task 0 第 3 项 (b) 已裁）：弹窗**能渲染**（Task 0 第 2 项）⇒ 编辑腿的接线断言**落在 Task 3 的 dom 用例**（渲染编辑弹窗 → 保存 → 断言 `onSave` 的 payload）—— 直测真接线，比在 node 层做代理断言强。**本 Task 只做添加腿**（`expandBatchToEntries`）。
      ⚠️ **为什么必须单独做这一条**：纯函数层只证明「给定类生成什么 dict」，**证不了「它真的被带进 PUT payload」**。spec §4 第 9 条写的是「**保存后，文件里的配方是…**」—— **那需要接线**。
      **实测**：
- [ ] **GREEN（接线层）**：`capability.ts` / `batch.ts` 把两个配方字段带进 entry。
      **实测**：
- [ ] **RED（UI · `dom` project）**：⚠️ **落点是 `*.dom.test.tsx`** —— `rstest.config.ts` 把测试分在两个 project（`node` 匹配 `tests/unit/**/*.test.ts(x)` 但**排除** `*.dom.test.*`；`dom` 只收 `*.dom.test.(ts|tsx)`，happy-dom）。
      **渲染目标 = 直接 `render(<ModelCapabilityEditor provider="…" value={…} onChange={…} />)`，不经过弹窗** —— 环比 **`tests/unit/components/workspace/settings/functional-models-view.dom.test.tsx`**（渲染视图组件本身，注释写明"**instead of driving the Radix dropdown** … keeps the test about the rule rather than about Radix's portal behavior"；`tool-settings-page.dom.test.tsx` 同形态）⇒ **这条用例不依赖 Task 0 第 2 项**（Radix `Dialog` 能不能渲染是 Task 3 的事）。
      先例另照 **`tests/unit/components/workspace/composer-reasoning-controls.dom.test.tsx`** —— 同类的「模式 + 推理深度」控件，用 `@testing-library/react` 的 `render` / `fireEvent` / `screen`，测三种观察形态。
      ⚠️ **断言只钉"那一行在不在"，不要去开 `Select` 的候选列表** —— 新控件照「API 类型」的 gate 形态（`models-add-dialog.tsx:219-237`：`<span className="text-sm font-medium">{M.…}</span>` + `<Select>`）⇒ **span 是内联渲染的**，`queryByText` / `getByText` 就够；happy-dom 下 Portal 的挂载时机不可靠，开列表属于自找 flake。
      ⚠️ **i18n 要 mock**（照上面那条先例的 `KEYS` proxy：`rs.mock("@/core/i18n/hooks", …)`）—— 否则新 key 解析成 `undefined`，按文案断言会**假红**。
      用例钉住（spec §4 第 8 条）：**下拉只在 `provider === "openai-compatible"` 时出现 —— `provider="anthropic"` / `"deepseek"` 时它不在**（**每个假设各渲一次**，别驱动切换 —— 同先例的"renders the view once with a different stored provider"）。
      **实测**：
- [ ] **GREEN（UI）**：`model-capability-editor.tsx` **新增 `provider` prop**（两个弹窗的调用点各传一次），并在「思考模式」**下面**挂下拉（spec §3.4：**只当 `provider === "openai-compatible"` 时渲染**，复用同弹窗里「API 类型」那个 `provider === ... &&` 的 gate 形态，`models-add-dialog.tsx:220`）。三个选项 =「不设置」/「OpenAI 兼容网关」/「vLLM / SGLang」，初始值走**反推**（D6），推不出落「不设置」。
      ⚠️ **两格自动推要落在前端**（spec D3 已裁）—— 保存时按 `use:` 类算出配方，**不是**让后端按 provider 补；**且不碰 `supports_thinking` chip**（spec D3 第 4 行）。
      **实测**：
- [ ] **neuter（自动推）**：把「`anthropic` ⇒ 形状③」那一行**从推导表里删掉** ⇒ 接线层那条必须**转红**。改回。
      ⚠️ **先确认实现选的是哪种兜底**，两种都能让这条 neuter 有牙、但红的理由不同：
      - 按 spec D3 的「**其余 ⇒ ①**」⇒ 删掉 `anthropic` 后会**落到形状①**（不是"不生成"）⇒ 断言形状③自然红；
      - 若实现是"查不到就返回 `undefined`" ⇒ 删掉后**不生成** ⇒ 也红。
      **把实际是哪种写进 `**实测**`** —— 否则下一个人重跑时会以为行为变了。
      **实测**：
- [ ] **门禁**：`cd frontend && pnpm check`（lint + type check）干净；`pnpm test` 窄面绿 —— ⚠️ **两个 project 都要跑到**（只跑 node 会漏掉 Task 3 的 dom 用例）。
      **实测**：

---

## Task 3 — 前端：请求头（两个弹窗）

> 动到的文件：`frontend/src/components/workspace/settings/models-add-dialog.tsx`（第一步）；`models-edit-dialog.tsx`（连接组 + **打开时预填** + **新增「API 类型」** + **`max_tokens` 预填**）；`frontend/src/core/models/types.ts`（`ManagedModelInput` 加 `default_headers`、读侧 `ManagedModel` **+5**）、`batch.ts`、**`models-settings-page.tsx`（`toManagedInput` **+5** —— D6 的抹除防线）**；**文案**：`frontend/src/core/i18n/locales/{types,en-US,zh-CN}.ts`（请求头那一组的 key，同上——**三个文件缺一 `pnpm check` 红**；⚠️ **「API 类型」不新增 key**，复用 `M.apiType` / `M.apiTypeChat` / `M.apiTypeResponses`）。

**验收对应**：spec §4 的第 11 / 12 / 14 条。

⚠️ **为什么是两个文件** —— `models-edit-dialog.tsx` **也有「接口地址」那一组**（已核：`M.endpoint` 在 `:149`、`M.apiKey` 在 `:137`），所以请求头**两处都要有**，否则已存在的条目改不了头。（这正是第一轮审查的必改第 1 条。）

- [ ] **RED**：⚠️ **先按 Task 0 第 2 项的核实结果二选一** —— Radix `Dialog` 能不能在 `dom` project 里渲染：
      ✅ **Task 0 第 2 项已答：能渲染** ⇒ 在 `tests/unit/components/workspace/settings/*.dom.test.tsx` 里**直接 `render(<ModelsEditDialog open model={…} onSave={…} … />)`**（`open`/`onOpenChange` 是受控 prop、mount 时零网络；只需 mock `@/core/i18n/hooks`），钉住 ① 添加弹窗第一步能填 `default_headers`；② **编辑弹窗也能填**；③ **打开编辑弹窗时显示已存的头**（D6 读侧）；④ **编辑腿接线**：给定一个 `anthropic` 条目 ⇒ 保存 ⇒ `onSave` 的 payload **带形状③的两个字段**（= Task 0 第 3 项 (b) 从 Task 2 移过来的那条）。⛔「不能渲染 ⇒ 退回接线层」的 contingency 已作废（Task 0 第 2 项），别再写第二套。
      ⚠️⚠️ **不要让 neuter 去守一个它测不到的分支** —— 如果 RED 落在接线层、而 neuter 却去删编辑弹窗里的控件，**那条 neuter 会静默失效**（接线层的用例照样绿）。**这是本 plan 第一轮审查查出的必改 1。**
      - **必须做（与弹窗能不能渲染无关）**：`models-settings-page.tsx` 的 `toManagedInput` **往返用例**（node project）—— 给定一个带 `default_headers` / 配方 / `max_tokens` / `use_responses_api` 的 `ManagedModel`（GET 形状）⇒ 投影出的 `ManagedModelInput` **仍带这 5 个字段**。**这条是 D6 的防线**（既有的 `max_tokens` / `use_responses_api` 今天就是在这里丢的 ⇒ **同一条用例把它们一起钉上**：`max_tokens: 8192` 与 `use_responses_api: true` 都要原样带过去）。
      - **必须做（两个既有字段的界面侧）** —— 若弹窗能渲染 ⇒ dom 用例钉住 ① 打开一个 `max_tokens: 8192` 的条目时那一格**显示 8192**（今天恒空）；② 「API 类型」显示 Responses、改成 Chat 保存 ⇒ payload 里**没有** `use_responses_api`（**不是 `false`**）；③ **防呆**：从没设过该键的条目保存后**仍不带**这个键。（弹窗**能**渲染 —— Task 0 第 2 项已验证 ⇒ 这三条**都落在 dom 用例里**，不需要纯函数回落；⚠️ 但 `apiTypeToUseResponsesApi` 的规则本身仍放在 `thinking-shape.ts`（Task 0 第 3 项 (b)），node 层另有一条纯函数用例守着它 ⇒ **「不写成 false」在两层都有牙**。）
      **实测**：
- [ ] **GREEN**：两个弹窗各加一个键/值两列的重复行控件（+ 增/删），**编辑弹窗用 GET 读回来的值预填**（D6：头、`max_tokens`、以及**新增的「API 类型」**）；`types.ts`（`ManagedModel` **+5**、`ManagedModelInput` +`default_headers`）、`batch.ts`、**`models-settings-page.tsx` 的 `toManagedInput` 补满 5 个**。
      **实测**：
- [ ] **neuter**：⚠️ **落点必须与 RED 一致** —— 若 RED 在 dom 层，删编辑弹窗那处控件；若 RED 在接线层，删 `batch.ts` 里 `default_headers` 那一行。**无论哪种，那条 RED 必须转红**；不红就说明这条 neuter 选错了对象。改回。
      **实测**：
- [ ] **neuter（`toManagedInput` · 带 revert proof）**：把 `toManagedInput` 里的 `default_headers` 那一行删掉 ⇒ 上面那条往返用例**转红**。改回。
      **实测**：
- [ ] **neuter（两个既有字段 · 带 revert proof）**：把 `toManagedInput` 里 `max_tokens` 那一行删掉 ⇒ 往返用例**转红**（同一批断言里就该有一条专门盯它）。改回。⚠️ **不要**用"删编辑弹窗的「API 类型」"来当这条的 neuter —— 它与"不写成 false"那条的受害者不是同一批（照 plan 的老规矩：neuter 只能打它 RED 守的那一条）。
      **实测**：
- [ ] **门禁**：`cd frontend && pnpm check` 干净；`pnpm test` 窄面绿（**两个 project 都要跑到**）。
      **实测**：

---

## Task 4 — 文档同步 + 真栈验收

> 动到的文件：`backend/AGENTS.md`（若需要）；真栈**不动仓库里任何文件**（隔离实例 + 本机 recorder，全在仓库外）。

**验收对应**：spec §4 的第 15 / 16 / 17 / 19 条（第 18 条含可选的回显观察）+ **第 13 条的真栈形态**（真栈第 4 项；其验不了的那半见 spec §6 第 8 条）。

- [ ] **文档**（**按 Task 0 第 5 项的核实结果**决定动作）：若 `backend/AGENTS.md` 的 **Models Configuration** 一节确实列了 `models_config.json` 的字段集 ⇒ **同步更新**（本对加 3 个）。⚠️ **顺手扫同段相邻句**（上一对的教训：计划点名的两处之外还查出了第三处）。**若该节根本没列字段清单 ⇒ 明确记一句「无需改动」**，别硬加。
      **实测**：
- [ ] **真栈（口径照前两对：只验请求体形状，不声称回话）**：**隔离实例**（`DEER_FLOW_PROJECT_ROOT` / `DEER_FLOW_CONFIG_PATH` / `DEER_FLOW_MODELS_CONFIG_PATH` 三个环境变量指向**仓库外 scratch 根** + `DEER_FLOW_AUTH_DISABLED=1` + `:8099`）+ **本机 recorder 端点** ⇒ **零出网**。
      ⚠️ **启动隔离实例前把 `rag.qdrant_url` 也改到 scratch 或指向空**（前两对的实测：它会连本机 `:6333`）。
      ⚠️ **触发路径要点名**：配方的差异**只体现在请求体**，所以断言点是 **recorder 抓到的 body**，不是界面。
      **实测**：
- [ ] **真栈五条**：
      1. 建一个**勾了「思考模式」**、**不勾档位能力**、带「OpenAI 兼容网关」形状的条目 ⇒ 四个模式**收敛成两个请求体**：flash ⇒ `extra_body.thinking.type == "disabled"`、thinking / pro / ultra ⇒ `"enabled"`，同组内逐字节相同 —— **本对的核心验收**。
         ⚠️ **两条前提都要照做**：① D3 的自动推**不碰 `supports_thinking` chip**，chip 不勾时开思考那条在界面上不可达（composer 只给 Flash）⇒ 条目会**验不出差异**，那不是配方的错；② **档位那一维必须先关**（`supports_reasoning_effort` 不勾、`supported_reasoning_efforts` 空）—— 否则 flash `undefined` / thinking `low` / pro `medium` / ultra `high` 四个请求体**收敛不了**；关掉后 `factory.py:373-375` 会把 `reasoning_effort` 整个 pop 掉（`offeredModes` 只看思考 chip，四个模式照样能选）。
      2. **对照组**：同一条目把形状设回「不设置」⇒ **四个**模式的请求体**逐字节相同**（前提同上：档位那一维已关）—— 证明差异来自配方，不是别的东西。
      3. `default_headers` 用一个 recorder 端点验：**请求头里出现所配的键**。
      4. **编辑既有 `anthropic` 条目 ⇒ 自动获得形状 ③**（验收 13 在真栈上的样子）：样本**在 scratch 根里复刻**他本机 `minimax-m3` 的形态 —— `use: langchain_anthropic:ChatAnthropic` + `base_url` 指向本机 recorder + **假 key**；设置页里**只改显示名**再保存 ⇒ scratch 的 `models_config.json` 里该条目**多出** `{"thinking": {"type": "enabled", "budget_tokens": 4096}}` / `{"thinking": {"type": "disabled"}}`。
         ⚠️ **样本要"手写进 scratch 文件"、不能走界面新增** —— 界面上新建 `anthropic` 条目**在创建那一刻就会带上形状 ③**（D3 自动写），那就验不出"编辑让它多出配方"这条路径了；**起点必须是"有类、无配方"**（与他本机 `minimax-m3` 今天的状态一致）。
         ⚠️⚠️ **不许编辑他本机那条** —— `minimax-m3` 是全局唯一一条 `ChatAnthropic` 条目（响应里的 `provider` 由 `use:` 反查得出，`models_config.py:66-68`），本项是"**复刻它的形态**"、不是"动它"；动手前后 `models_config.json` md5 必须逐字节相同。
         ⚠️ **这一项只验到"写进去了"为止**：`opencode.ai/zen/go` 那个代理**收不收原生 Anthropic 形状的 `thinking`**，隔离实例答不了（recorder 只证明发得出去）—— 而他本机两条 `opencode.ai` 条目（`deepseek-v4.1-flash` / `minimax-m3`）此前实测都 400 `MissingSessionID`（缺 `x-opencode-session` 头）⇒ 真要验接受度得先补 `default_headers` + 一个真 key，**那是另一条线**（spec §6 第 8 条登记）。
      5. **两个既有字段在真栈上不丢**（验收 18）：scratch 里造一个带 `max_tokens: 8192` + `use_responses_api: true` 的条目 ⇒ 在设置页**动另一个条目**（新增或删除）后保存 ⇒ 前者这两个键**仍在 scratch 文件里**；顺带（可选）重开它的编辑弹窗 ⇒ 头 / 形状 / **最大输出**显示为**已存值**（D6 读侧在真栈上的样子）。⚠️ **判据是"没被抹"**，不是"能被改" —— 保存前后逐字比对那两个键即可。
      ⚠️ **区分度检查**（上一对的教训）：如果那条目的**默认档恰好等于回退目标**，观测值就无法解释 ⇒ **先确认两个假设预测出不同结果**。本对按上面第 1 条的"**不勾档位能力**"造样本，这条自动满足。
      **实测**：
- [ ] **收尾**：**零改动他的配置**（写入全落 scratch 根 ⇒ `models_config.json` / `config.yaml` md5 与动手前相同，**不欠还原**；**动手前先把两本的 md5 记下来**，收尾逐个比对）；隔离实例与 recorder 停掉（`taskkill /T`，确认端口释放）；**scratch 目录删净**。
      **实测**：
- [ ] **门禁**：后端 **全量 `cd backend && make test` 后台跑** ⇒ 抽 FAILED 的 node id 去 HEAD（`git worktree add --detach`、**仓外 basetemp**、HEAD 那棵树先 `cp` 进去那 4 个 gitignored 文件）跑同一批 ⇒ **双向 diff**；`ruff` 双净；`cd frontend && pnpm check` + `pnpm test` 全量。
      ⚠️ **跨树 A/B 两侧必须用同一个仓外 basetemp**（否则凭空多一条"回归"，双向已证）。
      **实测**：
- [ ] **交付后回写**：spec 的 `**Status:**` 与 plan 本文件的 `**Status:**` 一起更新（交付的提交号 + 关键门禁数字），并把各 Task 的 `**实测**` 行补齐 —— **未回写的 plan 不算交付**。
      **实测**：
