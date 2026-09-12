# 运行状态与失败呈现(⑤ + ④⑥)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"这次 run 什么结局"(⑤)与"为什么没开始 / 没跑完"(④⑥)做成**同一种内联呈现**:持久、挂在它所属的那一轮、带一个可执行的动作——替换掉今天那条**会消失、无归属、无操作**的 toast。

**Architecture:** 见 `../specs/2026-09-12-harness-run-status-failure-design.md`。**原因分两个方向取**:pre-stream 读抛出的 `HTTPError.status`(零后端改动);post-stream 靠一个**加性字段** `RunResponse.error`。前端新建 `core/run-status/` 薄层(纯函数分类 + 投影),一个组件挂在**两个锚点**上。

**Tech Stack:** 后端 Python 3.12 / FastAPI(`RunResponse`);前端 Next.js 16 / TS / Tailwind 4 / TanStack Query / Rstest。

**前置(2026-09-12 已冻结,本计划不再议)**:D1 落点=**两段式锚点**;D2=**分段取**;D3=**徽标 + 失败条**;`422` **不呈现给用户**;`interrupted` **合成一句"已停止"**;**toast 保留**(不删任何既有 toast)。**Task 0 探针已完成**(结论见 spec §3.3/§7)。

**测试命令(全程统一):**
```bash
cd frontend && pnpm test            # 全量;单文件过滤:pnpm test "<路径片段>"
cd frontend && pnpm check           # eslint + tsc
cd backend && PYTHONPATH=. .venv/Scripts/python.exe -m pytest <窄集合> -q --basetemp .pytest-tmp -p no:cacheprovider
cd backend && .venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m ruff format --check .
```

**关键事实(已核实,行号见 spec §3):**
- **ok 检查在 `AsyncCaller.fetch`**;非 ok 会被转成 **`HTTPError extends Error`,带 `.status`/`.text`/`.response`**。⇒ pre-stream 直接读 `error.status`。
- **`onFailedResponseHook` 是错的机制**:`STATUS_NO_RETRY` 含 400/401/…/409/422,**先 throw 才轮到 hook**。别再提它。
- **`getStreamErrorMessage`(`hooks.ts:1471-1489`)只读 `.message`**,4 个调用点(`:1879`/`:2213`/`:2413`/`:2732`)——**不改它的行为**,新增入口。
- **`RunRecord.error` 已存在**(`manager.py:176`),`RunResponse` 的构造点在 `thread_runs.py:266-284` ⇒ 后端那步是**加字段 + 传值**。
- **`RunStatus` 六值**(`schemas.py:14-22`);**`run.end` 永远写 `success`** ⇒ ⑤ 读 `RunRow.status`。
- **前置的 409/400/404/422/501** 在 `services/__init__.py`(`:1264`/`:1104`/`:1129`/`:1074`/`:1266`)。
- **前端从不设 `multitask_strategy`**,后端默认 `reject` ⇒ `interrupted` = 用户按的停止。
- **环境债(既有)**:`pnpm format` 因 `core.autocrlf` 对全树报 CRLF;`tests/knowledge/tools/test_graph_search.py` 在 HEAD 就不过 `ruff format --check`。**判本项内容是否合规**用"剥 CR 后与 prettier 输出比对、数字与 HEAD 相同"的方法。

---

## Task 0: 探针(已完成)

- [x] Node 直连私有 `:8099`,真实触发 400 与 409:**两者都带 `status` 抛到调用方**(`HTTPError`),**hook 命中 0 次**(被 `STATUS_NO_RETRY` 短路)。结论写回 spec §3.3/§7。**已提交 `b9c9938f`。**

## Task 1: 后端把 `error` 暴露到 `RunResponse`(加性)

**Files:** Modify `backend/app/gateway/routers/thread_runs.py`;Modify `backend/tests/test_gateway_run_recovery.py`

- [x] **Step 1(RED)**:在 `tests/test_gateway_run_recovery.py` 加两条 TestClient 用例(经 `_router_auth_helpers.make_authed_test_app` + `app.state.run_manager` 桩,`GET /api/threads/thread-1/runs/run-1`)。**红在哪**:两条都 `KeyError: 'error'`(响应里没有该键)——即"加性字段不存在"本身,不是断言写错。
- [x] **Step 2**:`RunResponse`(`:167-168`)加 `error: str | None = None`;构造点 `_record_to_response`(`:285-286`)加 `error=record.error`。**纯加性**——既有字段一个不动、`stop_reason` 保持原样。全仓只有这一个构造点(已 grep 确认)。
- [x] **Step 3(GREEN)**:两条转绿;第二条断言未失败时是 **`None`**(不是空串)。
- [x] **Step 4(安全面过一遍)**:见下方交付纪要的"§8 风险 4 结论"——**已就地定案,不改代码**。
- [x] **Step 5**:窄集合门禁 44 passed;`ruff check` + `ruff format --check` 两文件干净。
- [x] **Step 6(revert 证明)**:两刀都有牙(见交付纪要)。

**窄集合门禁:** `test_gateway_run_recovery.py` + `test_run_worker_delivery.py` + `test_thread_run_query_validation.py` + `test_run_events_endpoint.py` + `test_harness_boundary.py`(**不用全量**:本机全量有 155 条环境红)。

**交付判据:** 加性字段可读;既有响应字段零变化;`ruff check`/`format --check` 干净。 **✅ 达成。**

## Task 2: 前端数据层 `core/run-status/`

**Files:** Create `frontend/src/core/run-status/{types,classify,parse,hooks}.ts`、`frontend/tests/unit/core/run-status/{classify,parse}.test.ts`

- [x] **Step 1(RED —— 两个纯函数的测试)**:
  - `classify.test.ts`:**逐类各一条** —— `{status:409}`→占用类;`{status:400}`→配置类;`{status:404}`→环境类;`{status:503}`→**模式不匹配类**(§5.1);`{status:422}`/`{status:501}`→**不呈现**(两者都是前端 bug,已裁);`{status:"error"}`/`{status:"timeout"}`→运行期失败;`{status:"interrupted"}`→被停止;`{status:"success"}`→**不呈现**;`{status:"running"|"pending"}`→**不呈现**(还没结局)。**未知状态码/未知 status 一律落到"不呈现"而不是猜**(与快照/交付两条线同一条纪律)。
  - `parse.test.ts`:`parseRunOutcome(row)` 逐字段重建 —— 有 `error` 时读出、没有时为 `null`;`stop_reason` 有则读;未知字段丢弃;`status` 缺失 → 返回 `null`。
- [x] **Step 2**:`types.ts` —— `RunOutcome`(从 `RunResponse` 投影:`status` / `stop_reason` / `error`)+ `FailureKind` + 动作键。**注意:本步原文漏了 `modeMismatch`**(Step 1 与 Task 4 Step 3 都要求它),已按那两处补进 `FAILURE_KINDS`,并另导出 `PRESENTED_KINDS`(Task 4 的 guard 对账对象)。
- [x] **Step 3**:`classify.ts` —— **纯函数,零依赖**:`classifyRunOutcome(outcome)` 与 `classifyStartFailure(httpStatus)`(**两个入口**,因为两个方向的输入不同)。**这是本项唯一有判断逻辑的地方。** 查表用 `Map` 而非对象字面量:status 来自线上,`Record<string,...>["constructor"]` 会返回 Object 构造函数(会当 verdict 用),原型键不该能供货。
- [x] **Step 4**:`parse.ts` —— 逐字段重建(手法同 `core/constitution/parse.ts` 与 `core/delivery/parse.ts`)。
- [x] **Step 5**:`hooks.ts` —— `useRunOutcome`:走既有 `useRunDetail` 那类查询(`(threadId, runId)` 维度、`staleTime: Infinity`、同线程 `placeholderData`);`status` 还是 `running` 时**不判定**(由 Step 1 的 `none` 承担)。**两处按邻居收紧**:入参用 options bag(与 `useDelivery`/`useWorkspaceChanges` 同形,并给出 `enabled` 供调用方在 run 在飞时关掉——`staleTime: Infinity` 会把 mid-run 的 `running` 冻住);返回值 = `{ outcome, kind, action }`(Task 5 的组件要 kind/action,详情行要 `error` 原文)。
- [x] **Step 6**:转绿 + `pnpm check`。**测试 15 绿、eslint 0、prettier 干净;`pnpm check` 复跑 exit 0**(中间被一个坏掉的生成物挡过一次,非本项引入,见交付纪要)。
- [x] **Step 7(revert 证明)**:三刀都有牙(见交付纪要)。

**交付判据:** 两个纯函数测试全绿(node project);`pnpm check` 干净;**模块不 import React**(`hooks.ts` 除外——它只 import `useQuery`,不 import React 本身)。 **✅ 达成。**

## Task 3: pre-stream 分类入口(读 `error.status`)

**Files:** Create `frontend/src/core/run-status/start-failure.ts` + 单测;Modify `frontend/src/core/threads/hooks.ts`(run 创建失败那条路径)

- [ ] **Step 1(RED)**:`start-failure.test.ts` —— `describeStartFailure(error)` 对**真实形状**分类:① `HTTPError` 带 `.status = 409` → 占用类;② `.status = 400` → 配置类;③ `.status = 404` → 环境类;④ `.status = 422` → `none`(不呈现);⑤ 无 `.status` 的普通 Error → 兜底(见 Step 3);⑥ `null`/字符串 → 兜底。
- [ ] **Step 2**:实现 `describeStartFailure(error)`:**先读 `error.status`**(`HTTPError.status`),再读 `error.text` 拿原始 body(便于控制台),两者都没有才退回消息文本。**不做字符串匹配分类**——spec 明确否掉"按自由文本猜"。
- [ ] **Step 3(与既有行为共存,spec §8 风险 6)**:`hooks.ts:2413` 那条 run 创建失败的路径改为**同时**产出 `{kind, message}`;`getStreamErrorMessage` 的**行为不改**(另外 3 个调用点依赖它总能返回一句话)。
- [ ] **Step 4**:pre-stream 的**短命记录**:提交时记本次提交、失败时把 `{kind, message}` 挂到那条**用户消息**上,开始流式后清掉。**待裁(小口子)**:放页面 state 还是 `sessionStorage`(刷新后是否还该看到上次那条失败)——**实现前问一次**,默认页面 state(刷新即消失)。
- [ ] **Step 5**:转绿 + `pnpm check`。
- [ ] **Step 6(revert 证明)**:把"读 `error.status`"改成"只读 message" → 前三条例红。

**交付判据:** 分类只依赖结构化字段(测试里**不含**"按文案匹配"的用例);既有 toast 行为不变(有断言或手工确认)。

## Task 4: 文案落盘 + 两处 guard

**Files:** Create `frontend/src/core/run-status/run-status-i18n-keys.json`、`backend/tests/test_run_status_i18n_keys.py`、`frontend/tests/unit/core/run-status/i18n-keys.test.ts`;Modify `frontend/src/core/i18n/locales/{zh-CN,en-US,types}.ts`

- [ ] **Step 0(前置,硬)**:spec §5 那 **7 条已批**(2026-09-12,含补批的 `runOutcome.modeMismatch`)。落盘 7 条,照抄 spec,**零改写**。
- [ ] **Step 1(RED)**:写清单(嵌套形状,`kinds` 列出**会被呈现**的类别)+ 前端 guard(复用 `tests/unit/support/i18n-key-manifest.ts`,Task 1 交付层已抽出)+ 后端 guard。**先确认红。**
- [ ] **Step 2**:`types.ts` 加 `runOutcome` 块;两份 locale 填文案(照抄 spec,**零改写**)。
- [ ] **Step 3**:后端 guard 的对账对象:断言清单的 `kinds` 集合 == **`FailureKind` 里"会被呈现"的那几个**(`occupied` / `config` / `environment` / `modeMismatch` / `runFailed` / `stopped`;**不含** `422`/`501` 那一档)。**前端类型在后端读不到**,所以退一步:**断言清单与前端 `classify.ts` 导出的 `PRESENTED_KINDS` 常量逐项相等**(后端读前端源文件有先例 `test_constitution_i18n_keys.py`)。**这是本任务唯一有实质内容的跨端断言。**
- [ ] **Step 4**:转绿 + `pnpm check` + `ruff`。
- [ ] **Step 5(revert 证明)**:删一条 locale key → 正向红;加一条孤儿 → 反向红;给清单加一个不该呈现的类别 → 后端红。

**交付判据:** 两处 guard 绿且各自有牙;文案逐字等于 spec;清单是 `PRESENTED_KINDS` 的镜像。

## Task 5: 组件 + 两处锚点接线

**Files:** Create `frontend/src/components/workspace/run-status/{run-status-badge,run-status-notice}.tsx` + `.dom.test.tsx`;Modify `frontend/src/components/workspace/messages/{message-list,message-list-item}.tsx` 与 `frontend/src/core/messages/`(新增 pre-stream 锚点取法)

- [ ] **Step 1(RED —— 锚点取法,纯函数优先)**:新取法 `getStartFailureAnchorGroupIndices(groups)` —— "本轮最后一条 `human` 且其后没有任何 assistant/tool 消息"。**纯函数 + 单测**(spec §8 风险 2:不要在渲染处内联判断)。用例:① 只有 human → 命中;② human 后跟了 assistant → 不命中;③ 多条 human 时取最后一条;④ 空列表 → 空。
- [ ] **Step 2(RED —— 徽标)**:`run-status-badge.dom.test.tsx` —— `error`/`timeout`/`interrupted` 各渲染徽标且文案逐字;**`success`/`running` 不渲染**。
- [ ] **Step 3(RED —— 失败条)**:`run-status-notice.dom.test.tsx` —— 占用类/配置类/环境类/运行期失败各一条,断言**文案逐字 + 动作可见 + 色调**(醒目 vs 中性);`422` 与 `success` **整块不渲染**。
- [ ] **Step 4**:实现两个组件。**复用现成的色调词汇**(`text-muted-foreground` / `text-destructive`,`eval-run-banner` 是现成先例),不发明新色。动作是**按钮/链接**,不是纯文字。
- [ ] **Step 5**:接线两处锚点:post-stream 挂 `MessageListItem`(与 `WorkspaceChangeBadge` **同一位置**);pre-stream 挂 `MessageList`(按 Step 1 的取法)。
- [ ] **Step 6**:转绿 + `pnpm test`(全量)+ `pnpm check` + `pnpm format`。
- [ ] **Step 7(revert 证明)**:把 `success` 也渲染徽标 → 对应用例红;把 pre-stream 锚点取法的"其后无 assistant"条件去掉 → 对应用例红。

**交付判据:** 三个 dom 测试全绿;`success` 零呈现(不产生任何新节点);与交付那一行**同锚点不抢位**(手工在真栈上确认一次)。

## Task 6: 真栈验收 + 文档 + 收尾

**Files:** Modify `frontend/AGENTS.md`、`docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md`(§12 两项标交付)、本 plan(交付纪要)

- [ ] **Step 1(真栈,四条腿)**:私有 `:8099` + `DEER_FLOW_AUTH_DISABLED=1`,前端**只设** `DEER_FLOW_INTERNAL_GATEWAY_BASE_URL`(**不设 `NEXT_PUBLIC_*`**);真浏览器 `chromium.launch({ channel: "chrome" })`。
  - **腿一(占用类)**:一条 run 在跑时再发一条 → 内联出现**占用类**文案 + "停掉它"动作;且那条 409 **不再只靠 toast**。
  - **腿二(配置类)**:`context.model_name` 填不在 allowlist 的名字 → **配置类**文案 + 去改模型。
  - **腿三(运行期失败)**:让 agent 产出但不交出(交付那条现成路径)→ **run 的 error + 交付的醒目行同锚点相邻出现**,且 `error` 文案**确实来自后端**(Task 1 的字段)。
  - **腿四(被停止)**:按停止 → **"已停止"**中性徽标;且 `success` 的 run **不出现任何徽标**。
- [ ] **Step 2**:`frontend/AGENTS.md` 记:两段式锚点(哪个锚点用在哪)、`HTTPError.status` 是 pre-stream 的分类依据、**不要改 `getStreamErrorMessage` 的既有行为**、`success` 零呈现。
- [ ] **Step 3**:回写一期 spec §12 第 4/5 项为已交付;本 plan 末尾交付纪要(逐 Task 记 hash 与实测数字)。
- [ ] **Step 4**:按冻结信息提交(**不推送**);`git status` 确认只含本线文件。**2026-09-12 复核更正**:原写"工作树里有宠物线在飞改动"——**已不成立**,宠物线(含 2b 的 `think`)已于 `f1e92de0` 等提交落地,`git status` 里 **0 个** pet 路径。当前工作树 = 本线 4 个文件(2 代码 + 2 文档)**+ 4 份与本线无关的未跟踪 docs**(`AGENT_HARNESS_VISUALIZATION_RESEARCH.md` / `COMMUNITY_DETECTION_RESEARCH.md` / `HARNESS_EXECUTION_FLOW_MAP.md` / `plans/2026-09-11-local-knowledge-base-rfc-draft.md`)⇒ **仍要显式列路径,但那 4 份 docs 不属本线,不要顺手 add**。

**交付判据:** 四条腿全过;**任一不过:不提交**,记为开放项。

---

## 依赖排序

```
Task 0 ✅ ─→ Task 1(后端字段) ─┐
                                ├─→ Task 5(组件+接线) ─→ Task 6(验收)
Task 2(数据层) ─→ Task 3(pre-stream) ─┘
                     ↑
        Task 4(文案+guard, 需用户先批文案)
```

Task 1 与 Task 2 相互独立;Task 3 依赖 2;Task 4 依赖 2(清单要镜像 `PRESENTED_KINDS`);Task 5 依赖 1+3+4;Task 6 依赖全部。
**可先落的那半**:pre-stream(Task 2+3+4+5 的 pre-stream 部分)不依赖 Task 1。

## 交付纪要

### Task 0(探针)— 已提交 `b9c9938f`

见上方 Task 0 与 spec §3.3/§7。

### Task 1(后端加性字段)— 2026-09-12,**已提交 `e2ad45b0`**（4 文件 / +111 −19；代码仅 +2 行）

**改动**:`backend/app/gateway/routers/thread_runs.py` 两处(`RunResponse` 加 `error: str | None = None`;`_record_to_response` 加 `error=record.error`)+ `backend/tests/test_gateway_run_recovery.py` 两条新用例。

| 项 | 实测 |
|---|---|
| 新增用例 | **2** 条:`test_run_detail_exposes_error_reason`、`test_run_detail_reports_no_error_for_successful_run` |
| RED | 2 failed / 5 deselected —— 两条都 `KeyError: 'error'`(键不存在,非断言写错) |
| GREEN | 本文件 **7 passed**;窄集合(**5 文件**)**44 passed** |
| 门禁 | `ruff check` **All checks passed**;`ruff format --check` **2 files already formatted** |

**revert proof(两刀,都有牙)**

| neuter | 结果 |
|---|---|
| `error=record.error` → `error=None` | `..._exposes_error_reason` **红**;`..._no_error_for_successful_run` **绿**(它只钉默认值,符合预期) |
| `error=record.error` → `error=record.error or ""` | `..._no_error_for_successful_run` **红**(证明第二条不是哑的:`None` 与空串真的被区分开) |

两刀均已原样恢复并复跑,上表 GREEN 数字是恢复后的实测。

**§8 风险 4(暴露面)结论 —— 已就地定案,不改代码:**
run 的 `error` 字符串**今天已经在 API 上暴露**:`POST /api/runs/wait` 返回 `{"status": ..., "error": record.error}`(`routers/runs.py:89`),管理台 `console.py:414` 也返回 `row.error` 的截断。本字段只是把**同一份数据**补到**同一个 owner 作用域**的 `GET /threads/{tid}/runs/{rid}`(该路由带 `runs:read` + `owner_check=True`)。⇒ 它改变的是"在哪读得到",不是"读到的是什么",**不引入新的敏感数据类别**。
残余(已知,不在本 Task 范围):worker 的兜底 `except Exception as exc: error = f"{exc}"`(`runtime/runs/worker.py:1075-1077`)会写入任意异常文本;若将来要收窄,改动点在**写入侧**(worker),而不是这个读投影。其余写入点都是固定文案:`STARTUP_ORPHAN_RECOVERY_ERROR`、`LEASE_ORPHAN_RECOVERY_ERROR`、`_DELIVERY_INCOMPLETE_ERROR`、`"Rolled back by user"`、takeover 固定串。

**偏离原计划(诚实记录):** 计划写的是"在**既有**终态路径测试里加断言"。实际该文件既有的两个用例是 lifespan 级 `_FakeRunManager` 桩,没有 HTTP 面(`reconcile_calls` 断言,不经过路由),无法承载"经 GET 能拿到"这一断言。故**新增两条 TestClient 用例**,复用既有的 `_router_auth_helpers.make_authed_test_app` 机具(与 `test_thread_run_query_validation.py` 同款)。落点仍是计划指定的文件。

**契约/文档同步:** 无需。`backend/docs/API.md` 不列 run 响应字段,`contracts/` 下只有 `subagent_status_contract.json` 提到 `stop_reason`,均不 pin `RunResponse` 的字段表(已 grep 确认)。

**下一步**:**Task 1 已按用户指示单提为 `e2ad45b0`**(2026-09-12,含两个代码文件 + spec/plan 的文案批准与本次交付纪要)。Task 2(前端数据层)不依赖本 Task,可独立开。

### Task 2(前端数据层 `core/run-status/`)— 2026-09-12,代码就绪,**未提交**

**改动**:新建 `frontend/src/core/run-status/{types,classify,parse,hooks}.ts` + `frontend/tests/unit/core/run-status/{classify,parse}.test.ts`。

| 项 | 实测 |
|---|---|
| 新增用例 | **15**(`classify.test.ts` 11 + `parse.test.ts` 4),全在 node project(非 dom) |
| RED | 2 failed / 0 tests —— 两条都是 `Cannot find module '@/core/run-status/...'`(模块不存在) |
| GREEN | 2 files passed / **15 passed** |
| eslint | `pnpm lint` **exit 0** |
| prettier | 6 个新文件全 `use Prettier code style!`;**全为 LF**(避开本仓的 autocrlf 陷阱);`parse.test.ts` 一处长行按 prettier 折行后复检通过 |
| tsc | 初跑未过(坏掉的生成物,见下);**重启 dev server 后 `pnpm check` 复跑 exit 0** |

**revert proof(三刀,各自命中,无溢出)**

| neuter | 结果 |
|---|---|
| `classifyRunOutcome` 未知 status 的兜底 `?? NOTHING` → `?? {kind:"runFailed",action:"inspect"}` | 恰好 **1 红**(`classifyRunOutcome > shows nothing for a status it does not know...`),14 绿 |
| `[422, NOTHING]` → `[422, {kind:"config",action:"configure"}]` | `shows nothing for the two frontend-bug statuses` **红** |
| `classifyStartFailure` 兜底 `?? NOTHING` → `?? {kind:"occupied",action:"stop"}` | `shows nothing for a status it does not know` **红** |

第三刀是计划外的:计划只点名了前两刀,但前两刀都只压 `ended` 那一侧,`classifyStartFailure` 的兜底就没有任何用例压着它了 —— 补上后它同样有牙。两刀同跑时恰好 2 红,互不干扰,可逐条归因。恢复后复跑 15 绿,`grep NEUTER` 零残留。

**曾出现的环境红(非本项引入,同日已解决):`pnpm check` 的 tsc 步。**
- 全部 5 条错误都在 `frontend/.next/dev/types/routes.d.ts`( **gitignored 的生成物**),第 117 行是 `r route handlers`(被写坏/错接),mtime 就是刚才。
- 成因:用户的 `next dev --turbo` **正在跑**(:3000,PID 38668/38556),该文件由它生成;这是一次撕裂写。**本项改动不涉及它**。
- 本项代码**类型是干净的**:全项目 tsc 跑过,诊断只出现在那一个文件里,`src/core/run-status/*` 与两个测试文件**零诊断**。
- 为什么不能绕开:`next-env.d.ts` 有 `import "./.next/dev/types/routes.d.ts"`,所以它必被拉进编译;我试过用临时 tsconfig 把 `.next` 排除,仍被该 import 引入(临时文件已删)。
- **处置(用户裁 `重启 dev server`,2026-09-12 20:31)**:用户重启后 Next 重写该文件(新 md5 `1557a774…`,第 117 行恢复正常)⇒ 复跑 `pnpm check` **exit 0**。按纪律没去动用户 dev server 的产物(删文件是错的:文件缺失会让 `next-env.d.ts` 报"找不到模块",更糟)。
- 当时的旁证(临时 tsconfig 排除 `.next`,已删)只证明"我的文件干净";最终结论由 `pnpm check` 本身复跑确证。

**偏离原计划(诚实记录):**
① **`FailureKind` 补了 `modeMismatch`** —— Step 2 的枚举漏了它,而 Step 1 与 Task 4 Step 3 都要求这一档;按那两处为准。
② **`useRunOutcome` 入参改成 options bag**(`{threadId, runId, enabled}`),不再按 Step 5 的字面 `(threadId, runId)` —— 与紧邻的 `useDelivery` / `useWorkspaceChanges` 同形,且 `enabled` 是必需的:查询是 `staleTime: Infinity`,调用方若在 run 在飞时读一次,`running` 会被永久冻住、真实结局再也判不出来。
③ **`useRunOutcome` 返回 `{outcome, kind, action}`** 而不是裸 `RunOutcome` —— Task 5 的两个组件要 kind/action,详情行要 `error` 原文,一次给全,组件不用自己再调 classify。
④ **查表用 `Map` 而非对象字面量** —— `status` 来自线上,对象字面量会对 `"constructor"` 这类键返回 Object 构造函数并被当成 verdict。这是本仓已有的一类防护(见 clarification 字段/`__proto__` 的既有守卫)。
