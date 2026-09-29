# 视频 ASR 的「服务档」（HTTP）—— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-28-rag-asr-service-tier-design.md](../specs/2026-09-28-rag-asr-service-tier-design.md)
**Status:** 🚧 **已立项、开工（2026-09-29）**——**Task 0 已完成**（三项取证全回填；两处 spec §5.1 的缺前提 + 三处 spec 没写的配置面）；**四件追加裁定已落**（钥匙放**顶层** · 加 **`asr` 腿** · 服务档**两格都填、地址格灰字占位**（③ 已按 09-25 端点解锁对复核更正）· 探针**夹具自带黄金期望**），并**补了 Task 2b**（探针后端原先没 Task）；spec 已原地改词。**下一步 Task 1**。D1–D8 已裁，串行门已清。
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

**依赖顺序**：Task 0（取证）→ Task 1（配置面）→ Task 2（后端 provider）→ **Task 2b（后端探针）** → Task 3（前端行）→ Task 4（文档 + 端到端 + 收官）。

---

## Task 0 — 开工前取证（只读 + 一次性真机实验）

- [x] 1. **真机跑一次 `dashscope` 同步档**（临时脚本，**不进仓库**；用 `rag_config.json` 里的 key）：`qwen-audio-3.1-asr-flash` + 说话人开关。**spec §5.1 已把三条路径的端点 / 音频给法 / 时间戳写全**（§1 也有 200 / 毫秒级段+词 / 24s→3 段的实测）⇒ 本项只补**仍缺的两件**：① **`sentences[]` 的逐字段样本**（含 `words[]` 的 punctuation 形状）；② 说话人开关的**实际字段名与取值**（`speaker_diarization_enabled` / `diarization_enabled` 谁生效、返回里 `speaker_id` 长什么样）。
- [x] 2. **探针 fixture**：选/造一段 **≤10 秒**的内置短 wav，定它放哪（后端资产目录）+ 探针 endpoint 的请求/响应形状（照既有三个探针同族）。
- [x] 3. **接口契约**：核 `asr.py:193`（`resolve_provider`）的分派与既有 provider 的返回契约（新 provider 要产出的形状）——**逐字段抄**，别发明。

**实测**（Task 0，2026-09-29 真机；临时脚本在仓外 `%TEMP%`，未入库）：

### 1）`dashscope` 同步档的真实请求 / 返回（**补齐 spec §5.1 缺的两处前提**：`format` 必填 + 分段依赖说话人开关）

**端点**：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`（`Authorization: Bearer <key>`）。

**请求体（实测可用）**：
```json
{"model": "qwen-audio-3.1-asr-flash",
 "input": {"messages": [{"role": "user", "content": [{"audio": "data:audio/wav;base64,<...>"}]}]},
 "parameters": {"format": "wav", "speaker_diarization_enabled": true}}
```

| # | 实测结论 | 证据 |
| --- | --- | --- |
| ① | **`parameters.format` 是必填**（`"format is empty"` 400、0.7 s 秒回、音频根本没被读）；**值不校验**——`wav/mp3/mp4/m4a/aac/ogg/flac/xyz` **全 200 且结果相同** ⇒ 服务端自己嗅探容器，我们填**文件后缀**即可 | 9 值扫描 |
| ② | **说话人开关只在 `parameters` 顶层生效**：`{"speaker_diarization_enabled": true}` ⇒ 200 且多出 `sentences[]`；塞进 `asr_options` ⇒ **与不开完全一样**；`diarization_enabled`（§7 表里 `fun-asr` 那个）⇒ **也无效果** | 5 变体对照 |
| ③ | ⚠️ **不开说话人 ⇒ 没有分段**：43.69 s 音频只回**一个** `output.sentence`（`200→43520 ms` 整段一行）；**开了才出现 `output.sentences[]`**（同一文件 6 段，边界≈真停顿）⇒ **这个开关不是"加说话人"，是"开分段"**（spec §1 的"`speaker_diarization_enabled: true` 才返回 `sentences[]`"实测成立，但**要写清它同时是分段开关**） | V5 vs V6 |
| ④ | 返回形状（**同一份挂在两层**：`output.*` 与 `output.output.*`，逐字段相同）：`output.sentence`（**单数对象**，恒有）/ `output.sentences`（**列表，仅开开关时出现**）/ `output.text` / `output.usage{duration,input_tokens,output_tokens,total_tokens}` / 顶层 `usage` + `request_id` | 全量 shape dump |
| ⑤ | `sentences[i]` 逐字段：`begin_time`(int,ms) · `end_time`(int,ms) · `sentence_id`(int,1 起) · `sentence_end`(bool) · `channel_id`(int,0) · `speaker_id`(int,0 起) · `text`(str,**带标点**) · `words[]`；`words[j]`：`begin_time` · `end_time` · `text` · `punctuation`(**恒 `""`**——标点只在 `text` 里) · `fixed`(bool) · `speaker_id` | V6 逐字段 |
| ⑥ | 文本**带标点、不带逐字空格**（与本地 `paraformer-zh` 相反）；`speaker_id` 在双人合成音频上 **0/1 交替、与真值一致**（单人音频上会假分裂成 1） | V6 6 段 / 夹具 |
| ⑦ | **"等分特征"判据可用**：真边界下 `ms/字符` 在段间**不均匀**（实测 160 / 325，双人长音频 3.57–4.77 字符/秒）——照字符数等比摊开的合成段会给出**同一个** ms/字符 | V6 + 夹具 |
| ⑧ | **`qwen3-asr-flash` 是另一条路**（同端点、同 body 形状）：返回 `output.choices[].message.content[].text` + `annotations[{emotion,language,type}]`，**完全不给时间戳** ⇒ 不可用（它才是 spec §5.1 引的那份文档的形状） | T1 |
| ⑨ | 耗时：9 s 音频 0.7–1.4 s、18 s 1.0 s、44 s 1.6–2.4 s；`usage.duration` = 音频秒数（成本口径） | 全轮 |
| ⑩ | ⚠️ **钥匙盘面**：`.env` 里 `DASHSCOPE_API_KEY` / `DASHSCOPE_JUDGE_API_KEY` **已被封**（`InvalidApiKey: API-key is blocked`）；`DASHSCOPE_EMBEDDING_API_KEY` / `DASHSCOPE_RERANK_API_KEY` / `DASHSCOPE_QWEN38_API_KEY` + `rag_config.json` 那两把 **都过鉴权**（本轮用 `DASHSCOPE_QWEN38_API_KEY`） | 7 把逐试 |
| ⑪ | ⚠️ **红鲱鱼，别当限制**：**钥匙被封**时 body >≈150 KB 会以 `ConnectionResetError 10054` 收场（服务端早退 401 后关读端）；**钥匙有效时 1.86 MB base64 正常返回** ⇒ 与"10 MB 上限"无关，**别为它改设计** | 尺寸阶梯 193 KB/772 KB/1.86 MB |

### 2）探针 fixture（**已造、已双向验通**）

- **来源**：**Windows SAPI 现造**（`Microsoft Huihui Desktop`，zh-CN）——本机合成、**无第三方音频来源 / 许可问题**，不引入 ModelScope 样例。
- **设计**（专为"识破合成段"）：句 A「语音识别探针第一句。」（10 字）**快读**（Rate +4，1.84 s）+ **1.2 s 静音** + 句 B「第二句慢一些，用来检查时间戳。」（15 字）**慢读**（Rate −3，5.92 s）= **8.96 s**。⇒ ① 段间 `ms/字符` 差 **2.1×**（184 vs 395），等比摊开的假段会被一眼看穿；② **边界必须落在 1.84–3.04 s 这段静音里**——比"跟本地基线比"更硬、且**不需要跑本地腿**。
- ⚠️ **静音必须 > VAD 阈值**：0.6 s 间隔**本地腿不切**（FSMN-VAD 默认 `max_end_silence_time` 800 ms），1.2 s 才切。
- **双向验通**（真机）：DashScope（`format` 填 wav 或 mp3）⇒ **2–3 段**、A/B 边界落在 3.12 s≈设计的静音处、`ms/字符` 160 vs 325 ✓；本地 `funasr + vad + cam++` ⇒ **2 段**（`0→1600` / `3080→8950`）、边界同样落在静音处 ✓。
- **体积 / 格式**：`wav` **286,922 B**（280 KB）· `mp3` **36,512 B**（36 KB）· opus 13,506 B。⚠️ **本地腿吃 mp3 会把两段并成一段**（funasr 自己的 mp3 解码路径；解回 wav 就正常）⇒ **探针只走服务腿，mp3 够用**；若将来要"本地基线"就选 wav。
- **放哪**：`app/` 下**没有**资产目录先例，harness 包里只有 yaml/md（**无二进制先例**）。事实：Docker `COPY backend ./backend` ⇒ **`backend/` 下任意路径都随镜像走**；wheel 安装要求文件**被 git 跟踪**（hatchling 排除 VCS-ignored，姊妹件踩过）。建议 `backend/app/gateway/assets/asr_probe.wav`（新建目录，与探针路由同层）。
- **探针 endpoint 形状**（照既有四支，**不是三支**）：`POST /rag/config/probe-asr` · `require_admin_user` · Pydantic body `extra="forbid"`（候选 `asr_provider/asr_model/asr_base_url/asr_api_key`，钥匙可送掩码哨兵）· 返回 `{status: Literal[...], detail: str}` · `_PROBE_TIMEOUT_SECONDS = 10` · **不落库**（`rag_config.py:609/683/773/849` 四支为模板）。
- ⚠️ **D7 的"本地基线对照"要改落法**：本地腿 `load` 实测 **8.2–8.4 s**（+ 推理 2 s）**已超探针 10 s 超时**，且部署上未必装 funasr ⇒ **探针里跑不起本地基线**。改为**夹具自带黄金期望**（边界必须落进已知静音区间 + 段间 ms/字符不得近似相等），判据等价、零额外依赖。**这一条要你拍**。

### 3）接口契约（逐字段核完）

| 面 | 事实 | 对新 provider 的含义 |
| --- | --- | --- |
| `AsrProvider` Protocol（`asr.py:45-51`） | `name: str` · `unit: Literal["ms","s"]` · `transcribe(path) -> list[tuple[float,float,str]]` | 新 provider 产出**三元组**，单位走 `unit`（服务档用 `"ms"`） |
| 调用方式（`asr.py:222`） | `run_file_io(prov.transcribe, path)` ⇒ **落线程池** | 新 provider 必须是**同步 blocking**（用 `requests`/同步 `httpx`），**不要 async** |
| `path` 是什么（`worker.py:599`） | `transcribe_video(storage_path, …)`，`storage_path` = **视频文件**（不是抽出的音轨） | provider 自己读字节 + base64；`parameters.format` 用**文件后缀** |
| ⚠️ **没有钥匙/地址的通道** | `resolve_provider(name, *, model)` 与 `transcribe_video(…, provider_name, model, duration_ms)` **都只收 model** | **Task 2 必须扩签名**（`base_url=` / `api_key=`，worker 传 `cfg.asr_base_url` / `cfg.asr_api_key`；探针传候选值）——spec §3 只写了"分派加一支"，**这条要补进 plan** |
| 降级 | `transcribe_video` 把**任何**异常收敛为 `AsrError`（`AsrError` 原样透传） | D8 免费成立；provider 内部只需**不吞**异常 |
| 错误文案 | `resolve_provider` 抛 `AsrError("未知 ASR provider：…（支持 funasr | whisper）")` | 加值时必须同步改这句话 |

**⚠️ 配置面比 spec §3 写的多三处**（Task 1 的实际改动面）：

| 处 | 现状 | 不加会怎样 |
| --- | --- | --- |
| `rag_config.py:66` `_VIDEO_FIELDS = ("asr_provider","asr_model")` | 白名单**只放这两格** | 两个新字段**根本不进 GET/PUT**（静默丢弃） |
| `rag_config.py:52/58` `_SECRET_FIELDS` / `_SECRET_LEGS` | 四个**顶层**钥匙才有掩码 + env 徽章 | `video.asr_api_key` 会被**明文回显**（`_build_response` 的 video 分支 `:225-229` 对所有 video 字段一律当普通值） |
| `providers/__init__.py` `PROVIDER_ALLOWLIST` | 四条腿（embedding/rerank/parse/sparse）；`secret_env_var(leg, provider)` **要查表** | `_secret_env_name` 会 **KeyError** ⇒ 要么加一条 `asr` 腿（拿到 id 校验 + `secret_env_var` + `default_endpoint` 占位来源），要么给 ASR 特判 |

**前端三处窄化逐条复核**（行号未漂）：`config-form.ts:62`（类型字面量）· `:185`（归一化）· `:305` / `:307`（provider 联合类型）· `types.ts:11` ✓ 全部在位。

### 4）Task 0 结论落定 / 待裁

| # | 件 | 状态 |
| --- | --- | --- |
| ① | `asr_base_url` / `asr_api_key` 放哪 | **已裁：乙——放顶层**（2026-09-29）。理由 = 与既有四条腿同形、零新机制（掩码/env 徽章/哨兵/整对象替换全现成）。spec D4 已原地改词；`video` 块仍只放 `asr_provider` / `asr_model` |
| ② | `PROVIDER_ALLOWLIST` 加不加 `asr` 腿 | **已裁：甲——加**（2026-09-29）。D2 的三组四值本就是一份受控清单；env 徽章必经 `secret_env_var(leg, provider)`（`providers/__init__.py:170/177`），不加腿就得特判 |
| ③ | dashscope 那行的**地址/钥匙锁法** | **已裁并复核更正（2026-09-29）**：**不锁**——**服务档（通用 + 原生）两格都填，地址格用 `default_endpoint` 做灰字占位**。⚠️ 我原先按 `has_fixed_endpoint` 推成"地址锁"，被 **2026-09-25 端点解锁对（D1 乙 / D2 乙）** 推翻：地址行**永远可编辑**（同厂商可能有 workspace 级端点），`default_endpoint` **只作占位、不落值、不回落**（**留空 ⇒ 报错**）。`has_fixed_endpoint` 已不是 UI 的锁依据（docstring 里的"read-only"是 09-17 旧话） |
| ④ | D7 的"本地基线对照" | **已裁：甲——夹具自带黄金期望**（2026-09-29）：① 边界必须落进夹具已知静音区间；② 段间 `ms/字符` 不得近似相等。**不跑本地腿**（`load` 8.2–8.4 s 已超探针 10 s 超时） |

**① 的连带事实（Task 1 要处理）**：ASR 的 **provider 字段是嵌套的**（`rag.video.asr_provider`），而 `_secret_env_name` 的两次取值（`written.get(provider_field)` / `getattr(config.rag, provider_field, None)`，`rag_config.py:199`）**都按顶层字段名写死** ⇒ `_SECRET_LEGS["asr_api_key"] = ("asr", "video.asr_provider")` 会**静默取不到**（退化成 `provider_ids("asr")[0]`）。要么让这两处认点号路径，要么让 `_SECRET_LEGS` 存取值器。env 变量名：`dashscope` → `DASHSCOPE_ASR_API_KEY`（**别用 `DASHSCOPE_API_KEY`**——他机器上那把已封，且被 config.yaml:50 的条目引用着）、`openai-audio` → `RAG_ASR_API_KEY`、`funasr` / `whisper` → `None`（本机进程内，无凭据）。

**⚠️ 计划缺口（Task 0 查出）**：探针的**后端那一半没有 Task**——原 Task 3 只覆盖前端（状态点 / 结论入状态 / 拦 Save），而 fixture 入库 + `probe-asr` 路由 + 黄金期望判据 + 桩测都在后端 ⇒ **补 Task 2b**。

---

## Task 1 — 配置面（spec D4；落点按 Task 0 实测校正）

- [ ] **RED**：断言两处后端字面量（`app_config.py:156` / `rag_config_file.py:110`）接受服务档值、两处前端字面量（`types.ts:11` / `config-form.ts:62`）同步、**顶层**两个新字段（`asr_base_url` / `asr_api_key`）可读写且**钥匙走 secret 机制**（掩码哨兵 + env 徽章）；**3 处窄化**（`config-form.ts:185` / `:305` / `:307`）不再吞掉新值；`PROVIDER_ALLOWLIST["asr"]` 四条 id 齐（`funasr` / `whisper` / `openai-audio` / `dashscope`）且 `secret_env_var` 各自对。此刻无实现 ⇒ 红。
- [ ] **GREEN**：放开字面量 + 顶层加 `asr_base_url` / `asr_api_key`（`app_config.RagConfig` 与 `rag_config_file.RagConfigFile` 各一对）；`_SECRET_FIELDS` + `_SECRET_LEGS` 各加一行；**`_secret_env_name` 认点号路径**（`rag.video.asr_provider`，见 Task 0 结论 ① 的连带事实）；**新增 `PROVIDER_ALLOWLIST["asr"]` 腿**（`dashscope` 行带 `default_endpoint`——**只喂占位**，**不带锁语义**；`has_fixed_endpoint` 该不该跟着填由既有四行的惯例决定）；**GET 响应加 `asr_providers` capability 列表**（照 `embedding_providers` / `rerank_providers`：`provider_id` + `default_endpoint` + **`group`**）；**服务档地址留空 ⇒ PUT 报错**（09-25 D1 乙"连回落删"的既有规则）；`_VIDEO_FIELDS` **不动**。⚠️ **分组（D2 三组）要跟行走、不在前端硬编码**——同 `_embedding_provider_capabilities` 那条规则；落法：`ProviderSpec` 加一个 `group` 字段，随 capability 出给前端。
- [ ] **neuter**：把窄化改回"只认两个"⇒ "新值被吞"的断言红（revert proof）。
- [ ] **门禁**：后端相关套件 + `make lint`；前端 `pnpm test` / `pnpm check`。

**实测**：（回填）

---

## Task 2 — 后端：服务档 provider（spec D5 / D8 + §3 落点）

- [ ] **RED**：桩测（替换 HTTP 调用）——① **请求形状**（地址 / 钥匙 / 模型名 / **`format` 必填** / **`speaker_diarization_enabled` 在 `parameters` 顶层**）；② **抽取**：`sentences[]` 优先、`utterances[]` 回退、空/单段 ⇒ 空 rows（**不抛**）；③ **降级**：网络失败 / 超时 / 401 ⇒ `AsrError`（不新增状态值）；④ **签名**：`base_url` / `api_key` 能传进 provider。此刻无实现 ⇒ 红。
- [ ] **GREEN**：`asr.py:193`（`resolve_provider`）分派加一支（**并同步改那句"支持 funasr | whisper"**）+ 扩签名（`resolve_provider` / `transcribe_video` 收 `base_url` / `api_key`；`worker.py:599` 传 `cfg.asr_base_url` / `cfg.asr_api_key`）+ provider 实现（**同步 blocking** HTTP 客户端；`path` 是视频文件 ⇒ 自己读字节 + base64、`format` 填后缀）。
- [ ] **neuter**：把降级去掉（失败直接抛原始异常）⇒ ③ 红（revert proof）。
- [ ] **门禁**：`make test`（相关文件）+ `make lint` 净。

**实测**：（回填）

---

## Task 2b — 后端：探针（fixture + `probe-asr` 路由；D7 的黄金期望）

> Task 0 查出的计划缺口：探针的后端那一半原先没 Task。

- [ ] **RED**：① fixture **入库**（`backend/app/gateway/assets/asr_probe.wav`，SAPI 现造 8.96 s；仓里已有测试断言它的时长/静音区间/体积）；② `POST /rag/config/probe-asr`（照 `probe-sparse` 族：`require_admin_user` · body `extra="forbid"` · 返回 `{status, detail}` · 10 s 超时 · 不落库）；③ **黄金期望判据**：边界落进已知静音区间 + 段间 `ms/字符` 不得近似相等 ⇒ `no_timestamps` 只在"没有段级时间戳 / 只有一条整段"时给。此刻无实现 ⇒ 红。
- [ ] **GREEN**：fixture 落盘 + 路由 + 判据（探针**只走服务腿**，不发本地腿）。
- [ ] **neuter**：把"等分特征"判据去掉（只看"有没有 segments"）⇒ ③ 的合成段用例红（revert proof）。
- [ ] **门禁**：`make test`（相关文件）+ `make lint` 净。

**实测**：（回填）

---

## Task 3 — 前端：ASR 行（spec D1 / D2 / D3 / D7）

- [ ] **RED**：DOM 用例——① 行数 2→4（标签复用「提供商 / Model ID / API Key / 接口地址」）；② 分组下拉（**三组** + 分隔线）；③ 锁法**两态**（本地引擎双锁 / **服务档两格都填 + 地址格灰字占位**：`dashscope` ⇒ `https://dashscope.aliyuncs.com`、`openai-audio` ⇒ `https://api.example.com/v1`）；④ 探针（挂提供商行右端、结论入状态、`no_timestamps` 拦 Save）。此刻无实现 ⇒ 红。
- [ ] **GREEN**：`functional-models-view.tsx` 按 D1–D3 / D7 实现；`OptionSelect` 扩分组（照 `models-add-dialog.tsx:234-244` 的 `SelectGroup`/`SelectLabel`/`SelectSeparator`）；占位与分组**读后端 capability**（`default_endpoint` / `group`），不按 provider 名字硬编码（照 `endpointPlaceholderFor` 的既有写法，`config-form.ts:531`）。
- [ ] **neuter**：把"锁"改成"隐藏"⇒ ③ 红（revert proof；铁律 = 恒显、锁而不藏）。
- [ ] **门禁**：`pnpm test` + `pnpm check`；**真浏览器复核**四行 / 分组 / 锁（**只读，不点保存**）。

**实测**：（回填）

---

## Task 4 — 文档 + 端到端 + 收官（spec §7 / §8）

- [ ] **文档**：`backend/AGENTS.md` 的视频段 + `frontend/AGENTS.md` 的 functional-models 段各补一句（服务档：四行 / **三组四值** / 探针 / 降级契约）。
- [ ] **端到端（真机）**：配一个 `dashscope` 服务 + 一个 ≤5 分钟视频 ⇒ 卡片「口述」多段、带标点、带 `spk`；再跑一次**故意配错钥匙** ⇒ `asr=failed` + 卡片「（ASR 失败）」；记录总耗时。
- [ ] **收官门禁**：后端全量 + `pnpm check` 净；`git diff` 只含本件该动的文件。

**实测**：（回填）
