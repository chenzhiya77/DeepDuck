# Agent 宠物 2a:app 的灯 + 缩放控件(2026-09-12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**:把宠物从「这个线程的灯」变成「**app 的灯**」—— 在 `workspace` 全站任意切换都在;并让 `displaySize` 用户可控。

**设计依据**:`docs/superpowers/specs/2026-09-09-agent-pet-sprite-design.md` 的 §4.1 重开段、§10.2(缩放)、§10.3(跨页)。**本 plan 不重新论证设计**;与 spec 冲突时先改 spec。

**本期的定义性约束**:零美术、零新帧。只有前端架构、设置与控件。美术增量见 2b(另一份 plan / 另一个会话)。

**约定**:
- 纯逻辑放 `core/pet/`(`*.test.ts`,node 环境);只有真渲染才用 `*.dom.test.tsx`(贵约 3 倍)。
- 每个 Task 末尾写**交付纪要**:真实数字 / revert 证明 / 偏离 / 未覆盖项。**未覆盖项必须显式列出**,不许用「验证通过」盖过去。
- 门禁:`frontend` 下 `pnpm check`(scoped eslint + 过滤 tsc)+ 相关测试全绿。
- **提交粒度**:Task 0 结论落 spec 一笔;Task 1-5 按可独立回滚的单元提交。提交前 `git status` 核对该笔只含本线文件。

---

## Task 0:前置核实与设计取舍(**阻塞后续所有任务**)

§10.3 列了四个待核实项,其中第 ② 项会**决定 Task 1 的形态** —— 不闭环不许写代码。

- [ ] **Step 1(能不能不动 sidecar / knowledge)** 读 `components/workspace/sidecar/sidecar-panel.tsx:156` 与 `components/workspace/knowledge/chat-panel.tsx:163` 的 `useThreadStream` 调用:**它们传的 `threadId` 是不是当前主线程**(`displayThreadId` / `context` 各是什么)。结论只有两种:① 用的是别的线程 ⇒ 本期不动;② 与主线程同一个 ⇒ 它们也必须改成消费 provider,工作量翻倍。
- [ ] **Step 2(薄 vs 厚)** 通读 `core/threads/hooks.ts:1534` 的 `useThreadStream` 全貌,把返回值与内部状态分成两类:**页面专属**(`optimisticMessages`、`pendingSuperseded*`、`isUploading`、replay mask、`onSend/onStart/onFinish` 监听)与**宠物需要的**(`messages`、`isLoading`,以及切线程时的重置契约)。产出是一张清单,不是印象。
- [ ] **Step 3(三条候选做取舍)** 用 Step 2 的清单在三条里选一条,判据是**换页后仍能说出「在等你」**、且不引入难以收拾的副作用:

  | 候选 | 形态 | 已知代价 |
  |---|---|---|
  | **A 整体上提** | 把 `useThreadStream` 提到外壳,页面改成消费 | 一大坨页面专属状态跟着进外壳,风险最高 |
  | **B 薄订阅并列** | 外壳只用 SDK `useStream` 订 `messages`+`isLoading`;页面保留自己的富 hook | 同一线程**两条订阅**;要证明双订阅无害(后端 StreamBridge 是多订阅广播,但必须实地确认,不能推断) |
  | **C 页面快照广播** | 页面把宠物需要的切片发布到外壳 store | 最便宜,但**换页即失活** ⇒ 说不出「在等你」,**已判为不满足目标**(除非前两条都被否) |

- [ ] **Step 4** 结论写回 spec §10.3,把「待核实项 ① ②」关掉或改写;**若结论推翻 §10.3 的形态,先改 spec 再动代码**。
- **验收**:Step 1 有明确引文;Step 2 有清单;Step 3 有选定项 + 否掉另两条的理由;spec 相应处已更新。
- **交付纪要**:待填(含「读了哪些文件、判定依据、哪条候选被否及原因」)。

## Task 1:当前线程 provider(TDD)

按 Task 0 的裁决实现「外壳持有当前线程」的那一层。

- [ ] **Step 1(先写红测试)** 契约三条:① messages / isLoading 的来源**唯一**(外壳与页面不能各读各的);② `threadId` 切换时的重置照 §11 的既有契约(fatigue / `wasLoading` 归零、`greet` **不重放**);③ 无当前线程时(新会话页、非聊天页)给出稳定的空态,不抛错。
- [ ] **Step 2** 实现 provider(落点按 Task 0 的裁决;候选文件 `core/threads/` 新增一个 context,或扩展现有 `components/workspace/messages/context.ts`)。
- [ ] **Step 3** 三个 chat 页面(`chats/[thread_id]/page.tsx`、`agents/[agent_name]/chats/[thread_id]/page.tsx`、`agents/new/page.tsx`)改成消费 provider。
- [ ] **Step 4** 转绿 + 门禁。
- **验收**:三条契约各有用例;**双订阅的防法有一条可执行的证据**(选 B 时:实测两条订阅同时存在时消息与 isLoading 都正确;选 A 时:实测页面不再自建流)。
- **交付纪要**:待填。

## Task 2:挂点迁移 + 断点重推

- [ ] **Step 1** 给内容区加容器上下文:`WorkspaceContent` 里 `<SidebarInset className="min-w-0 [container-type:inline-size]">` —— `SidebarInset` 的 `className` 走 `cn(...)` 合并(`components/ui/sidebar.tsx:307-318` 已核实),**不改 `ui/` 下的生成文件**。
- [ ] **Step 2** `AgentPet` 从 `chat-box.tsx:415` 的 `div#chat` 迁到外壳(与 `CommandPalette` / `Toaster` 同一层);`aria-hidden`、`pointer-events-none`、`z-20` 三项不变。
- [ ] **Step 3(回收)** 迁移后 `div#chat` 那条 `[container-type:inline-size]`(`chat-box.tsx:415`)失去消费者 —— 已核实**除 `.pet-shell` 外全仓库没有别的 `@container` 消费者**(`globals.css:108` 是唯一一条规则,`src/` 下无 Tailwind 容器变体)。确认后删掉;`chat-box.tsx:401` 那条在 `ResizablePanelGroup` 上是既有的、**不在本线范围**,不动。
- [ ] **Step 4(断点重推)** 实测内容区宽度下的隐藏断点,**不沿用 480**。记录:多少 px 时宠物开始压到可见内容/布局崩坏,据此取闭区间阈值。
- [ ] **Step 5(`pet.offset` 语义重估)** 默认值从「面板内缩进 12/56」重估 —— 56 的理由(避开 `h-12` 的 header)跨页后不成立;写新默认值并说明依据。
- [ ] **Step 6** 门禁 + 真栈浏览器验收(task 4 复验)。
- **验收**:① workspace 五个面之间切换宠物都在;② 公开路由(`/`、`/login`、`/docs`、`/blog`)**没有**宠物;③ 新断点有实测数字;④ 拖 sidecar 不再改变宠物可见性(与 §10 旧行为不同,属预期)。
- **交付纪要**:待填。

## Task 3:缩放控件

- [ ] **Step 1(先写红测试)** 纯函数先立:`clampToEven`(恒偶数的取整)、`clampOffset` 在 `displaySize` 变化后重算盒矩形。node 用例覆盖边界(64 / 256 / 奇数输入 / 越界 offset)。
- [ ] **Step 2** `core/settings/local.ts` 的 pet 节加 `displaySize`(默认 158,按节 merge ⇒ **无需迁移**);设置行照 §10.1 加「重置」。
- [ ] **Step 3** 控件:滑杆或档位(档位建议 64/96/128/158/192/256),**恒偶数**;>156 段标注「开始插值」并在 156 给吸附点(§10.2)。
- [ ] **Step 4(必须处理)** **松手才应用** —— `onPointerUp` / `onChangeEnd` 才写设置。理由:盒子尺寸变化会重排并重置 `background-position` 的百分比基准(§9.1 那条实测),逐帧应用会抖帧。
- [ ] **Step 5** 渲染层从设置读 `displaySize`(`manifest.displaySize` 降级为默认值);缩放后**重跑一次 clamp**。
- [ ] **Step 6** DOM 用例:控件交互、偶数取整、松手才写设置(拖动中不写)。
- **验收**:§10.2 的五条(偶数 / DPR 1.5 整数设备像素 / **拖动不抖帧** / 缩放后不出屏 / 切状态不空白)+ 刷新后持久。
- **交付纪要**:待填。

## Task 4:浏览器验收阶梯(**不可用单测替代**)

前 1 期的阶梯是在**占位帧**上跑的(已在 spec §18 标注),本期必须用**真美术**重跑与本线相关的部分。

- [ ] **Step 1** 起栈(`backend` 的 gateway + `frontend` 的 `scripts/pnpm.py dev`;无 nginx,`make dev` 必失败),登录后进一个线程。
- [ ] **Step 2(跨页)** 依次切到 agents / knowledge / scheduled-tasks,每次断言宠物节点存在且仍在播;再进 `/`、`/login`、`/docs` 断言**不存在**。
- [ ] **Step 3(核心)** 触发 `ask_clarification` ⇒ 切到**另一个页面** ⇒ 宠物仍显示 `wait`(这是「app 的灯」的验收点,也是本期唯一的产品判断);答完 ⇒ 切页仍回落 `idle`。
- [ ] **Step 4(缩放)** 拖滑杆全程截图/采样,确认无帧位抖动;256 与 64 两端都试;刷新验证持久;缩放后把宠物拖到边缘验证 clamp。
- [ ] **Step 5(断点)** 把内容区宽度压到新阈值附近,确认闭区间行为;并记录与旧 480 的差异。
- [ ] **Step 6(观感)** 知识库三列布局下的落位 —— 这是宠物第一次出现在非聊天页,重点看遮挡与视觉重量。
- **验收**:每步给证据(截图 / DOM 断言 / 计算样式采样),**无证据的步骤记为未验**。
- **交付纪要**:待填(含未验项)。

## Task 5:文档同步

- [ ] **Step 1** `frontend/AGENTS.md` 的 Interaction Ownership:挂载点从 `div#chat` 改写为外壳(`SidebarInset`)+ 撤掉「mobile 分支没有 `id="chat"` 所以不挂」那条理由(跨页后这个理由不再成立,改写成「公开路由不挂」)。三条不变量(a)(b)(c)中 (a) 需重写,(b)(c) 原样。
- [ ] **Step 2** spec §18 补 2a 交付状态(含测试量、真栈验收、未验项);§10.3 待核实项按 Task 0 结论关闭。
- [ ] **Step 3** 若 `displaySize` 的取值/语义与 §8 的补偿公式有出入,同步 §8。
- **验收**:两份文档与代码一致;无「待填」。
- **交付纪要**:待填。

---

## 依赖与并行

- **Task 0 阻塞 1-5**(② 的结论决定 1 的形态)。
- Task 2 / 3 相互独立,可并行;两者都依赖 Task 1。
- **2b(美术)与本 plan 完全无依赖**,可同时进行:另一个会话出 `think` / `work` / `error` / `done` / `greet` 五组帧 + 阈值校准,不碰本 plan 的任何文件。
