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

**Files:** Modify `backend/app/gateway/routers/thread_runs.py`;Modify 既有终态路径测试(见 Step 3)

- [ ] **Step 1(RED)**:在既有终态路径测试里加断言——一个**真的以 error 收尾**的 run,经 `GET /threads/{tid}/runs/{rid}` 能拿到那条消息。首选落点:`tests/test_gateway_run_recovery.py`(它的 `orphan_recovered` 路径**确实会写 `error`**);交付未达标那条(`_DELIVERY_INCOMPLETE_ERROR`)是同类。**今天必红**(响应没有 `error` 键)。
- [ ] **Step 2**:`RunResponse`(`:150-168`)加 `error: str | None = None`;构造点(`:266-284`)加 `error=record.error`。**纯加性**——既有字段一个不动、`stop_reason` 保持原样。
- [ ] **Step 3(GREEN)**:Step 1 那条例绿;并补一条**未失败时是 `None`**(别把 `None` 和空串混起来)。
- [ ] **Step 4(安全面过一遍,spec §8 风险 4)**:确认这几类 `error`(交付固定文案 / `on_chain_error` 的 `str(error)`)**不会带 prompt 或 tool 输出**;若有风险,在本步就地记录并缩小暴露面(而不是留给"以后注意")。
- [ ] **Step 5**:窄集合门禁(见下方)+ `ruff`。
- [ ] **Step 6(revert 证明)**:把 `error=record.error` 去掉 → Step 1 转红,Step 3 那条(未失败为 `None`)保持绿。

**窄集合门禁:** `test_gateway_run_recovery.py` + `test_run_worker_delivery.py` + `test_thread_run_query_validation.py` + `test_run_events_endpoint.py` + `test_harness_boundary.py`(**不用全量**:本机全量有 155 条环境红)。

**交付判据:** 加性字段可读;既有响应字段零变化;`ruff check`/`format --check` 干净。

## Task 2: 前端数据层 `core/run-status/`

**Files:** Create `frontend/src/core/run-status/{types,classify,parse,hooks}.ts`、`frontend/tests/unit/core/run-status/{classify,parse}.test.ts`

- [ ] **Step 1(RED —— 两个纯函数的测试)**:
  - `classify.test.ts`:**逐类各一条** —— `{status:409}`→占用类;`{status:400}`/`{status:501}`→配置类;`{status:404}`/`{status:503}`→环境类;`{status:422}`→按已裁**返回"不呈现"**;`{status:"error"}`→运行期失败;`{status:"timeout"}`→运行期失败;`{status:"interrupted"}`→被停止;`{status:"success"}`→**不呈现**;`{status:"running"|"pending"}`→**不呈现**(还没结局)。**未知状态码/未知 status 一律落到"不呈现"而不是猜**(与快照/交付两条线同一条纪律)。
  - `parse.test.ts`:`parseRunOutcome(row)` 逐字段重建 —— 有 `error` 时读出、没有时为 `null`;`stop_reason` 有则读;未知字段丢弃;`status` 缺失 → 返回 `null`。
- [ ] **Step 2**:`types.ts` —— `RunOutcome`(从 `RunResponse` 投影:`status` / `stop_reason` / `error`)+ `FailureKind`(`occupied` / `config` / `environment` / `runFailed` / `stopped` / `none`)+ 动作键。
- [ ] **Step 3**:`classify.ts` —— **纯函数,零依赖**:`classifyRunOutcome(outcome)` 与 `classifyStartFailure(httpStatus)`(**两个入口**,因为两个方向的输入不同)。**这是本项唯一有判断逻辑的地方。**
- [ ] **Step 4**:`parse.ts` —— 逐字段重建(手法同 `core/constitution/parse.ts` 与 `core/delivery/parse.ts`)。
- [ ] **Step 5**:`hooks.ts` —— `useRunOutcome(threadId, runId)`:走既有 `useRunDetail` 那类查询(`(threadId, runId)` 维度、`staleTime: Infinity`、同线程 `placeholderData`);`status` 还是 `running` 时**不判定**(见 Step 1)。
- [ ] **Step 6**:转绿 + `pnpm check`。
- [ ] **Step 7(revert 证明)**:把"未知 status 落到不呈现"改成"落到运行期失败" → 对应用例红;把 `422` 改成呈现 → 对应用例红。

**交付判据:** 两个纯函数测试全绿(node project);`pnpm check` 干净;模块**不 import React**(`hooks.ts` 除外)。

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

- [ ] **Step 0(前置,硬)**:spec §5 那 6 条文案**先拿用户批**(命名空间 `runOutcome.*`),批完再落盘。**未批不动这一步。**
- [ ] **Step 1(RED)**:写清单(嵌套形状,`kinds` 列出**会被呈现**的类别)+ 前端 guard(复用 `tests/unit/support/i18n-key-manifest.ts`,Task 1 交付层已抽出)+ 后端 guard。**先确认红。**
- [ ] **Step 2**:`types.ts` 加 `runOutcome` 块;两份 locale 填文案(照抄 spec,**零改写**)。
- [ ] **Step 3**:后端 guard 的对账对象:断言清单的 `kinds` 集合 == **`FailureKind` 里"会被呈现"的那几个**——**但前端类型在后端读不到**,所以退一步:**断言清单与前端 `classify.ts` 里导出的 `PRESENTED_KINDS` 常量逐项相等**(后端读前端源文件有先例 `test/constitution_i18n_keys.py`)。**这是本任务唯一有实质内容的跨端断言。**
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
- [ ] **Step 4**:按冻结信息提交(**不推送**);`git status` 确认只含本线文件(工作树里有宠物线在飞改动,**只 add 自己的**)。

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

## 交付纪要(待填)

_(Task 0 见上;Task 1–6 完成后逐条回写)_
