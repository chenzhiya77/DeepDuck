# 知识库详情 tab 行窄栏溢出（渐隐遮罩 + 点击下拉）—— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-28-kb-tabs-overflow-design.md](../specs/2026-09-28-kb-tabs-overflow-design.md)
**Status:** 📝 **Task 0–1 已交付（2026-09-28）——Task 2 起待开工**。已裁（均 2026-09-28）：**D1 乙（固定折叠边界）/ D2 甲（保留滚动双通道）/ D4 甲 · D5 · D6 照默认冻结**；docs 成对提交（docs-only）。**同日审查 ①–⑧ 已改**（签名/勾点/滚入/证据/命名/行号/措辞/标估）+ 不变式入硬约束。**Task 0 五项已回填**（含 ② 预扫口径纠正：role=tab 守护用例四文件、会红面 0）；**Task 1 已提交 `8a8a834d`**（纯函数 + node 用例，RED 5 红 → GREEN 5 绿 → neuter {②,③}/{③} → 还原 5 绿 + 门禁净）。
**相关记录**：[2026-09-24-settings-responsive-layout.md](2026-09-24-settings-responsive-layout.md)（同页相邻、零文件重叠，已交付）。

**Architecture:** 四件事 —— **① 纯函数** `computeFoldCount(containerWidth, itemEnds[], maskWidth)` = 固定折叠边界（D1 乙：有效宽扣遮罩宽、"完整放得下"才留平铺侧、半露归尾；`itemEnds[i]` = trigger 的 `offsetLeft+offsetWidth`，与 D1 同口径、**天然含 gap/内边距**——不得改回"宽度累加"签名）**② TabStrip 组件**（滚动容器 + 迁入的 `TabsList`/`TabsTrigger` + 行尾渐隐遮罩 40px + chevron + `DropdownMenu`（下拉项 = 边界尾，复用 `tabs.*` 六词））**③ middle-tabs 接线**（六 trigger 迁入，`mx-4` 边距移到滚动容器）**④ 激活滚入**（D4 甲：滚入**有效可见区**即扣除遮罩宽）+ i18n `tabs.more` 三文件。

**硬约束（spec 已裁/已定，实现时不许自行放松）**：

- **D1 乙**：下拉内容 = 固定折叠边界**之后**的尾巴（N+1…6），**不含**平铺侧的项；边界只随**宽度**重算，**滚动永不改下拉内容**。
- **D3**：遮罩 = 渐隐 + chevron（›）**整块可点开下拉**（不另放 ⋯ 按钮）；固定 **40px** 骑行尾；出现条件只有 `scrollWidth > clientWidth` 一个布尔。
- **D2 甲（已裁）**：滚动（滚轮 + 拖拽）与下拉**双通道**并存，不删滚动。
- **D4 甲**：激活项变化（含从下拉切回）自动滚入**有效可见区**（= 栏宽 − 遮罩宽；不得停在 40px 遮罩下）。
- **不变式**：六 trigger **永不移出 DOM**（Radix 方向键循环 + D1"滚动不改成员"都靠它；折叠只是呈现层）。
- **宽栏零变化**：全放得下时无遮罩、无下拉触发器，`TabsList` 六 trigger 与现状一字不变（验收 5 钉）。
- **不动**：`ui/tabs.tsx` 生成件 · `panels-shell.tsx` · 六个 tab 内容组件与 `forceMount` keep-alive · `onTabChange` 值域 · 后端全部。
- **结构要点三条**（spec §3）：滚动容器底部内边距垫高（防吞 `bottom:-5px` 激活下划线）· 滚动条隐藏 · 遮罩 `bg-background` 渐变 + `<button type="button">`。
- **用例只钉结构**（类名 / 显隐 / 文案原文 / 回调值 / mock 调用），**不钉几何**；几何归 Task 3 真浏览器（`localhost:3000` 只读）。

**Global Constraints:**

- 分支 `feat/rag-knowledge-base`；每个 Task：**RED → GREEN → neuter（带 revert proof）→ 门禁 → commit**（Conventional Commits）。
- **前端命令**：`cd frontend && PYTHONIOENCODING=utf-8 python ../scripts/pnpm.py <script>`；门禁 = `pnpm check` + `pnpm test`；**prettier 新债**只重排自己那几行（「新债行号交集法」）。
- **不起隔离实例**；Task 3 只驱动用户已在跑的 `:3000`、**只读**；不碰任何配置文件。
- **每个 Task 的 `**实测**` 行必须回填**（RED/GREEN/neuter 受害者/门禁数字）——未回写的 plan 不算交付。
- **scope fence**（spec §1.3/§6）：tab 换行 · Priority+ 逐个收 · IA 合并 · 下拉排序/置顶 · 遮罩宽调参（40→28 是逃生口，验收观感不佳才动）· 内层滚动与外层 ScrollArea 嵌套若打架的逃生口（内层只留拖拽 + 下拉）。

**依赖顺序**：Task 0（只读核实）→ Task 1（纯函数）→ Task 2（TabStrip + 接线 + i18n）→ Task 3（激活滚入 + 文档 + 真浏览器 + 全量门禁收官）。

---

## Task 0 — 开工前五项核实（只读）

- [x] 1. **测量口径**（裁剪层已核：react-resizable-panels **库内联 `overflow:"hidden"`**，`ui/resizable.tsx` 纯透传）：`TabsList` 的 `mx-4 mt-2`（`middle-tabs.tsx:202`）在装进滚动容器后 margin 落谁身上（spec §3 要求移到容器外侧）；`variant="line"` 激活下划线 `bottom:-5px`（`ui/tabs.tsx:70`）所需底部内边距数值（报"垫多少"）。
- [x] 2. **会红断言扫描**（审查已预扫：`middle-tabs.dom.test.tsx` 对 `TabsList`/`TabsTrigger`/`tabs.*` **0 命中**）：复核零命中即可（类名 + 文本计数两类都看，settings 对 Task 2 的教训）；顺带定案——要不要在 `middle-tabs.dom.test.tsx` 补钉宽栏六 trigger 形态（验收 5 的落点）。
- [x] 3. **测量注入配方**：`eval-tab.dom.test.tsx:458-488` 的 `Object.defineProperty(HTMLElement.prototype, "scrollWidth", …)` 先例复核；`offsetWidth` 同法注入的可行性给方案（dom 用例要伪造 itemWidths / 容器宽）。
- [x] 4. **i18n 落点**：`knowledge.tabs.*` 六词消费点清单（除 `middle-tabs.tsx:203-208` 外还有谁读）；`types.ts:551-560` 块内 `tabs.more` 插入位置；zh/en 对应行号。
- [x] 5. **嵌套滚动手感**（spec §6.5）：外层横向 `ScrollArea`（`panels-shell.tsx:275`）与内层 tab 滚动容器的 wheel 归属——推理 + （若可行）真栈只读复核，给结论：内层能独立横滚 / 需要逃生口。

**实测（2026-09-28，Task 0 五项）**：

- ① ✅ **margin 归属**：`mx-4 mt-2` 移到滚动容器**自身**（外边距、不进滚动内容）；测量容器宽 = 容器 `clientWidth`（不含自身 margin）。**垫多少**：`after:bottom-[-5px]` + `after:h-0.5`（`ui/tabs.tsx:70`）——trigger 底边距 `TabsList` 底 3px（`p-[3px]`），下划线带占 trigger 底下 3~5px ⇒ 越过 `TabsList` 底边 **2px**；滚动容器**最低垫 2px，取 `pb-1.5`（6px）**。
- ② ✅ **纠正预扫口径（重要）**：字面量（`TabsList`/`TabsTrigger`/`tabs.`）确为 0 命中，但 **role=tab 断言存在**——四个文件经 `MiddleTabs` 钉 tab：`middle-tabs.dom.test.tsx:60-77`（第六 trigger「评测」+ mouseDown 激活 + 六 pane keep-alive）/ `wiki-panel.dom.test.tsx:128-150`（「文档」「百科」+ 激活 + keep-alive）/ `graph-tab.dom.test.tsx:91-119`（「知识图谱」×3）/ `vector-tab.dom.test.tsx:99-115`（四 trigger + 激活 + keep-alive）。全部走 `getByRole("tab", {name})` + `mouseDown`（Radix automatic）+ pane `data-testid`，**零类名 / 零顺序 / 零 DOM 结构钉** ⇒ 不变式成立（trigger 留 Radix、同标签、常驻 DOM、`TabsContent` 不动）时**会红面 = 0**；四文件 = 验收 5/不变式的**守护用例**，Task 2 GREEN 后作提交回归。`document-panel.dom.test.tsx:85` 仅注释提及、无钉。定案：**不补钉**宽栏形态（验收 5 的新钉落 `tab-strip.dom.test.tsx`）。
- ③ ✅ **配方 = 先例扩展**：`eval-tab.dom.test.tsx:458-488`（`Object.defineProperty(HTMLElement.prototype, "scrollWidth", …)` + afterEach 还原原 descriptor / delete）✓ 照抄可用；但折叠判定要注入**三样**——容器 `clientWidth` + 各 trigger `offsetLeft` / `offsetWidth`（jsdom 全 0）。方案：容器走 prototype 配方（同 scrollWidth），各 trigger 走**实例级** `Object.defineProperty(el, "offsetWidth"|"offsetLeft", { value })`（实例属性遮蔽原型 getter，逐元素不同值、还原只需删实例键）。
- ④ ✅ **插入点钉准**：消费点唯一 = `middle-tabs.tsx:203-208`（六行 `tk.tabs.*`）。插入位：`zh-CN.ts:600` `eval: "评测",` 后加 `more: "更多标签页",` / `en-US.ts:643` `eval: "Evaluation",` 后加 `more: "More tabs",` / `types.ts:559` `eval: string;` 后加 `more: string;`（带一行注释）。
- ⑤ ✅ **不打架（推理定案，真栈手感并入 Task 3）**：内层 `overflow-x:auto` 是横向手势（Shift+滚轮 / 触控板横滑）的最近可滚祖先——它有溢出时手势归它、无溢出时落给外层 `ScrollArea`（`panels-shell.tsx:275`）；纵向滚轮在条带上不产生横滚（内层无纵向溢出）⇒ 落给页面纵向；Radix ScrollArea 的 viewport 不劫持 wheel。**结论：不需要逃生口**（§6.5 那条逃生口不用启用）；Task 3 真浏览器拖分隔条时顺手复核手感。

---

## Task 1 — 纯函数 `computeFoldCount`（spec D5）

> 动到的文件：`components/workspace/knowledge/tab-strip.utils.ts`（新）、`tests/unit/knowledge/tab-strip.unit.test.ts`（新，node 环境；命名照 `eval-trend-chart.unit.test.ts` 先例）。
> **验收对应**：spec §4 的 1。

- [x] **RED**：纯函数（签名 `computeFoldCount(containerWidth, itemEnds[], maskWidth)`，`itemEnds[i]` = trigger 的 `offsetLeft+offsetWidth`）用例五情形：① 全放得下（N=全部、无溢出）；② 溢出且扣遮罩宽后前 N 个完整；③ 半露 tab 归尾（不截断在平铺侧）；④ 仅 1 个放得下；⑤ 空表 0。此刻无实现 ⇒ 红（import 不存在）。
- [x] **GREEN**：`computeFoldCount(containerWidth, itemEnds, maskWidth)` 按 spec D1 边界规则实现（有效宽 = 溢出时 `containerWidth - maskWidth`；按 `itemEnds` 逐项判 `end ≤ 有效宽`、完整才计数——**天然含 gap/内边距，不得改回宽度累加**）。
- [x] **neuter ①**：去掉遮罩宽扣除 ⇒ ②（及依赖它的 ③）红、①④⑤绿（受害者不相交按断言粒度记）。
- [x] **neuter ②**：把半露归尾改成四舍五入计数 ⇒ ③ 红、其余绿。
- [x] **还原证明** + **门禁**：`pnpm check` 净；prettier 只动自己新写的行。

**实测（2026-09-28，Task 1 完成）**：

- **RED**：5 条全红——`Cannot find module '@/components/workspace/knowledge/tab-strip.utils'`（实现不存在）。
- **GREEN**：实现 = 溢出判定 `itemEnds.some(end > containerWidth)` → 有效宽 = 溢出 ? 容器宽 − 遮罩宽 : 容器宽 → **前缀计数**（逐项 `end ≤ 有效宽`、遇第一个放不下的即停）⇒ **5/5 绿**。
- **neuter ①（去遮罩宽扣除）**：**②③ 红 / ①④⑤ 绿** ⇒ 受害 = {②,③}，与计划预测一致。
- **neuter ②（半遮算可见 `end > effective + mask/2`）**：**仅 ③ 红 / 其余 4 绿** ⇒ 受害 = {③}，与计划一致；两轮受害者集按断言粒度区分（①{②,③} ②{③}）。
- **还原证明**：复原 **5/5 绿**。**门禁**：`pnpm check`（eslint + tsc）净。**prettier**：两新文件 `--check` 通过、零新债。

---

## Task 2 — TabStrip 组件 + 接线 + i18n（spec §3 / D1 乙 + D2 甲 + D3 + D6）

> 动到的文件：`tab-strip.tsx`（新）、`middle-tabs.tsx`（六 trigger 迁出到 TabStrip，TabsContent 零动）、`zh-CN.ts` / `en-US.ts` / `types.ts`（`tabs.more`）、`tab-strip.dom.test.tsx`（新，happy-dom）。
> **验收对应**：spec §4 的 2 / 3 / 4 / 5 / 7。

- [ ] **RED**：dom 用例六条：① 注入溢出 ⇒ 遮罩渲染且含 chevron；② 不溢出 ⇒ 无遮罩、无下拉触发器（宽栏零变化）；③ 注入宽度使 N=4 ⇒ 下拉项恰为第 5、6 项、文案 = `tabs.*` 现有值（**不含**前 4 项）；④ 点遮罩开下拉；⑤ 选中项 `onTabChange` 回调值 = 该项 tab 值；⑥ `tabs.more` 三文件同在 + zh/en 值断言（验收 7，审查补勾点）。此刻无实现 ⇒ 红。
- [ ] **GREEN**：`tab-strip.tsx` 落滚动容器（隐藏滚动条 + 底部内边距）+ 迁入 `TabsList`/`TabsTrigger` + 40px 渐隐遮罩按钮 + `DropdownMenu`（项 = `computeFoldCount` 边界尾，当前项 `Check` + `aria-current`）；测量 = `useLayoutEffect` 每 render + 容器 `ResizeObserver`（D5）；`middle-tabs.tsx` 接线 + `tabs.more` 三文件。
- [ ] **neuter ①**：把遮罩改成无条件渲染 ⇒ ② 红（① 绿——它断"溢出时在"）。
- [ ] **neuter ②**：下拉项改成全量 6 项 ⇒ ③ 红、①②④⑤⑥ 绿（受害者不相交）。
- [ ] **neuter ③**：把 zh 值换词 ⇒ ⑥ 红、其余绿。
- [ ] **还原证明** + **提交回归**：既有 knowledge 用例（Task 0.2 清单）零改动全绿。
- [ ] **门禁**：`pnpm check` 净 + 触碰面 `tests/unit/knowledge/` 全绿。

**实测**：（回填）

---

## Task 3 — 激活滚入 + 文档 + 真浏览器几何 + 收官（spec D4 / §4.6/4.10）

> 动到的文件：`tab-strip.tsx`（滚入一处）、`tab-strip.dom.test.tsx`（+1 条）、`frontend/AGENTS.md`（知识库页一句）。
> **验收对应**：spec §4 的 6 / 8 / 9 / 10。

- [ ] **RED**：dom 用例——激活值切到"视野外"的项（注入测量 + mock 滚入）⇒ 滚入被调（**落点 = 有效可见区即扣除遮罩宽**，不得停在遮罩下——审查 ③）。
- [ ] **GREEN**：激活值变化 effect 里对激活 trigger 滚入**有效可见区**（含从下拉切回的同一路径；落点按"栏宽 − 遮罩宽"判，不裸用 `nearest` 贴右缘）。
- [ ] **neuter**：去掉滚入 ⇒ 该条红（revert proof）。
- [ ] **文档**：`frontend/AGENTS.md` 知识库页条目补一句（tab 行溢出降级 = 折叠边界下拉 + 渐隐遮罩，TabStrip 组件）；**后端 AGENTS.md / README 不动**（无用户可见新功能、无后端变化）。
- [ ] **真浏览器几何**（只读，验收 10 a–e）：拖窄/拖宽来回——遮罩恒 40px 行尾不抖 / N 随宽度单调 / 半露不截断 / 下拉选折叠项后下划线滚入有效可见区（不被遮罩盖）/ 全放得下与现状一致。逐条记录结果；**顺带量六 tab 总宽实值回填 spec §1.1（现为估算 ~480px，审查 ⑧）**。
- [ ] **收官门禁**：`pnpm check` 净 + 前端全量 `pnpm test` 0 失败 + `git diff` 不含 `backend/`（验收 8/9）。

**实测**：（回填）
