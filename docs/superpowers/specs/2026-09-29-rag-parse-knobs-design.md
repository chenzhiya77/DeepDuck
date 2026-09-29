# 解析与视频 OCR 的四个旋钮：MinerU 语种／服务地址／解析档位／OCR 语种 —— 设计

**Status:** **2026-09-29 起草，待开工。四项改法已按用户同日裁定落定**（「A-2 + A-3 + A-6 + A-5 都按你的推荐来」＝提成配置字段）。**§6.1 两项均已裁**：**①＝乙**（服务地址**复用一个既有字段**、界面标题改「服务地址」，云腿留空＝官方默认、本地腿必填；随之登记本对**唯一一条行为变化**，见 §6.2 首条）；**②＝乙**（三个新控件进设置界面：解析语种、模型版本、OCR 语种；地址行只改标题与说明）。**本对再无待裁项。**除那条行为变化外，默认行为全部保持现状。本轮只产出文档，未实现、未提交，不读取或修改真实 `config.yaml` / `models_config.json` / `rag_config.json`。

**Plan:** [2026-09-29-rag-parse-knobs.md](../plans/2026-09-29-rag-parse-knobs.md)

**相关记录**：

- [发布前写死项盘点](../../PRE_RELEASE_HARDCODE_INVENTORY.md) §4.2「对 2」＝本对（`A-2` + `A-3` + `A-6` + `A-5`）；四条完整证据在那里，本文件只写改法。
- [2026-09-24 MinerU 4.x 解析适配](2026-09-24-mineru-4x-parse-adaptation-design.md)：**本地腿**的 `parse_backend → parse_tier` 与地址字段；其 spec 明写「**mineru-cloud 零改动**」⇒ A-2／A-5／A-6 **不在它范围内**（本对补上）。
- [2026-09-08 视频入库](2026-09-08-video-ingest-design.md)：视频四条腿与 `video_*` 字段的来源；A-3 的 `lang="ch"` 就在它建的 ocr 腿上。
- [2026-09-27 ASR 模型选择器](2026-09-27-rag-asr-model-picker-design.md)：把 `asr_provider` / `asr_model` 做成界面行（本对与它同区、同文件 ⇒ 碰撞面见 §5.2）。

## 1. 目标与边界

把四个「决定结果方向、却写死在代码里」的值提成配置字段（其中"服务地址"＝**扩大既有 `parse_base_url` 的语义**，不新开字段——① 裁乙）。**除 §6.2 首条登记的唯一例外外**，不声明时四条腿的行为与今天逐字节相同。

| 本期做 | 本期不做 |
| --- | --- |
| `rag.parse_language`（MinerU **云腿**语种，16 值，默认 `"ch"`）—— A-2 | 装 PaddleOCR 或换 OCR 引擎；改 caption 的 prompt |
| `rag.parse_model_version`（云腿档位，`pipeline`／`vlm`，默认 `"vlm"`）—— A-5 | 改默认值（"默认该不该是平台默认 `pipeline`"留白）；`MinerU-HTML` 档（上传白名单没有 `.html`，不可达） |
| **服务地址＝复用既有 `rag.parse_base_url`**（语义扩为"当前解析服务的地址"：云腿留空＝官方 `https://mineru.net`；本地腿仍必填）—— A-6 | 为云腿**新开**一个地址字段（① 已裁乙）；改 `parse_base_url` 的类型与默认值 |
| `rag.video.ocr_lang`（PaddleOCR `lang`，默认 `"ch"`）—— A-3 | 语言/档位的枚举远端同步；除 Literal 外的额外校验 |
| 三个新字段进两层 ＋（② 已裁乙）设置界面：解析区云腿两行、地址行改标题、视频区一行 | 保存期新增校验；不动 `models:` 引用机制 |

**为什么值得做**（四条都属盘点档 §1.2 的"坏-A"：值决定结果方向、用户够不着）：

- **A-2**：MinerU 云 API 本就支持 16 个语言包（官方默认就是 `ch`）——**问题不在平台，在我们没把能力接出来**；`ch` 的字面含义是「中英文」，所以受影响的是日／韩／繁／泰／阿拉伯／西里尔等语种的文档。
- **A-5**：我们硬点 `vlm` 而**平台默认是 `pipeline`** ⇒ 替用户选了另一条解析流水线；同为"解析档位"，**本地腿有 `parse_tier` 字段、云腿没有**。
- **A-6**：该地址决定**源文件被 PUT 到哪台服务器**（数据出域方向由代码定）；`parse_base_url` 只服务本地腿，其余端点腿各有地址旋钮。
- **A-3**：视频屏幕文字用哪套字库被钉死；非中英文字幕认不出，且降级为空、不报错（静默）。

## 2. 决定

### D1 三个新字段 ＋ 一个既有字段的语义扩大（各自照邻居的形状）

| 字段（`config.yaml` 的 `rag:` 段） | 类型 | 默认 | 照谁 |
| --- | --- | --- | --- |
| `parse_language`（新） | `Literal[16 值]`（官方「language 取值参考」全表） | `"ch"` | `parse_tier` 的 Literal 形状 |
| `parse_model_version`（新） | `Literal["pipeline", "vlm"]` | `"vlm"` | 同上；只列两档 |
| `parse_base_url`（**既有，类型与默认都不动**） | `str \| None` | `None` | —— |
| `video.ocr_lang`（新） | `str` | `"ch"` | `video.asr_model` 的**字面默认**形状 |

- **`parse_base_url` 的语义扩大（① 裁乙；本对唯一行为变化，§6.2 首条）**：描述由「本地 MinerU 服务地址；`parse_provider=mineru-local` 时必填」改为「**当前解析服务的地址**：云腿留空＝官方 `https://mineru.net`；本地腿必填（该服务不带鉴权，只应部署在内网）」。**类型、默认值、两层声明位置一律不动**；空态语义随 provider 变，靠字段描述与行内 ⓘ 写清。判据（为什么两个 provider 共用一个地址字段是对的）：仓内的同类参数就是这样——`embedding_base_url` 服务 3 个 provider、`asr_model` 服务 2 个，都是"一类参数一个字段"；**＋ 同日、同页的第三个先例**：ASR 腿（[2026-09-28 那一对](2026-09-28-rag-asr-service-tier-design.md)）也是 **4 个值（`funasr`／`whisper`／`openai-audio`／`dashscope`）共用一个 `asr_base_url`** ⇒ 这条规则正在同一张设置页上被第二条腿复制。
- 16 值（官方取值参考，2026-09-29 两次实测一致）：`ch`、`ch_server`、`en`、`japan`、`korean`、`chinese_cht`、`ta`、`te`、`ka`、`el`、`th`、`latin`、`arabic`、`cyrillic`、`east_slavic`、`devanagari`。官方原文：`language`「指定文档语言，默认 `ch`…**仅对 pipeline、vlm 模型有效**」；`model_version`「三个选项:pipeline、vlm、MinerU-HTML，默认 pipeline…HTML 文件需明确指定为 MinerU-HTML」。
- `ocr_lang` **用自由字符串而非 Literal**：PaddleOCR 的 `lang` 清单随版本变（2.x／3.x 不同），且引擎尚未安装（§6.2）⇒ 不做枚举校验；装引擎那天按当时版本的清单核对。
- **三个新字段两层都声明**：`RagConfig`（config.yaml 层）给字面默认；`RagConfigFile`（UI 文件层）同名同类型、默认 `None` ＝"不覆盖 config.yaml"（照 `parse_tier` 的既有关系）。**不进 `MODEL_REFERENCE_FIELDS`**（它们不是模型条目引用）。

### D2 三个消费点（云腿两处 ＋ 视频一处）

| 消费点 | 今天 | 改成 |
| --- | --- | --- |
| `parser.py:387` `_apply_upload_url` 的请求体 | `"language": "ch"`；`model_version` 来自三层签名默认 `"vlm"` | 语种与档位从 `get_app_config().rag` 现取；两者仍是**顶层批参数**（官方文档：per-request，不是 per-file） |
| `parser.py:54` `MINERU_BASE_URL`（拼进 `:385` 申请上传、`:406` 轮询） | 模块常量，无覆盖 | 常量**保留作默认**；两个拼 URL 的函数各收 `base_url: str = MINERU_BASE_URL`；云客户端由 `build_parse_provider` 传 `section.parse_base_url or MINERU_BASE_URL`（① 裁乙：读的就是既有字段） |
| `video/ocr.py:57` `PaddleOCR(..., lang="ch")` | 字面量 | `PaddleOcrEngine(lang=…)`；`ocr_frame` 建默认引擎时现取 `get_app_config().rag.video.ocr_lang`（与 `wiki/generator.py` 的"调用点现取配置"同形状） |

**形状纪律**：三处只改"值从哪来"。`build_parse_provider` 的 `if/else` 两侧各加自己的 kwargs（云腿：`model_version` ＋ `language` ＋ `base_url`（空则退常量）；本地腿：`base_url` ＋ `tier`——**这一侧今天就是这么写的，不动**）；语种与档位的签名默认收敛为"一处默认"（`RagConfig` 字段），避免 `:686` / `:722` / `:756` 三处默认再漂；地址那一处的默认仍是模块常量。

### D3 界面（② 已裁＝乙：进设置界面）

界面改动为：

- **解析区**：新增两行 —— 「解析语种」`OptionSelect`（16 值 + 空）与「模型版本」`OptionSelect`（`pipeline`／`vlm` + 空），**控件形状**照 `parse_tier` 行（`functional-models-view.tsx:1748-1762` 一带）。**这两行同样"始终渲染"**（该区的硬约定：不适用的行锁上并给原因，不隐藏）：**云分支可编辑；本地分支渲染为同名的锁定孪生**，原因复用现成的 `lockedCloudOnly`（「仅云 API 需要」）——照 `mineruToken` 行在本地分支的样子（实测 `:1763-1766`）。两行都是**云腿专属**（本地腿的对应物是既有的 `parse_tier`，没有"语言／版本"这两个概念）。
- **地址沿用既有那一行**（不新增行；**始终可编辑**，① 裁乙后不再有"锁定孪生"）：**地址行只改标题** —— 「本地服务地址」→「**服务地址**」（i18n `parseBaseUrl`，两语同步）。**ⓘ 不在地址行**：`parseBaseUrlHint` 实测挂在**「解析提供方」行**（`functional-models-view.tsx:1720` 的 `RowLabel info={F.parseBaseUrlHint}`），所以两态口径写在**那一行**：**云腿留空＝官方 `https://mineru.net`；本地腿必填，该服务不带鉴权、只应部署在内网**（现文案只有后半句）。实施时按符号定位这个 `RowLabel`，别去地址行找 ⓘ。
- **视频区**：新增一行「OCR 语种」`Input`（`asr_*` 行旁，`groupMultimodal` 实测边界 `:1455-1705`）。
- i18n：**新增 8 键 × 3 文件 ＝ 24 处**（`parseLanguage`／`parseLanguageHint`、`parseModelVersion`／`parseModelVersionHint`、`ocrLang`／`ocrLangHint` 六键 ＋ **两个新 `OptionSelect` 各自的空选项标签 2 键** —— 既有家族就是这么做的：`parseTierAuto`（`:829` 的 `"": F.parseTierAuto`）、`sparseProviderNone`（`:840`）、`judgeModelNone`；Task 0 实测更正，原写 6 键）＋ **改 2 键 × 2 语 ＝ 4 处**（`parseBaseUrl` 标题、`parseBaseUrlHint` 说明）；空选项**文案**沿用既有那句（「（使用配置默认）」）。
- **前端触点（六处，缺一处就是缺陷——2026-09-29 审查补全）**：① `types.ts` 的 `RagConfigValues` 三项；② `config-form.ts` 表单值类型三行；③ **`SELECT_FIELDS`**（`parse_language`／`parse_model_version`）与 **`VIDEO_SOURCES`**（`ocr_lang` → `video.ocr_lang`）；④ `formValuesFromConfig` 三行；⑤ **`buildRagConfigInput` 的 video「自由文本」循环**（`config-form.ts:288` 的 `for (const key of ["asr_model"] as const)` 要并上 `ocr_lang` —— 漏了它值**永不进载荷**，正是 B-1 形状）；⑥ **`hasFormChanges` 的 video 列表**（`config-form.ts:677` 的 `(["asr_provider","asr_model"])` 要加 `ocr_lang` —— 漏了它**只改 OCR 语种时 Save 一直禁用**）。
- **既有断言的改写（不是放宽，2026-09-29 审查点名）**：`config-form.test.ts:136` 的 `values.video` 是**整对象相等** ⇒ 补 `ocr_lang` 键；`functional-models-view.dom.test.tsx:372-381`（云分支：地址行变可编辑 ⇒ `labelCount("parseBaseUrl")` 0→>0、`lockedLocalOnly` 计数 2→1）与 `:383-391`（本地分支多两个孪生 ⇒ `lockedCloudOnly` 的单数 `getByText` 会因多元素抛错，改 `getAllByText(...).length === 3`）按新行为改写。**⚠ 孪生行没有 aria-label**（照 `mineruToken` 孪生），而 `labelCount` 用的是 `queryAllByLabelText` ⇒ 断言孪生要用 gutter 文本/`lockedCloudOnly` 计数，**不要用 `labelCount`**（恒 0，会写出假绿断言）。详见 plan Task 2。
- **不改**：`parse_provider` 开关本身、`parse_tier` 行、ASR 两行、卡片标题与卡片 ⓘ。

（若日后改口为甲：以上界面部分整体移出，三个新字段只进 `RagConfig`、不进 `RagConfigFile`（⇒ 无响应形状变化、无 golden 改动、无前端）；但 **`parse_base_url` 的语义扩大照旧发生** —— 那是 `RagConfig` 层的读取行为。）

### D4 不做与边界

- **不装 PaddleOCR**：它是可选重依赖（本机未装、`pyproject` 零声明）⇒ A-3 只做"字段 ＋ 传参"，**屏幕文字真正可用**仍是运维动作（装引擎 ＋ 校准 `_lines_from_paddle` 的返回形状，见 §6.2）。
- **不改默认值**："`vlm` 该不该改成平台默认 `pipeline`""语种该不该仍 `ch`"都是产品决定，本对留白。
- **不改 caption prompt**（"caption 临时顶 OCR"的讨论结论：caption 双模式已在兜，本对不做）。
- **不新增保存期校验**：Literal 由 pydantic 校验（非法值 422），地址格式不校验（与 `embedding_base_url` 等一致）。
- **不动**：`knowledge/model_target.py`、`models/factory.py`、`rag_config.json` 的掩码／原子写／热加载机制、MinerU 本地腿客户端。

### D5 文档与模板同批

- `config.example.yaml` 的 rag 段：**parse 段是"注释示例"风格**（实测 `:2613-2615` 一带）⇒ 加**两处**注释示例（`parse_language`／`parse_model_version`，中性占位）＋ **改写一处**（`parse_base_url` 那条注释，把「required when parse_provider=mineru-local」改成两态口径）；**video 段是"注释 + 实值"风格**（实测 `:2658` 起，如 `asr_provider: funasr`）⇒ `ocr_lang` 按该段风格加**一行注释 + 实值 `ch`**，不是注释示例。合计＝**三处新增 ＋ 一处改写**。`config_version` **40 → 41**（门 A／对 1 的先例），`deploy/helm/deer-flow/values.yaml` 与 `deploy/helm/deer-flow/README.md` 同批。**⚠ 编号随落地顺序**：若 ASR 服务档那一对先落地并 bump（它也要改配置面），本对顺延 **41 → 42**（见 §5.2 的串行约束）。
- **仓根 `README.md` 两处（2026-09-29 审查补）**：解析 bullet（`:46`）补"云腿留空＝官方地址、填了就打到它"；视频 bullet（`:45`）补"PaddleOCR 未安装 ⇒ 屏幕文字恒为空"。
- `backend/AGENTS.md`：RAG 段补**三个新旋钮**（`parse_language`／`parse_model_version`／`video.ocr_lang`）**＋ 改写 `parse_base_url` 的两态口径**；**把 PaddleOCR 加进"视频重依赖"清单**（现清单缺它）＋ 一句"未安装时屏幕文字恒空"（2026-09-29 实测的文档缺口）。
- `rag_config.example.json` **不改（2026-09-29 审查定）**：该文件的既有口径是"模型条目／主设施字段"，其守卫（`test_rag_config_example.py:48-54`）把"模板里应含什么"与 `MODEL_REFERENCE_FIELDS` 绑定 —— 三个新字段都不是模型引用。
- 盘点档：A-2 行的例证收窄为"**非中英**文字种被硬套中英文字库"（`ch` 官方含义＝中英文，纯英文文档受影响很小）；四条在交付时标已交付。

## 3. 接口与实施归属

| 接口／对象 | 本期契约 |
| --- | --- |
| `RagConfig.parse_language` / `.parse_model_version` / `.video.ocr_lang`（**新**）＋ `parse_base_url` 的**语义扩大** | D1 表 |
| `RagConfigFile` 同名三新字段 | 同类型、默认 `None`；声明即自动进 GET／PUT 响应与 `sources`（`_build_response` 反射） |
| `MineruCloudParser.__init__` / `build_parse_provider` / `parse_document` | 各加 `language` / `base_url` 参数（默认 `None` ⇒ 读配置 ⇒ 云腿地址再退官方常量）；语种／档位的签名默认不再是值的唯一来源 |
| `_apply_upload_url` / `_poll_result` | 各加 `language` / `base_url` 参数（默认＝今天的字面量，保证不传时逐字节相同） |
| `PaddleOcrEngine` / `ocr_frame` | 引擎构造收 `lang`，**必填、无默认**（默认只留在 `RagConfig.video.ocr_lang` 一处；`test_ocr.py:61` 的裸构造补参）；`ocr_frame` 现取配置后传入 |
| 设置界面（**② 已裁乙**） | 解析区两新行（云分支可编辑、本地分支锁定孪生）＋ 地址行改标题 ＋ provider 行 ⓘ 改说明 ＋ 视频区一行；不含新卡片 |
| `response_golden.json`（**② 已裁乙**） | GET／PUT 的 `config`/`sources` 各多 **三** 键（`sources` 用嵌套键 `video.ocr_lang`）；**`_registered_additions` 记一句**（R19 先例：嵌套新键进不了顶层 `_ADDED_FIELDS` 白名单）；形状守卫同批 |

## 4. 验收清单

1. **加载链**：无覆盖 ⇒ 三个新字段取字面默认（`"ch"`／`"vlm"`／`"ch"`）；`parse_base_url` 为空时云腿落官方常量；文件层覆盖生效、撤销覆盖回到 config.yaml；两层的类型不合法值时 422。
2. **云腿请求体**：临时配置 ＋ `MockTransport`（不真发网）观察：`language`／`model_version` 来自配置、且是**顶层批参数**；`parse_base_url` 非空时云腿请求打到该主机，为空时打官方（负向对照：与今天的请求**逐字节相同**）。**负向对照落在既有守卫 `test_parse_local.py:410-424` 上**——它的 `_stub_config` 会**继承真实配置的 `parse_base_url`**（今天靠"云腿忽略该字段"侥幸绿），先显式钉 `None`；正向用例照 `:389` 的写法 `_stub_config(..., parse_base_url="http://127.0.0.1:9999")` 看 host（夹具现成）。
3. **视频腿**：`ocr_lang` 被传给 `PaddleOcrEngine`（fake 引擎或捕构造参数）；引擎未装 ⇒ 端到端仍是"空结果"路径（不因本次改动改变）。
4. **四条各自的负向对照**：不声明 ⇒ 行为与今天逐字节相同（不是"看起来没坏"的空洞断言——每条的默认路径都要有正向执行证据）。**唯一例外**＝`parse_base_url` 非空的部署在云腿下的新行为（§6.2 首条），要有一条**正向**用例钉住它（设了地址 ⇒ 真的打到那里）。
5. **界面（② 已裁乙）**：解析区新增语种／版本两行（**云分支可编辑、本地分支锁定孪生**）、**地址行标题为「服务地址」**、**两态 ⓘ 在「解析提供方」行**；视频区多一行 `ocrLang`；保存不丢（B-1 形状的反向守卫）；非 RAG 隔离不变（既有 `parse_*` / `asr_*` 断言全绿）。
6. **响应形状（② 已裁乙）**：以 goldens 为基线做**双向差集**，`config`／`sources` 仅各多 **三** 键，其余逐字不变。
7. **门禁**：后端 ruff 双净、RAG 窄面与全量（共享加载路径）；前端（② 已裁乙）`pnpm check`、窄面与全量。
8. **真栈**：改 `parse_language` / `parse_model_version` / `parse_base_url` ⇒ 入库一条文本文件，网关日志里的 MinerU 请求 URL 与请求体跟着变（具名证据）；`ocr_lang` 因引擎未装只验"配置被读到"（日志/单测），如实验收边界；`config.yaml` 与 `rag_config.json` 逐字节还原。

## 5. 文件影响

### 5.1 本期修改面

| 文件 | 修改 |
| --- | --- |
| `config/app_config.py`（`RagConfig` ＋ `RagVideoConfig`） | 三个新字段 ＋ `parse_base_url` 的**描述扩写**（D1） |
| `config/rag_config_file.py`（② 已裁乙） | 三个新字段（含 `RagVideoFileConfig.ocr_lang`）＋ `parse_base_url` 描述扩写（**两层描述都要改**） |
| `knowledge/parser.py` | 云腿消费点（D2） |
| `knowledge/video/ocr.py` | `lang` 参数 ＋ 现取配置 |
| `frontend/src/core/rag/{types,config-form}.ts`、`functional-models-view.tsx`、`i18n/locales/{types,zh-CN,en-US}.ts`（② 已裁乙） | 触点 ＋ 解析/视频两区 ＋ **新 6 键** ＋ 改 `parseBaseUrl`／`parseBaseUrlHint` |
| `backend/tests/…` | 加载链、请求体、引擎参数、（界面形状守卫） |
| `config.example.yaml`、chart `values.yaml` ＋ `deploy/helm/deer-flow/README.md`、**仓根 `README.md`**、`backend/AGENTS.md`、盘点档 | D5（`rag_config.example.json` **不改**，见 D5） |

**明确不改**：`parse_tier`／`parse_provider`／`asr_*` 的语义与默认值；`parse_base_url` 的**类型与默认值**（只有语义扩大，见 D1）；`video/captioner.py` 与其 prompt；`_lines_from_paddle`；MinerU 本地腿客户端（`parse_local.py`）；`models/factory.py`、`knowledge/model_target.py`、rag router 的响应反射与保存期检查。

### 5.2 碰撞面

- **ASR 服务档**（[2026-09-28 那一对](2026-09-28-rag-asr-service-tier-design.md)：**已立项开工、代码在飞**（2026-09-29 实测：`test_rag_config_api.py` 未提交的 +99 行里已有 `asr_providers`／顶层 `asr_base_url`／`asr_api_key`，`test_rag_provider_config.py` 已在扩 `asr` 腿）；**它自己的 spec 只登记了与姊妹件（输出形状）的串行、不知道本对存在** ⇒ 碰撞面由本对登记）—— **本对与它共用一批文件 ⇒ 必须串行**：

  | 共享面 | 它会动 | 本对会动 |
  | --- | --- | --- |
  | `app_config.py` / `rag_config_file.py` | 顶层 `asr_base_url` / `asr_api_key` ＋ `asr_provider` 枚举扩值 | 三个新字段（含 video 块 `ocr_lang`） |
  | `routers/rag_config.py` 的 GET ＋ `_ADDED_FIELDS` | 顶层 `asr_providers` 能力块（顶层白名单扩） | 三个**嵌套**键（走 `_registered_additions`） |
  | `response_golden.json` | 键集与 `sources` 变 | 键集与 `sources` 变 |
  | `test_rag_config_api.py` | **在飞（+99）** | 本对也要动它（形状守卫） |
  | 视频区 JSX ＋ i18n 三文件 | ASR 行 2→4 行（提供商/Model ID/API Key/接口地址） | 同段加 `ocrLang` 行 ＋ 改 `parseBaseUrl`／`parseBaseUrlHint` |
  | `functional-models-view.dom.test.tsx` | 行数 2→4 的 DOM 用例 | 改 `:372-381`／`:383-391` |
  | `backend/AGENTS.md`（＋它的 `frontend/AGENTS.md`） | 视频段一句（服务档：四行／三组四值／探针／降级契约）；`frontend/AGENTS.md` 的 functional-models 段 | 本对动 `backend/AGENTS.md` 的 **RAG 段**（同文件不同段）；`frontend/AGENTS.md` 本对**不动** |

  **⇒ 本对的写码任务（Task 1–3）排在其后**；开工前先核它是否已落地，落地后**重数 golden 键集、重扫断言**（只这两步，不重跑整个 Task 0）。`config_version` 编号随落地顺序（见 D5）。
- **边界：`ocr_lang` 留在 `video` 块**（它那边定的规则要点名）：ASR 服务档裁定「**连接信息（地址／钥匙）放该腿顶层、`video` 块只留模型选择**」—— `ocr_lang` 是**行为/字库参数**（与 `asr_model`／`asr_provider` 同类），**不是连接信息** ⇒ 不搬顶层。
- **对 1**（`2026-09-26`，已交付）：同文件 `app_config.py`／`rag_config_file.py`／前端三件套／golden（② 已裁乙）⇒ 加法，无语义冲突。

## 6. 裁定记录与已知代价

### 6.1 裁定记录（①② 均已裁＝乙，两项都不再重开）

| # | 在问什么 | 选项 | 裁定／推荐 | 后果 |
| --- | --- | --- | --- | --- |
| **①** ✅ **已裁（2026-09-29，乙）** | 服务地址：新开字段还是复用 `parse_base_url` | ~~甲 新开 `parse_cloud_base_url`；乙 复用既有字段~~ | **已裁乙** —— 判据是仓内的同类参数规则：**一类参数一个字段、跨 provider 共用**（`embedding_base_url` 服务 3 个 provider、`asr_model` 服务 2 个）；我此前"形状不同就该各开字段"的说法不成立，已撤回。界面标题改「服务地址」；云腿留空＝官方默认，本地腿必填 | 代价＝**一条已登记的行为变化**（§6.2 首条）：云腿下该字段从"被忽略"变"生效"；类型与默认值不动 |
| **②** ✅ **已裁（2026-09-29，乙：进设置界面）** | 界面暴露 | ~~甲 只做配置层；乙 连界面~~ | **已裁乙** —— 既有同类旋钮都在界面里；"进文件层不进前端"正是 B-1（保存即丢）缺陷的形状；且 ① 的落点（改标题「服务地址」）本身就是界面动作 ⇒ 两项互证 | 代价＝一片前端面（plan Task 2）；若不做界面，三个新旋钮只能手改 `config.yaml`（与邻居不一致） |

### 6.2 已知代价与登记不改

- **`parse_base_url` 的语义扩大 ＝ 本对唯一的行为变化（① 裁乙，与"字段是否声明"无关、必须登记）**：今天云腿**忽略**该字段（`MINERU_BASE_URL` 写死）；改后云腿**读它**。**具体场景**：任何人先选本地、填了地址（文件里存下 `parse_base_url`）、之后切回云 —— 文件里的值不会消失（前端按字段把覆盖带过去）⇒ 云请求会打到那台本地地址、入库当场失败。**这是"响的变化"**（失败可见、清掉字段即恢复），不是静默改结果方向；但它确实把 A-6 从"纯加法"降级为"带一次行为变化"——盘点档 A-6 行与交付回写要如实更正（对 1 里 A-7 那句"⚠ 不再能称纯加法"是同一处理）。**逃生口**：清空该字段 ⇒ 回官方默认。
- **A-3 的"屏幕文字可用"不在本对**：PaddleOCR 未装 ⇒ OCR 腿仍恒空（每帧一条 warning、`path_status` 无 ocr 腿）；**装引擎 ＋ 校准 `_lines_from_paddle` 返回形状 ＋ 盘点档记的"引擎只建一次"欠账**（该措辞与现码对不上：`worker.py:664-673` 已是每帧新建实例，实施前按真实意图重读）都是"装之前"的前置工作；本对只保证"**装上后语种可配**"。
- **`ocr_lang` 写错是静默的**：非法值会在 `PaddleOCR` 构造时抛错、被 `recognize` 的宽捕获降级为空串（与今天同形状）——这是"自由字符串不做枚举校验"的直接代价，登记不改。
- **纯空白值对三个新字段是硬报错、不是"未声明"（2026-09-29 审查核实）**：`MODEL_REFERENCE_FIELDS` 的空白归一**只管模型引用字段** ⇒ `parse_language`／`parse_model_version`（Literal）与 `ocr_lang`（str）收到 `"   "` 会撞 pydantic 校验（与 `parse_tier` 今天的形状一致）。本对**不**为它们加归一（不新增机制）。
- **Literal 的远端同步**：MinerU 若新增语种值或档位，需要一行代码（与 `parse_tier` 同等代价）。
- **真栈验收的边界**：云腿三项可用"文本文件入库 + 网关日志"具名验收；`ocr_lang` 在引擎装上之前**无法端到端验收**（只验配置被读到），如实登记、不冒充。

后续不再重开本对的四项改法；实施中若确遇新事实，按本文件的更正惯例**追加**一条（不改写已裁的行）。
