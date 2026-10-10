# RAG 面板多模态输入（图片提问 · 语音听写） —— 设计

**Status:** 已裁（D1–D6 全甲，2026-10-10）；实施待「开工」；**树归属**：主树（切片随带＝另议）。载体＝成对（本文件＋`../plans/2026-10-10-rag-panel-multimodal-input.md`）。来源：他问「主对话能传图/语音，RAG 面板呢」→ 本日现场核实（全部锚点为实读行）＋他令「**语音随批一起**」。**终审 2026-10-10：勘误两处已写回（chat-panel Textarea 行号 `:684`、SOUL 不点名 `view_image` 口径）＋受害者面实名（`chat-panel.dom.test.tsx` 878 行钉 composer ⑤＋⑬；`input-box-helpers.ts` 职责=slash/goal、语音 hook 不塞入；input-box 语音接线无直接用例）＋`include_uploads` 归属实核（lead wrapper `:289` 起=True）。**

**本对一件事：把主对话已有的两种输入能力补进 RAG 问答面板——①图片作为提问素材（附件/粘贴→线程 uploads→vision 模型 `view_image`）②语音听写（浏览器 STT→草稿框）。后端看图链与消息渲染层已在且两面板共用；缺的只在 RAG 面板的输入层。**

## 1. 现状与缺口（锚点，实读）

- **主对话两种输入已全有**：粘贴/选文件→附件（`input-box.tsx:1905/1914`；composer 缩略图 `prompt-input.tsx:304/322/356`）；**发送时上传**（`core/threads/hooks.ts:2222` `uploadFiles(threadId, files)` → `/api/threads/{id}/uploads`，`core/uploads/api.ts:51-62`）；语音听写（上游 `be637163a` PR #4036：接线状态机 `input-box.tsx:361-449/1379-1450+`、mic 钮 `:2563`、纯工具层 `core/voice-input/speech-recognition.ts`〔`getSpeechRecognitionConstructor:78`／`getSpeechRecognitionLanguage:87`／`shouldRestart…:100`〕、错误文案 `t.inputBox.voiceInput*` `:1385-1397`、模块测试 `frontend/tests/unit/core/voice-input/speech-recognition.test.ts`）。
- **后端看图链已在**：`view_image` 仅当所选模型 `supports_vision` 时挂（`tools.py:116-120`）；工具限 `/mnt/user-data/{workspace,uploads,outputs}` 三根、20MB、魔数判型（`view_image_tool.py`）；`ViewImageMiddleware` 调用前注入 base64 隐藏消息、调用后 `RemoveMessage` 清理。**uploads 注入＝lead 家族 True**（`tool_error_handling_middleware.py:299`；subagent 才 False `:328`）⇒ rag 助手（custom agent 走 lead 链）已有。
- **展示层两面板共用**：RAG 面板消息渲染用共享 `MessageList`（`chat-panel.tsx:37`）；`MessageImage`＋`resolveMessageImageURL`（`core/artifacts/utils.ts:94+`：`/mnt/…`→artifacts API、相对产出路径、外部 http(s) 直渲）⇒ 图进了线程就会渲染，**无需新做**。
- **缺的只在 RAG 面板输入层**：`chat-panel.tsx` composer＝自建小容器（Textarea `:684` 起、`draft` 受控、Enter 守卫至 `:704`；注释自述 "styled after the home-page InputBox" `:680-681`；面板已同域引用 `t.inputBox.*` 先例 `:694`）；**无附件、无 mic**（本日 grep 零命中；无附件 state/上传调用）；composer 另有**流式中换发送/停止**行为（问题包 ⑤＋⑬）——加附件/ mic 不得破。
- **门槛**：rag 助手模型需 `supports_vision`（t6 默认模型 qwen3.8-flash ✓）；不满足时 `view_image` 不挂——口径见 D3。

## 2. 方案

### 2.1 图片提问（面板附件，后端零改）
- composer 增附件区：选文件＋粘贴（复用 `splitUnsupportedUploadFiles`／`validateUploadLimits`／`useUploadLimits` 同款校验与文案）；
- pending 文件**随发送走、发送时上传**（与主对话同款）：`uploadFiles(threadId, files)` 后照现有 submit 发 run（面板线程已存在，无新建路径）；
- 后端不动：图进线程 uploads → 清单注入 → 模型（有 vision 时）自行 `view_image`；面板**不做前端能力门控**（按 D3）。

### 2.2 语音听写（面板移植，按 D1 定形态）
- 复用：支持检测（`getSpeechRecognitionConstructor`）、语言（`getSpeechRecognitionLanguage(locale)`）、错误 i18n（`t.inputBox.voiceInput*`，面板已同域引用 `t.inputBox.*`——`chat-panel.tsx:694` 先例）；
- 行为对齐主对话：连续听写／停止请求／重启定时／错误态文案；听写文本并入同一 `draft/setDraft`；
- mic 钮落 composer 尾部（与深度检索开关同排）；不支持时按 D2 隐藏。

### 2.3 引导（按 D5）
- SOUL 加半句：**用户随消息附了图时的作答口径**——图＝用户提供的问题语境，先理解图再按检索工作流用知识库佐证/补充；图上内容不标 `[n]`，知识库结论照常标 `[n]`。
- ⚠️ 句内**不点名 `view_image`**：该工具仅 vision 模型下挂载，点名会给非 vision 模型造悬空引用（与「文档级/百科级」同款教训）。

### 2.4 不碰面
- 音频文件上传/转写（≠语音输入；不做）；图片"入库"对话入口（管理面已有）；回复带图（已支持）；主对话既有行为（除 D1 甲 的等价抽 hook 外零改）；后端代码（除 SOUL 半句外零改）。

## 3. 决策点（已裁：2026-10-10 全甲——即各点首选项）

- **D1 语音工程形态**：**甲**＝抽共享 `useVoiceInput` hook 于 `core/voice-input/`、input-box 与面板共用（单一实现防漂；动主对话 composer，需复核其既有用例与前端全量）／乙＝面板内复制接线（零动主对话，两份实现有漂移风险）。
- **D2 语音可用性口径**：**甲**＝与主对话一致（浏览器不支持即隐藏 mic；语言按 locale 取）／乙＝面板另加不可用说明。
- **D3 图片的模型口径**：**甲**＝不做前端门控；模型无 vision 时后端如实（`view_image` 不挂、按工具返回提示照实）／乙＝前端按模型能力禁用附件（需把模型能力引入面板，多一层耦合）。
- **D4 附件 UI 形态**：**甲**＝复用 ai-elements 附件条组件（`PromptInputAttachment(s)`，与主对话同观感）／乙＝面板内轻量 chips。
- **D5 引导面**：**甲**＝SOUL 半句同批／乙＝不动 SOUL。
- **D6 验收面**：**甲**＝前端 dom 用例＋`pnpm check`＋真浏览器手验（附件/mic 两态）＋真栈 W22（REST 级：上传图→提问→审 `view_image` 与回答融合）／乙＝仅 dom（不跑真栈）。

## 4. 验收（判据）
- 前端：`pnpm check`（eslint+tsc）零诊断；前端测试全量（口径=0 失败）；新增 dom 用例（附件 pending→`uploadFiles` 调用；mic 钮态与不支持隐藏）。
- 后端：仅 SOUL 半句 ⇒ `test_rag_agent_assembly.py` 钉句族复核（不出红）；后端代码零改（不跑后端全量，理由入纪行）。
- 真栈 W22（t6 实例）：REST 上传探针图到线程 → 提问（图内容＋知识库）→ transcript 证 `view_image` 被调、回答融合；**前端 UI 两态手验**（真浏览器截图）。
- 树复核：切片零改动（随带另议）。

## 5. 明确不做（另案）
- 音频文件上传/转写；图片经对话入库；回复带图新机制；主对话语音行为改动（除 D1 甲 的等价重构）；切片随带（另议）。
