# RAG 面板多模态输入（图片提问 · 语音听写） —— 实施计划

## 范围与交接

一对一件事＝①图片提问（面板附件＋发送时上传）②语音听写（按 D1 形态移植）。成对 spec 同名（`../specs/2026-10-10-rag-panel-multimodal-input-design.md`），决策点 D1–D6 见 spec §3（**已裁全甲**：①抽共享 `useVoiceInput` hook／②与主对话一致（不支持即隐藏）／③不做前端门控／④复用附件条组件／⑤SOUL 半句同批／⑥dom＋`check`＋真浏览器手验＋真栈 W22）。**树归属**：主树（切片随带＝另议）。**不碰**：后端看图链与 uploads 注入（已在）／消息渲染层（两面板共用）／音频转写／图入库对话入口／主对话既有行为（除 D1 甲 的等价抽 hook）。TDD：前端按 `frontend/AGENTS.md`（rstest dom 用例；新行为带测试）；提交信息英文 conventional；只 stage 本线文件。

## 硬约束（执行期注意）／Global Constraints

- **前端命令**（照 `frontend/AGENTS.md`）：`cd frontend && python ../scripts/pnpm.py check`（eslint+tsc）／`python ../scripts/pnpm.py test`（全量，口径=0 失败）；单文件＝`python ../scripts/pnpm.py test <路径>`（rstest 位置参数；**不要 `--run`**；多文件过滤用目录）。
- **复用不重造**：附件校验/上传/limits 全用 `core/uploads/*`；语音全用 `core/voice-input/*`＋`inputBox` i18n 键；**不新增后端接口**。
- **i18n**：优先沿用既有键（附件与语音文案均已有）；确需新键则 `zh-CN`/`en-US` 同笔。
- **dom 驱动注意**（在案坑）：Radix 菜单 aria-hide 查询加 `hidden: true`；happy-dom 合成 PointerEvent 无 `pointerType`（Select 用 `fireEvent.click`）；滚动落点断言会被 happy-dom 不 clamp 骗过——凡滚动/几何类另行真浏览器量。
- 真栈仅测试库；临时件收尾；`config.yaml`/`rag_config.json` 零改动。

## Task 0 — 落点核实

> 动到的文件：只读核实＋spec/plan 回填（本对文档）

- [ ] ① 主对话上传链复核：`core/threads/hooks.ts:2222` 上下文（pending 附件→submit 的数据形状、optimistic 消息更新）；chat-panel composer 行域与 submit 链（`draft` 态、`handleSubmit`、threadId 来源）；附件组件 API（`PromptInputAttachment(s)`＋controller `files/add/remove` 表面）；② 语音接线行域（`input-box.tsx:361-449/1372-1450+/2563`）与 hook 抽取边界（依赖面：draft setter、refs、toast、i18n）；③ i18n 键清单（`t.inputBox.voiceInput*`、`t.uploads.*`）；④ SOUL 落点行；⑤ 受害者面实名：`frontend/tests/unit/knowledge/chat-panel.dom.test.tsx`（878 行；钉 composer 占位「向当前知识库提问…」、disabled 态、流式中换发送/停止 ⑤＋⑬——改 composer 必复核）／`frontend/tests/unit/components/workspace/input-box-helpers.test.ts`（纯 helpers：slash/goal 面）／`frontend/tests/unit/core/voice-input/speech-recognition.test.ts`（模块面，抽 hook 不许动它）；**input-box 语音接线本身无直接用例**（终审实核）⇒ D1 甲 回归网＝模块测试＋前端全量＋真浏览器手验；⑥ D1–D6 裁定值回填。

**Task 0 复核结果（待执行期填）**：…

## Task 1 — 图片提问（前端 TDD）

> 动到的文件：`frontend/src/components/workspace/knowledge/chat-panel.tsx`（＋按 D4 复用的附件组件）＋对应测试

- [ ] RED：面板附件 pending（添加/移除）→ 发送时 `uploadFiles(threadId, files)` 被调；上传失败态文案；limit 校验文案（照 `t.uploads.*`）；GREEN：附件区＋submit 改造（发送时上传→照现有 run 调用；composer 既有「流式中换发送/停止」⑤＋⑬ 行为不得破）；neuter 一次（去上传恰红后还原）。
- [ ] 门禁：`pnpm check`＋定向 dom 用例。

**实测（待执行期填）**：…

## Task 2 — 语音听写（按 D1 形态）

> 动到的文件：按 D1——甲：`core/voice-input/` 新 hook＋`input-box.tsx` 等价接线＋`chat-panel.tsx`；乙：仅 `chat-panel.tsx`。＋对应测试

- [ ] RED：mic 钮渲染条件（不支持隐藏，按 D2）；listening 态切换（点按开始/停止）；错误文案映射；GREEN：按 D1 落实现（hook 落 `core/voice-input/`；**不塞 `input-box-helpers.ts`**——该模块职责=slash/goal）；neuter 一次（恰红后还原）。
- [ ] 门禁：`pnpm check`＋定向 dom 用例＋（D1 甲）前端全量复跑（动主对话）。

**实测（待执行期填）**：…

## Task 3 — 引导（SOUL 半句，按 D5）

> 动到的文件：`backend/packages/harness/deerflow/agents/assets/rag/SOUL.md`（主树独有）

- [ ] SOUL 加图问答半句（图＝用户提供的问题语境；先看图再按检索工作流用知识库佐证；图上内容不标 `[n]`、知识库结论照常标 `[n]`；**句内不点名 `view_image`**——仅 vision 模型挂载，点名给非 vision 模型造悬空引用）；`test_rag_agent_assembly.py` 复核（钉句族不分叉）。

**实测（待执行期填）**：…

## Task 4 — 门禁＋真栈 W22＋真浏览器手验＋回填

- [ ] 前端全量（`pnpm test`＋`check`，0 诊断/0 失败）；后端仅 SOUL ⇒ `test_rag_agent_assembly.py` 窄面（不跑后端全量，理由入纪行：零后端代码）。
- [ ] 真栈 W22（t6 实例）：REST 上传探针图到线程 → 提问（图内容＋知识库）→ transcript 证 `view_image` 被调、回答融合；**真浏览器手验**（面板附件/mic 两态截图，10(a) 同款口径）。
- [ ] 回填：本 plan 纪行（Task 0–4 逐格勾＋实测）＋spec 状态行；提交链落定。

**实测（待执行期填）**：…

## 提交链（预计，以执行期拆分为准）

- 开工首笔（spec+plan 成对）／前端一笔（Task 1＋2＋测试）／引导一笔（Task 3 SOUL）／回填并入文档笔；均主树、不推（待令）。
