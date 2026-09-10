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

- [x] **Step 1(`deerflow_tool_meta` 运行时确认,spec §15 开放项 8)** — 2026-09-10 闭环,结论:**在**,Task 2 的 `byErrors` / `byUnrecoverable` 两路保留。**交付纪要**:没有按原步骤「发一个必然失败的工具调用 + 浏览器打印」走,改为四条腿(覆盖持久化/两条出线/客户端类型,比单次浏览器打印更宽):① 本机 `backend/.deer-flow/data/deerflow.db` 的 `writes` 表解出 **138 条带 stamp 的真实 ToolMessage**,meta 键形状 **138/138** 为 `status`/`error_type`/`recoverable_by_model`/`recommended_next_action`/`source`,与 `tool_result_meta.py:34-40` 逐字一致,其中 5 条 `status:"error"`;② 把库里那条真实 error 消息喂进 `serialize_messages_tuple`(`runtime/serialization.py:124`),`additional_kwargs` 原样带出;③ 同一条喂进 `serialize_channel_values_for_api` 同样带出,而本机 `run_events.backend: memory`、`run_events` 表 0 行,前端刷新回灌走的正是 `threads.py:1378`;④ SDK `BaseMessage.additional_kwargs?: Record<string, unknown>` 是开放记录,前端已在生产读兄弟键(`utils.ts:719`)。**顺带发现**:138 条里 `recoverable_by_model` 全 `true`、零 `false`,`source` 无 `exception` ⇒ `byUnrecoverable` 实测 0/138(只有代码级证据),Task 2 该子分只能靠合成 fixture;`byErrors` 实测 5/138 ≈ 3.6%。已写回 spec §2 表格行、§7 阈值段、§15 开放项 8。**未覆盖项(诚实记录)**:没有真发一次失败工具调用做活体浏览器打印 —— 四条腿已覆盖其全部信息面,若 Task 7 浏览器验收时顺手打印一次可作为第五腿,非必需。
- [x] **Step 2(容器查询上下文,spec §10 的 480px 断点依赖它)** — 2026-09-10 闭环,结论:**自挂 `[container-type:inline-size]` 于 `div#chat` 可用且必需**,不退回 `ResizeObserver`。**交付纪要**:运行时 spike(零源码改动,reload 后无残留),在已登录真实应用内:① `div#chat` 在 `/workspace/chats/new`(未发消息)即存在,宽 759、`container-type: normal`,带 `[container-type:inline-size]` 的祖先是 `#workspace-chats-new-group`(宽 760)—— 现场复现 spec §10 的「错误盒子」;② 自挂后布局**逐字节不变**(759→759,首子节点矩形 before/after 相同);③ `div#chat` 下探针 700/600/481 显示、480/479/400/300 隐藏,**断点精确 480**(`max-width` 闭区间,spec §10 措辞已从「< 480px」更正为「≤ 480px」);④ 对照实验:chat 压到 400 而 group 仍 760 时,挂在 group 下的同规则探针**不匹配**窄规则 ⇒ 自挂是必需而非偏好。已写回 spec §10。**未覆盖项**:sidecar **真拖拽**改变 `div#chat` 宽度这一环未实测(属 ResizablePanelGroup 既有行为,非本设计引入),并入 Task 7 Step 5。

## Task 1: 状态与工具分类纯函数(TDD)

**Files:** Create `frontend/src/core/pet/{state.ts,tools.ts}` + `frontend/tests/unit/core/pet/{state,tools}.test.ts`

- [x] **Step 1(先写红测试 `tools.test.ts`):** 覆盖 ① `collectActiveToolNames` —— 多工具并行返回多个名、**ToolMessage 内容为空仍算已答**(钉住 spec §15 开放项 1)、孤儿 ToolMessage(无 AI 前置)不崩、空 messages 返回 `[]`;② 6 类映射逐个 + **未知 MCP 名(如 `github_list_prs`)落 `generic`**;③ `pickWorkKind` 优先级表逐对比较 + 空数组返回 `null`;④ **用含 `task` 的 fixture 断言 `delegate` 能出来**(spec §15 开放项 10 的回归锚 —— 将来有人改回走 `getMessageGroups` 时这条会红)。
- [x] **Step 2:** 实现 `tools.ts`,逐字按 spec §6.1 的 `collectActiveToolNames` 与 §6.2 的 `classifyTool` / `WORK_KIND_PRECEDENCE` / `pickWorkKind`。复用 `hasToolCalls`(`core/messages/utils.ts:664`),**不复用 `findToolCallResult`**。
- [x] **Step 3(先写红测试 `state.test.ts`):** 覆盖决策树全分支 + `done` 下降沿(`wasLoading` true→false)+ **spec §5.3 三条不变量逐条**:① `error` 压掉 `done`;② `isLoading` 为真时即使有未回答请求也是 `work`/`think` 而非 `wait`;③ `done` 只在落到 `idle` 时触发,落到 `wait` / `error` 时 `oneShot` 为 `null`。
- [x] **Step 4:** 实现 `state.ts`(类型 + `derivePetState`),按 spec §5.1 / §5.2。注意 `PetSignals.activeToolNames` 是**数组**不是 `string | null`。
- [x] **Step 5:** 转绿 + `cd frontend && pnpm check`。

**Task 1 交付纪要(2026-09-10)**

- **RED**:两个文件的红都是「模块不存在」——`Cannot find module '@/core/pet/tools'`(0 用例被收集)、随后 `Cannot find module '@/core/pet/state'`。先写测试跑红再实现,顺序与 Step 1/3 一致。
- **GREEN**:`tests/unit/core/pet/tools.test.ts` **35 例**、`state.test.ts` **13 例**,合计 **48 例**全绿;两个文件都只跑 node 侧(`*.test.ts`),符合 `frontend/AGENTS.md` 的「纯逻辑不进 DOM」分节纪律。
- **revert proof(七次 neuter,逐个确认对应用例恰好转红后原样恢复)**:每次只改一处实现,恢复后复跑 48 例全绿。

  | # | 被 neuter 的行为 | 改动 | 转红用例 |
  |---|---|---|---|
  | 1 | 空内容 ToolMessage 也算已答 | `answered` 收集加 `&& m.content` | **恰好 1 条**(§15 开放项 1 那条) |
  | 2 | `delegate` 可达 | 删掉 `task: "delegate"` | **8 条**(`task` 映射 + 6 对 delegate 优先级 + 开放项 10 的锚) |
  | 3 | 优先级排序 | `pickWorkKind` 去掉 `sort` | **22 条**(21 对两两比较 + state 里「取最显著」那条) |
  | 4 | 未知工具落 `generic` | `?? "generic"` → `?? "read"` | **恰好 2 条**(`classifyTool` 兜底 + state 的 generic 回落) |
  | 5 | §5.3 不变量 1(`error` 最高) | `hasError` 分支移到 `wait` 之后 | **恰好 1 条**(不变量 1) |
  | 6 | §5.3 不变量 2(`isLoading` 先分支) | `wait` 分支提到 `isLoading` 之前 | **恰好 1 条**(不变量 2) |
  | 7 | §5.3 不变量 3(`done` 只在落 `idle` 时) | `wait` 分支也发 `oneShot` | **恰好 1 条**(不变量 3) |

  三条不变量各自**恰好**命中一条,证明它们是三条独立的钉,不是一条用例重复覆盖。
- **偏离原计划(2 处,均为 tsconfig 强制,语义不变)**:① spec §6.2 片段里的 `...sort(...)[0]` 在本仓库过不了类型检查 —— `tsconfig.json` 开了 `noUncheckedIndexedAccess`,索引访问恒为 `T | undefined`;改为 `const ranked = ...; return ranked[0] ?? null`(仓库既有写法:`eval-tab.tsx:351` 的 `runs[0] ?? null`)。空数组已由前置 guard 排除,`?? null` 只服务类型。② `collectActiveToolNames` 里除 `hasToolCalls(m)` 外多写了 `m.type !== "ai" ||` —— `hasToolCalls` 不是类型谓词,不加这句 `m.tool_calls` 无法通过类型检查;与既有 `extractPresentFilesFromMessage`(`core/messages/utils.ts:682`)同一写法,`hasToolCalls` 仍被复用。
- **门禁**:`pnpm check` 干净(先报 1 条 `import/order`、再报 4 条 `noUncheckedIndexedAccess` 类型错,均已修);**全量 `pnpm test`:2121 通过 / 1 失败**,唯一失败是 `knowledge/chat-panel.dom.test.tsx`「restores the remembered model per kb…」——本机**预存环境性失败**(该测试文件与其被测路径在本树中零改动,本轮只新增 `core/pet/` 两个目录、无任何既有文件被改),判据与记录见项目记忆「环境性测试红」。
- **未覆盖项(诚实记录)**:① 本轮无 DOM 测试 —— 正确而非缺口,`state.ts`/`tools.ts` 是纯函数,AGENTS.md 要求留在 node。② `ask_clarification` 故意不在映射表内也**未加测试**:spec §6.2 已论证它在 `isLoading` 变 false 前不会被观察到(走 `Command(goto=END)`),加一条「它落 generic」的用例会把一个永远不会发生的输入固化成契约。③ `pickWorkKind` 的 `WORK_KIND_PRECEDENCE` 数值本身没有测试断言(只断言相对顺序),这是刻意的:spec §6.2 明说这张表是产品判断、可随时改。

## Task 2: 疲劳度与精灵解析纯函数(TDD)

**Files:** Create `frontend/src/core/pet/{fatigue.ts,sprite.ts}` + `frontend/tests/unit/core/pet/{fatigue,sprite}.test.ts`

- [x] **Step 1(先写红测试 `fatigue.test.ts`):** 覆盖 ① 五个子分各自封顶 3;② `max` 语义(单一高分即拉满);③ `collectFatigueInput` 从 `additional_kwargs.deerflow_tool_meta` 正确分出 `toolErrorCount` 与 `unrecoverableErrorCount`;④ **meta 缺失时两者都为 0**(不崩、不误判);⑤ `maxConsecutiveSameTool` 的连续同名计数。按 Task 0 Step 1 的结论决定是否保留 ③④。
- [x] **Step 2:** 实现 `fatigue.ts`,阈值表按 spec §7(**阈值是猜的,写进模块注释说明需上线后校准**)。
- [x] **Step 3(先写红测试 `sprite.test.ts`):** 覆盖 ① `work-{kind}` → `work` → `fallback` 两级回落逐级;② one-shot 优先于 base;③ manifest 里完全没有候选项时返回 `null`;④ `effectiveFps` 对 `loop: true` 应用 `FATIGUE_FPS_SCALE`、对 `loop: false` **不衰减**(spec §9.2 注释:done 是信息必须读得清)。**用内联 fixture manifest,不 import 真文件**(真 manifest 到 Task 3 才存在;`resolveSprite` 的 manifest 是参数,spec §9.2)。
- [x] **Step 4:** 实现 `sprite.ts`,按 spec §9.2。
- [x] **Step 5:** 转绿 + `pnpm check`。

**Task 2 交付纪要(2026-09-10)**

- **RED**:两次都是「模块不存在」(`@/core/pet/fatigue`、`@/core/pet/sprite`,0 用例收集)。
- **GREEN**:`fatigue.test.ts` **36 例** + `sprite.test.ts` **11 例**;`core/pet/` 四个测试文件合计 **95 例**全绿(35+13+36+11)。
- **revert proof(12 次 neuter,逐个确认命中)**:N1 是批量(五个子分的首个阈值各 +1 一档),其余每次只改一处。

  | # | 被 neuter 的行为 | 改动 | 转红 |
  |---|---|---|---|
  | N1 | 五个子分的档位边界 | 五处首个阈值各 +1 档 | **恰好 5 条**(每个子分各一条边界行) |
  | N2 | `byUnrecoverable` 的 2→3 跳档(无 2 档) | 补出 `<4 → 2` 一档 | 恰好 1 条 |
  | N3 | `max` 而非 `sum` | 子分改成相加 | 恰好 1 条(**首次跑没红,见下**) |
  | N4 | 错误的可恢复性拆分 | `unrecoverable = toolErrorCount` | 恰好 1 条 |
  | N5 | meta 缺失不算错 | 缺失时 `toolErrorCount += 1` | 恰好 1 条 |
  | N6 | `partial_success` 不算错 | 把 partial 也计入 | 恰好 1 条 |
  | N7 | 跨消息的连续同名计数 | 每条消息重置 run 游标 | 恰好 1 条 |
  | N8 | `work-{kind}` 第一级 | 候选只留 `work` | 恰好 1 条 |
  | N9 | one-shot 优先于 base | 候选顺序对调 | 恰好 1 条 |
  | N10 | `fallback` 候选 | 从候选表移除 | 恰好 2 条(两级回落各一条) |
  | N11 | 全部落空返回 `null` | 改成返回 `fallback` | 恰好 1 条 |
  | N12 | 只有 `loop: true` 才衰减 | 去掉 `loop` 判断 | 恰好 1 条 |

- **revert proof 抓到一个空洞测试(本轮最有价值的发现)**:N3 第一次跑**全绿** —— 我原来那条「max 不是 sum」的用例给了一个子分 3 档,于是 `Math.min(3, sum)` 同样得 3,断言根本无法失败。改成四个子分各 1 档(同时 `toolCallCount=5`、`maxConsecutiveSameTool=3`、`toolErrorCount=1`、`elapsedMs=2min`)后:max 得 1、sum 得 `min(3,4)=3`,才真正区分开,N3 随即恰好命中。**这条记下来是为了说明 revert proof 不是仪式**:它当场证伪了我一条「看起来在测 max」的用例。
- **API 决策(spec 留白处,需回填 spec §7/§12)**:`collectFatigueInput` 的签名 spec 没写。实测需要三条约束同时成立 —— 它必须能只靠 `messages` memo(§12 要求 memo 在 `messages.length`),而 `elapsedMs` 是每 tick 变化的活值。故定案:`collectFatigueInput(messages): FatigueSignals`,其中 `FatigueSignals = Omit<FatigueInput, "elapsedMs">`;`elapsedMs` 由调用方在渲染时补进 `computeFatigueLevel`。若按 `FatigueInput` 全量返回,就必须把 `elapsedMs` 传进 memo,缓存每帧失效,直接违背 §12。
- **其余实现决策(2 处)**:① `toolCallCount` 数的是**发起过的** tool_call(AI 消息的 `tool_calls` 条目),不是已完成的 ToolMessage 数 —— 名字是 tool *call* count,且发起即算「这个 run 干了多少活」;② 错误子分只读 `additional_kwargs.deerflow_tool_meta` 的结构化字段(`isRecord` 局部守卫,仓库同类写法见 `human-input.ts:90`),**零文本解析**。
- **偏离原计划(1 处,tsconfig 强制)**:`effectiveFps` 里 `manifest.states[sprite]` 在 `noUncheckedIndexedAccess` 下是 `T | undefined`,而 spec §9.2 直接读 `.loop`。用 `!` 非空断言 + 注释说明「调用方只会传 `resolveSprite` 的产物,其键必然存在」;仓库 `src/core/` 已有非空断言先例(`kb-order.ts:70`、`preprocess.ts:90`)。不用「未命中返回 0」那种静默兜底:那会让 fps=0 流进 `calc(frames/fps)` 变成非法 CSS,而断言是响亮失败。
- **门禁**:`pnpm check` 干净(本轮零 lint/类型错);**全量 `pnpm test`:2173 例 / 2172 通过 / 1 失败**(203 文件 / 1 失败),唯一失败是本机预存环境性失败 `knowledge/chat-panel.dom.test.tsx`「restores the remembered model per kb…」—— 与 Task 1 那条同源,判据相同(该文件与其被测路径在本树零改动)。
  **一次异常记录(如实,原因未查明)**:本轮**第一次**全量跑报的是「**Test Files 3 failed | 200 passed**」但只有 1 条用例失败、总数 2152;紧接着原样复跑得到干净的「1 failed | 202 passed」、总数 2173。两次都在同一个工作树、同一份代码上,差异是 2 个文件未能收集(少了 21 条用例)。我**没有**查明成因,所以不写推测;记录它是为了让后来者知道:这台机器上全量套件偶发「文件级失败但无对应用例失败」,遇到时先原样复跑一次再判断。对本轮的结论无影响 —— 宠物的 95 条在两个文件级视图下都是绿的。
- **未覆盖项(诚实记录)**:① 五个子分的阈值**数值**只被相对边界钉住(`<5` 改 `<6` 会红),但「5 这个数本身对不对」无从测 —— spec §15 开放项 2 已明确阈值是猜的、需上线校准,模块注释里也写明了。② `byUnrecoverable` 的 2→3 跳档在真实数据里**从未触发过**(Task 0 实测 0/138),它的正确性只有合成 fixture 支撑,与 spec §7 的记载一致。③ 本轮仍无 DOM 测试(纯函数,正确);④ `FATIGUE_FPS_SCALE` 只钉了表值(`[1, 0.9, 0.75, 0.6]`)与「一次性态不衰减」,没有验证 0.6 这个下界在浏览器里观感是否合适 —— 那属于 Task 7 的浏览器验收范围。

## Task 3: 资产契约与占位帧

**Files:** Create `frontend/public/pet/parrot/{manifest.json,idle.webp,wait.webp}`

- [x] **Step 1:** 写 `manifest.json`,按 spec §8 的形状(`frameWidth` / `frameHeight` / `fallback: "idle"` / `states`)。**第 1 期只声明 `idle` 与 `wait` 两个条目** —— 其余状态故意不声明,用来验证回落契约真的生效。
- [x] **Step 2:** 出**占位帧**(纯色块 + 状态名文字,横向单行,`idle` 2 帧 / `wait` 2 帧即可)。目的是让链路能跑通并可浏览器实测;真图由用户后续替换,替换时**代码零改动**(spec §8 规则 1、2)。占位帧必须满足契约:两组同 `frameWidth × frameHeight`。
- [x] **Step 3:** `manifest.json` 用**静态 `import`** 引入(spec §11 裁决),不运行时 fetch。确认 TS 能解析 JSON import(`tsconfig.json` 的 `resolveJsonModule`)。
- [x] **Step 4(manifest 自洽断言):** 在 `sprite.test.ts`(或独立 `manifest.test.ts`)里对**静态 import 的真 manifest** 逐态断言 `sheetWidth === frames × frameWidth`、`sheetHeight === frameHeight`(spec §8 自校验;占位帧阶段即生效:2 帧 × 512 ⇒ `sheetWidth: 1024`、`sheetHeight: 512`)。防的是「重导了 sheet 却忘改 manifest 的 frames」这类不同步:它不报错,只表现为某态播到尾巴花屏/空白。

**Task 3 交付纪要(2026-09-10)**

- **产出**:`frontend/public/pet/parrot/` 下三个文件 —— `manifest.json`(只声明 `idle` / `wait`,其余状态故意不声明以验证回落)、`idle.webp`、`wait.webp`(**各 2 帧、1024×512**,即 `2 × 512` 与 `frameHeight`)。
- **RED**:`Cannot find module '../../../../public/pet/parrot/manifest.json'`(0 用例收集)。
- **GREEN**:`sprite.test.ts` 11 → **16 例**(新增 5:1 条 `idle` 必需 + fallback 可达,2 个状态各 1 条宽、1 条高),`core/pet/` 累计 **100 例**全绿。
- **静态 import 已验证**:`tsconfig.json` 的 `resolveJsonModule: true`;测试从 `tests/unit/core/pet/` 用相对路径 `../../../../public/pet/parrot/manifest.json` 引入真文件,Rstest 的 node 工程正常解析(用例通过即证明),`tsc --noEmit` 也通过 —— 即 spec §11 的「静态 import,不运行时 fetch」成立。渲染器(Task 4)按 `${sprite}.webp` 取同名文件,故文件名必须等于 state key。
- **revert proof(2 次 neuter)**:

  | # | 被 neuter 的行为 | 改动 | 转红 |
  |---|---|---|---|
  | P1 | `sheetWidth === frames × frameWidth` | `idle.frames` 改 3、`sheetWidth` 保持 1024 | **恰好 1 条**,且用例名直接点名 `idle` |
  | P2 | fallback 必须可达 | `fallback` 指向未声明的 `think` | 恰好 1 条 |

- **manifest 与真实文件的一致性(人工取证,非测试)**:`ffprobe` 逐张读出 `idle.webp` / `wait.webp` 均为 **1024×512**,与 manifest 的 `frames: 2 × frameWidth: 512` / `frameHeight: 512` 吻合。
- **诚实记录的边界**:Step 4 的断言按 spec §8 的要求是**纯算术、不解码图片**,所以它只能发现「manifest 内部两个数彼此不同步」,**发现不了**「manifest 的数字与 webp 实际尺寸一起错」或「文件缺失」。后者目前靠人工 `ffprobe` 与 Task 7 的浏览器实测兜(资产缺失时渲染器回落成「不渲染任何节点」,是静默降级)。若想把「资产文件本身」也钉住,可在 node 里读 RIFF/WEBP 头 30 行左右拿到真实尺寸再比对 —— 本轮**没做**(计划与 spec 都明确把这条限定为算术自校验),需要的话是一个独立小改动。
- **占位帧的两处设计决定**:① **fps 用真实值 8,只把帧数降到 2** —— 这样 Task 7 观察到的播放节奏就是上线节奏,将来换真图只改 `frames` / `sheetWidth` 两个数据(P1 那个断言正好守它);代价是 2 帧 @8fps 只有 0.25s,肉眼是明显闪烁,但占位阶段这是**诚实的**占位表现。② 两组用**蓝系 / 琥珀系**区分并各印状态名(`IDLE n` / `WAIT n`),使 Task 7 那条唯一交付判断「『在等你』与『跑完了』视觉上分得开」在占位阶段就可判读。生成方式:ffmpeg `drawtext` + `hstack`(`libwebp` 编码),无新增依赖、无仓库内脚本。
- **门禁**:`pnpm check` 干净;`core/pet/` 100 例全绿。**本轮未重跑全量套件** —— 改动只有新增资产 + 一个测试文件的新增 describe,不触碰任何既有源文件;上一次全量(2 小时前)是 2173/2172/1(唯一失败为本机预存那条)。Task 4 会改 `pet-sprite.tsx` 等新文件,那时再跑全量。
- **未覆盖项**:① 占位帧没有做「非 512 尺寸会被拒」的负向校验(渲染器侧不校验,靠 Task 4 的等宽假设);② manifest 只声明两个状态,故 `work-{kind}` / one-shot 等回落路径的真实资产不存在 —— 这正是第 1 期要验的回落行为,由 Task 7 用浏览器确认。

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
