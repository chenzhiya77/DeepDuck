# 视频 ASR 的「服务档」（HTTP）—— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-28-rag-asr-service-tier-design.md](../specs/2026-09-28-rag-asr-service-tier-design.md)
**Status:** 🚧 **草案成对（2026-09-29）**——**本线仍未立项、开工待令**（未获令前别当下一步主动推）；**串行门已清**（本地档已收尾 `d337f168`）⇒ **随时可开**。
**来源**：侧聊产出；与 [2026-09-28-video-asr-output-shape.md](2026-09-28-video-asr-output-shape.md)（本地档）是同一架构的**两条来源面**——⚠️ **两条线都动 `asr.py` ⇒ 必须串行**（spec §8）。

**Architecture:** 三处——**① 配置面**（两处后端字面量 + `video` 块两字段 + 两处前端字面量 + 3 处窄化）**② 后端**（`asr.py` 分派加一支 + 新增服务档 provider：HTTP 客户端 + 抽取函数 + 降级）**③ 前端**（ASR 行 2→4 行 + 分组下拉 + 锁法 + 探针）。逐面清单见 spec **§3 落点**。

**硬约束（spec 已定，实现时不许自行放松）**：

- **D1 行形状**：四行（提供商 / Model ID / API Key / 接口地址）；**恒显、锁不隐藏**。
- **D2 分组**：**三组**（本地引擎 / 通用协议 / 原生协议），一期共 **4 个值**（`funasr` / `whisper` / `openai-audio` / `dashscope`）；**原生协议**组 = **每套原生协议一格**，一期只有 `dashscope`（`volc-asr` 随投递二期）。
- **D3 锁法**：本地引擎（进程内）⇒ 地址、钥匙**两格都锁**；通用协议 ⇒ **两格可填**。
- **D6 长音频**：**一期不投递** ⇒ 服务档只吃 **≤5 分钟**（同步 + base64）；更长的整段走本地腿（接受的现状）。
- **D7 探针**：挂「提供商」行右端；**结论入表单状态、保存时按结论拦**（只有 `no_timestamps` 拦 Save）；只挂服务档那几格。
- **D8 降级**：网络失败 / 超时 / 401 / 429 / 5xx ⇒ `AsrError` ⇒ `asr=failed` ⇒ 卡片「（ASR 失败）」；**不重试、不回退、不加新状态值**。
- **非目标**（spec §7）：不帮起/管 `funasr-server` · 不做 GPU 部署 · 不做凭据加密 · 不做多服务池。
- **不引入新依赖**：HTTP 客户端用仓里已有的；对象存储 / 新 SDK 属二期投递，本件不做。
- **请求开关要显式传**（服务端默认都不给）：说话人（百炼 `speaker_diarization_enabled`）等——漏了就静默退化。

**Global Constraints:**

- 分支 `feat/rag-knowledge-base`；每个 Task：**RED → GREEN → neuter（带 revert proof）→ 门禁 → commit**（Conventional Commits）。
- **命令**：后端 `cd backend && make test` / `make lint`；前端 `cd frontend && pnpm test` / `pnpm check`。
- **每个 Task 的 `**实测**` 行必须回填**（RED/GREEN/neuter 受害者/门禁数字/真机耗时）——未回写的 plan 不算交付。

**依赖顺序**：Task 0（取证）→ Task 1（配置面）→ Task 2（后端 provider）→ Task 3（前端行）→ Task 4（文档 + 端到端 + 收官）。

---

## Task 0 — 开工前取证（只读 + 一次性真机实验）

- [ ] 1. **真机跑一次 `dashscope` 同步档**（临时脚本，**不进仓库**；用 `rag_config.json` 里的 key）：`qwen-audio-3.1-asr-flash` + 说话人开关。**spec §5.1 已把三条路径的端点 / 音频给法 / 时间戳写全**（§1 也有 200 / 毫秒级段+词 / 24s→3 段的实测）⇒ 本项只补**仍缺的两件**：① **`sentences[]` 的逐字段样本**（含 `words[]` 的 punctuation 形状）；② 说话人开关的**实际字段名与取值**（`speaker_diarization_enabled` / `diarization_enabled` 谁生效、返回里 `speaker_id` 长什么样）。
- [ ] 2. **探针 fixture**：选/造一段 **≤10 秒**的内置短 wav，定它放哪（后端资产目录）+ 探针 endpoint 的请求/响应形状（照既有三个探针同族）。
- [ ] 3. **接口契约**：核 `asr.py:193`（`resolve_provider`）的分派与既有 provider 的返回契约（新 provider 要产出的形状）——**逐字段抄**，别发明。

**实测**：（回填）

---

## Task 1 — 配置面（spec D4）

- [ ] **RED**：断言两处后端字面量（`app_config.py:156` / `rag_config_file.py:110`）接受服务档值、两处前端字面量（`types.ts:11` / `config-form.ts:62`）同步、`video` 块两个新字段可读写；**3 处窄化**（`config-form.ts:185` / `:305` / `:307`）不再吞掉新值。此刻无实现 ⇒ 红。
- [ ] **GREEN**：放开字面量 + 加 `asr_base_url` / `asr_api_key`（钥匙走既有 secret 机制：掩码哨兵 + env 徽章 + PUT 整对象替换）。
- [ ] **neuter**：把窄化改回"只认两个"⇒ "新值被吞"的断言红（revert proof）。
- [ ] **门禁**：后端相关套件 + `make lint`；前端 `pnpm test` / `pnpm check`。

**实测**：（回填）

---

## Task 2 — 后端：服务档 provider（spec D5 / D8 + §3 落点）

- [ ] **RED**：桩测（替换 HTTP 调用）——① **请求形状**（地址 / 钥匙 / 模型名 / 开关）；② **抽取**：`sentences[]` 优先、`utterances[]` 回退、空/单段 ⇒ 空 rows（**不抛**）；③ **降级**：网络失败 / 超时 / 401 ⇒ `AsrError`（不新增状态值）。此刻无实现 ⇒ 红。
- [ ] **GREEN**：`asr.py:193`（`resolve_provider`）分派加一支 + provider 实现（HTTP 客户端 + 抽取 + 降级）。
- [ ] **neuter**：把降级去掉（失败直接抛原始异常）⇒ ③ 红（revert proof）。
- [ ] **门禁**：`make test`（相关文件）+ `make lint` 净。

**实测**：（回填）

---

## Task 3 — 前端：ASR 行（spec D1 / D2 / D3 / D7）

- [ ] **RED**：DOM 用例——① 行数 2→4（标签复用「提供商 / Model ID / API Key / 接口地址」）；② 分组下拉（**三组** + 分隔线）；③ 锁法（本地引擎双锁 / 通用协议可填）；④ 探针（挂提供商行右端、结论入状态、`no_timestamps` 拦 Save）。此刻无实现 ⇒ 红。
- [ ] **GREEN**：`functional-models-view.tsx` 按 D1–D3 / D7 实现；`OptionSelect` 扩分组（照 `models-add-dialog.tsx:234-244` 的 `SelectGroup`/`SelectLabel`/`SelectSeparator`）。
- [ ] **neuter**：把"锁"改成"隐藏"⇒ ③ 红（revert proof；铁律 = 恒显、锁而不藏）。
- [ ] **门禁**：`pnpm test` + `pnpm check`；**真浏览器复核**四行 / 分组 / 锁（**只读，不点保存**）。

**实测**：（回填）

---

## Task 4 — 文档 + 端到端 + 收官（spec §7 / §8）

- [ ] **文档**：`backend/AGENTS.md` 的视频段 + `frontend/AGENTS.md` 的 functional-models 段各补一句（服务档：四行 / **三组四值** / 探针 / 降级契约）。
- [ ] **端到端（真机）**：配一个 `dashscope` 服务 + 一个 ≤5 分钟视频 ⇒ 卡片「口述」多段、带标点、带 `spk`；再跑一次**故意配错钥匙** ⇒ `asr=failed` + 卡片「（ASR 失败）」；记录总耗时。
- [ ] **收官门禁**：后端全量 + `pnpm check` 净；`git diff` 只含本件该动的文件。

**实测**：（回填）
