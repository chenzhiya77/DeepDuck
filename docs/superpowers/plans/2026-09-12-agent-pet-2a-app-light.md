# Agent 宠物 2a:app 的灯 + 缩放控件(2026-09-12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**:把宠物从「这个线程的灯」变成「**app 的灯**」—— 在 `workspace` 全站任意切换都在;并让 `displaySize` 用户可控。

**设计依据**:`docs/superpowers/specs/2026-09-09-agent-pet-sprite-design.md` 的 §4.1 重开段、§10.2(缩放)、§10.3(跨页)。**本 plan 不重新论证设计**;与 spec 冲突时先改 spec。

**本期的定义性约束**:零美术、零新帧。只有前端架构、设置与控件。美术增量见 2b(另一份 plan / 另一个会话)。

**约定**:
- 纯逻辑放 `core/pet/`(`*.test.ts`,node 环境);只有真渲染才用 `*.dom.test.tsx`(贵约 3 倍)。
- 每个 Task 末尾写**交付纪要**:真实数字 / revert 证明 / 偏离 / 未覆盖项。**未覆盖项必须显式列出**,不许用「验证通过」盖过去。
- 门禁:`frontend` 下 `pnpm check`(scoped eslint + 过滤 tsc)+ 相关测试全绿。
- **提交粒度**:Task 0 结论落 spec 一笔;Task 1-6 按可独立回滚的单元提交。提交前 `git status` 核对该笔只含本线文件。

---

## Task 0:前置核实与设计取舍(**阻塞后续所有任务**)

§10.3 列了四个待核实项,其中第 ② 项会**决定 Task 1 的形态** —— 不闭环不许写代码。

- [x] **Step 1(能不能不动 sidecar / knowledge)** 读 `components/workspace/sidecar/sidecar-panel.tsx:156` 与 `components/workspace/knowledge/chat-panel.tsx:163` 的 `useThreadStream` 调用:**它们传的 `threadId` 是不是当前主线程**(`displayThreadId` / `context` 各是什么)。结论只有两种:① 用的是别的线程 ⇒ 本期不动;② 与主线程同一个 ⇒ 它们也必须改成消费 provider,工作量翻倍。
- [x] **Step 2(薄 vs 厚)** 通读 `core/threads/hooks.ts:1534` 的 `useThreadStream` 全貌,把返回值与内部状态分成两类:**页面专属**(`optimisticMessages`、`pendingSuperseded*`、`isUploading`、replay mask、`onSend/onStart/onFinish` 监听)与**宠物需要的**(`messages`、`isLoading`,以及切线程时的重置契约)。产出是一张清单,不是印象。
- [x] **Step 3(三条候选做取舍)** 用 Step 2 的清单在三条里选一条,判据是**换页后仍能说出「在等你」**、且不引入难以收拾的副作用:

  | 候选 | 形态 | 已知代价 |
  |---|---|---|
  | **A 整体上提** | 把 `useThreadStream` 提到外壳,页面改成消费 | 一大坨页面专属状态跟着进外壳,风险最高 |
  | **B 薄订阅并列** | 外壳只用 SDK `useStream` 订 `messages`+`isLoading`;页面保留自己的富 hook | 同一线程**两条订阅**;要证明双订阅无害(后端 StreamBridge 是多订阅广播,但必须实地确认,不能推断) |
  | **C 页面快照广播** | 页面把宠物需要的切片发布到外壳 store | 最便宜,但**换页即失活** ⇒ 说不出「在等你」,**已判为不满足目标**(除非前两条都被否) |

- [x] **Step 4** 结论写回 spec §10.3,把「待核实项 ① ②」关掉或改写;**若结论推翻 §10.3 的形态,先改 spec 再动代码**。
- **验收**:Step 1 有明确引文;Step 2 有清单;Step 3 有选定项 + 否掉另两条的理由;spec 相应处已更新。
- **交付纪要(2026-09-12 完成)**:
  - **Step 1 结论 = ① 两者都用别的线程,本期不动**。证据(引文):`sidecar-panel.tsx` 传 `threadId: sidecar.sidecarThreadId`;`knowledge/chat-panel.tsx` 传 `threadId: isNewThread ? undefined : threadId`,而它的 `threadId` 来自 `useState(() => uuid())` + `metadata.kb_id`(kb 绑定线程,与主线程无关)。⇒ 原「工作量翻倍」的分支不存在。
  - **Step 2 清单**:`useThreadStream` 的返回(`hooks.ts:2605`)九项中,**宠物只要 `thread`(`messages` + `isLoading`)**,其余八项(`sendMessage` / `regenerateMessage` / `editAndRegenerateMessage` / `isUploading` / `isHistoryLoading` / `hasMoreHistory` / `loadMoreHistory` / `pendingUsageMessages`)全是页面与 composer 机器。另:内部还有 `optimisticMessages` / `pendingSuperseded*` / replay mask / 上传态 / `onSend|onStart|onFinish` 监听 —— 全部页面专属。**关键**:`thread.messages` = 历史查询 + 实时流 + 乐观消息三者合并,而**历史那半本来就全局**(`useThreadHistory` 跑在 QueryClient 下),只有实时那半每次挂载各建。
  - **Step 3 选定 B+(薄订阅 + 主面注册),否掉 A 与 C**。A 被否的**新理由**(写 plan 时才看清):三个 chat 页面传的上下文不同(`context.agent_name`,以及新会话页的 `threadId: undefined` + `onStart` 回收新 id),外壳无法用一条 hook 持有 ⇒ 硬做等于在外壳建「活跃流注册表」,那已是 B+ 的另一半。C 被否:页面一卸载即失活,说不出「在等你」。**B+ 的要点**:外壳拿到 threadId 后**自己续订、不随页面卸载而断**;页面不改造成消费外壳。
  - **偏离**:spec §10.3 原文写的是 A(「chat 页面改成消费」),已按 Step 4 改写为 B+,并把 ① ② 两道待核实项关掉。
  - **未覆盖 / 新增待办**:① **B+ 的硬假设仍未验证** —— 迟到的订阅者能否正确报告一条「已在飞行中」的 run(Task 1 之前必须先 spike);② ~~知识库面板要不要也注册~~ **已裁决(2026-09-12,用户):跟** —— 共**四个主面**注册(含 `knowledge/chat-panel`,只加一行、不重构);不跟的话在知识库里聊天时宠物会显示主线程那条可能一直 idle 的线程,看起来像坏了。

## Task 1:外壳薄订阅 + 主面注册(TDD)

按 Task 0 的裁决(**B+**)实现:外壳持有**一条薄订阅**,主面**注册**线程 id。**不是**把页面改造成消费外壳。

- [x] **Step 1(spike,阻塞)** 坐实外壳薄订阅的机制。**Leg 0(静态)+ Leg 1(传输层)+ Leg 2(重定向后)均已跑完(2026-09-12);Leg 3 移出到 Task 5 Step 3。** Leg 0 改变了机制的形状,Leg 1/2 把剩下的假设全部实测掉。

  **Leg 0(静态读源码,已完成)**:应用走 `useStreamLGP`(选项里没有 `transport`,`dist/react/stream.js` 的分流),返回的 `isLoading` = `stream.isLoading`(`stream.lgp.js:401`),而它**只在两种情况下为真**:① **本 hook 自己**发起 submit(49/55);② 挂载时的 reconnect 路径(386-388)调到 `joinStream(runId)`,而它需要 `reconnectOnMount` 真值(应用已开,`hooks.ts:1667` ⇒ `sessionStorage`)、`lg:stream:<threadId>` 里有 runId,且 `reconnectKey` 这个 memo **重算** —— 它的依赖是 `[runMetadataStorage, stream.isLoading, threadId]`。
  ⇒ **两条推论**:
  - **A(订阅后跑)**:外壳在 run 已在飞时挂上,若 `lg:stream:X` 已有 runId ⇒ 会 join ⇒ `isLoading` 真、能收后续事件。**预期可行。**
  - **B(先订阅后跑,即常见情形)**:外壳的 hook 先挂好,随后页面发送消息、另一个 hook 把 runId 写进 storage ⇒ **外壳那条的 memo 不会重算**(它的 `stream.isLoading` 仍为 false、`threadId` 未变)⇒ **`isLoading` 永远 false**。**静态预测:这条路径不行。**
  ⇒ **机制必须改**:注册协议要带 **runId**,而不是只带 threadId(`useThreadStream` 的 `onCreated` 已经拿到 `meta.thread_id` + `meta.run_id`,`hooks.ts:1676`),外壳侧显式 join。两个候选(**Leg 1 实测后选定 J2**):
  - **J1** 外壳把 runId 写进 SDK 的私有 key `lg:stream:<threadId>` 并让 hook 重挂 —— 零新流代码,但依赖 SDK 私有实现;
  - **J2** 外壳自己 `getAPIClient().runs.joinStream(threadId, runId)` —— join **只当存活信号**,精确状态在 run 结束时**重取一次 thread state**(那时消息已落盘,`wait` 才可靠)。

  **Leg 1(传输层)已跑完(2026-09-12,私有免鉴权实例 8099,不需要登录)**。三条 run,全部在**已在飞行中**时才 `/join`:

  | run | 迟到 | 事件总数 | 收到 | 首个事件 | 终态 |
  |---|---|---|---|---|---|
  | `sleep 45` | 8s | 119 | 119 | `…-0`(run 首事件) | `event: end` ✅ |
  | 1500 字散文 | 10s | 675 | 675 | `…-0` ✅ | `end` ✅ |
  | 2500 字散文 | 32s | 864 | 864 | `…-0` ✅ | `end` ✅ |

  ⇒ **拿到的是从事件 0 的完整回放 + 终结帧**,比原判据要求的「尾部」更强。**未验**:`gap` 路径没能触发(非法 / 合法但极旧 / 未来 id 三种都完整回放;`queue_maxsize` 默认 256,但订阅时事件已远超 256 仍完整回放)⇒ 记为未测,因此 J2 仍要求在 run 结束或收到 gap 时**重取一次 thread state**。

  **Leg 2(原「客户端 A/B 两条件对照」)已重定向并跑完**。原设计要用「第二个 `useStream`」探针在 J1/J2 之间选;但 **Leg 1 已证明原始 `/join` 可用 ⇒ 直接选 J2(客户端级 join),那个探针失去对象**。改为跑两件不需要登录、且真正决定设计的事:
  - **premise(实测钉死「status 说不出在等你」)**:一条以 `ask_clarification` 结束的 run 与普通跑完**完全同形** —— run 都 `success`、`GET /api/threads/{id}.status` 都 `idle`;唯一区分点是消息里的 `artifact.human_input`(`request_id=clarification:call_84b93bbd…`、`input_mode=free_text`、`version=1`)。**判据成立 ⇒ 粗档作废,wait 必须由消息派生。**
  - **并发(把「两条订阅」从推断变实测)**:两个订阅者同时挂同一条 run,**各拿到 111 事件**(`metadata` 1 / `values` 13 / `messages` 95 / `end` 1,逐项相同)、都从 `…-0` 起、都看到 `end`、互不干扰 ⇒ 代价就是 2× 事件量。

  **Leg 3 移出本 spike**:它要「宠物在切页状态下显示 `wait`」,而 2a 未落地时离开聊天页**根本没有宠物** —— 它是功能验收,且**已逐字写在 Task 5 Step 3**,留在那里。

  **证据与可复现性**:结论已写回 spec §10.3 待核实项 ⑤;脚本是一次性的(已删),但上表的数字与判定都在此处与 spec 里。**机制若有变,先改 spec 再写代码。**
- [x] **Step 2(先写红测试)** 契约三条:① **宠物只认外壳那一条** —— 页面那条富 hook 与宠物无关,两者不得争「谁更新宠物」;② `threadId` 切换时的重置照 §11 既有契约(fatigue / `wasLoading` 归零、`greet` **不重放**);③ 无注册线程 / 非聊天页时给出稳定空态,不抛错。
- [x] **Step 3** 实现外壳薄订阅(只取 `messages` + `isLoading`)+ 注册协议。**要点:外壳拿到 threadId 后自己续订,不随页面卸载而断** —— 这正是「换页后仍在跑 / 仍能说在等你」的来源。
- [x] **Step 4(阻塞已解,2026-09-12)** 四个主面**注册 `(threadId, liveRunId)`** —— **不是只有 threadId**:Leg 0 已证「只带线程 id」在那条最常见的路径上永远拿不到 `isLoading`,必须带 runId 才能 join。
  **那条线已落地**(用户选择等它):`liveRunId` 现在在 `HEAD` 里,是**派生值** —— `liveRun && liveRun.threadId === threadId ? liveRun.runId : null`(`hooks.ts:2621`),在 `onCreated` 时置入、随线程本地状态一起清;`chats/[thread_id]/page.tsx` 也已经在解构它。同批还落了一个 `@/core/constitution/run-id::resolveRunId(liveRunId, messages)`。
  **本步只用 `liveRunId`,不用 `resolveRunId`**:后者的回退值是「消息里最近一条 `run_id`」= 一条**已经跑完**的 run,join 上去只会立刻收到 `end`,而 `runId: null` 那条路径已经会取一次 thread state —— 所以回退在这里是白做功。**注册值**:`{ threadId, runId: liveRunId }`;新会话在首条消息前 `threadId` 为空 ⇒ 不登记(也不清掉上一个,见 `useRegisterActivity` 的注释:卸载与空线程都不注销,否则外壳订阅活不过页面)。
  **实际是三个面(不是四个,已改)**:`chats/[thread_id]/page.tsx`、`agents/[agent_name]/chats/[thread_id]/page.tsx`、`knowledge/chat-panel.tsx`。**`agents/new/page.tsx` 被剔除**,依据有据:它**不渲染 `ChatBox`**(第 399 行直接用 `MessageList`),而宠物挂在 ChatBox 的桌面分支 ⇒ **那里没有宠物**,注册它无的放矢;它还把 `threadId: undefined` 硬编码传给 hook、没有 `onStart`,连线程 id 都拿不到;它的线程是引导式(建完 agent 就回不去)。**不改造它们去消费外壳**,它们继续用自己的富 hook。
- [x] **Step 5** 转绿 + 门禁。
- **验收**:契约三条各有用例;Step 1 的 spike 有实测证据;**页面富 hook 与外壳薄订阅同时存在时,`messages` 与 `isLoading` 都正确**。
- **交付纪要(2026-09-12 完成)**:
  - **交付物**:`core/threads/activity.ts`(纯状态机)+ `core/threads/activity-context.tsx`(provider:join 消费 + 注册协议)+ 两个测试文件 + provider 挂载到 `WorkspaceContent` + **三处**注册。
  - **测试量**:**21 例**(14 node 纯函数 + 7 DOM);连同本线既有套件,`core/threads + core/pet + components/pet` **348 例全过**。门禁:scoped eslint 干净、**tsc 全量干净**。
  - **revert 证明(两轮,都恰好命中)**:(1) provider 层同时破坏三处(换目标不 abort / 不重取 / 无 run 时不取状态)⇒ **恰好 3 条红**、其余 3 条绿;(2) 修掉两个自埋缺陷后再同时破坏(去掉幂等与保留标志 / 恢复卸载注销)⇒ **恰好 3 条红**(2 node + 1 DOM)。
  - **过程中修掉的两个自埋缺陷**:① `useRegisterActivity` 原本**卸载即注销** ⇒ 一离开会话页订阅就断,与「离开聊天页仍在跑」正相反 —— 改为卸载与空线程都**不**注销(换会话由下次注册覆盖);② `register` 原本重置 `needsRefetch` ⇒ run 刚结束标记的重取会被紧随其后的重注册吃掉 —— 改为同线程重注册**保留**该标志,并加**幂等**判定(完全相同的注册不动状态,否则一次重放会把在跑的 join 抹成停跑)。
  - **偏离 spec/plan**:① 注册面 **4 → 3**(剔 `agents/new`,依据见 Step 4);② **放弃 `resolveRunId`**,只用 `liveRunId`(理由见 Step 4);③ 注册值从 plan 原文的「只注册线程 id」改为 **`(threadId, liveRunId)`**(Leg 0 结论)。
  - **未覆盖(诚实记录)**:**三处注册是页面级接线,没有单测** —— tsc 只保证调用形状正确;「切页之后宠物仍能说 wait」要等 **Task 5 的浏览器阶梯**才验。provider 的 `gap` 与 `join-error` 两条分支**只有单测覆盖,从未被真栈触发**。
  - **过渡状态(提交时必须知道)**:注册已接上 ⇒ **外壳订阅现在会真的跑起来**,与页面那条**并存**(已量化:2× 事件量)。宠物**仍读页面的 `useThread()`**,要等 Task 2 把它挂到外壳并改读 `useAppActivity()`;在那之前这是一笔**已知、已量化、spec 里记过的过渡成本**。

## Task 2:挂点迁移 + 断点重推

**进展(2026-09-12):Step 1 / 2 / 3 / 5 已交付;Step 4(断点)与 Step 6(真栈部分)待浏览器。**

- [x] **Step 1** 给内容区加容器上下文:`WorkspaceContent` 里 `<SidebarInset className="min-w-0 [container-type:inline-size]">` —— `SidebarInset` 的 `className` 走 `cn(...)` 合并(`components/ui/sidebar.tsx:307-318` 已核实),**不改 `ui/` 下的生成文件**。**风险已排除**:`container-type` 会给 `fixed` 后代换包含块,而 workspace 下**全量 grep 确认没有任何 `fixed` 后代**,这一层安全。
- [x] **Step 2** `AgentPet` 从 `chat-box.tsx` 的 `div#chat` 迁到外壳(落 `SidebarInset` 内,与 `CommandPalette` / `Toaster` 同层);`aria-hidden`、`pointer-events-none`、`z-20` 三项不变。**同时改了数据源**:`useThread()` → `useAppActivity()`,并**去掉 `threadId` prop**(重置键改从 `activity.target?.threadId` 取)。为此给活动状态**补了 `hasError`**:宠物的优先级是 error > 在跑 > wait > done(§5.3 不变量 1),少了它,外壳版宠物永远到不了 error 态 —— 页面的 `thread.error` 在迁移中是丢掉的。**消息类型在宠物这一侧收口**(`activity.messages as Message[]`):活动层刻意对消息形状不可知。
- [x] **Step 3(回收)** 已删掉 `div#chat` 上那条 `[container-type:inline-size]`,以及 `chat-box.tsx` 里 `<AgentPet threadId={…} />` 与它的 import(宠物不再挂在聊天页里)。`chat-box.tsx:401` 那条在 `ResizablePanelGroup` 上是既有的、**不在本线范围**,不动。
- [x] **Step 4(断点:实测后**保持 480**,不改 `globals.css` 的阈值)** —— 2026-09-12 真实应用采样(用户操作):边界落在内容区 **482 显示 / 480 隐藏**,回程 **479 隐藏 / 483 显示** ⇒ 容器查询确实量的是内容区(闭区间确认)。**同时测出那条规则在桌面布局里永远触发不到**:内容区 = 窗口 − 侧边栏(展开 **256** / 收起 **48**),窗口 <768 切移动布局(此时内容区 = 窗口)⇒ 桌面最窄内容区 = `768 − 256 = `**512** > 480。**用户裁定:窄窗口(481–767)也要有宠物**(实测 512–600 不挤),故阈值**不动**;只更新了 `globals.css` 的注释与 spec §10 的布局覆盖裁决(原「第 1 期桌面端 only」作废)。
- [x] **Step 5(`pet.offset` 语义重估;结论:保持 `{ right: 12, top: 56 }`)** 坐标空间从「chat 面板」换成「内容区」,但**默认值不变**,理由:**需要让开的 header / 工具栏本来就在内容区里面**(聊天页的 `h-12` header 与知识库工具栏都由页面自己渲染,不在内容区之外)⇒ 垂直让位量不变;水平上 `right: 12` 在聊天页仍等价于「距 chat 面板右缘 12px」。差异只出现在**非聊天页**(宠物现在在那里也出现),与各页工具栏的观感交给 **Task 5 Step 7**。
- [x] **Step 6** 门禁 + 真栈浏览器验收。**代码侧已过**(1164 例、tsc/eslint 干净)。**真栈(用户实测 2026-09-12)**:① 切页后宠物还在 ✓(迁移的核心成果);② `/`、`/login`、showcase 404 页都**没有**宠物 ✓;③ 断点边界有实测数字 ✓。**未验**:④ 拖 sidecar 不再改变宠物可见性(容器已换成内容区,理论上与之无关,但**没有实测**)。
- **验收**:① ✅(用户实测)② ✅(用户实测)③ ✅(482/480 边界)④ **未验**
- **交付纪要(2026-09-12)**:
  - **交付物**:`AgentPet` 改挂 `SidebarInset` 并改读 `useAppActivity()`(去掉 `threadId` prop);`SidebarInset` 承载容器上下文;`chat-box.tsx` 移除宠物挂载与 `div#chat` 的 `container-type`;活动状态**新增 `hasError`**(否则 error 态在迁移中静默丢失);宠物 DOM 用例改用 `ActivityProvider`,并新增「活动里的未答请求 ⇒ `wait.webp`」这条核心断言。
  - **测试量**:agent-pet **7 → 9 例**;`tests/unit/core` + `tests/unit/components/workspace` **1164 例全过**;tsc 全量干净、eslint 干净。
  - **改写/偏离**:① spec §10 的「第 1 期桌面端 only」**作废**(原理由「mobile 分支没有 `id="chat"`」随迁移失效);② `frontend/AGENTS.md` 的 Interaction Ownership (a) 已同步(挂载点 / 容器 / 公开路由 / 注册语义);③ 注册值带 `liveRunId`、只用 `liveRunId` 不用 `resolveRunId`(见 Task 1)。
  - **未覆盖**:④ sidecar 拖拽;**Task 5 的阶梯**(跨页 `wait` / 缩放 / 跳转 / 非聊天页观感)整体仍待做。
  - **已知但未处理**:窄窗口(481–767)现在也会显示宠物 —— 这是**用户明确要的**(裁定见 spec §10),不是缺陷;窗口 <480 时由那条容器规则兜底隐藏。

## Task 3:缩放控件

- [ ] **Step 1(先写红测试)** 纯函数先立:`clampToEven`(恒偶数的取整)、`clampOffset` 在 `displaySize` 变化后重算盒矩形。node 用例覆盖边界(64 / 256 / 奇数输入 / 越界 offset)。
- [ ] **Step 2** `core/settings/local.ts` 的 pet 节加 `displaySize`(默认 158,按节 merge ⇒ **无需迁移**);设置行照 §10.1 加「重置」。
- [ ] **Step 3** 控件:滑杆或档位(档位建议 64/96/128/158/192/256),**恒偶数**;>156 段标注「开始插值」并在 156 给吸附点(§10.2)。
- [ ] **Step 4(必须处理)** **松手才应用** —— `onPointerUp` / `onChangeEnd` 才写设置。理由:盒子尺寸变化会重排并重置 `background-position` 的百分比基准(§9.1 那条实测),逐帧应用会抖帧。
- [ ] **Step 5** 渲染层从设置读 `displaySize`(`manifest.displaySize` 降级为默认值);缩放后**重跑一次 clamp**。
- [ ] **Step 6** DOM 用例:控件交互、偶数取整、松手才写设置(拖动中不写)。
- **验收**:§10.2 的五条(偶数 / DPR 1.5 整数设备像素 / **拖动不抖帧** / 缩放后不出屏 / 切状态不空白)+ 刷新后持久。
- **交付纪要**:待填。

## Task 4:单目标点击跳转(Alt+单击)

宠物代表**一个**线程,点它直接跳回那一个 —— **不做选择器**(多会话版属另一条线,见 spec §17「浮动会话卡」)。用户 2026-09-12 选「先做单目标」,手势定为 Alt+单击。

- [ ] **Step 1(复用而非新写)** 走 §10.1 已有的 Alt+`pointerdown` window 级命中路径:把「Alt + 位移 **<4px** 后抬起」判定为**单击**,**≥4px 仍是拖拽**(阈值不变)。**宠物仍 `pointer-events-none`**,入口只在命中矩形上 —— 纯单击被否决,因为那要求 idle 时给宠物指针事件,会静默吞掉底下消息列表的点击。
- [ ] **Step 2** 跳转规则:目标线程**不在当前页时才跳**,否则不做任何事(知识库面板也注册 ⇒ 在知识库页点它可能是无操作)。路径必须走 `core/threads/utils.ts::pathOfThread()`(仓库约定:百分号编码自定义 agent 名与 thread id)。
- [ ] **Step 3** 单击**不得**触发底下的消息链接 —— 复用 §10.1 已有的「拖后吞 click」逻辑,不新写一套。
- [ ] **Step 4** 设置行提示文案补一句「Alt+单击回到该会话」(发现性由文案承担,与 §10.1 同款)。
- [ ] **Step 5** DOM 用例:Alt+位移 <4px 触发跳转且**不写 offset**;Alt+位移 ≥4px 只拖拽**不跳转** —— 两条互斥,钉住 4px 这个分叉。
- **验收**:① 在非聊天页 Alt+单击 ⇒ 回到宠物代表的那个线程;② 当前页就是目标线程 ⇒ **无操作**(不刷新、不跳空路由);③ 不按 Alt 单击 ⇒ 什么都不发生且点击穿透到下方内容;④ §10.1 的拖拽六项**不回归**。
- **交付纪要**:待填。

## Task 5:浏览器验收阶梯(**不可用单测替代**)

前 1 期的阶梯是在**占位帧**上跑的(已在 spec §18 标注),本期必须用**真美术**重跑与本线相关的部分。

- [ ] **Step 1** 起栈(`backend` 的 gateway + `frontend` 的 `scripts/pnpm.py dev`;无 nginx,`make dev` 必失败),登录后进一个线程。
- [ ] **Step 2(跨页)** 依次切到 agents / knowledge / scheduled-tasks,每次断言宠物节点存在且仍在播;再进 `/`、`/login`、`/docs` 断言**不存在**。
- [ ] **Step 3(核心)** 触发 `ask_clarification` ⇒ 切到**另一个页面** ⇒ 宠物仍显示 `wait`(这是「app 的灯」的验收点,也是本期唯一的产品判断);答完 ⇒ 切页仍回落 `idle`。
- [ ] **Step 4(缩放)** 拖滑杆全程截图/采样,确认无帧位抖动;256 与 64 两端都试;刷新验证持久;缩放后把宠物拖到边缘验证 clamp。
- [ ] **Step 5(断点)** 把内容区宽度压到新阈值附近,确认闭区间行为;并记录与旧 480 的差异。
- [ ] **Step 6(跳转)** 在 agents 页 Alt+单击 ⇒ 回到宠物代表的线程;当前页即目标线程 ⇒ 无操作;不按 Alt 单击 ⇒ 穿透且什么都不发生。
- [ ] **Step 7(观感)** 知识库三列布局下的落位 —— 这是宠物第一次出现在非聊天页,重点看遮挡与视觉重量。
- **验收**:每步给证据(截图 / DOM 断言 / 计算样式采样),**无证据的步骤记为未验**。
- **交付纪要**:待填(含未验项)。

## Task 6:文档同步

- [ ] **Step 1** `frontend/AGENTS.md` 的 Interaction Ownership:挂载点从 `div#chat` 改写为外壳(`SidebarInset`)+ 撤掉「mobile 分支没有 `id="chat"` 所以不挂」那条理由(跨页后这个理由不再成立,改写成「公开路由不挂」)+ 把 Alt 那条从「拖拽」补成「拖拽 / 单击两分支」。三条不变量 (a) 需重写,(b)(c) 原样。
- [ ] **Step 2** spec §18 补 2a 交付状态(含测试量、真栈验收、未验项);§10.3 待核实项按 Task 0 结论关闭。
- [ ] **Step 3** 若 `displaySize` 的取值/语义与 §8 的补偿公式有出入,同步 §8。
- **验收**:两份文档与代码一致;无「待填」。
- **交付纪要**:待填。

---

## 依赖与并行

- **Task 0 阻塞 1-6**(② 的结论决定 1 的形态)。
- **Task 3(缩放)不依赖任何别的 Task** —— 它只动设置节、`placement.ts` 与 `pet-sprite.tsx` 的盒子尺寸,与外壳订阅无关(本条 2026-09-12 更正:原文写成「依赖 Task 1」是过度约束)。**所以 Task 1 Step 4 挂起期间可以先做 Task 3。**
- Task 2 依赖 Task 1(挂到外壳才有壳订阅可读)。
- **Task 4 依赖 Task 1 + Task 2**(要有壳订阅才知道跳去哪,要有壳挂载才有那个点击目标)。
- **2b(美术)与本 plan 完全无依赖**,可同时进行:另一个会话出 `think` / `work` / `error` / `done` / `greet` 五组帧,帧到位后翻 `WORK_KIND_ENABLED`,不碰本 plan 的任何文件。(**疲劳轴不在 2b**:用户 2026-09-12 明确不做,闸门 `FATIGUE_ENABLED` 恒 `false`,见 spec §17。)
