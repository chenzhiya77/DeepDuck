# Agent 装饰宠物(鹦鹉帧动画)第 1 期 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 agent 聊天窗挂一只帧动画鹦鹉,把已有但无人读取的 run 状态做成周边视觉。第 1 期只交付 **`idle` + `wait` 两组帧**,交付判断只有一条:**「agent 在等你回答」与「run 跑完了」在视觉上分得开**。零后端改动、零新依赖、零新事件通道。

**Architecture:** 宠物是**观察者**,不是输出面、不是 agent(spec `../specs/2026-09-09-agent-pet-sprite-design.md` §4 四项裁决)。数据流是单向的:既有 `useThread()` 信号 → 四个纯函数 → 一个只吃 `PetState` 的渲染器。不订阅 `onStreamCustomEvent`(§4.3),不调用 `getMessageGroups`(§6.1),不持有任何 agent/线程/记忆(§4.4)。契约细节全在 spec,本计划只排步骤。

**Tech Stack:** React 19 + Next.js 16 + Tailwind 4。渲染用纯 CSS `background-position` + `steps()`,**不引 PixiJS/Lottie/motion**(spec §9.1)。测试按 `frontend/AGENTS.md` 分节约定:纯逻辑走 `*.test.ts`(node),只有渲染器走 `*.dom.test.tsx`(happy-dom,贵约 3 倍)。

**测试运行命令(全程统一):**
```bash
cd frontend && pnpm test       # Rstest:*.test.ts 走 node,*.dom.test.tsx 走 happy-dom
cd frontend && pnpm check      # lint + typecheck,提交前必跑
cd frontend && pnpm dev        # 浏览器实测(Task 7 唯一手段,不可用单测替代)
```

**关键事实(已核实,细节与行号见 spec §2):**
- **`ClarificationMiddleware` 走 `Command(goto=END)`**,所以「在等你回答」与「跑完了」在流层面完全同形(`isLoading` 都变 false、`onFinish` 都触发)。唯一区分信号是 `hasOpenHumanInputRequest`(`core/messages/human-input.ts:486`,签名 `(messages, isVisibleMessage?)`)。这是本期全部价值所在。
- **`getMessageGroups` 不可用于派生在飞工具**(spec §6.1):它把带工具调用的 AI 消息拆进三类互斥 group,优先级 `present_files`(`utils.ts:158`)> `task`(`:164`)> `assistant:processing`(`:170`)。只看 processing **永远看不到 `task` 与 `present_files`**,`delegate` workKind 会静默失效。必须直接走 `thread.messages`。
- **`findToolCallResult` 不可复用**(spec §15 开放项 1):`utils.ts:706` 在 ToolMessage 存在但内容为空时也返回 `undefined`,会把「已完成的空结果」误读成「仍在飞」。自建 `answered` Set。
- **挂载点已确认安全**:`chat-box.tsx:413` 的 `div#chat`,且 `:81` 已有 `const { thread } = useThread()`。三条 ResizablePanelGroup 约束全在**侧面板**(`pinnedContentWidth` 消费于 `:450-452`、`animatingRightPanel` 于 `:404`),加一个 `{children}` 的兄弟节点不触碰任何一条。
- **mobile 分支无挂载点**:`chat-box.tsx:349-353` 渲染的容器没有 `id="chat"`。本期裁决桌面 only(spec §10)。
- **`deerflow_tool_meta` 静态证据充分但未直接观测**:后端盖在 `ToolMessage.additional_kwargs`(`tool_result_meta.py:18`,dataclass `:33-40`),前端已在读同一 dict 的其他键(`utils.ts:718` 读 `.hide_from_ui`)。→ Task 0 Step 1 必须先确认。
- 设置节形状照抄既有 `notification: { enabled: true }`(`core/settings/local.ts:5-7`);`LocalSettingsSetter`(`store.ts:14`)按节 merge,**无需迁移**。
- 术语已定死(spec §3):叫**宠物/鹦鹉**,不叫 mascot/avatar/companion(avatar 在本仓库已指自定义 agent 的 `BotIcon`);状态叫**持续态/一次性**,不叫 emotion(AIRI 术语,语义是模型自报,与本设计相反)。

**机器特定:** host 侧 pnpm 一律经 `scripts/pnpm.py`(根 `AGENTS.md` 已写明)。sprite sheet 是 `public/` 下静态图,不计入 `pnpm perf:check` 的预算(该命令度量唯一 JS 与 CSS 文件);新增 `core/pet/` 的 JS 量很小,本期不预期触发预算失败,但 Task 7 仍跑一次确认。

---

## File Structure

**新建:**
- `frontend/src/core/pet/state.ts`(类型 + `derivePetState`)
- `frontend/src/core/pet/tools.ts`(`collectActiveToolNames` + `classifyTool` + `pickWorkKind`)
- `frontend/src/core/pet/fatigue.ts`(`collectFatigueInput` + `computeFatigueLevel`)
- `frontend/src/core/pet/sprite.ts`(`resolveSprite` + `effectiveFps` + `FATIGUE_FPS_SCALE`)
- `frontend/src/components/workspace/pet/pet-sprite.tsx`(渲染器,不知道 agent 存在)
- `frontend/src/components/workspace/pet/agent-pet.tsx`(订阅者)
- `frontend/public/pet/parrot/manifest.json` + `idle.webp` + `wait.webp`(Task 3 先出占位帧)
- `frontend/tests/unit/core/pet/{state,tools,fatigue,sprite}.test.ts`
- `frontend/tests/unit/components/workspace/pet/pet-sprite.dom.test.tsx`

**修改:**
- `frontend/src/core/settings/local.ts`(+ `pet: { enabled: true }` 节 + `LocalSettings` 类型)
- `frontend/src/components/workspace/chats/chat-box.tsx`(+1 行挂载,**仅桌面分支**)
- `frontend/AGENTS.md`(+ `core/pet/` 域说明 + 宠物挂载所有权,仓库强制约定)

**本期不动:** 后端任何文件、`contracts/`、`package.json`、`core/threads/hooks.ts`、`core/messages/*`(只读不改)。

---

## Task 0: 两项前置核实(**阻塞后续所有任务**)

- [ ] **Step 1(`deerflow_tool_meta` 运行时确认,spec §15 开放项 8):** 起 `make dev`,发一个必然失败的工具调用(例如让 agent `read_file` 一个不存在的路径),在浏览器里打印该 ToolMessage 的 `additional_kwargs`,确认 `deerflow_tool_meta` 是否在、字段名与 `status` / `recoverable_by_model` 是否与后端 dataclass 一致。**若不在** → Task 2 删掉 `byErrors` / `byUnrecoverable` 两路,疲劳度退回三子分,并把结论写回 spec §15 开放项 8。**任何情况下都不得改为从 ToolMessage 文本猜错误**(违背 spec §4.4(a) 与后端模块 docstring 的 "instead of parsing text")。
- [ ] **Step 2(容器查询上下文,spec §10 的 480px 断点依赖它):** 确认 `div#chat`(`chat-box.tsx:413`)的子树里 Tailwind 的 `@container` 变体可用 —— `:240` 已在用 `cqw` 单位,说明某处有 container context,但需确认它覆盖聊天面板而不只是侧面板。写一个临时 spike(不提交)验证 `@container (max-width: 480px)` 在 sidecar 把面板拖窄时能生效。**若不可用** → 退回 `ResizeObserver` 量 `div#chat` 宽度,或直接去掉窄面板隐藏并在 spec §10 记为开放项。

## Task 1: 状态与工具分类纯函数(TDD)

**Files:** Create `frontend/src/core/pet/{state.ts,tools.ts}` + `frontend/tests/unit/core/pet/{state,tools}.test.ts`

- [ ] **Step 1(先写红测试 `tools.test.ts`):** 覆盖 ① `collectActiveToolNames` —— 多工具并行返回多个名、**ToolMessage 内容为空仍算已答**(钉住 spec §15 开放项 1)、孤儿 ToolMessage(无 AI 前置)不崩、空 messages 返回 `[]`;② 6 类映射逐个 + **未知 MCP 名(如 `github_list_prs`)落 `generic`**;③ `pickWorkKind` 优先级表逐对比较 + 空数组返回 `null`;④ **用含 `task` 的 fixture 断言 `delegate` 能出来**(spec §15 开放项 10 的回归锚 —— 将来有人改回走 `getMessageGroups` 时这条会红)。
- [ ] **Step 2:** 实现 `tools.ts`,逐字按 spec §6.1 的 `collectActiveToolNames` 与 §6.2 的 `classifyTool` / `WORK_KIND_PRECEDENCE` / `pickWorkKind`。复用 `hasToolCalls`(`core/messages/utils.ts:664`),**不复用 `findToolCallResult`**。
- [ ] **Step 3(先写红测试 `state.test.ts`):** 覆盖决策树全分支 + `done` 下降沿(`wasLoading` true→false)+ **spec §5.3 三条不变量逐条**:① `error` 压掉 `done`;② `isLoading` 为真时即使有未回答请求也是 `work`/`think` 而非 `wait`;③ `done` 只在落到 `idle` 时触发,落到 `wait` / `error` 时 `oneShot` 为 `null`。
- [ ] **Step 4:** 实现 `state.ts`(类型 + `derivePetState`),按 spec §5.1 / §5.2。注意 `PetSignals.activeToolNames` 是**数组**不是 `string | null`。
- [ ] **Step 5:** 转绿 + `cd frontend && pnpm check`。

## Task 2: 疲劳度与精灵解析纯函数(TDD)

**Files:** Create `frontend/src/core/pet/{fatigue.ts,sprite.ts}` + `frontend/tests/unit/core/pet/{fatigue,sprite}.test.ts`

- [ ] **Step 1(先写红测试 `fatigue.test.ts`):** 覆盖 ① 五个子分各自封顶 3;② `max` 语义(单一高分即拉满);③ `collectFatigueInput` 从 `additional_kwargs.deerflow_tool_meta` 正确分出 `toolErrorCount` 与 `unrecoverableErrorCount`;④ **meta 缺失时两者都为 0**(不崩、不误判);⑤ `maxConsecutiveSameTool` 的连续同名计数。按 Task 0 Step 1 的结论决定是否保留 ③④。
- [ ] **Step 2:** 实现 `fatigue.ts`,阈值表按 spec §7(**阈值是猜的,写进模块注释说明需上线后校准**)。
- [ ] **Step 3(先写红测试 `sprite.test.ts`):** 覆盖 ① `work-{kind}` → `work` → `fallback` 两级回落逐级;② one-shot 优先于 base;③ manifest 里完全没有候选项时返回 `null`;④ `effectiveFps` 对 `loop: true` 应用 `FATIGUE_FPS_SCALE`、对 `loop: false` **不衰减**(spec §9.2 注释:done 是信息必须读得清)。**用内联 fixture manifest,不 import 真文件**(真 manifest 到 Task 3 才存在;`resolveSprite` 的 manifest 是参数,spec §9.2)。
- [ ] **Step 4:** 实现 `sprite.ts`,按 spec §9.2。
- [ ] **Step 5:** 转绿 + `pnpm check`。

## Task 3: 资产契约与占位帧

**Files:** Create `frontend/public/pet/parrot/{manifest.json,idle.webp,wait.webp}`

- [ ] **Step 1:** 写 `manifest.json`,按 spec §8 的形状(`frameWidth` / `frameHeight` / `fallback: "idle"` / `states`)。**第 1 期只声明 `idle` 与 `wait` 两个条目** —— 其余状态故意不声明,用来验证回落契约真的生效。
- [ ] **Step 2:** 出**占位帧**(纯色块 + 状态名文字,横向单行,`idle` 2 帧 / `wait` 2 帧即可)。目的是让链路能跑通并可浏览器实测;真图由用户后续替换,替换时**代码零改动**(spec §8 规则 1、2)。占位帧必须满足契约:两组同 `frameWidth × frameHeight`。
- [ ] **Step 3:** `manifest.json` 用**静态 `import`** 引入(spec §11 裁决),不运行时 fetch。确认 TS 能解析 JSON import(`tsconfig.json` 的 `resolveJsonModule`)。
- [ ] **Step 4(manifest 自洽断言):** 在 `sprite.test.ts`(或独立 `manifest.test.ts`)里对**静态 import 的真 manifest** 逐态断言 `sheetWidth === frames × frameWidth`、`sheetHeight === frameHeight`(spec §8 自校验;占位帧阶段即生效:2 帧 × 512 ⇒ `sheetWidth: 1024`、`sheetHeight: 512`)。防的是「重导了 sheet 却忘改 manifest 的 frames」这类不同步:它不报错,只表现为某态播到尾巴花屏/空白。

## Task 4: 渲染器组件(TDD,唯一 DOM 测试)

**Files:** Create `frontend/src/components/workspace/pet/pet-sprite.tsx` + `frontend/tests/unit/components/workspace/pet/pet-sprite.dom.test.tsx`

- [ ] **Step 1(先写红测试):** **只测三件**(spec §13.2,刻意压最小):① `motion-reduce` 下不加 animation、停在第 0 帧;② one-shot 播完(`animationEnd`)后回调触发、回到 base;③ 开关关掉时不渲染任何节点。其余逻辑已被 `sprite.ts` 在 node 环境覆盖,**不要在 DOM 测试里重复测回落**。
- [ ] **Step 2:** 实现 `pet-sprite.tsx`:只吃 `{ base, workKind, fatigue, oneShot }` + manifest,用 `background-position` + `animation: ... steps(N)` 播放。**不引任何动画库**。`pointer-events-none` 在这一层就加上。盒子边长取 manifest 的 `displaySize` 并**取偶数整数 CSS px**(spec §10:帧宽在设备像素上对齐,防右缘邻帧鬼影;DPR 1.5 下偶数即整数设备像素)。
- [ ] **Step 3:** 转绿 + `pnpm check`。

## Task 5: 订阅者组件 + 设置节

**Files:** Create `frontend/src/components/workspace/pet/agent-pet.tsx`;Modify `frontend/src/core/settings/local.ts`

- [ ] **Step 1:** `local.ts` 的 `LocalSettings` 类型与 `DEFAULT_LOCAL_SETTINGS` 各加一节 `pet: { enabled: true }`,形状照抄 `notification`(`:5-7`)。**不写迁移**(按节 merge 自动补默认)。
- [ ] **Step 2:** `agent-pet.tsx`:读 `useThread()`(`components/workspace/messages/context.ts`),按 spec §12 把两个消息扫描 **memo 在 `messages.length` 上**;`hasOpenHumanInputRequest` 的调用**逐字照抄** `page.tsx:262-269`(同 `useMemo` 键 `[thread.messages]`、同过滤器 `!isHiddenFromUIMessage`)。
- [ ] **Step 3:** 组件内 ref:`wasLoading`(下降沿检测)、`greet` 一次性触发、`elapsedMs` 起点(spec §15 开放项 6:记「首次观察到 `isLoading === true`」的时刻)。**跨线程重置**:以 `threadId` 为键把 fatigue / wasLoading 归零,`greet` 不重放(spec §11 裁决)。
- [ ] **Step 4:** 开关关掉时直接返回 `null`(不留 DOM 节点,与 `notification.enabled` 行为一致)。
- [ ] **Step 5(自由放置,spec §10.1):** 设置节加 `offset: { right: 12, top: 56 }`;`core/pet/placement.ts` 实现 `clampOffset` 纯函数 + node 测试;`agent-pet.tsx` 实现 Alt+拖拽:window 级 `pointerdown` 判断 Alt 且指针落在宠物盒矩形内(矩形由 offset + displaySize 算出,**不给宠物 pointer-events**),`pointermove` 更新 offset、`pointerup` 写回 `pet.offset`;渲染时 clamp 到面板可见区。设置行加提示文案与重置位置按钮。手势三件套照抄 Qoder 实测值:**位移 > 4px 才起拖**(Alt+单击不算拖拽)、记 `pointerId` 并 `setPointerCapture`(`pointerup` 释放、`pointercancel` 同样收尾)、**起过拖的手势吞掉紧跟的那次 click**(否则松手会点开底下的消息链接)。
- [ ] **Step 6:** `pnpm check`。

## Task 6: 挂载

**Files:** Modify `frontend/src/components/workspace/chats/chat-box.tsx`

- [ ] **Step 1:** 在 `:413` 的 `div#chat` 内、`{children}` 之后加 `<AgentPet />`,定位 `absolute z-20 pointer-events-none`,`right/top` 读设置 `pet.offset`(渲染时 clamp,默认 12/56 即 right-3 top-14,spec §10.1)+ Task 0 Step 2 裁定的窄面板隐藏方式。**只改桌面分支,mobile 分支(`:349-353`)不动**(spec §10 裁决)。
- [ ] **Step 2:** 确认没有触碰 `pinnedContentWidth` / `animatingRightPanel` / `handlePanelGroupLayoutChanged` / `handleSidePanelResize` 任何一处(spec §2.6 已核实四条全在侧面板)。
- [ ] **Step 3:** `pnpm check` + `pnpm test` 全量。

## Task 7: 浏览器验证阶梯(**不可用单测替代**)

- [ ] **Step 1:** `pnpm dev`,开一个线程。验证 `idle` 播放。
- [ ] **Step 2(核心验收):** 触发一个 `ask_clarification`(让 agent 需要追问),验证鹦鹉切到 **`wait`**;再发一条普通消息跑完,验证鹦鹉播 **`done` 一次性动画后回 `idle`**(第 1 期 `done` 无帧 → 应回落到 `idle`,这正是要验的回落行为)。**两者视觉上必须分得开** —— 这是本期唯一交付判断。
- [ ] **Step 3:** 触发一个 `error`(断网或配错模型),验证 `error` 态;确认 `error` 压掉 `done`(spec §5.3 不变量 1)。
- [ ] **Step 4:** 在有未回答的 clarification card 时直接发新消息开新 run,验证鹦鹉走 `work`/`think` 而非 `wait`(spec §5.3 不变量 2)。
- [ ] **Step 5:** 开右侧 artifacts/sidecar 面板并把分隔条拖到最窄,验证窄面板隐藏生效、且**拖拽手感无变化**(没碰到 ResizablePanelGroup 约束)。
- [ ] **Step 6:** 系统开启「减少动态效果」,验证停在静态帧。关掉设置开关,验证 DOM 里无残留节点。
- [ ] **Step 7:** 切线程再切回,验证 fatigue 归零、`greet` 不重放。
- [ ] **Step 8:** `cd frontend && pnpm perf:check` 跑一次确认预算未破。
- [ ] **Step 9(自由放置):** Alt+拖拽鹦鹉到新位置,刷新页面验证持久化;拖窄 sidecar 验证盒子被 clamp 在可见区内不出屏;不按 Alt 在鹦鹉位置按住拖动,验证不起拖且点击穿透到下方内容;**Alt+按住但位移 < 4px 后松手,验证鹦鹉没动**(阈值生效);**把鹦鹉拖到一条消息链接上松手,验证链接没有被点开**(拖后吞 click 生效);**拖拽全程验证鹦鹉仍播当前态、不切态**(§10.1 拖拽不进状态机)。

## Task 8: 文档同步(仓库强制约定)

- [ ] **Step 1:** `frontend/AGENTS.md`:`src/` 结构清单加 `core/pet/` 域;Interaction Ownership 加一条「宠物挂载点在 `chat-box.tsx` 桌面分支的 `div#chat`,mobile 分支故意不挂」。
- [ ] **Step 2:** 把 Task 0 两步的核实结论写回 spec §15(开放项 8 关闭或改写、§10 的断点方式定案)。
- [ ] **Step 3:** 若占位帧仍是占位,在 spec §18 分期表标注「第 1 期代码已交付,等待真图替换(零代码改动)」。
- [ ] **Step 4:** `README.md` 是否需要提及由用户定(纯装饰功能,倾向不加)。

---

## 后续期(不在本计划内)

第 2 期(补 `think`/`work`/`error`/`done`/`greet` 帧 + 打开 fatigue)、第 3 期(打开 `workKind` 分类)、第 4 期候选(生成式评论,需先重开 spec §4.1 裁决一)见 spec §18。第 2、3 期是纯美术增量 + 常量开关,**不再碰逻辑也不再碰测试**。
