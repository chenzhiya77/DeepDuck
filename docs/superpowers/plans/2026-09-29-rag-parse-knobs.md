# 解析与视频 OCR 的四个旋钮 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-09-29-rag-parse-knobs-design.md](../specs/2026-09-29-rag-parse-knobs-design.md)
**Status:** **2026-09-29 起草；Task 0 已完成**（只读核实，六框全勾、「实测」已回填），**Task 1–5 待授权**。四项改法已按用户同日裁定落定；**spec §6.1 两项均已裁＝乙**（① 服务地址**复用既有 `parse_base_url`**、界面标题改「服务地址」，随之登记本对**唯一一条行为变化**，spec §6.2 首条；② **三个新控件进设置界面**）。**本计划无待裁项**，全文按 ②＝乙 有效。**未实现任何生产代码、未提交**；Task 0 的探针全部走临时三件套（三个 `DEER_FLOW_*_PATH`），未读真实配置。
**相关基线:** [盘点档](../../PRE_RELEASE_HARDCODE_INVENTORY.md) §4.2「对 2」（`A-2` + `A-3` + `A-6` + `A-5`）＝本对；[2026-09-24 MinerU 4.x 那一对](../specs/2026-09-24-mineru-4x-parse-adaptation-design.md)（本地腿，明写「mineru-cloud 零改动」）；[2026-09-08 视频入库](../specs/2026-09-08-video-ingest-design.md)（A-3 所在腿）。

**Architecture:** `config.yaml → RagConfig`／`rag_config.json → RagConfigFile → merge → AppConfig.rag`；**三个新字段**挂两层，另**扩大既有 `parse_base_url` 的语义**（云腿也读它，空则退官方常量）。三个消费点各自**现取配置**：云腿 `parser.py`（请求体的 `language`／`model_version` 与 URL 主机）、视频 ocr `video/ocr.py`（`PaddleOCR(lang=…)`）。响应侧靠 `_build_response` 反射（② 已裁乙，golden 同批）。**除 `parse_base_url` 语义扩大这唯一例外外**，不声明时四条腿行为逐字节不变。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| A-2 | `rag.parse_language`（Literal 16 值，默认 `"ch"`）＋ 云腿请求体接线 | 改默认语种；语言枚举的远端同步 |
| A-5 | `rag.parse_model_version`（Literal `pipeline`/`vlm`，默认 `"vlm"`）＋ 云腿请求体接线 | 改默认档（留白）；`MinerU-HTML` 档 |
| A-6 | **复用既有 `rag.parse_base_url`**（语义扩为"当前解析服务的地址"；云腿空＝官方常量）＋ 云腿两处拼 URL；**登记行为变化** | 为云腿新开字段（① 已裁乙）；改它的类型与默认值 |
| A-3 | `rag.video.ocr_lang`（str，默认 `"ch"`）＋ 引擎构造传参 | 装 PaddleOCR；校准 `_lines_from_paddle`；"引擎只建一次"欠账 |
| D3 | 界面（② 已裁乙）：解析区两新行（**云分支可编辑、本地分支锁定孪生**）＋ 地址行改标题 ＋ provider 行 ⓘ 改说明 ＋ 视频区一行 | 新卡片、卡片标题/ⓘ、`parse_provider` 开关本身、`parse_tier` 行 |

**待裁：无**（spec §6.1 ①② 均已裁＝乙：① 复用既有 `parse_base_url`；② 三个新控件进设置界面）。全文按 ②＝乙 有效；若日后改口为甲，Task 1 的「响应形状/golden」与整个 Task 2 移出（`parse_base_url` 的语义扩大不受影响），其余不变。

## 硬约束

- **默认值全部保持现状**（**唯一例外＝`parse_base_url` 的语义扩大**，① 裁乙）：四条腿在不声明时与今天逐字节相同（每条的**负向对照**都要有正向执行证据，不是"看起来没坏"）；那条例外必须另有一条**正向**用例钉住（设了地址 ⇒ 云腿真的打到那里）。
- **被改语义的既有字段只有一个**：`parse_base_url`（类型／默认／两层位置都不动）；`parse_tier`／`parse_provider`／`asr_*` 一行不动。**这条行为变化要登记**（Task 3 的盘点档 A-6 行 ＋ Task 5 回写），不许静默。
- **三个消费点同批**：云腿两处在同一 `if/else` 两侧、视频一处在另一文件；只改一处＝半个旋钮。
- **不新增机制**：不造校验、不造异常、不动 `MODEL_REFERENCE_FIELDS`（非模型引用）、不动保存期检查与掩码/原子写。
- **不装 PaddleOCR**：本对只保证"装上后语种可配"；屏幕文字可用性是运维动作（spec §6.2）。
- **共享组件（`app_config.py`／`rag_config_file.py`／前端三件套）改完必须跑全量**。

## 执行纪律

- 当前分支 `feat/rag-knowledge-base`。起草轮只写文档、不据此开工；实施按 **RED → GREEN → neuter（行为还原并记录受害者）→ revert proof → 门禁** 执行；提交／推送按届时明确授权，使用 Conventional Commits。
- 后端在 `backend/` 用 `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest <path>`；ruff 用 `uv run --no-sync ruff check` 与 `uv run --no-sync ruff format --check`（不用裸 `uv run`／`uv sync`）。
- 前端在 `frontend/` 用 `PYTHONIOENCODING=utf-8 python ../scripts/pnpm.py <script>`。
- 单测显式绑定临时配置；**云腿用例用 `MockTransport` 拦网**（不真发 MinerU）；视频腿用假引擎/fake runner（PaddleOCR 不装）。
- 真栈只允许临时改 **RAG 配置**；`rag_config.json` 与 `config.yaml` 先存档字节、成功/失败均逐字节还原；只清理本次创建且可确定 ID 的资源。
- **找会被影响的既有断言按界面词汇与数据字段两把扫**（`parse_`／`asr_`／`解析档位`／`解析提供方`）。

**依赖顺序**：Task 0（只读核实）→ Task 1（后端三新字段＋`parse_base_url` 语义扩大＋云腿两处＋视频一处）→ Task 2（前端，② 已裁乙）→ Task 3（示例/版本/文档）→ Task 4（真栈）→ Task 5（回写）。Task 1 与 Task 2 之间不发布（只发 Task 1 会让 GET 多三键而前端不认）。**与 ASR 服务档那一对的串行（spec §5.2）**：它的写码任务（当前 Task 1 在飞，还剩 Task 1–4）先落地，本对的 **Task 1–3 排其后**——共享七处（两层配置／router 的 GET ＋ `_ADDED_FIELDS`／`response_golden.json`／`test_rag_config_api.py`／视频区 JSX ＋ i18n 三文件／同份 dom 用例／`config.example.yaml`）；本对 Task 0 的「golden 重数 ＋ 断言扫描」两项也等它落地后再做（其余四项不受影响）。**若它先 bump `config_version`，本对顺延 41 → 42**。

---

## Task 0 — 只读核实与基线捕获

- [x] **四个落点复核（按符号，不按行号）**：`parser.py::_apply_upload_url` 的请求体与签名、`_poll_result` 的 URL 拼接、`MINERU_BASE_URL` 的全部使用点；`build_parse_provider` 的 `if/else` 两侧 kwargs；`parse_document` / `MineruCloudParser.__init__` 的签名默认；`video/ocr.py::PaddleOcrEngine._engine` 与 `ocr_frame`；`worker._video_ocr_leg` 的调用形状。确认「谁取配置、谁传参、谁捕获错误」并记下现状。
- [x] **既有形状取样（逐字）**：`RagConfig` 的 `parse_tier`／`parse_base_url`／`video.asr_model`（`app_config.py`）与 `RagConfigFile` 对应字段的类型/默认/描述句式；前端 `config-form.ts` 的类型、`TEXT_FIELDS`、枚举清单、`formValuesFromConfig` 四处对 `parse_*` 的处理；`functional-models-view.tsx` 解析区（`:1720-1776`）与视频区（`:1455-1705`）的行结构；i18n 三文件的键名与空选文案。
- [x] **响应 golden 基线**：当场重数 `backend/tests/fixtures/rag_config/response_golden.json` 的键集（`get.config`／`get.sources`／`put.*`），作为双向差集基线（② 已裁乙，会用到）。
- [x] **断言扫描（两把扫）**：按数据字段（`parse_language`／`model_version`／`ocr_lang`／`parse_base_url`）与界面词汇（`解析提供方`／`解析档位`／`解析语种`／`屏幕文字`）各扫 `backend/tests` 与 `frontend/tests`，列出会被影响的既有用例。**已知四位（2026-09-29 审查点名，Task 0 只需确认仍在；行号已按 HEAD `34f4940e` 更新）**：`functional-models-view.dom.test.tsx:372-381`、同文件 `:383-391`、`config-form.test.ts:136`、`test_parse_local.py:410-424`（环境依赖型）；另 `test_ocr.py:61` 会因 `PaddleOcrEngine(lang)` 改必填而受影响。
- [x] **碰撞面（2026-09-29 升级：从"文档在飞"到"代码在飞"）**：**ASR 服务档那一对已开工且代码在飞**（未提交：`test_rag_config_api.py` 的 `asr_providers`／顶层 `asr_base_url`／`asr_api_key`，`test_rag_provider_config.py` 在扩 `asr` 腿）⇒ **开工前核它是否已落地**；落地后**重数 golden 键集、重扫断言**（本 Task 的这两项按新基线做，其余四项不受影响）。共享七处与串行约束见 spec §5.2。对 1（已交付）为加法，无冲突。
- [x] **云腿请求形状的现行证据**：用临时配置 ＋ `MockTransport` 捕一次今天的请求体（`language`/`model_version`/URL 主机）存作对照，供 Task 1 的"逐字节相同"负向对照使用。

**实测（2026-09-29 完成，只读核实；生产代码零改动、未提交）**：

**性质与基线**：Task 0 是**只读核实**，无 RED／neuter（plan 纪律明写不伪造这两类数字）。基线 HEAD `34f4940e`——ASR 服务档那一对**已收官**（plan 22／22 全勾、其代码已在 HEAD、工作树无该线在飞文件）。**用户真实配置一份没读**：全部探针走临时三件套（见 ⑥）。

**① 四个落点复核（按符号；行号仅作当时参考 —— ASR 线已让 worker 那处漂移）**

| 腿 | 谁取配置 | 谁传参 | 谁捕获错误 |
| --- | --- | --- | --- |
| 云腿请求体 | **今天无处取**（`language` 是 `:387` 的字面量） | `_apply_upload_url(client, *, file_name, data_id, model_version, token)`（`:383`）← `MineruCloudParser.__init__`（`:686`）→ `parse()`（`:701`） | 调用方（保存期构造不触网） |
| 云腿 URL | **今天无**（模块常量 `MINERU_BASE_URL` `:54`） | 两个函数各自拼：`:385`（申请）／`:406`（轮询） | 同上 |
| 云腿档位默认 | **三层签名默认** `"vlm"`（`:686`／`:722`／`:756`） | `build_parse_provider` 的 `if/else`：本地 `:743` `base_url`／云 `:746` `model_version` | —— |
| 视频 OCR | **今天无**（`PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)` `ocr.py:57`） | `ocr_frame`（`:84`）建默认引擎（`:90`）；`worker._video_ocr_leg`（`:676`）**每帧**调（`:684`；该腿入口 `:629`） | `PaddleOcrEngine.recognize` 的宽捕获 → 空串（`:48-50`） |

**② 既有形状取样（逐字）**：`RagConfig.parse_base_url: str | None = Field(default=None, …)`、`parse_tier: Literal["flash","basic","standard","advanced"] | None`（`app_config.py:216-222`）；`RagVideoConfig.asr_model: str = Field(default="paraformer-zh", …)`（`:157`）。`RagConfigFile` 同三字段全 `| None`（`rag_config_file.py:149-151`）、`RagVideoFileConfig.asr_model: str | None`（`:111`）。前端：类型 `config-form.ts:58-63`（`parse_provider`／`parse_base_url`／`parse_tier` ＋ `video.{asr_provider,asr_model}`）、`TEXT_FIELDS`（`:120` 含 `parse_base_url`）、`SELECT_FIELDS`（`:136-137` 含 `parse_provider`／`parse_tier`）、`VIDEO_SOURCES`（`:140-143`）、`formValuesFromConfig`（`:181-186`）。视图：解析区 `:1720-1776`（`parseProvider` 行 ⓘ 在 `:1720`；本地分支 `:1733-1766`；云分支锁定孪生 `:1771-1776`）、视频区 `groupMultimodal` `:1455-1705`（caption 行 ＋ ASR 四行；后者用**共享可见词** `providerLabel`／`modelLabel`／`apiKeyLabel`／`endpointLabel` ＋ 各自 aria）。i18n：改的 2 键 = `parseBaseUrl`（`zh-CN:1751`）／`parseBaseUrlHint`（`:1752`）；空选项文案家族 = `parseTierAuto`（`:1754`，视图 `:829` 的 `"": F.parseTierAuto`）／`sparseProviderNone`（视图 `:840`）／`judgeModelNone`（`zh-CN:1762`）等。

**③ 响应 golden 基线（ASR 落地后重数）**：`get.config` **28**、`get.sources` **29**、`put.payload` **12**、`put.response.config` **28**、`put.response.sources` **29**。`_registered_additions` 里 ASR 已按 R19 同款补记（"…were added by hand (spec 2026-09-28 ASR service tier §3; same R19 reason…)"）⇒ 本对三键照同格式续一句；本对落地后应为 **31／32／12／31／32**。

**④ 断言扫描（两把扫）**

- **数据字段轴**：后端 `test_rag_config_api.py`（全文键集守卫 `:842` 的 `set(body) == set(golden) | _ADDED_FIELDS` —— 本对三键是**嵌套**、不经过它 ✓）、`test_parse_local.py`、`test_rag_provider_config.py`、`test_rag_config_save_probe.py`、`test_rag_config_sparse_probe.py`、`test_embedder_providers.py`、`fixtures/rag_config/response_golden.json`；前端 `unit/rag/config-form.test.ts`、`unit/settings/functional-models.dom.test.tsx`。
- **界面词汇轴**：`knowledge/video/{test_ocr,test_recaption,test_shot_card,test_worker_pipeline}.py`、`knowledge/eval/test_video_eval.py`（「屏幕文字」是镜头卡第三行 —— 本对不碰卡片组装 ✓）；前端 `unit/knowledge/chunk-drawer.dom.test.tsx`、`unit/settings/functional-models.dom.test.tsx`。
- **确认为受害者（四位 ＋ 一位）**：`functional-models-view.dom.test.tsx:372-381`／`:383-391`、`config-form.test.ts:136`、`test_parse_local.py:410-424`、`test_ocr.py:61` —— 与审查点名一致、仍在原位。

**⑤ 碰撞面**：ASR 服务档已落地（22／22、`34f4940e`）；共享七处与串行约束见 spec §5.2；它还在 `app_config.py:156-158` 留下同款 ①乙 注释（"The ASR leg's connection info sits here rather than inside `video:`…"）—— 与本对 §5.2 的边界句一致 ✓；落地后的「重数 golden ＋ 重扫断言」已在本段完成。

**⑥ 云腿请求形状的现行证据（今日基线，捕获于临时三件套）**

`DEER_FLOW_CONFIG_PATH`＝`config.example.yaml` 的副本、`DEER_FLOW_MODELS_CONFIG_PATH`＝`{"models":[]}`、`DEER_FLOW_RAG_CONFIG_PATH`＝`{}` ＋ `MockTransport` ⇒ 捕获一次：

```
POST https://mineru.net/api/v4/file-urls/batch
Authorization: Bearer <token>
{"files": [{"data_id": "probe", "name": "probe.pdf"}], "language": "ch", "model_version": "vlm"}
```

**⚠ 隔离姿势（Task 1 新用例必须照办）**：`ModelsConfig`／`RagConfigFile.resolve_config_path` 有 **`__file__` 回退**（editable 安装 ⇒ 直指**仓库根**）⇒ 只设 `DEER_FLOW_CONFIG_PATH` 不够，三个 `DEER_FLOW_*_PATH` 都要指到临时文件，否则会合并**真实** `models_config.json`／`rag_config.json`（首次探针就这么撞上：校验错误里出现了不在临时配置里的真实模型）。

**Task 0 新出发现（已就地回写 spec／plan）**

1. **i18n 是 8 键不是 6 键**：两个新 `OptionSelect` 各需一个**空选项标签**键（既有家族：`parseTierAuto`／`sparseProviderNone`／`judgeModelNone`）⇒ spec D3 与 plan Task 2 已改为 **8 键 × 3 文件 ＝ 24 处**（文案仍沿用「（使用配置默认）」）。
2. **视频区锚点过期**：`groupMultimodal` 真实边界 **`:1455-1705`**（原引 `:1428-1510` 只盖到开头）⇒ 已改。
3. `worker._video_ocr_leg` 行号已漂（原记 `:664-673` → 现 `:676-684`）—— 按符号无碍，仅记录。

**遗留**：Task 1–5 待授权；PaddleOCR 仍未装（A-3 的端到端边界，见 spec §6.2）。

---

## Task 1 — 后端三新字段、`parse_base_url` 语义扩大与三个消费点

> 文件：`config/app_config.py`、`config/rag_config_file.py`（② 已裁乙）、`knowledge/parser.py`、`knowledge/video/ocr.py`、`backend/tests/…`、`tests/fixtures/rag_config/response_golden.json`（② 已裁乙）。
> **验收对应**：spec §4 的 1 / 2 / 3 / 4 / 6。

- [ ] **RED：加载链**：无覆盖 ⇒ 三个新字段取默认（`"ch"`／`"vlm"`／`"ch"`）；`parse_base_url` 为空 ⇒ 云腿退官方常量；文件层覆盖生效、撤销回到 config.yaml；非法 Literal ⇒ 422。不经"直接构造 `AppConfig(...)`"代替。
- [ ] **RED：云腿请求体（`MockTransport`）**：`language`／`model_version` 来自配置且为顶层批参数；**`parse_base_url` 非空 ⇒ 请求打到该主机（正向）**、为空 ⇒ 与 Task 0 捕的请求体逐字节相同（负向对照）。**负向对照落在既有守卫 `test_parse_local.py:410-424`（`host == "mineru.net"`）上**——它的 `_stub_config` 会**继承真实配置**（今天靠"云腿忽略该字段"侥幸绿）⇒ **先显式钉 `parse_base_url=None`**；正向用例照 `:389` 的写法 `_stub_config(..., parse_base_url="http://127.0.0.1:9999")` 看 host（夹具现成）。
- [ ] **RED：视频腿**：`ocr_lang` 被传到 `PaddleOcrEngine`（捕构造参数）；引擎缺失路径不变。
- [ ] **GREEN**：两层各加**三个新字段**（描述按各自那一层的邻居写）＋ **两层的 `parse_base_url` 描述都改成两态口径**（云腿留空＝官方；本地腿必填、不带鉴权）；`parser.py` 三处签名加 `language`／`base_url`（默认＝今天的字面量）；`build_parse_provider` 云腿分支传三个值（`model_version`／`language`／`base_url`＝`section.parse_base_url or MINERU_BASE_URL`）、本地腿不动；`video/ocr.py` 的 `PaddleOcrEngine(lang=…)`（**`lang` 必填、无默认**——默认只留在 `RagConfig.video.ocr_lang` 一处；`test_ocr.py:61` 的裸构造补参） ＋ `ocr_frame` 现取配置。**同一个提交**更新 golden（② 已裁乙）＋ **在它的 `_registered_additions` 补一句**（三键含嵌套键 `video.ocr_lang`，走不了顶层 `_ADDED_FIELDS` 白名单 —— R19 先例）。
- [ ] **neuter：整体还原旧行为**，逐项独立还原并证明 GREEN 恢复、各有对应用例转红：① 请求体回到字面 `"ch"`／签名默认 `"vlm"`；② URL 回到常量（**忽略 `parse_base_url`**）；③ 引擎回到字面 `lang="ch"`；④（② 已裁乙）文件层去掉三个新字段 ⇒ 形状守卫转红。
- [ ] **门禁**：ruff 双净；RAG 配置／解析／视频窄面绿；`app_config.py` 与 `rag_config_file.py` 是共享加载路径 ⇒ **跑后端全量**（后台执行，结果未回不报绿），与基线集合对照零新增。

**实测（待回填）**：

---

## Task 2 — 前端触点与两个区（② 已裁乙）

> 文件：`core/rag/types.ts`、`core/rag/config-form.ts`、`components/workspace/settings/functional-models-view.tsx`、`core/i18n/locales/{types,zh-CN,en-US}.ts`；用例 `tests/unit/rag/config-form.test.ts`、`tests/unit/settings/functional-models.dom.test.tsx`。

- [ ] **RED：保存不丢字段**（B-1 形状的反向守卫）：三个新字段任一有文件层覆盖时，编辑无关字段后 `buildRagConfigInput()` 仍带它。
- [ ] **RED：保存不可用也要防**：只改 `ocr_lang` ⇒ Save 必须**可用**（`hasFormChanges` 的 video 列表 `config-form.ts:677` 漏了它就会一直禁用；这条与"保存不丢"是两回事，两条都要有）。
- [ ] **RED：读取映射**：`formValuesFromConfig()` 把三项（含 `null`/缺键）正确落成表单值。
- [ ] **RED：界面结构**：解析区新增语种／版本两行——**云分支是可编辑控件、本地分支是同名的锁定孪生**（`lockedCloudOnly`）；**地址行标题为「服务地址」**（始终可编辑、**无**锁定孪生）；**两态 ⓘ 在「解析提供方」行**（`:1720`）；视频区多一行 `ocrLang`；用 `aria-label` 与分组标题断言，不断言几何。
- [ ] **RED：既有断言改写（不是放宽，2026-09-29 审查点名）**：`config-form.test.ts:136` 的 `values.video` 是**整对象相等** ⇒ 补 `ocr_lang` 键；`functional-models-view.dom.test.tsx:372-381` 云分支改成"地址行可编辑 ＋ `getAllByText("lockedLocalOnly").length === 1`"；`:383-391` 的 `lockedCloudOnly` 由**单数** `getByText` 改 `getAllByText(...).length === 3`。**⚠ 孪生行没有 aria-label**（照 `mineruToken` 孪生）而 `labelCount` 用 `queryAllByLabelText` ⇒ 孪生断言用 gutter 文本/计数，**别用 `labelCount`**（恒 0 ＝ 假绿）。
- [ ] **GREEN**：**触点六处，一处不漏**：① `types.ts` 三项；② `config-form.ts` 表单值类型三行；③ `SELECT_FIELDS`（语种／版本）＋ `VIDEO_SOURCES`（`ocr_lang` → `video.ocr_lang`）；④ `formValuesFromConfig` 三行；⑤ **`buildRagConfigInput` 的 video 自由文本循环（`:288`）并上 `ocr_lang`**；⑥ **`hasFormChanges` 的 video 列表（`:677`）加 `ocr_lang`**。视图两区（语种/版本用 `OptionSelect`、OCR 语种用 `Input`；**地址行只改标题**，`parseBaseUrlHint` 的两态口径改的是**「解析提供方」行的 ⓘ**（`:1720`））＋ i18n **新 8 键 × 3 文件**（六键角色标签/提示 ＋ **两个 select 的空选项标签 2 键**，Task 0 实测更正） ＋ **改 2 键 × 2 语（`parseBaseUrl` 标题、`parseBaseUrlHint` 说明）**。
- [ ] **neuter**：① 从各清单去掉三个新字段（`parse_language`/`parse_model_version` 在 `SELECT_FIELDS`、`ocr_lang` 在 `VIDEO_SOURCES`）⇒ 保存不丢转红；**①′ 只把 `ocr_lang` 从 `buildRagConfigInput` 的 video 循环去掉** ⇒ 保存不丢转红（验第 ⑤ 触点有牙）；**①″ 只把 `ocr_lang` 从 `hasFormChanges` 的列表去掉** ⇒"Save 仍可用"转红（验第 ⑥ 触点有牙）；② 从 `formValuesFromConfig` 去掉三行 ⇒ 读取映射转红；③ **把本地分支的两个锁定孪生行删掉** ⇒ 界面结构转红（验"孪生"这条有牙；**不是**"把两行放进本地分支"——甲方案下本地分支本来就该有它们）。
- [ ] **门禁**：`pnpm check` 零诊断；`config-form` 与 `functional-models` 窄面绿；**前端全量**（共享组件，后台执行）。

**实测（待回填）**：

---

## Task 3 — 示例文件、版本与文档

> 文件：`config.example.yaml`、`deploy/helm/deer-flow/values.yaml`、`deploy/helm/deer-flow/README.md`、**仓根 `README.md`**、`backend/AGENTS.md`、[盘点档](../../PRE_RELEASE_HARDCODE_INVENTORY.md)。**`rag_config.example.json` 不改**（该文件口径＝模型条目／主设施字段，其守卫绑定 `MODEL_REFERENCE_FIELDS`）。**不运行 `make config-upgrade`、不读改用户真实配置。**

- [ ] **RED**：模板契约用例扩三项（存在、键序、`config_version` ≥ 41；**取值按各段既有风格**：parse 段两处是注释示例、video 段 `ocr_lang` 是**实值 `ch`**）。**`rag_config.example.json` 不进断言面**（它不改）。
- [ ] **GREEN**：示例**按各段风格**（parse 段：两处新增注释示例 ＋ `parse_base_url` 注释改两态；video 段：一行注释 + 实值 `ocr_lang: ch`）／版本同批（`config_version` 40 → 41，**若 ASR 服务档先落地并 bump 则顺延 42** ＋ chart 同升，否则 `scripts/check_config_version.sh` 会新开红）；**仓根 `README.md` 两处**（解析 bullet `:46` 补"云腿留空＝官方、填了就打到它"；视频 bullet `:45` 补"PaddleOCR 未安装 ⇒ 屏幕文字恒空"）；`backend/AGENTS.md` 补三个旋钮＋ `parse_base_url` 的两态口径 ＋ **把 PaddleOCR 加进视频重依赖清单** ＋ 一句"未安装时屏幕文字恒空"；盘点档 A-2 例证收窄（"非中英文字种"）＋ **复核 A-6 行的"⚠ 不再能称纯加法"批注**（起草轮 2026-09-29 已就地登记，实施时确认仍在即可）。
- [ ] **门禁**：示例契约用例绿；`bash scripts/check_config_version.sh` OK；grep 复核**三处新增键 ＋ 一处改写**出现（parse 段两键、video 段 `ocr_lang`、`parse_base_url` 注释）。

**实测（待回填）**：

---

## Task 4 — 真栈验收

> 前提：服务运行且已加载本对代码；`config.yaml` 与 `rag_config.json` 先存档字节/md5，结束逐字节还原。

- [ ] **腿一（语种）**：改 `parse_language` ⇒ 入库一条文本文件，网关日志里 MinerU 请求体的 `language` 跟着变（具名证据）；清空 ⇒ 回 `"ch"`。
- [ ] **腿二（档位）**：改 `parse_model_version` ⇒ 请求体 `model_version` 跟着变；清空 ⇒ 回 `"vlm"`。
- [ ] **腿三（地址）**：把 `parse_base_url` 设到一个**可控的失败地址**（如 `http://127.0.0.1:9/`，日志只体现主机名）⇒ 云腿请求打到该主机并失败（**这同时是 spec §6.2 那条行为变化的真栈证据**：该字段在云腿下从"被忽略"变"生效"）；清空 ⇒ 回官方地址。（**不把真实文档流量引向不明主机**；失败即证据。）
- [ ] **腿四（OCR 语种）**：引擎未装 ⇒ 只验"配置被读到"（`ocr_lang` 改了以后 `PaddleOcrEngine` 构造参数随之变，用日志或单测；引擎端到端无法验收，如实记）。
- [ ] **还原**：两份配置逐字节还原；清理本次创建的测试文档（按 id）。

**实测（待回填）**：

---

## Task 5 — 交付回写

- [ ] **spec／plan Status** 改为已交付，记录 ①② 的裁定（①＝复用既有字段、②＝进界面）；**把 spec §6.2 首条的行为变化写进交付纪要**，并核对盘点档 A-6 行的登记已落；逐 Task 的「实测」补齐。
- [ ] **盘点档**：A-2／A-3／A-5／A-6 四条标已交付并指向本对；§4.2「对 2」标已交付；计数随 §4.2 与 §4 可做清单调整。
- [ ] **文档缺口**（本对话 2026-09-29 查出的两处）随本对收口：`backend/AGENTS.md` 重依赖清单补 PaddleOCR（Task 3）；盘点档 A-3 行补一句"实施前重读引擎欠账"。
- [ ] 提交按届时授权，Conventional Commits；不推送除非明确要求。

**实测（待回填）**：
