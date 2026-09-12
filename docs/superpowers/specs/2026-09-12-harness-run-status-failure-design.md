# 运行状态与失败呈现(⑤ + ④⑥)— 设计文档

- 日期:2026-09-12
- 分支:沿用 `feat/rag-knowledge-base`
- 上游:构成快照 spec `2026-09-10-harness-constitution-snapshot-design.md` **§12 第 4 项(⑤ 状态机外框)** 与 **第 5 项(④⑥ 失败类型化)**
- 相邻:交付层 spec `2026-09-12-harness-delivery-layer-design.md`(它的 §8 把"失败呈现"这片地交给了本项)

## 1. 目标与范围,以及为什么是**一份** spec

**这两项合并成一份,不是省事,是上游 spec 自己写的硬约束**:§12 第 5 项末尾写着"**与第 4 项共用呈现位**:第 4 项讲'run 怎么结束的',本项讲'run 为什么没开始 / 没跑完'。**两者必须落在同一个位置、同一套视觉语言**,否则用户会看到两种不同的失败样式。" 分开写两份 spec,就是把刚在两处修过的"同一件事分裂两处"(构成视图的 `extension` 带、交付层的两种卡)再种回去。

**要解决的问题(用户原话的场景)**:今天一次失败的 run,用户看到的是一条**会消失、无归属、无操作**的 toast,而三类可行动性完全不同的失败共用它:

| 失败 | 用户该做什么 | 今天 |
|---|---|---|
| 一线程一活跃 run 冲突(409) | **等上一个跑完 / 停掉它** | 同一句 toast |
| 模型不在 allowlist(400) | **改配置或换模型** | 同一句 toast |
| run 跑起来了然后失败(如交付未达标) | **看它产出了什么** | 同一句 toast,**而且那条 error 消息连 API 都取不到**(见 §3) |

**本期做**:把 run 的终态(⑤)与"为什么没开始 / 没跑完"(④⑥)做成**同一种**内联呈现:持久、挂在它所属的那一轮、带一个可执行的动作,并按失败类别给出不同的下一步。

**本期不做**:改任何失败的产生逻辑;补全所有失败类别的文案;把 toast 完全撤掉(见 §8 风险 3)。

## 2. ⚠️ 三个待裁点(先摊开,不替你决定)

### D1 落点:失败/终态呈现在哪里?

| | 方案 | 代价 | 得到的 |
|---|---|---|---|
| **A** | 全部挂在**触发它的那条用户消息**上(一个锚点) | 跑挂了也回到用户消息处,而那时用户视线在**回复**上 | 锚点最简单,pre-stream 也有地方放 |
| **B** | **两段式**:没跑起来 → 挂用户消息;**跑起来了然后失败 → 挂该 run 最后一条 assistant 气泡**(两个锚点) | 两个锚点,多一处解析 | 符合 `frontend/AGENTS.md` 既有的 **run 作用域显示约定**(与 workspace-change 卡、交付那一行同一个位置) |
| **C** | 不内联:做一个**头部栏的运行状态指示**(与构成触发器同簇),失败时展开 | 头部是 chrome,而"这次没跑成"是**对话内容**;且与构成触发器抢位置 | 不用碰消息列表 |

**我推荐 B**,理由不只是"符合约定":**交付层那一行已经在 run 的最后一条 assistant 气泡上**。选 B 之后,"产出了却没交出"(交付的 `not_started` 醒目行)与"这次 run 为什么是 error"会**落在同一处**——这正是交付层 spec §8 提出却无法验证的那条要求("界面说的与后端说的要对得上")。选 A 或 C 会让它们分居两地。

### D2 失败的"为什么"从哪来?(**2026-09-12 Task 0 探针后已定**)

**结论:两个方向分开取,不是一条路包打两头。**

| 方向 | 取法 | 后端改动 | 依据 |
|---|---|---|---|
| **pre-stream**(run 没建起来) | **前端读抛出的 `HTTPError.status`**(`error.status`,body 在 `error.text`) | **零** | 探针实测:400 与 409 都带着 `status` 抛到调用方(§3.3) |
| **post-stream**(跑起来之后失败) | **后端把 `error` 暴露到 `RunResponse`**(加性字段,`stop_reason` 是现成先例) | 一个加性字段 + 契约/文档同步 | post-stream **今天没有任何字段承载原因**(§3.1 实测) |

**被探针否掉的两个方案,记下来免得重提:**

- **✗ 接 `onFailedResponseHook`**:该 hook 在 `onFailedAttempt` 里被调用(`async_caller.js:92-93`),而 `STATUS_NO_RETRY = [400,401,402,403,404,405,406,407,408,409,422]`(`:6-20`)**先 `throw error`** ⇒ **本项关心的每一个状态码都到不了 hook**。探针实测 hook 命中 0 次,这不是"路径不通",是它对这些码**永不触发**。
- **✗ 只做前端、post-stream 用 `run.error.metadata.error_type`**:`error_type` 是**异常类名**不是 reason;且"状态级失败"(如交付未达标)**连事件都不发** ⇒ 看不见原因。

> **为什么 pre-stream 不也让后端给结构化 reason**:那要前端先按状态码分类才能知道该读哪个字段,等于用后端字段解决一个前端已经能解决的事。**后端只在"信息确实不存在"的那一半补。**

### D3 形态:失败条还是状态徽标?

| | 方案 | 得到的 |
|---|---|---|
| **A** | **一条内联的失败条**:图标 + 一句人话 + **一个动作**(等/停 · 改配置 · 换模型) | 与用户原始痛点对齐——"无操作"是被点名的那一半 |
| **B** | 只做**状态徽标**(error / timeout / interrupted),无动作 | 成本最低,但仍要用户自己想下一步 |

**采纳 A + B**:徽标负责"这次是什么结局"(⑤,一眼可扫),失败条负责"为什么、怎么办"(④⑥,展开才看)。`success` 不挂任何东西——一次顺利的 run 不需要徽标,那是噪声。

## 3. 已核实的前提(2026-09-12 代码核查,带行号)

### 3.1 后端已经分好了类,但只在一个方向上有类型

**pre-stream 准入(run 根本没建起来)** —— `app/gateway/services/__init__.py`,**行号已复核未漂移**:

| 失败 | 状态码 | 位置 | `detail` |
|---|---|---|---|
| 请求体校验失败 | 422 | `:1074` / `:1082` | `str(exc)` |
| 模型不在 allowlist | 400 | `:1097-1104` | `Model {name!r} is not in the configured model allowlist` |
| thread 不存在 | 404 | `:1129` | `Thread {thread_id} not found` |
| **一线程一活跃 run 冲突** | **409** | `:1264`(`create_or_reject`,底层 `uq_runs_thread_active`) | `str(exc)` |
| 未实现的 SDK 选项 | 501 | `:1266` | `str(exc)` |
| checkpoint 模式不兼容 | 409 / 503 | `runtime/checkpoint_mode.py` 的两个错误类型(由 threads 路由转) | 带 cause 与 thread id |

**post-stream(run 跑起来之后)**:
- `run.error` 事件存在,但 payload 是 `content = str(error)` + **`metadata.error_type = 异常类名`**(`journal.py:377-380`)——**类名不是 reason**。
- **`RunResponse` 没有 `error` 字段**(`routers/thread_runs.py:150-168` 逐字段核过)。字段只有:`status` / `metadata` / `kwargs` / `stop_reason` / token 计数等。
- **实测**(交付层 Task 4,私有 `:8099`):一条因交付未达标而失败的 run,`status = "error"`,而**终态事件里只有 `run.end`(`metadata.status` 仍写 `success`,是已知缺口),没有任何 `run.error`** ⇒ **"为什么"在任何 API 上都取不到**。
- **`stop_reason` 是唯一已经暴露的"结局细节"**(`RunResponse.stop_reason`),`orphan_recovered` / `loop_capped` / `token_capped` / `turn_capped` 可读。

### 3.2 前端今天把这一切塌成一条会消失的 toast

- **唯一的失败呈现**是 `toast.error(getStreamErrorMessage(error))`(`core/threads/hooks.ts:1879`、`:2413`,另有 `:2213` / `:2732` 同类调用)。
- **`getStreamErrorMessage`(:1471-1489)只读文本**:依次尝试 `string` → `Error.message` → `.message` → `.error`(再 `.message` 或字符串),**完全不读 HTTP 状态码**,拿不到就落 `"Request failed."`。
- **`stop_reason` 在前端只有子代理侧消费者**(`core/tasks/subtask-result.ts`、`subtask-update.ts`),**run 级零消费者**——与构成快照 spec §12 第 4 项的记载一致。
- **没有类型化的 run 状态徽标**:页面只有 `thread.isLoading` / `thread.error` 两个内部态;`CancelOutcome` 与 `orphan_recovered` 在 `frontend/src` 零命中;停止按钮(`components/workspace/input-box.tsx`)不区分取消结果。
- **`stream_replay_gap` 是唯一被呈现的 run 级异常**:`core/api/api-client.ts` 发出内部自定义事件 → `hooks.ts:1808-1825` 全量重置 + `toast.warning`。

### 3.3 ⭐ 状态码其实**在手上**,是前端自己把它扔了(Task 0 探针实测,含一处我写错后的更正)

**探针结果**(私有 `:8099`,真实 400 与真实 409):

```
case 400 (model not in allowlist)
  caller saw: message="HTTP 400: {\"detail\":\"Model '...' is not in the configured model allowlist\"}"  status=400
case 409 (thread already has an active run)
  caller saw: message="HTTP 409: {\"detail\":\"Thread ... already has an active run\"}"  status=409
VERDICT: hook fired with a numeric status 0 time(s)
```

- **抛出的错误是 `HTTPError extends Error`,带 `.status` / `.text` / `.response`**(`dist/utils/async_caller.js:30-47`)。ok 检查在 **`AsyncCaller.fetch`**(`:106-109`,`res.ok ? res : Promise.reject(res)`),再在 `call` 的 catch 里被 `HTTPError.fromResponse` 转成上面这个类。**这两个字段就是 pre-stream 分类所需的全部信息。**
- **hook 命中 0 次不是"路径不通",是它对这些码永不触发**:hook 在 `onFailedAttempt` 里调用(`:92-93`),而 `STATUS_NO_RETRY = [400,401,402,403,404,405,406,407,408,409,422]`(`:6-20`)**先 `throw error`** ⇒ **本项关心的每一个状态码都到不了 hook**。
- **前端是"拿到了却扔掉"**:`sendMessage` 的 catch **就在错误对象手上**(`core/threads/hooks.ts:2413`),却只把它交给 `getStreamErrorMessage(error)`,而那个函数(`:1471-1489`)只读 `.message` ⇒ 用户看到整串 `HTTP 409: {"detail":...}`,而 `.status` 与 `.text` 被一个辅助函数丢掉。
- **`onFailedResponseHook` / `withResponse` 在本仓 `src/` 零使用**;客户端单例在 `core/api/api-client.ts:461-469` 构建——**本项也不需要它们**。

> **更正(2026-09-12)**:本节初稿写的是"前端拿不到状态码,是 SDK 的设计",依据是只读了 `client.fetch`(`dist/client.js:139-147`,那里确实不查 ok)而**没有往下读一层**到 `AsyncCaller.fetch`;随后又把自己探针里 hook 的 0 命中误读成"路径不通"。**两处都错。** 真实情况是:状态码一路抛到调用方,前端一个函数把它丢了。保留这段更正,是因为"读了一层就下结论"正是本线反复踩到的同一类错。

⇒ **结论(修正后)**:pre-stream 的类别信息**后端有、前端也有,只是前端在最后一跳丢掉了** ⇒ 修 `getStreamErrorMessage`／改读 `error.status` 属于本项范围,**零后端改动**。post-stream 的类别信息**后端确实没有**(§3.1)⇒ 只有那一半需要后端补。

### 3.4 run 的权威结局是 `RunRow.status`,不是 `run.end`

`RunStatus`(`runtime/runs/schemas.py:14-22`)六个取值:`pending` / `running` / `success` / `error` / `timeout` / `interrupted`。`run.end` **永远写 `success`**(契约 `known_gaps` 的 `terminal-run-status` 条目明写"run.end is only a root graph completion marker and always says success. `RunRow.status` is authoritative")。⇒ **⑤ 的数据源是 `RunRow.status`**(前端经 `GET /runs/{rid}` 已有 `useRunDetail`,但当前只被 `hooks.ts:3065-3075` 用在一个未渲染的场景),**不是** `run.end`。

## 4. 设计骨架(三条裁决均已采纳:D1-B / D2 分段 / D3-A+B)

> **采纳口径(2026-09-12)**:D1 落点为**推荐 B**(两段式);D2 为**分段取**(pre-stream 前端读 `error.status`,post-stream 后端补 `error` 字段);D3 为**推荐 A+B**(徽标 + 失败条)。凡下文标"待裁"的,是**需要你点头的小口子**,不是尚未决定的方向。

### 4.1 两个锚点,一条视觉语言

- **pre-stream 失败**(run 未创建):挂在**触发它的那条用户消息**上。
- **post-stream 终态**(error / timeout / interrupted):挂在**该 run 最后一条 assistant 气泡**上——与 `workspace-change` 卡、交付那一行**同一锚点**。
- 两者用**同一个组件**,只有"该显示哪几行"不同。

> 锚点规则不要新写:post-stream 那半复用既有约定(`core/messages/` 里已有的"run 最后一条 assistant 组"取法,`workspace-change-anchor.ts` 是它的现成实现;注意那里的 `assistant`-only 限制是承重的,文件头注释明写"do not unify the two helpers")。pre-stream 那半需要一个新取法:**本轮最后一条 `human` 消息**,且只在"这条之后没有出现任何 assistant/tool 消息"时才画(否则说明它其实跑起来了)。

### 4.2 类别 → 动作(判据按 D2 分段取)

**pre-stream:按 `HTTPError.status` 判**;**post-stream:按 `status` / `stop_reason` / `error` 判**。

| 类别 | 判据 | 呈现 | 动作 |
|---|---|---|---|
| **占用类** | 409(活跃 run 冲突 / checkpoint 模式不兼容) | 醒目 | **停掉正在跑的那个** / 按匹配模式重启 |
| **配置类** | 400(模型不在 allowlist)· 501(未实现选项) | 醒目 | 去改配置(给出目标:模型列表) |
| **环境类** | 404(thread 没了)· 503 | 中性偏醒目 | 回列表重开 |
| **请求体类** | 422 | 见下方待裁 | (通常前端 bug) |
| **运行期失败** | `status ∈ {error, timeout}`,用 `stop_reason`(如 `orphan_recovered`)与 `error` 细化 | 醒目 | 看它产出了什么(链到交付那一行/工作区变更) |
| **被停止** | `status = interrupted` | 中性 | 无(用户自己停的,只需确认) |
| **成功** | `status = success` | **不呈现** | — |

> **待裁(小口子,需你点头)**:`422` 通常是**前端 bug**、不是用户可行动项——**显示还是不显示**(我倾向:不显示面向用户的文案,只保留控制台可查)。
> **待裁(其二)**:`interrupted` 里"用户主动停"与"被新消息打断"能否区分**未核实**(`CancelOutcome` 未暴露为字段,§3.2);若不能,两句合成一句"已停止"。

### 4.3 数据层

新建 `frontend/src/core/run-status/`(与 `core/delivery/` 同构,薄一层):

- `types.ts`:`RunOutcome`(从 `RunResponse` 投影:`status` / `stop_reason` / `error?`)+ `FailureKind`(上表四类枚举)。
- `classify.ts`:**纯函数**,把"HTTP 状态码 / `status` / `stop_reason` / `error`"映射成 `FailureKind` + 动作键。**这是本项唯一有判断逻辑的地方,必须纯函数 + 单测**,因为它的输入来自三个不同的地方。
- `parse.ts`:`parseRunOutcome(row)`(逐字段重建,未知字段丢弃——与 `core/constitution/parse.ts` / `core/delivery/parse.ts` 同一手法)。
- `hooks.ts`:`useRunOutcome(threadId, runId)`(`staleTime: Infinity`:终态事实)。
- **pre-stream 失败进不来 hook**(那时没有 runId):它需要一个**页面级的短命记录**——提交时记住"这次提交",失败时把 `{category, message}` 挂到那条用户消息上,成功开始流式后清掉。**待裁**:这个记录放页面 state 还是 `sessionStorage`(刷新后是否还该看到上次那条失败)。

### 4.4 与交付层的边界(承接它的 §8)

交付那一行讲**投递事实**(产出几个/交出几个),本项讲**run 的结局与原因**。两者同锚点、不同行、不同数据源。**一条因交付未达标而 `error` 的 run,两行会同时出现**:交付行说"产出了 1 个,一个都没交出",本项的行说这次 run 是 error —— **这正是交付层 §8 要的"对得上",由同一个锚点保证**。

## 5. 文案(待批)

**先给最小集合(6 条 × 2)**,其余类别按同一句式补。命名空间 `runOutcome.*`,落三文件 + checked-in 清单 + 两处 guard(与 `delivery.*` / `constitution.*` 同一套机具)。

| key | zh-CN | en-US |
|---|---|---|
| `runOutcome.busy` | 这个会话已有一个任务在跑，等它结束或先停掉它 | This chat already has a run going — wait for it or stop it |
| `runOutcome.modelNotAllowed` | 当前模型不在允许列表里，换一个模型再试 | That model isn't in the allowed list — pick another |
| `runOutcome.threadGone` | 这个会话不存在了，回到列表重新开始 | This chat no longer exists — start again from the list |
| `runOutcome.runFailed` | 这次没跑完 | This run didn't finish |
| `runOutcome.runStopped` | 已停止 | Stopped |
| `runOutcome.details` | 看详情 | Details |

> `runOutcome.runFailed` 有意**不解释原因**:原因来自后端的 `error`(D2 落地后),原样展示属于"开发者档",面向用户的话由类别决定(与交付层 §8 的同一条纪律)。

## 6. 非目标

- **不改**任何失败的产生逻辑、状态码、`stop_reason` 语义。
- **不撤掉** `stream_replay_gap` 的现有 toast(它是流中断的自愈提示,语义不同)。
- **不做**历史 run 的失败回溯列表(那是 ⑤ 的另一个自然延伸,但不在本期)。
- **不重排**消息列表结构,只在既有锚点上加组件。

## 7. Task 0 探针(**已完成 —— 2026-09-12,结论见 §3.3**)

**问题**:失败在到达前端时,**带不带可判别的状态码**?`onFailedResponseHook` 在 run 路径上是否触发?

- **做法**:Node 直连私有 `:8099` 的 LangGraph 兼容端点,用 SDK 的 `Client`(配 `callerOptions.onFailedResponseHook` + `maxRetries: 0`),真实触发一个 **400**(`context.model_name` 填不在 allowlist 的名字)与一个 **409**(同一 thread 连发两个 run),记录:hook 是否被调用、调用方拿到的错误的类与字段、以及 `status` 是否可读。
- **结果**:两个失败**都带着 `status` 抛到调用方**(`HTTPError.status` = 400 / 409,body 在 `.text`);**hook 命中 0 次**。
- **判据与去向**:hook 的 0 命中**不代表路径不通**,而是它被 `STATUS_NO_RETRY` 短路(§3.3)——所以**两个方案都没按原计划走**:不接 hook,直接读 `error.status`;后端只补 post-stream 那一半。
- **收尾**:探针脚本用完即删、后端已停、`:8001` 未触碰。

## 8. 风险与开放项

1. **`interrupted` 与"被停止"的区分可能不完整**:`multitask_strategy="interrupt"` 会中断前一个 run,它的终态也是 `interrupted`——用户主动停 vs 被新消息打断,前端能否区分**未核实**(`CancelOutcome` 没暴露为字段,§3.2)。若不能,**待裁**:是否补。
2. **锚点解析的成本**:pre-stream 那半需要"本轮最后一条 human 且其后没有任何 assistant/tool 消息"的判定,而 `core/messages/` 的分组逻辑已经比较复杂(见 `frontend/AGENTS.md` 对 `MessageList` 的描述)。**实现时必须走纯函数 + 单测**,不要在渲染处内联判断。
3. **toast 与内联并存会重复**:内联出现后,同一条失败可能仍从 toast 冒出来。**待裁**:是保留 toast(瞬时可见 + 内联持久)、还是只留内联。我倾向**保留**——toast 在滚动位置不在锚点附近时仍有用。
4. **post-stream 的后端面需要评审**:把 `error` 暴露到 `RunResponse` 是加性字段,但它是"把失败原文交给前端",要考虑它是否可能含敏感内容(交付那条消息是固定文案,但 `on_chain_error` 的 `str(error)` 可能是任意异常文本)。**落地时必须过一遍"这几类 `error` 里会不会带 prompt/tool 输出"**。
5. **本项与 §12 第 6 项(实时脉冲)的分工**:脉冲讲"正在走到哪",本项讲"结局如何"。两者都在 run 作用域内,**若都选内联锚点,要注意不要互相抢位**(建议:脉冲在头部触发器上给一个小状态,本项在内联)。**待第 6 项时确认**。
6. **`getStreamErrorMessage` 是"丢信息"的那一跳,改它影响面不小**:它有 4 个调用点(`hooks.ts:1879` / `:2213` / `:2413` / `:2732`),其中只有 `:2413` 是 run 创建失败。**不要改动它的既有行为**(其他三处依赖"总能返回一句话"),而是**新增**一个能同时给出 `{kind, message}` 的解析入口,让 run 创建那条路径用它。

## 9. 依赖排序与规模

- **前置已完成**:Task 0 探针(§7)。本项与本线已交付的四项都不冲突。
- **形状**:**不是纯前端**——只需一个后端加性字段(post-stream 的 `error`),其余是前端(4 个模块 + 1 个组件 + 文案机具)。
- **可先落的那部分**:pre-stream 那半(D1-B + `error.status` 分类 + D3 的失败条)**完全独立**,可以先做并单独验收;post-stream 那半等那个加性字段。
