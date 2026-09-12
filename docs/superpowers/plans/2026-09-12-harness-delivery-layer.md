# 交付层(⑩ run.delivery)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已经存在、此前无人消费的终端交付回执 `run.delivery` 渲染成**既有文件卡上的一行**——成功时安静、不一致/未交出时同一行变醒目,回答"agent 说它产出了东西,到底有没有交到我手里"。

**Architecture:** 见 `../specs/2026-09-12-harness-delivery-layer-design.md`。数据来自 `GET /api/threads/{tid}/runs/{rid}/events?event_types=run.delivery`(Task 0 已把该类型补进契约/catalog/docs),走 `core/delivery/` 一层薄封装后交给 `WorkspaceChangeBadge` 里新增的一行。**不改锚点、不加卡、不入环、对 `constitution-*` 零改动**。

**Tech Stack:** 后端 Python 3.12(仅 Task 0 已完成的声明);前端 Next.js 16 / TS / Tailwind 4 / TanStack Query / Rstest(node + dom 两个 project)。

**前置(2026-09-12 已冻结)**:落点 **A+C**(并进文件卡一行,成功安静/失败醒目)、**不入环**、**先补声明再建 UI**、文案 3 条已批。全部已裁,本计划不再议。

**测试命令(全程统一):**
```bash
cd frontend && pnpm test            # 全量;单文件过滤:pnpm test "<路径片段>"
cd frontend && pnpm check           # eslint + tsc
cd frontend && pnpm format          # prettier(见下方"格式债"说明)
cd backend && PYTHONPATH=. .venv/Scripts/python.exe -m pytest tests/test_delivery_i18n_keys.py -q --basetemp .pytest-tmp -p no:cacheprovider
cd backend && .venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m ruff format --check .
```

**关键事实(已核实,行号见 spec §2):**
- **渲染开关是"有没有 `satisfied`",不是"有没有回执"**——`produced_paths` 为空时回执只有基础形状 `{presented:0,…}`,没有判定;这是多数 run 的形状。
- **`presented`(satisfied)只要求 `matched_paths` 非空** ⇒ `1/3` 也是成功态,文案**不写 "N/N"**。
- **`mismatched` = 交出了东西但没有一个覆盖本次产出**(交出的可能是旧文件)。
- **判定是后端算的,前端只读不算**:`matched_paths` 由产出快照与 `present_files` 归属两次独立观测交叉核对得出。
- **三个 store 的 content 往返都还原成对象**(db 打 `content_is_json` 并在读时反序列化)⇒ 前端不防御字符串;**`outputs` 类别不截断**(截断只作用于 `trace`)。
- **`WorkspaceChangeBadge` 由 `available && count > 0` 把关**,而产出判定与文件变更事件**共用同一个 `pre_run_workspace_snapshot` 与同一套排除目录** ⇒ 有判定时卡片本就可见。
- **本机格式债(既有,非本项)**:`pnpm format` 因 `core.autocrlf` 对全工作树报 CRLF;`tests/knowledge/tools/test_graph_search.py` 在 HEAD 就不过 `ruff format --check`。**判本项内容是否合规**用 spec 里那条"剥 CR 后与 prettier 输出比对、数字与 HEAD 相同"的方法。

---

## Task 0: 补声明(已完成)

- [x] `catalog.py` 新增 `RUN_DELIVERY_EVENT` + 自成一家 `DELIVERY_RUN_EVENT_DEFINITIONS` 并发布进 `FIXED_RUN_EVENT_DEFINITIONS`(不进 `JOURNAL_*`);契约 `events[]` 加条目(**两个形状都声明**)+ `categories.outputs` 描述扩写;`RUN_EVENT_STREAM.md` 补一段;契约测试 **7 条新增**。
- [x] 门禁:契约套件 55 passed、窄集合 248 passed、ruff 干净。**已提交 `bf7592f7`**。

## Task 1: 文案落盘 + 三处 guard

**Files:** Create `frontend/src/core/delivery/delivery-i18n-keys.json`、`backend/tests/test_delivery_i18n_keys.py`、`frontend/tests/unit/support/i18n-key-manifest.ts`(新目录)、`frontend/tests/unit/core/delivery/i18n-keys.test.ts`;Modify `frontend/src/core/i18n/locales/{zh-CN,en-US,types}.ts`、`frontend/tests/unit/core/constitution/i18n-keys.test.ts`(改用共享助手)

- [x] **Step 1(一处偏离 spec 表、先说明)**:键名**逐字对齐契约的 `stage` 枚举**——`delivery.presented` / `delivery.mismatched` / **`delivery.not_started`**(spec §6 表里写的是 `notStarted`)。**只改标识符,不改任何一条文案**;理由是 snake/camel 的对应关系会变成一张手写映射表,那正是上一条线里 `guard`→`gate` 那处**用词错位**的同一种病,而这里可以彻底消灭它(guard 变成集合相等,零映射)。spec §6 的表已就地更正并留痕。
- [x] **Step 2(RED)**:写 `delivery-i18n-keys.json`(嵌套形状:`{"stages": ["presented","mismatched","not_started"]}`);写前端 guard 与后端 guard,**先确认它们红**(缺 locale 键 / 缺后端对账)。
- [x] **Step 3**:把现有 `constitution` guard 的遍历逻辑抽到 `tests/unit/support/i18n-key-manifest.ts`(纯函数:`expectedPaths(manifest)` / `leafAt` / `collectLeafPaths` / 双向比对),`constitution` 那条测试改为 import 它(**行为不变**,跑一次确认仍绿)。
- [x] **Step 4**:新 guard `tests/unit/core/delivery/i18n-keys.test.ts`——同一套双向遍历(每个 key 在两份 locale 里非空、且无孤儿),并断言清单计数。
- [x] **Step 5**:`types.ts` 加 `delivery` 块(`presented` / `mismatched` / `not_started` 都是函数:参数数量与 spec §6 一致);`zh-CN.ts` / `en-US.ts` 填 3 条(照抄 spec §6,零改写)。
- [x] **Step 6**:后端 `test_delivery_i18n_keys.py`:用 `parents[2]` 读前端清单(先例 `test_compose_default_bind_host.py`),断言 **清单的 stages 集合 == 契约里 `run.delivery.content_schema.properties.stage.enum`**——这把前端文案和 Task 0 的声明钉在一起,是本项唯一有实质内容的跨端断言。
- [x] **Step 7**:转绿 + `pnpm check` + 后端 `ruff`。
- [x] **Step 8(revert 证明)**:①删 `zh-CN.ts` 一条 `delivery.*` → 前端正向缺键红;②给 `en-US.ts` 加一条孤儿 `delivery.*` → 反向红;③给清单加一个契约枚举里没有的 stage → **后端**红(证明那条跨端断言有牙,不是自说自话)。

**交付判据:** 两处 guard 绿且各自有牙;文案逐字等于 spec §6(标识符按 Step 1 调整);`constitution` 那条测试重构后行为不变。

## Task 2: 前端数据层

**Files:** Create `frontend/src/core/delivery/{types,parse,api,hooks}.ts`、`frontend/tests/unit/core/delivery/{parse,api}.test.ts`

- [x] **Step 1(RED —— 两个纯函数的测试)**:
  - `parse.test.ts`:基础形状(无判定)→ 判定为 `null`;**详细形状三个 stage 各一条**;半套判定字段(`stage` 有而 `satisfied` 无)→ 按**无判定**处理(**不能让 UI 渲染出一个悬空判定**);未知字段丢弃而不抛;`content` 不是对象 → `null`。
  - `api.test.ts`(照 `core/constitution/api.test.ts` 的 `rs.mock("@/core/api/fetcher")` 手法):回执**已存在** → 一次问成;**尚未落库 → 有界重问**(回执是 run 结束时写的,与构成快照同一类竞态);真的没有 → 到上限后放弃;500 → 抛。
- [x] **Step 2**:`types.ts` 镜像契约(基础字段必选、判定字段可选),**不含任何推导**;`parse.ts` 逐字段重建(与 `core/constitution/parse.ts` 同一手法)。
- [x] **Step 3**:`api.ts` 的 URL 与 `.constitution` 同形:events 端点 + `event_types=run.delivery`;**有界重问照抄那里的常量与注释理由**。
- [x] **Step 4**:`hooks.ts`:`useDelivery(threadId, runId)` —— `(threadId, runId)` 维度、`staleTime: Infinity`、`refetchOnWindowFocus: false`、同线程 `placeholderData`(终局事实,run 内不变)。
- [x] **Step 5**:转绿 + `pnpm check`。
- [x] **Step 6(revert 证明)**:把"半套判定"改成按有判定处理 → 对应用例红;把有界重问的循环去掉 → 重问那条例红。

**交付判据:** 两个测试文件全绿(node project,不进 dom);`pnpm check` 干净;`parse` 与 `api` 均无 React 依赖。

## Task 3: 文件卡上的那一行

**Files:** Create `frontend/tests/unit/components/workspace/changes/workspace-change-badge.dom.test.tsx`;Modify `frontend/src/components/workspace/changes/workspace-change-badge.tsx`

- [ ] **Step 1(RED —— DOM 测试,四个形态)**:①`satisfied` → **安静**行(断言色调类 + 图标)且文案**逐字**等于冻结值;②`mismatched` / `not_started` → **醒目**行;③**回执缺失 → 卡片照常渲染,只是没有那一行**(不能因为回执没到就把整张文件卡吞掉);④`available=false` 或 `count=0` → 卡片整体仍为 `null`(**门槛未被放宽**)。
- [ ] **Step 2**:在卡片的头部区之下、文件列表之上插那一行;`useDelivery(threadId, runId)` 与已有的 `useWorkspaceChanges` 并列调用;**不新增可点区域**(v1 是纯文本)。
- [ ] **Step 3**:`matched/produced` 用回执字段直接显示,**不做集合运算**;色调只由 `stage` 决定。
- [ ] **Step 4**:转绿 + `pnpm test`(全量)+ `pnpm check` + `pnpm format`。
- [ ] **Step 5(revert 证明)**:把安静/醒目两档色调对调 → ①的断言红;把"回执缺失就不渲染卡片"改成提前 `return null` → ③红。

**交付判据:** 四个形态全绿;全量 0 failed(除已登记的环境红);**不因判定放宽卡片门槛**这条由 ④ 钉住。

## Task 4: 真栈验收 + 文档 + 收尾

**Files:** Modify `frontend/AGENTS.md`(Interaction Ownership 增/并入一条)、`docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md`(§12 第 3 项标记交付)、本 plan(交付纪要)

- [ ] **Step 1(两条腿,各自都要真数据)**:私有 `:8099` + `DEER_FLOW_AUTH_DISABLED=1`,前端只设 `DEER_FLOW_INTERNAL_GATEWAY_BASE_URL`(**不设 `NEXT_PUBLIC_*`**,否则 `/api/*` 全 404);真浏览器用 `chromium.launch({ channel: "chrome" })` 驱动系统 Chrome。
  - **腿一(成功态)**:让 agent 产出一个 outputs 文件并用 `present_files` 交出来 → **安静行**,文案逐字一致。
  - **腿二(失败态)**:让它产出但**不交** → **醒目行**,且该 run 在后端以 `error` 收尾、`error` 字段含 `_DELIVERY_INCOMPLETE_ERROR` ——**界面上说的和后端说的是同一件事**,这是本项唯一要证明的因果。
  - 顺带确认:**回执缺失的 run(产出为空)不显示那一行,但文件卡仍在**。
- [ ] **Step 2**:`frontend/AGENTS.md` 记录:这一行**只陈述投递事实**,run 终态归 §12 第 4 项;以及"渲染开关是 `satisfied` 的存在"这条易错点。
- [ ] **Step 3**:回写 spec §12 第 3 项为已交付(含两处修正:不再是"零后端改动";`not_started` 标识符);本 plan 末尾交付纪要(逐 Task 记 hash 与实测数字)。
- [ ] **Step 4**:按冻结信息提交(**不推送**,沿用本线惯例);`git status` 确认只含本线文件(工作树里有宠物线的在飞改动,**只 add 自己的**)。

**交付判据:** 两条腿都过且失败态的界面与后端错误对得上;**任一不过:不提交**,记为开放项。

---

## 依赖排序

```
Task 0 ✅ ─→ Task 1(文案+guard) ─┐
                                  ├─→ Task 3(卡上一行) ─→ Task 4(验收)
            Task 2(数据层) ───────┘
```

Task 1 与 Task 2 相互独立、可并行;Task 3 依赖两者;Task 4 依赖全部。

## 交付纪要(待填)

### Task 1 — 已交付(2026-09-12):文案落盘 + 三处 guard

- **产物**:`core/delivery/delivery-i18n-keys.json`(清单,`stages` 三项)· `types.ts` 的 `delivery` 块 · `zh-CN.ts` / `en-US.ts` 各 3 条(照抄 spec §6,**文案零改写**)· 前端 guard `tests/unit/core/delivery/i18n-keys.test.ts` · 后端 guard `backend/tests/test_delivery_i18n_keys.py` · **共享助手** `tests/unit/support/i18n-key-manifest.ts`(新目录)。
- **一处重构(行为不变)**:把 constitution guard 的遍历逻辑抽进共享助手(点分路径 + 双向比对 + 函数叶子判定),`tests/unit/core/constitution/i18n-keys.test.ts` 改为 import 它——**抽完先跑一次确认 3 例仍绿**,再写 delivery 那条。清单的嵌套形状各自留在各自的测试里(constitution 是 `core`+`middlewares`,delivery 是平面的 `stages`)。
- **文案键的标识符修正**:第三条用 `delivery.not_started`,与契约 `stage` 枚举**逐字同名**(spec §6 已留痕,文案一字未改)。效果是后端那条对账变成**集合相等、零映射**。
- **GREEN**:`pnpm test core/delivery` 3 passed、`core/constitution` 6 passed;`pnpm check`(eslint + tsc)干净;新文件 `prettier --check` 通过;后端 `test_delivery_i18n_keys.py` + `test_constitution_i18n_keys.py` + 契约 + harness 边界 **60 passed**,`ruff check` 干净、新文件 `format --check` 通过。
- **revert 证明(三探针,全部先确认探针真的生效)**:①删 `zh-CN.ts` 的 `not_started` → `missing: ['not_started']`;②给 `en-US.ts` 加 `orphanProbe` → `orphans` 非空;③给清单加 `invented_stage` → **后端**红(证明那条跨端对账不是自说自话)。
  > **第一个探针差点是假的**:我最初用 shell 里的 python 内联替换删键,**反引号转义没匹配上、文件没变**,于是测试"全绿"——差点被读成"用例没牙"。**改用 Edit(锚点不匹配会直接报错)后确认文件真的变了**才重跑。**教训:探针必须先证明自己生效**(`grep` 一下被改的文件),再信它的结果。
- **后端那条 guard 是"一开就绿"的,不是 RED 型**:清单与契约此刻本就一致(枚举是 Task 0 钉的),所以它的牙由探针 ③ 证明,而不是由 RED 阶段证明——**如实记下,不假装它红过**。
- **⭐ 全量套件出现 27 条红,已 A/B 证明与本次改动无关**:全部落在 `tests/unit/knowledge/chat-panel.dom.test.tsx`,报错是 `useActivity* must be used inside <ActivityProvider>`。根因是**宠物线**在本工作树提交的 `0156a64c` 把 `useRegisterActivity` 加进了 `knowledge/chat-panel.tsx`(第 50 行)而该测试的 wrapper 没有对应的 provider——两文件都已提交、工作树干净,**不是我改的**。**证明方式**:把我的 3 个 locale 文件退回 HEAD、新文件移开、只跑那一个文件 → **照样红**(同一报错 81 次);恢复后我的两个 guard 文件全绿。**未修**——那是另一条线的在飞工作(其记忆里写着"剩挂载 + 四个注册点"没做完),改它会与另一会话的编辑撞车。

### Task 2 — 已交付(2026-09-12):前端数据层

- **产物**:`core/delivery/{types,parse,api,hooks}.ts` + 测试 **18 例**(`parse.test.ts` 13、`api.test.ts` 5)。
- **核心规则"判定要么齐要么全无"**:`parseVerdict` 要求 `stage` 在枚举内 **且** `satisfied` 是布尔 **且** 三个路径列表都在,**否则整个判定为 `null`**——文案里插值的计数就来自那三个列表,缺一个就会渲染出一句有洞的话。由 5 个参数化用例钉住(缺判定 / 缺 stage / 缺列表 / 枚举外的 stage / 非布尔 satisfied)。
- **渲染开关是判定而非事件**:基础形状(多数 run)解析出 `verdict: null`,由专门用例钉住——否则绝大多数 run 都会显示一行"交出 0 个"。
- **`presented` 的兜底**:缺失时回退到 `paths.length`,这不是重新推导——worker 在同一记录里写的就是 `presented: len(paths)`。
- **有界重问照抄同线先例**(≤6 次 / 400ms),理由同一类:回执在 run 结束时才写,而卡片拿到 run id 就问,`staleTime: Infinity` 会把那次空答案锁住整轮。另加一条断言钉住 URL **只**要 `event_types=run.delivery`。
- **字段名不改成 camelCase**:沿用线上名(`by_tool` / `produced_paths`),与 `core/constitution/types.ts` 的同一条规则一致——它们就是契约。
- **`RunEventRow` 就地定义**而非从 `constitution/types` 引入:两者是兄弟功能、互不依赖;若出现第三个消费者(§12 第 6 项实时脉冲会需要)再抽共享模块。
- **GREEN**:`pnpm test core/delivery` 21 passed(含 Task 1 的 3 例);`pnpm check` 干净;新文件 `prettier --check` 通过。
- **revert 证明(两探针,均先 `grep` 确认探针真的落盘)**:①关掉"三个列表全在"的守卫 → `refuses a missing path list` 与 `refuses a stage outside the vocabulary` 两条红;②把有界重问换成一发即走 → `re-asks while the run has not written its receipt yet` 红。
