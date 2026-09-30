# 对外发布前的写死项盘点：好的写死 vs 坏的写死（2026-09）

**盘点日期**：2026-09-23 起，第三轮（角色落点枚举）2026-09-24（本机只读代码 + git 归属核对；未做端点实测，凡引用实测结论处均标出原始探针日期）。行号为工作树快照（分支 `feat/rag-knowledge-base`；初盘 HEAD `448fa421`，**第四轮 2026-09-26 按 HEAD `860dbf25` 复核了 B-1 / B-3 / A-1 / A-5 / G-9 引用的行号**，其余条目未逐个复核；**第五轮 2026-09-28 按 HEAD `47c35ca0` 更正门 A 的状态（那一对已交付）与字段真名（`default_model`，原写 `default_model_name`），并解除原先挂在门 A 上的四条与 `B-1` 选乙**）。

**缘起**：问题是「现在的模型配置中还有直接写死的吗，就是功能上、默认的、改不了换不了的，比如某些名称为厂商变量」→「哪些是**人为**固定写死的（为了一时堵住缺口的），**另外一个人下载使用这个项目会受影响**的」→ 最后要求**把写死分成两种**：好的写死是设计约束，是可变可换的、不触及默认功能行为的（包括用户自己手写一个模型名——它虽然"写死"在配置里，但它是功能的一部分、供功能调用运转）；坏的写死是不规范的、静默的、用户触碰不到控制不了的，**尤其是直接决定功能结果方向的、相当于默认替用户做了选择的**。

**本档就是按那条轴重排的**（前一版按"克隆者受影响程度"分 🔴/🟡/🟢，编号映射见 §5）。

**第三轮追问**：「不选择指定的默认模型的情况下，各个模型的默认情况都是怎么样的，有没有哪些是直接写死的，这就和走库默认一样是不一致的错误」。⇒ 本轮把**全部 20 个用模型的角色**逐个核到落点（附录 §6），据此补了 5 条：`A-7`～`A-10` 与基线条目 `G-9`。同时暴露了前一版的**方法缺陷**：那份清单是**按字面量 grep** 出来的，所以只能扫出"写死了值"的，扫不出"**没有字段可填**"的（wiki 生成、题目合成、追问建议三条就是这样漏的）。§1.2 已把判据与枚举方法一并修正。

**补正轮**：随后发现本档 **B-2** 与 2026-09-23 那一对的 **plan Task 9** 对同一批文档行给了**不同处置**（本档说"改名"、Task 9 说"删行"）⇒ 已裁定**以 Task 9 为准并同步本档**，同时更正本档一句过期断言（"那一对不动 `SECRET_ENV_VARS`"）。逐条见 §5 的「补正轮」表。**教训与 C-3 同一条**：两份文档对同一处给不同处置，就是本档自己判为"坏"的双真值源。

**第四轮（复核轮，2026-09-26）**：问题是「上游分支新增了模型配置，这个默认写死是不是也要改；范围能不能收成『对话模型交上游、RAG 功能模型自己管』」。⇒ 核了 `99c926b7..upstream/main`（614 个提交）与 2026-09-23 那一对**收窄后的新版 spec/plan**，结果：**改判 1 条**（`B-3` 其实早在 2026-09-16 就闭合了，是我当时没核界面）、**更正 2 条**（`B-1` 的字段前端零暴露、`G-9` 的归属）、**查出 1 个新缺陷**（`embedding_dimension` 会被任何一次无关保存删掉），并发现本档此前把**两个不同的门**混为一谈 ⇒ 新增 §4.1（门 A／门 B）与 §4.2（spec/plan 分组）。逐条见 §5 的「第四轮」表。

**闭合登记（2026-09-27）**：**`A-9` 已闭合**——由 [2026-09-23 默认模型那一对](superpowers/specs/2026-09-23-default-model-design.md) 的 Task 7 落地（提交 `3bf049cf`：删 `knowledge/eval/factory.py` 的 `dashscope:` 直连分支、端点常量与 `JudgeKeyMissingError`；CLI 的错名从 `skipped` ＋ 退 3 改为 stderr 一句 ＋ 一行 `status="error"` ＋ 退 2，judge 与答题一样按 `models:` 条目名取值）。坏写死**现存 14 条**（16 − 已闭合 2），**本仓自己待修仍为 13 条**（`A-9` 原就排除在"本仓待修"之外）；§3 与 §4 的计数句同批改准，逐条与表格属各轮历史快照、不动。

**第五轮（2026-09-28，门 A 状态复核）**：核对 HEAD `47c35ca0` 时发现**门 A 早已交付**——那一对的 plan **82/82 全勾**，提交落在 2026-09-26 21:14 → 09-27 20:35（`bfed5529` → `305f4fa2`），而本档第四轮把它记成"有排期（状态「暂不开工」）"、并据此建议「对 1」先落地，两处都过期。⇒ **更正 1 条状态**（门 A 从"待开"移入 §4.1「已开的门」）、**解除 5 项门禁**（`B-2` 剩余三处、`C-1`、`C-2`、`A-1` 的余下三行、`B-1` 选乙）、**更正 4 处字段名**（`rag.default_model_name` → `rag.default_model`：G-9、§4.1 门 B 表的"形状判断"与"授权不对称"两行、§6 附录末段）、**更正 1 处计数**（§4.1 那句"本仓自己待修 14 条"应为 13）。同批更正「对 1」两份在飞文档里同源的三处过期事实（门 A 已交付、字段名、golden 键数），并把"这两个角色要不要一并接 `rag.default_model`"补为它 §6.1 的第 ④ 项待裁；**已交付的门 A 那两份不回改**（按本档自己的惯例：已发过的文档冻结留档）。逐条见 §5 的「第五轮」表。

**闭合登记（2026-09-29）**：**`A-7`／`A-8` 已闭合**——由 [2026-09-26 那一对](superpowers/specs/2026-09-26-rag-wiki-synthesis-model-design.md)（§4.2「对 1」）交付：`rag.wiki_model`／`rag.synthesis_model` 两层字段（并进共享空白归一 `MODEL_REFERENCE_FIELDS`）＋ 三个调用点（wiki 手动／wiki worker 自动／考题合成）接上 `require_usable_rag_target` ⇒ 兜底链 `角色字段 → rag.default_model → models[0]`；worker 那条腿同时惰性化（改设置不用重启）、`app.py` 的 boot 建模型退场；保存期检查扩到六个字段。实施提交 `7d517757`（后端）／`7ba229eb`（前端）／`9ffae7c3`（模板与模块指南），真栈六条腿已过（Task 4／5 的真栈验收与交付回写另成一笔文档提交）。坏写死**现存 12 条**（16 − 已闭合 4：`B-3`／`A-9`／`A-7`／`A-8`），**本仓自己待修 11 条**（再减属上游的 `A-10`）；§3／§4／§4.1 与「一句话结论」的计数句同批改准，逐条与表格属各轮历史快照、不动。

**闭合登记（2026-09-30）**：**`A-3` 已被取代（不交付）**——用户同日裁定：屏幕文字腿改走 **`rag.vlm_model`**（与 caption 同一条链）⇒ `video/ocr.py` 重写为 `screen_text_shots`、`PaddleOcrEngine`／`_lines_from_paddle`／`OcrEngine` 协议整块删除，`ocr_lang` 提案一并作废（细节见 [spec 2026-09-29](superpowers/specs/2026-09-29-rag-parse-knobs-design.md) 的「A-3 的撤销与替换」节）。⇒ 「对 2」同日缩为 `A-2` + `A-6` + `A-5`（三项改法；② 变为两个新控件）。坏写死**现存 11 条**（16 − 已闭合/取代 5：`B-3`／`A-9`／`A-7`／`A-8`／`A-3`），**本仓自己待修 10 条**（再减属上游的 `A-10`）；§3／§4 与「一句话结论」的计数句同批改准，逐条与表格属各轮历史快照、不动。

**交付登记（2026-09-30）**：**「对 2」（`A-2` + `A-5` + `A-6`）已交付**——[spec](superpowers/specs/2026-09-29-rag-parse-knobs-design.md) + [plan](superpowers/plans/2026-09-29-rag-parse-knobs.md)，plan **33／33**；实施 `5bea5cfe`（T1 后端）／`80fe8c01`（T2 前端）／`d231e430`（T3 模板与文档）／`5dc512f1`（T4 真栈），Task 5 回写为同批文档提交；真栈三腿两向已过（抓包服务具名）、`config.yaml`／`rag_config.json` 逐字节还原。**本对唯一的行为变化**＝云腿下 `parse_base_url` 从「被忽略」变「生效」（spec §6.2 首条）。**同日：「对 3」（`A-4` + `C-3`）已交付**——[spec](superpowers/specs/2026-09-30-rag-caption-params-asr-default-design.md) + [plan](superpowers/plans/2026-09-30-rag-caption-params-asr-default.md)，plan **23／23**（Task 2 的 6 框为②甲留档）；实施 `46cfaf23`（Task 0）／`7aa70c59`（T1 后端）／`e07802c6`（T3 模板与文档）／`b29ef532`（T4 真栈）；真栈三次抓包两向已过（2048/0.15 → 1024/0.7 → 1024/0.15）、三份配置逐字节还原。⇒ 坏写死**现存 6 条**（16 − 已闭合/取代 5 − 已交付 5），**本仓自己待修 5 条**（再减属上游的 `A-10`）；§3／§4 与「一句话结论」的计数句同批改准，逐条与表格属各轮历史快照、不动。

**第六轮（2026-09-30，账本重核）**：触发＝用户拿一手事实推翻本档两行的转述（「现在项目中不是有维度这一设置行吗」）。逐点对 HEAD 复现（界面行可编辑／`NUMERIC_FIELDS` 已修保存即丢／迁移工程已交付）⇒ **更正 2 条**（`B-1`：三处断言过时、甲/乙岔口作废、收敛为两处描述修正；`G-1`：迁移工程已完成、不再是待办），**对 3 / 对 4 的搭车措辞同步**（`B-1` 甲/乙 → `B-1` 描述修正）。计数不变（`B-1` 留在坏-B、仍是一条待修）。逐条见 §5 的「第六轮」表。**教训**：本档的登记行是快照——引用前先对代码核现状（与 §1.3 的归属核对同一条纪律）。

**⚠ 本轮未处理的同源过期处**（登记备查，等指令）：**§6 附录 §6.1 的角色表**里至少两行随门 A 交付而过期——「图谱抽取」行写「未设 `models[0]`」（现为 `extract_model → rag.default_model → models[0]`）、「评测 judge」行写「另有 `dashscope:` 支路绕过 config 白名单」（该支路已删）。它们属§6 的第三轮快照，本轮只做 §4/§4.1/§4.2 与字段名的更正，未动。**2026-09-29 追加**：「wiki 生成」「题目合成」两行随「对 1」交付同批过期（前者现为 `wiki_model → rag.default_model → models[0]` 且启动期建模型已删，后者为 `synthesis_model → rag.default_model → models[0]`），同样留作快照、等指令。

**范围**：本仓 fork 新增/改动的 RAG 与配置层代码，加上会被别人直接拿走的载体（`config.example.yaml` / `rag_config.example.json` / `.env.example` / `README.md` 的相关段落）；**第三轮起扩到"所有用模型的角色"**（含标题 / 摘要 / 记忆 / 目标评估 / 输入润色 / 追问建议 / 技能审核这些非 RAG 角色），因为它们与 RAG 角色共用同一个"没指定时用谁"的问题——逐角色落点见附录 §6。**不含**上游自有文件里上游自己写的默认值与端点常量（归属核对方法见 §1.3；唯一例外是 `G-9` 那条位置默认，它是上游机制但为本档提供对照基线，故只登记不建议改）。

**与 [2026-09-23 默认模型那一对](superpowers/specs/2026-09-23-default-model-design.md) 的关系**：**本档不在其范围内，也未排期**——那份 spec 管「没指定功能模型时落到哪」，本档管「哪些东西用户根本指定不了」。两者有一处交叠（`vlm_base_url` / `vlm_api_key` 的退役），在相关条目里标注，避免双计。

**一句话结论**：**9 条好的写死（别动）· 16 条坏的写死**（坏-B 假旋钮 3 · 坏-A 替用户决定+够不着 10 · 坏-C 不规范 3）；其中 **`B-3` 已于 2026-09-16 被 `8eed49b8` 闭合**、**`A-9` 已于 2026-09-27 被 `3bf049cf` 闭合**、**`A-7`／`A-8` 已于 2026-09-29 被「对 1」交付**、**`A-3` 已于 2026-09-30 被 VLM 路线取代**（写死项随 PaddleOCR 引擎整块退场、不交付；见其行取代注）、**`A-2`／`A-5`／`A-6` 已于 2026-09-30 被「对 2」交付**、**`A-4`／`C-3` 已于 2026-09-30 被「对 3」交付**（现存 6 条）、`A-10` 是上游的 ⇒ **本仓自己待修的实为 5 条**。核心不一致是：**20 个用模型的角色里，13 个退到"位置默认 `models[0]`／跟随本轮／干脆不用模型"（由用户自己的配置决定），4 个退到字面量厂商型号（由别人的选择决定）**，另有 1 个继承那 4 个之一、1 个是档位参数、1 个无字面量（逐条见附录 §6）。坏的里面最危险的不是"够不着"那类，而是 **坏-B「假旋钮 / 文档与代码不符」那 3 条**——用户以为自己控制住了，其实没有。**顺序、门槛与分组见 §4 / §4.1 / §4.2**（第四轮重排：`B-3` 闭合、`A-7 + A-8` 升到第一、`B-1` 因改法岔口可能落到门 A；**第五轮解除门禁：门 A 已交付（2026-09-27），原先挂它的四条与 `B-1` 选乙现在都无门，唯一还开着的是门 B**）。**2026-09-29：`A-7` + `A-8` 已由「对 1」交付闭合（§4.2），坏写死现存 12 条、本仓待修 11 条。** **2026-09-30：`A-3` 被 VLM 路线取代（`video/ocr.py` 的 `lang="ch"` 随 PaddleOCR 整块退场、不交付，见其行取代注）⇒ 坏写死现存 11 条、本仓待修 10 条；「对 2」同日缩为 `A-2` + `A-6` + `A-5`。** **2026-09-30 同日：「对 2」（`A-2` + `A-6` + `A-5`）已交付**（[spec](superpowers/specs/2026-09-29-rag-parse-knobs-design.md) + [plan](superpowers/plans/2026-09-29-rag-parse-knobs.md)；plan 33／33、真栈三腿已过；实施 `5bea5cfe`／`80fe8c01`／`d231e430`／`5dc512f1`）⇒ 坏写死**现存 8 条**、**本仓待修 7 条**。 **2026-09-30 同日：「对 3」（`A-4` + `C-3`）已交付**（[spec](superpowers/specs/2026-09-30-rag-caption-params-asr-default-design.md) + [plan](superpowers/plans/2026-09-30-rag-caption-params-asr-default.md)；plan 23／23、真栈三次抓包两向已过；实施 `7aa70c59`／`e07802c6`／`b29ef532`）⇒ 坏写死**现存 6 条**、**本仓待修 5 条**。 **B-2 按载体删行 / 删项、不改名**：三处说明与 `test_parser.py` 四处归 Task 9，余下三处说明与一处 live 门禁紧跟其后处理。退役的是 RAG 专属回退，模型条目仍可显式引用自选环境变量，详见 B-2。

---

## 1. 判据

### 1.1 好的写死（三条都满足）

1. **可变可换**：用户填的值，或有配置旋钮能换（常量只在旋钮为空时兜底）；
2. **不替用户决定功能结果的方向**：它不选厂商、不选型号、不选语种、不选服务器、不截断输出；
3. **猜错/缺省的代价是效率或降级，不是错误结果**：最坏是多几次往返、少一个可选增强，功能仍然正确。

还有一类天然属于好的：**程序内部的协议常量与结构约定**（协议版本号、集合名、掩码哨兵）——用户本来就不该填，填了反而是风险。

### 1.2 坏的写死（命中一条即坏）

| 子类 | 判据 | 为什么这一类最该先修 |
| --- | --- | --- |
| **坏-B 假旋钮 / 文档与代码不符** | 看起来能改（有字段、有文档、有输入框），实际改了没用或被拒 | **用户以为自己控制住了**，所以不会去查、也不会报错给他看。危害大于"够不着"——够不着至少是明确的 |
| **坏-A 替用户做决定 + 够不着** | 无配置通路，且这个值**决定功能结果的方向**（用哪个模型/哪台服务器/哪种语言/多长输出） | 用户没有表达意见的位置，结果却是按别人的选择产生的 |
| **坏-C 不规范** | 不决定结果方向，但违反仓内既有做法（双真值源、绕过 i18n、示例装个人值） | 不紧急，但每次改都要改两处，且新人会照着抄 |

**注意区分**：「用户自己在 `config.yaml` / UI 里手写了一个模型名」——那也是字面量，但按 §1.1 第 1 条它是**功能的输入**，不是写死。本档只盘"用户没有表达位置"的那些。

**「够不着」有两种形态，判据都算**（第三轮补，前一版只认第一种）：

1. **值写死**：代码里有字面量，且没有字段能覆盖它（A-1～A-6）；
2. **字段不存在**：代码里没有字面量——它老老实实退到某个通用默认（如 `models[0]`）——但**没有任何配置字段能指定这个角色该用谁**（A-7 wiki 生成、A-8 题目合成、A-10 追问建议）。第二种更隐蔽，因为它"看起来没写死"。

**枚举方法（本档的自查规则）**：按字面量 grep 只能扫出第 1 种。**第 2 种必须按角色枚举**——列出所有"会用模型/会发出网请求"的角色，逐个问"这个角色有没有字段"。§6 附录就是那次枚举的结果（20 个角色）；漏掉这一步，前一版就把 wiki 生成与题目合成判成了"没问题"。

### 1.3 归属怎么核（可复现，每条都判过）

本仓与上游的分叉点是 `99c926b7`（与 `upstream/main` 的 merge-base）。

```bash
# ① 整个文件是不是本仓新增的（不存在 ⇒ fork-new，里面所有写死都归本仓）
git cat-file -e 99c926b7:backend/packages/harness/deerflow/knowledge/parser.py   # → 不存在

# ② 文件上游就有、但某一段是不是本仓加的（命中数 0 ⇒ 这段是 fork 加的）
git show 99c926b7:config.example.yaml | grep -c '^rag:'                          # → 0
git show 99c926b7:.env.example | grep -n 'DASHSCOPE\|SILICONFLOW\|MINERU'        # → 空
git show 99c926b7:backend/packages/harness/deerflow/config/app_config.py \
  | grep -n 'class RagConfig\|qwen3.7-text-embedding\|paraformer-zh'             # → 空

# ③ 具体某一行的作者（认「这行是上游的还是我的」）
git log -1 --format='%h %an %ad %s' -L 29,29:backend/packages/harness/deerflow/models/openai_codex_provider.py
```

按 ① 核过：`knowledge/` 整棵目录（含 `embedder.py` / `embedder_ark.py` / `embedder_factory.py` / `parser.py` / `reranker.py` / `caption_client.py` / `video/ocr.py` / `video/asr.py` / `eval/factory.py` / `vector_store.py`）、`config/rag_config_file.py`、`app/gateway/routers/rag_config.py`、`rag_config.example.json` **全部 fork-new**。按 ② 核过：`.env.example` / `README.md` / `config.example.yaml` / `config/app_config.py` **文件是上游的、RAG 段落全是本仓加的** ⇒ 里面的写死一样归本仓，只是改动时要知道自己在动一个上游同形文件（rebase 冲突面）。

---

## 2. 好的写死（9 条，别动）

| # | 位置与字面值 | 为什么是好的 | 如果非要改，代价是什么 |
| --- | --- | --- | --- |
| **G-1** | 向量集合固定 1024 维：`knowledge/embedder_factory.py:36` `COLLECTION_DIMENSION = 1024`；`knowledge/vector_store.py:122` `dense_size: int = 1024`（`:130` 存下、`:179` 建集合） | **这是设计约束，不是偷懒**：四个集合（`kb_chunks`/`kb_entities`/`kb_wiki_entries`/`kb_manual_cards`）共享一个向量空间，向量空间投影那一栏也依赖它。而且它**拒绝得很响**，不静默：实测宽度不符 → `embedder_factory.py:77` 抛 `RagConfigurationError`，保存期 → `routers/rag_config.py:371-372` 回 400；`backend/AGENTS.md` 里明写 “that is a **hard gate**, not a default”。按 §1.1 第 3 条，代价是"这个模型不能用"而不是"结果是错的"。 | 不是清理，是**迁移工程**：Qdrant 已建集合的向量宽度改不了 ⇒ 要"可配宽度 + 新集合 + 重建索引 + 启动期一致性检查"一整套。**本机同样要重建。**所以本档不把它列进"该改"，只把它的**假旋钮那一面**列进坏-B（见 B-1）。<br>**⚠ 2026-09-30 更正（第六轮）：这段"迁移工程"已经做完了** —— 宽度已是**部署设置**（`rag.embedding_dimension` 空＝1024，`embedder_factory.py:47` 的 `effective_dimension()` 一处解析；集合按在役宽度命名），2026-09-26 那一对交付了整套迁移（新 generation ＋ 全库重建 ＋ 切换 ＋ `GET /api/rag/config/migration`）。本行引的 `AGENTS.md` "that is a **hard gate**, not a default" 一句已被那一对改写为「a hard gate is “the model must return the width in force”」；`COLLECTION_DIMENSION` 也已改名 `DEFAULT_COLLECTION_DIMENSION`（`:38`）。⇒ **本行从"别动 ＋ 将来单独立项"变为已落地**：G-1 不再是待办，现状以 `AGENTS.md:884` 的「**The width is a deployment setting**」为准。 |
| **G-2** | `knowledge/caption_client.py:24` `ANTHROPIC_VERSION = "2023-06-01"` | 协议常量。`:22-23` 的注释自述：这是 Anthropic SDK 自己的默认值（引 `anthropic/_client.py:180`），且 “bumping it is a code change, not a config knob”。属 §1.1 末尾那类"用户不该填"的。 | 改成可配是**反向**的：把一个协议常量变成运维能填错的东西。 |
| **G-3** | 端点缺省值三份：`embedder.py:38`（DashScope）、`embedder_ark.py:41`（火山方舟）、`reranker.py:31`（DashScope rerank） | **都有旋钮兜着**，常量只在旋钮为空时生效：`config/app_config.py:208` `embedding_base_url`、`:212` `sparse_base_url`、`:216` `rerank_base_url`（描述均为 “None uses the provider's own default”）。这正是 §1.1 第 1 条的"可变可换"。 | 不需要改，**而且删/改会当场红三条**——这三条正是它们该留的证据：`tests/knowledge/test_embedder_ark.py:220`（`spec.default_endpoint == ARK_BASE_URL`）、`:236-240` `test_the_dashscope_default_endpoint_has_not_drifted`（`resolve_provider("embedding","dashscope").default_endpoint == DASHSCOPE_BASE_URL`）、`tests/test_rag_config_api.py:499-508` `test_the_rerank_default_endpoint_is_the_clients_own_constant`（`== DASHSCOPE_RERANK_BASE_URL`）。三条钉的都是同一件事：**allowlist 里那份 `default_endpoint` 字面量 == 客户端自己的常量**（`knowledge/providers/__init__.py` 故意**不** import 客户端常量以保持 import-light，改用测试保相等）。⇒ 改常量必须同批改 allowlist 那份，否则红。**对照**：MinerU 云分支缺的就是这一格（见 A-6/B-3）。 |
| **G-4** | 每模型批次上限：`embedder.py:47` `DASHSCOPE_SAFE_BATCH_SIZE = 10`、`:51-54` `DASHSCOPE_BATCH_SIZES = {"qwen3.7-text-embedding": 20}` | 保守缺省 + **注释自证代价方向**（`:41-46`）：未知模型走安全值，最坏是"多一次往返"，**不影响正确性、也不影响检索延迟**（查询恒为单行）。表只**升**不降，每行都是实测过的（2026-09-17 探针：20 行打 `text-embedding-v3`/`v4` 得 HTTP 400 `batch size is invalid`）。⇒ 不决定功能结果方向，符合 §1.1 第 3 条。 | 不破坏。**但有一条未来编辑风险要写在旁边**：把上限调大而模型其实吃不下 ⇒ **静默丢数据**（≥11 片的文档少一半），这正是 `c5bfbd4b`（2026-09-17）修的缺陷。所以若要开成 `rag.embedding_batch_size` 旋钮，必须同时保留按 provider/模型的上限校验，不能只加一个自由填的数字。 |
| **G-5** | provider allowlist 的 `Literal`：`app_config.py:207`（embedding 三家）/ `:211`（sparse 一家）/ `:215`（rerank 两家）/ `:217`（parse 两家）；`models_config.py:47-51`（UI 三家） | 策展式约束，**代价是公开写在 spec 里的**（接一家新厂商 = 四处代码：allowlist + 两处 `Literal` + 适配器 + 前端 OPTIONS），不是静默替用户决定；而且它是安全边界的一部分（`use:` 是动态导入路径，allowlist 挡住自由类路径）。 | 扩 `Literal` 不破坏，但要同时补该 provider 的实现类与前端选项。 |
| **G-6** | 内部结构约定：`app_config.py:188` `qdrant_url` 缺省 `http://localhost:6333`（有旋钮，且与 docker-compose 的服务对齐）、集合名、`rag_config_file.py:39` `MASKED_SECRET = MASKED_API_KEY`（与模型钥匙同一个哨兵值，注释自述"so the UI can share one constant"） | 缺省值 + 旋钮 / 纯内部约定，不决定功能方向。 | 不需要改。 |
| **G-7** | `models/openai_codex_provider.py:29` `CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"`（`:254` 使用） | **上游写的，本仓没碰过**：`git log -L 29,29:…` → `835ba041`（Purricane，2026-03-22，上游 PR #1166「add Claude Code OAuth and Codex CLI as LLM providers」），且 merge-base `99c926b7` 里同一行已在原位。它是产品固定端点（ChatGPT 后端），属 §1.1 末尾那类。 | 改动只会扩大与上游的 diff 面。**注意**：本仓文档曾把它误记为「本仓自己持有端点常量的唯一先例」，已于 2026-09-23 在 [spec §6.12](superpowers/specs/2026-09-23-default-model-design.md) 更正——「唯一」只在 `deerflow/models/` 这一层成立（反例即 G-3 与 A-6）。 |
| **G-8** | 用户在 `config.yaml` / `rag_config.json` / 设置界面里**自己填的**模型名、地址、钥匙 | 按 §1.1 第 1 条这就是"可变可换"，按 §1.2 的注意区分它**不是写死**——它是功能的输入，供功能调用运转。列在这里只为把边界划清：本档所有条目都是"用户没有表达位置"的那些。 | 不适用。 |
| **G-9** | **位置默认 `models[0]`**：`models/factory.py:298-299` `if name is None: name = config.models[0].name`（docstring `:273`：“If None, the first model in the config will be used”）。`models[0]` 是谁由 `models_config.py:191-212` 的 `merge_ui_models` 决定：config.yaml 的条目**原位保留**，UI 条目同名则原位替换、否则**追加到末尾** ⇒ 只要 config.yaml 有模型，`models[0]` 恒为**它的第一条**。 | **登记为基线，不建议在本档里改**：① 它是**上游机制**（`git log -L 298,299:…factory.py` → `83bd7e43`，Henry Li，2026-01-14，当时路径还是 `backend/src/models/factory.py`）；② 它退到的是**用户自己配置的第一条**，不是别人的厂商型号 ⇒ 满足 §1.1 第 2 条。它是 §6 附录里那 13 个角色的共同落点，所以必须先讲清它是什么，A-7/A-8/A-10 才读得懂。 | **它有真实缺点，但不由本档处理，也不由 [2026-09-23 那一对](superpowers/specs/2026-09-23-default-model-design.md) 处理**："第一条"是**位置语义**而不是"用户指定的默认"⇒ 在界面里新加的模型永远排在末尾、**当不上默认**；且重排或删除 config.yaml 的 `models:` 会**静默改变十来个角色的落点**。那一对（**2026-09-26 已收窄为 RAG 范围**）**明确不碰公共工厂**：spec `:21` 把「全站默认字段、公共工厂默认行为」列进本期不做，`:204` 写「字段加载不改变公共模型工厂的 `name=None` 行为」，`:244` 把 `models/factory.py` 明列为不改的生产文件 ⇒ **G-9 不由它替换**；它只在四个 RAG 角色（图谱抽取／评测裁判／图片配文／视频配文）上面加一层 `rag.default_model`（spec D3 `:57-60`；**2026-09-27 已交付**），`models[0]` 仍是这四条的**最后一层兜底**。**位置默认本身的替换归上游**：上游至今没有默认模型字段（`upstream/main` 的 `models/factory.py:393-394` 仍是 `name is None → config.models[0].name`），详见 §4.1 的门 B。**它也不能删**：删掉会让「没设默认模型」的部署失去落点。**⚠ 别顺手改工厂的解析顺序**：这条隐式约定在我方散落于 **10 处**非文档代码（`models/factory.py:299`、`lead_agent/agent.py:133`、`summarization_middleware.py:162`/`:716`、`tool_error_handling_middleware.py:361`、`client.py:301`、`context_compaction.py:88`、`subagents/config.py:48`、`tools/tools.py:114`、`context_usage.py:47`），上游是 **11 处**——多的那处是 `app/gateway/authz.py:387` 的 `authorize_model_use`，它把 `model_name is None → app_config.models[0].name` **在授权路径上又写了一遍**。只改工厂不改它，就会变成「授权查 A 模型、实际跑 B 模型」。 |

---

## 3. 坏的写死（16 条，其中 `B-3`、`A-9`、`A-7`、`A-8`、`A-3` 已闭合，`A-2`／`A-5`／`A-6` 已交付、`A-10` 判为上游所有 ⇒ 现存待修 **7** 条）

### 3.1 坏-B：假旋钮 / 文档与代码不符（3 条，最危险；其中 `B-3` 已闭合 ⇒ 现存 2 条）

> 共同特征：**用户以为自己控制住了**。所以这一类不会以"报错"的形式暴露，只会以"我明明设了怎么没用"的形式暴露。

#### B-1 `embedding_dimension` 写着 "override"，但唯一合法值是 1024

| | |
| --- | --- |
| **表现** | `config/rag_config_file.py:100` 的描述是 “Dense dimension **override**; None probes the provider at enable time.” —— **这份是 PUT 走的那个模型**（`routers/rag_config.py:384` 的 `body: RagConfigFile`）。而 `config/app_config.py:209` 的同一个字段描述里明写 “**Must be 1024** — the Qdrant collections are created at that size”。⇒ 字段名和描述都说它能覆盖，但唯一合法值是 1024：声明别的宽度会被 `embedder_factory.py:138-139` 拒（`RagConfigurationError`）。 |
| **它不是完全没用** | 公平地说，声明 1024 有一个真实作用：跳过运行期宽度探测（`embedder_factory.py:183`；`backend/AGENTS.md` 的解释是"某些自托管服务上探测不可靠，声明是权威的"）。所以它不是死字段，而是**只有一个合法值的"覆盖"项** ⇒ 坏在**措辞**，不在字段存在本身。 |
| **⚠ 第四轮更正：这个字段前端零暴露** | 本条前一版写「界面上是一个能填的框」「要同步改前端标签与 i18n 三处」——**错的**。全前端只有 `core/rag/types.ts:39` 一处 wire 类型；它**不在** `core/rag/config-form.ts` 的 `SECRET_FIELDS` / `TEXT_FIELDS` / `SELECT_FIELDS` 任一清单里，没有 i18n key，没有任何组件渲染它。⇒ 它是 **API 可写、但界面够不着**的字段，只能靠手写 `rag_config.json` 或 `config.yaml` 表达。`config.example.yaml:2597` 有它的注释行，`rag_config.example.json` 没有。 |
| **⚠ 第四轮新查出的缺陷：一次无关的保存会把它删掉** | `RagConfigFile` 的 25 个字段里，`embedding_dimension` 是**唯一**不被 `buildRagConfigInput()` 带回的标量字段（`config-form.ts:195-243` 只遍历那三个清单 + `video` 子对象；`video` 是逐键合并的窄模型 `RagVideoFileConfig`，不受影响）。而 PUT 是**整对象替换**（router docstring `:380`「Replace the API-writable rag_config.json」；`backend/AGENTS.md`「an omitted or emptied field is **removed** from the file」）⇒ **从功能模型视图保存任何东西（改重排、改解析都算），都会把 `rag_config.json` 里手写的 `embedding_dimension` 删掉**，退回 `config.yaml` 的值、或退回 `None` ⇒ 启用时重新探测。危害不是"少了一个值"，而是**静默把「声明＝跳过探测」变回「探测」**——而按 `backend/AGENTS.md:1180` 自己的话，探测在某些自建服务上不可靠。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面（⚠ 有岔口，甲／乙待裁）** | **共同点**：改描述**零用例风险**（已核：`backend/tests` 与 `frontend` 搜 “Dense dimension override” / “Must be 1024” 零命中，没有测试钉这两段文字）；**别改 `app_config.py:209`**（它已经是对的）。<br>**甲 —— 只改描述**：把 `rag_config_file.py:100` 补成与 `:209` 一致（"必须 1024；声明它等于跳过探测"）。零代码逻辑、**无门**、可立刻做。**代价**：上面那条「保存即丢」的缺陷**原样留着**，得在本档另立一条登记。<br>**乙 —— 把字段从 `RagConfigFile` 退役**（只留在 `RagConfig`，即只能由 `config.yaml` 声明）：既然界面从来不暴露它、唯一合法值是 1024，它本就不该在 API 可写文件里 ⇒ **一次关掉假旋钮与保存即丢两件事**。机制现成：`_RETIRED_KEYS`（`rag_config_file.py:57`；MinerU 那对为 `parse_backend` 建，2026-09-23 那一对的 Task 8 已把它扩成"名字→原因表"并加了嵌套剥离，Task 9 已删字段且已发布）。**代价（2026-09-28 更新：原写的「撞门 A」已解除）**：原先的顾虑是"那一对的 Task 8/9 也要往 `_RETIRED_KEYS` 加两个 VLM 键、且其 spec D10.4 要求两者背靠背交付 ⇒ 乙不能抢在它前面"——**那一对已交付**，机制现成、无人撞车，乙现在是**一笔独立的改动**，要点两条：① `_RETIRED_KEYS` 加一项（读时剥离 ＋ warning，不回写磁盘）；② 删 `RagConfigFile` 的声明。**这两件事要在同一个批次里完成**（沿用 Task 8/9 那条纪律：先剥离后删声明的中间态不可单独发布，反序则存量文件加载失败）。另：乙是**API 形状变更**（PUT 回送该键将变 422），与甲的一次性描述修正不同量级。<br>**丙（不推荐）**：把它加进表单清单让它能被带回 ⇒ 等于给一个「只能是 1024」的字段做界面，正是本条判为坏的假旋钮的放大版。 |
| **⚠ 2026-09-30 第六轮重核（用户侧聊取证，主会话逐点复核）：三处断言已过时，"假旋钮"帽子基本摘掉** | 对 HEAD 逐点复现：① **界面已有可编辑的维度行**（`functional-models-view.tsx:1113` `data-slot="dimension-row"`：输入框绑 `values.embedding_dimension`、行内档位快选与状态点，仅探测判定 `fixed` 时只读）——第四轮那句"前端零暴露"作废；② **"保存即丢"已修**：`config-form.ts:197` 的 `NUMERIC_FIELDS` 把它带进每次保存的载荷（空输入＝撤销覆盖、wire 写 `null`）——第四轮查出的缺陷已由 2026-09-26 那一对关闭；③ **"唯一合法值 1024"已不成立**：宽度现在可声明、改了触发一次迁移保存（重建集合到新 generation；后端 `test_a_width_change_defers_the_width_and_starts_the_rebuild` 等一整套用例、前端 `changesEmbeddingDimension`＋迁移状态机、`effective_dimension()`＝声明值或 1024）。⇒ **乙（退役该字段）现在会把一个已交付的界面功能拆掉，出局**；**甲的方向也反了**（不是把 `rag_config_file` 改成"必须 1024"，而是 `app_config` 那句陈旧）。**本条真正剩下的**＝两段描述没跟上迁移语义：`app_config.py:207` 的 "Must be 1024 — the Qdrant collections are created at that size"（**这句才是陈旧的**）＋ `rag_config_file.py:141` 的 "Dense dimension override; None probes the provider at enable time."（基本对、没写全：空＝1024、改了＝重建）；`config.example.yaml` 的注释反倒是对的。⇒ 改法收敛为**一处描述修正 ＋ 一处补全**，零代码逻辑、**无岔口**。**本条留在坏-B**（"文档与代码不符"仍是它的形状），**计数不变**（坏-B 现存 2 条含本条）。 |

#### B-2 `SILICONFLOW_VLM_API_KEY`：六处文档叫用户设，零处代码读它

| | |
| --- | --- |
| **载体与测试归属（已同步 Task 9）** | **① 归 2026-09-23 那一对的 Task 9（三处说明 + `test_parser.py` 四处）**：`config.example.yaml:2564` 删除独立的 VLM 注释整行；`config/app_config.py:184`、`backend/AGENTS.md:1186` **只删除名单中的 `SILICONFLOW_VLM_API_KEY` 一项及相应分隔符**，保留同一行的其他变量和有效说明，不改成另一厂商变量名。测试侧 `backend/tests/knowledge/test_parser.py:5` 改模块说明，`:211` / `:237` / `:274` 删除无效 `setenv`，保留用例及有效断言，夹具按 Task 9 的条目目标调整。<br>**② 归本条（三处说明 + 一处 live 门禁）**：`.env.example:44`、`README.md:221`、`UPSTREAM_README.md:152` 与 `backend/tests/knowledge/test_e2e_smoke.py:53`；紧跟 Task 9 处理，不重复改 `test_parser.py`。 |
| **代码实际读的** | 当前 `config/rag_config_file.py:47` 的 `SECRET_ENV_VARS["vlm_api_key"] = "DASHSCOPE_API_KEY"`，与 `app_config.py:196` 的 `vlm_api_key_env` 默认值一致。Task 9 之后**不再走 RAG 专属环境变量回退**；模型条目仍可通过 `api_key: $任意名` 显式引用环境变量。退役的是旧 RAG 来源，不是模型条目的环境变量引用能力（见 spec D10）。 |
| **文档自相矛盾（两处，不是一处）** | ① 同一个 `backend/AGENTS.md`：`:698` 写着"回退到 `deerflow.config.rag_config_file.SECRET_ENV_VARS` 里命名的环境变量（**单一真值源**——客户端 import 它，所以 API 报告的名字与客户端读的名字不可能漂移）"，而 `:1186` 列的四个名字里有一个不在那份真值源里 ⇒ 机制说对了、名单写错了。<br>② `UPSTREAM_README.md` **同一段之内**就矛盾：`:147-149` 已经写着 caption VLM “is picked from your configured models, and **each inherits that model's endpoint and API key**”，紧接着 `:151-152` 又把 `SILICONFLOW_VLM_API_KEY` 列进"API keys 的环境变量回退"名单 ⇒ 删掉名单里那一项正好闭合这段自相矛盾（**是删一项，不是删整行**：那一行是四个变量的枚举，另三个仍生效）。 |
| **证据强度** | 全仓搜 `SILICONFLOW_VLM_API_KEY`，可执行代码里**只有测试命中**：`tests/knowledge/test_parser.py:211`/`:237`/`:274`、`tests/knowledge/test_e2e_smoke.py:53`。其中 `test_parser.py:211` 那条**自己就证明了这个变量无效**——它 `monkeypatch.setenv("SILICONFLOW_VLM_API_KEY", "vlm-key")`，随后 `:219` 断言 `request.headers["Authorization"] == "Bearer test-dash-key"`（钥匙来自 DashScope 夹具）。`test_e2e_smoke.py:53` 把它列进 live 门禁的 `REQUIRED_KEYS` ⇒ **不设这个没人读的变量，整组 live e2e 直接 skip**。 |
| **归属** | `.env.example` / `README.md` / `config.example.yaml` / `app_config.py` / `backend/AGENTS.md` 文件都在，但**这几行是本仓加的**（§1.3 ②：上游 `.env.example` 里 `DASHSCOPE`/`SILICONFLOW`/`MINERU` 零命中）。`UPSTREAM_README.md` 是**已跟踪的**用户面 README（标题 “🦌 DeerFlow - 2.0”），`:145-155` 那段 RAG 文案也是本仓的。 |
| **克隆者的遭遇** | 照 `README.md:221` 导出它 ⇒ 图片说明（caption）那条腿拿不到钥匙，按既有语义**静默降级**（不崩溃，所以更难发现）；想跑 live e2e 又被迫设一个无效变量。 |
| **与那一对的交叠（⚠ 本档此前写错过，已更正）** | 本条前一版写过一句「那一对不动 `SECRET_ENV_VARS`」——**错的**。实际是：spec `:235` 与 plan Task 9（`:180` 连带面 + GREEN ①）明写要**一并处理** `SECRET_ENV_VARS["vlm_api_key"]`（`:47`）、两处**模块级**消费者 `knowledge/captioner.py:32` 与 `knowledge/video/captioner.py:34`（都是 `VL_API_KEY_ENV = SECRET_ENV_VARS["vlm_api_key"]`）、以及两处缺钥匙降级分支 `captioner.py:65` / `video/captioner.py:81`；plan 还专门警告「**只删字典条目会让这两处 import 期 `KeyError`**（整批测试文件收集失败，看着像无关红）」。另：`routers/rag_config.py:176-177` 的 vlm 分支删掉后该函数变成纯 `_SECRET_LEGS` 驱动。⇒ **`SECRET_ENV_VARS` 的 vlm 那一格归 Task 9，本条不碰。** |
| **处置（删旧回退说明，不改名）** | 撤回"六处改成 `DASHSCOPE_API_KEY`"：Task 9 退役的是 RAG 专属回退，不能为它继续保留另一个厂商变量的说明；**不禁止模型条目显式使用 `api_key: $任意名`**。Task 9 的三处说明按上面的载体清单删行 / 删项；本条删除 `.env.example:44`、`README.md:221` 的独立 VLM 行，`UPSTREAM_README.md:152` **只删名单中的 VLM 一项，保留其他变量**，并删除 `test_e2e_smoke.py:53` 的无效门禁项；`test_parser.py` 四处归 Task 9，不在本条重复处理。<br>**排期：紧跟 Task 9，不要抢在它前面做**，与退役后的机制说明同步，不再称为"可以立刻做"。<br>**影响范围**：**仅清理无效变量引用不会改变 VLM 的运行取值**；删除 live 门禁中的无效项会改变测试的跳过条件。不能据此保证 Task 9 的退役迁移不影响本机：依赖 `rag_config.json` 的 VLM 密钥或旧 RAG 环境变量回退的配置，须改为由模型条目提供钥匙。 |
| **`test_parser.py` 归属已同步（仅文档，尚未执行）** | `backend/tests/knowledge/test_parser.py:5` / `:211` / `:237` / `:274` 的说明与无效 `setenv` 清理归 **Task 9**，其连带面清单已同步，B-2 只接上述三处说明与一处 live 门禁，不再将该文件列为范围外或待裁项。 |

#### B-3 `parse_base_url` 让人以为云侧也能换地址 —— ✅ **已闭合（2026-09-16 `8eed49b8`），登记不改**

| | |
| --- | --- |
| **原表现** | `config/app_config.py` 的 `parse_base_url` 与 `embedding_base_url` / `rerank_base_url` / `sparse_base_url` **同形**（G-3 那三个是真旋钮），而它只管 `mineru-local`；云分支没有地址入参。原判的"坏在哪"是「三个真旋钮 + 一个半旋钮排在一起，**没有任何提示说明第四个只管 local**」。 |
| **⚠ 第四轮核实：那句"没有任何提示"是错的** | 三层都说了，而且**早于本档成文**（`8eed49b8`，2026-09-16，`feat(settings): rework the models settings views`）：<br>① **界面标签**就叫「本地服务地址」/ "Local service address"（`zh-CN.ts:1725` / `en-US.ts:1819`）；<br>② 选 `mineru-cloud` 时该行渲染成**带原因的锁定行** `<LockedBox reason={F.lockedLocalOnly} />`（`functional-models-view.tsx:1134-1135`），文案「仅本地服务需要」/ "Local service only"（`zh-CN.ts:1796` / `en-US.ts:1889`）；<br>③ **后端两处描述都以 "Local MinerU service address" 开头**（`app_config.py:218`、`rag_config_file.py:109`）。 |
| **结论** | **不是"后来被修掉的"，是我当时没核界面** ⇒ 本条从坏项里移出，计数随之调整（§3 / §3.1 / 一句话结论）。保留本条与编号不删，是为了给"同形字段"这个判据留一个**反例**：同形不等于同义，但**界面把差异说出来之后**它就不是坏写死。 |
| **遗留（不归本条）** | 后端**字段名**仍与三个真旋钮同形；只读 `config.yaml` 的人看到的是字段名，不是界面。要不要连字段名一起改属命名口味，**不登记为坏项**——改了要动 `rag_config.json` 的键 ⇒ 反而制造一次退役，成本高于收益。 |

### 3.2 坏-A：替用户做决定 + 够不着（10 条；其中 `A-9`、`A-7`、`A-8`、`A-3` 已闭合，`A-2`／`A-5`／`A-6`／`A-4` 已交付 ⇒ 现存 **2** 条）

> 共同特征：**没有配置通路**，而这个值决定功能结果的方向。"没有配置通路"有两种形态（§1.2）：`A-1`～`A-6` 与 `A-9` 是**值写死了**；`A-7`/`A-8`/`A-10` 是**字段根本不存在**——代码老老实实退到通用默认，但用户没有任何位置能指定这个角色该用谁。

#### A-1 代码侧字面默认模型名 —— 用户什么都不写时，系统替他选了厂商和型号

| | |
| --- | --- |
| **写死的是什么** | `config/app_config.py:189` `embedding_model="qwen3.7-text-embedding"`、`:191` `rerank_model="qwen3-rerank"`、`:193` `vlm_model="qwen3.7-flash"`、`:194` `vlm_base_url=` DashScope compatible-mode、`:196` `vlm_api_key_env="DASHSCOPE_API_KEY"`、`:157` `asr_model="paraformer-zh"`。 |
| **为什么是坏-A 而不是 G-6 那种缺省值** | G-6 的 `qdrant_url` 缺省 `localhost` 是**中性**的（谁的部署都长这样）；而模型名缺省值是**某一家厂商的某一个型号**，它决定了向量/重排/图片说明/语音识别四条腿实际打到哪里、按什么模型的能力产出结果。⇒ 正是"默认替用户做了选择"。 |
| **归属** | `RagConfig` / `RagVideoConfig` 整块 fork 新增（§1.3 ②：上游 `app_config.py` 里 `class RagConfig`、`qwen3.7-text-embedding`、`paraformer-zh` 零命中）。 |
| **克隆者的遭遇** | 名字里带版本号（3.7 / v4）⇒ 平台侧一改名就全断，且断点在**第一次 ingest**，不在配置期。 |
| **改法与破坏面** | **不能只删默认**：删掉 `:189` 之后，没在 `config.yaml` 写 `rag.embedding_model` 的部署会拿到空串 ⇒ 必须同时给一个"缺项即配置错误"的收口。**这正是 2026-09-23 那一对 D10 已经为 `vlm_model`（`:193`）走过的路**，可复用其形状（读取期归一 + 缺项报错 + 四条路径同一个 `ValueError` 文案）。⇒ 建议：**VLM 那一片已由那一对的 D10 处理**——`:194-196` 三项**字段退役**，`:193` 的 `vlm_model` **字段保留、只删它的字面量默认**（口径见 spec D10：退役键数按载体分开数，别把 `:193` 算进退役）；本条只剩 `:189`/`:191`/`:157` 三项，另起一对、照抄同一形状。**本机**：你的 `config.yaml` 里这些值都是显式写的，删默认对你无感。 |

#### A-2 `parser.py:387` 请求体里 `"language": "ch"` 写死

| | |
| --- | --- |
| **写死的是什么** | `knowledge/parser.py:387`：申请上传 URL 的请求体 `json={"files": [...], "model_version": model_version, "language": "ch"}`。 |
| **为什么是坏-A** | 它决定 MinerU 用哪种语种的解析提示 ⇒ **直接决定解析结果的方向**，且无任何配置通路（`rag` 段里没有对应字段）。~~纯英文文档也按中文提示解析~~（**2026-09-29 收窄**：`ch` 的官方含义＝中英文，纯英文文档受影响很小；真正被硬套的是**非中英**文字种——日／韩／繁／泰／阿拉伯／西里尔等）。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面** | 提成 `rag.parse_language`，默认 `"ch"` ⇒ **不破坏任何现有部署**（默认值即当前行为），本机也无感。 |
| **✅ 已交付（2026-09-30，「对 2」）** | 见 §4.2；实施 `5bea5cfe`（`RagConfig`／`RagConfigFile` 各加 16 值 `Literal`，云腿请求体现取配置、`sources` 反射自动进出）；真栈腿一已验（`japan` ⇒ `ch` 两向，抓包具名）。 |

#### A-3 `video/ocr.py:57` `lang="ch"` 写死

| | |
| --- | --- |
| **写死的是什么** | `knowledge/video/ocr.py:57` `PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)`；`:53-58` 还只在首次调用时建一次引擎。 |
| **为什么是坏-A** | 决定视频屏幕文字认哪种语言 ⇒ 结果方向；配置通路为零（全仓搜 `ocr_lang` 零命中）。非中文视频的屏幕文字恒为空，但按 `:48-50` 是**降级为空、不抛错** ⇒ 静默。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面** | 提成 `rag.video.ocr_lang`，默认 `"ch"` ⇒ 不破坏。**本机现状**：PaddleOCR 未装 ⇒ 这条腿本来就空转（每帧一条 warning），改与不改当前都看不出差别；且"引擎只建一次"另有一笔已知欠账（装 PaddleOCR 前要先改成每次新建），两者可一并处理。 |
| **⚠ 2026-09-30 已被取代（不交付）** | 屏幕文字改走 **`rag.vlm_model`**（与 caption 同一条链，VLM 读屏幕文字）⇒ **不再需要"语种"这个旋钮**，`PaddleOcrEngine` 与其字库整块退场（`video/ocr.py` 重写为 `screen_text_shots`，调用形状与降级契约照 caption 腿；spec 2026-09-29 的「A-3 的撤销与替换」节）。本条**不随「对 2」交付**、也从该对摘出（对 2 缩为 `A-2` + `A-6` + `A-5`）；上面两行的 `ocr_lang` 改法与"引擎只建一次"欠账**一并作废**。**取代它的新风险**（登记在本档之外的线）：屏幕文字从确定性引擎变生成式输出、且会像 caption 一样遇网络／凭据失败（失败率 >30% 打一条 warning，无自己的 `path_status` 腿）——见 spec 同节。 |

#### A-4 `caption_client.py:27` `_MAX_TOKENS = 1024` / `:30` `_TEMPERATURE = 0.15`

| | |
| --- | --- |
| **写死的是什么** | `knowledge/caption_client.py:27` `_MAX_TOKENS = 1024`、`:30` `_TEMPERATURE = 0.15`；两个值**两种方言共用**（`:47` 的 OpenAI 形状与 `:56` 的 Messages 形状都发 `max_tokens` / `temperature`），两条 caption 腿（`captioner.py:44` 文档图、`video/captioner.py:58` 镜头帧）都走 `request_caption`。 |
| **为什么是坏-A** | `_MAX_TOKENS` 决定**长图/密排页面的说明被静默截断**（`:26` 的注释自己写着"room for a full-page transcription"，但 1024 是否够没有任何配置出口）；`_TEMPERATURE` 决定采样确定性。两者都无配置通路（`rag` 段里没有对应字段）。 |
| **同仓反例（这条最有力）** | `config/agents_config.py:194-203` 把 **`temperature` 与 `max_tokens` 都做成了 per-agent 配置项**，docstring `:179-183` 还专门论证过理由：“let two agents that reference the *same* `models:` profile still run with different temperature / output length — the core ask of issue #4336, where 'different agents have different capabilities, so a shared temperature is a poor fit'”。⇒ **同一个仓里，agent 侧认定"共享一个 temperature 是不合适的"并开成了配置，caption 侧却把两个值钉死在模块常量里。**这不是"设计如此"，是漏做的那一套。 |
| **归属** | fork-new（§1.3 ①）；反例 `agents_config.py` 是上游文件，但正好说明仓内已有既有做法可对齐。 |
| **改法与破坏面** | 提成 `rag.caption_max_tokens` / `rag.caption_temperature`，默认 1024 / 0.15 ⇒ 不破坏。注意两条腿共用 ⇒ 若要"文档图与视频镜头用不同上限"，得按腿分（`agents_config.py` 的 per-agent 形状就是先例）。 |
| **✅ 已交付（2026-09-30，「对 3」）** | 见 §4.2；实施 `7aa70c59`（`rag.caption_max_tokens` / `rag.caption_temperature`，**默认仍 1024 / 0.15**；①＝甲 两条腿共用一组、②＝甲 只进 `RagConfig`、不进文件层/界面/探针）；真栈三次抓包两向已验（2048/0.15 → 1024/0.7 → 1024/0.15）。 |

#### A-5 `parser.py` 三层 `model_version="vlm"`，全无配置通路

| | |
| --- | --- |
| **写死的是什么** | `knowledge/parser.py:686`（`MineruCloudParser.__init__`）、`:722`（`build_parse_provider`）、`:756`（`parse_document`）三处签名默认 `model_version: str = "vlm"`，`:746` 传给云客户端、`:701` 进请求体。 |
| **为什么是坏-A** | 它是**云 API 的档位参数**，决定解析质量与费用方向；而 `app/` 与 `knowledge/` 里**没有任何调用方传配置值** ⇒ 三层默认一路生效，用户没有表达位置。 |
| **同层另一条腿做了字段（本轮补）** | `config/app_config.py:219-222` 有 `parse_tier: Literal["flash","basic","standard","advanced"] \| None`，描述自述 “Optional tier for the **local** MinerU 4.x service; **None lets the service decide**（服务端自身默认 standard；flash-only 的服务端不带档位会对 PDF 答 503）”。该字段原名 `parse_backend`（`vlm` / `hybrid`），**已随 4.x 那一对退役改名**（2026-09-24）。⇒ **同一个解析层：本地腿既有字段、又允许"交给服务决定"；云腿既无字段、也不允许交回服务**。这条不对称本身就是"漏做而非设计"的证据（与 A-4 的 `agents_config.py` 反例同一性质）。 |
| **⚠ 别修错对象** | 仓内还有**另一个同名** `model_version`，与此无关：`app/gateway/services/knowledge_service.py:121`/`:1417` 与 `knowledge/projection/reducer.py:43`（那是向量投影的 `umap-v1`/`pca-v1`）。按名字搜会同时命中，改之前先确认在 `parser.py`。 |
| **别拿错证据** | 仓内唯一那张三档精度表（[2026-09-14 spec §3.6](superpowers/specs/2026-09-14-rag-model-provider-adaptation-design.md)：`pipeline` 86.47 / `vlm` 95.30 / `hybrid` 95.39，OmniDocBench v1.6）量的是**本地部署后端**，该 spec 自己在表前警告「云侧的 `model_version` 与它不是同一张表，**不能直接对比**」⇒ **仓内没有任何证据支撑"云侧选 `vlm`"**。要改默认值得先拿云侧自己的对照数据。 |
| **归属** | fork-new（§1.3 ①）。 |
| **⚠ 本档有待同步的引用（另一条线，2026-09-24）** | 本条用来做对照的 `rag.parse_backend` 正被 [2026-09-24 MinerU 4.x 那一对](superpowers/specs/2026-09-24-mineru-4x-parse-adaptation-design.md) 退役为 `parse_tier`（spec D2 `:78-83`、影响面 `:156-158`：`app_config.py:219-222` 与 `rag_config_file.py:103` 换字段、`parser.py:742-744` 换 kwarg；四档值 `flash`/`basic`/`standard`/`advanced`、`None` = 服务端定，且**不做 `vlm`/`hybrid` 的值映射**，spec `:81`）。那份 spec 的 `:208` **点名了本档**：「`docs/PRE_RELEASE_HARDCODE_INVENTORY.md`（未提交的研究档，`docs/` 根）引了 `parse_backend`——顺手同步（不阻塞本对）」。⇒ **本档原先有 4 处实质引用 `parse_backend`**（本条的对照行、§4 第 7 条、§5「第二版→第三版」表、§6.2 附录「文档解析（云）」行；另有 3 处说明性提及——本行这句自指、本条的对照行里那句「原名」注记、文末「相关记录」里指向那一对的那句），**已于 2026-09-24（该对 Task 4）一次性改名 `parse_tier`**——那一对的后端与前端均已交付，改名不再是把未来状态写成现状。 |
| **但那一对不覆盖本条（已核）** | 其 spec `:65` 的非目标明写「**`mineru-cloud` 零改动**（云腿 `/api/v4` 流程一行不碰，守护用例继续跑）」，`:29` 也把「mineru-cloud 腿、`parse_document` 签名」列为不动 ⇒ **A-2（`language:"ch"`）、A-5（云侧 `model_version`）、A-6（云端点无旋钮）都不在它范围内，仍是未排期项**。别因为"MinerU 有一对了"就以为这三条被接走了。 |
| **改法与破坏面** | 加 `rag.parse_model_version`（默认 `"vlm"`）⇒ 不破坏。但"默认值该不该是 vlm"是另一个产品决定，别在同一步里顺手换。**与那一对的顺序**：它动的是本地腿的字段名与 `parser.py:742-744`，本条动的是云腿的签名默认与 `:746`；两者在 `build_parse_provider` 的同一个 `if/else` 两侧 ⇒ **等它落地后再做本条**，否则同一函数改两遍。 |
| **✅ 已交付（2026-09-30，「对 2」）** | 见 §4.2；实施 `5bea5cfe`（`parse_model_version`，`pipeline`／`vlm`，**默认仍 `"vlm"`**、产品决定留白）；真栈腿二已验（`pipeline` ⇒ `vlm` 两向）。 |

#### A-6 MinerU **云**端点无旋钮

| | |
| --- | --- |
| **写死的是什么** | `knowledge/parser.py:54` `MINERU_BASE_URL = "https://mineru.net"`，直接拼进 `:385`（申请上传 URL）与 `:406`（轮询结果）。 |
| **为什么是坏-A** | 它决定**你的源文件被 PUT 到哪台服务器**（`:397-401` 的裸二进制 PUT 走的正是这个 URL 换回来的地址）⇒ 数据出域方向由代码定，用户够不着。与 G-3 那四个"有旋钮兜着的端点缺省值"形成对照：**同样的形状，只有这一条腿没有旋钮**（B-3 说的是它 misleading 的那一面，本条说的是它够不着的那一面）。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面** | 给云分支补地址覆盖、默认值仍是 `https://mineru.net`；且是对齐既有形状（`mineru-local` 早就有地址旋钮、G-3 那三个也有），不是新机制。**⚠ 2026-09-29 更正：不再能称"纯加法、不破坏"** —— [2026-09-29 那一对](superpowers/specs/2026-09-29-rag-parse-knobs-design.md)把本条裁定为**复用既有 `parse_base_url`**（不新开字段，其 spec §6.1 ①＝乙）⇒ 该字段在云腿下从"**被忽略**"变"**生效**"：任何先设过本地地址、之后切回云的部署，云请求会改打到那个地址（失败可见、清掉字段即恢复）。那条**唯一的行为变化**已在该 spec §6.2 首条如实登记。本机无感仅当该字段本就为空。 |
| **✅ 已交付（2026-09-30，「对 2」）** | 见 §4.2；实施 `5bea5cfe`（复用既有 `parse_base_url`：云腿读它、空退官方常量）＋ `80fe8c01`（界面地址行解锁、标题「服务地址」、ⓘ 两态）；真栈腿三已验（到达配置地址／失败地址失败／清空回官方 `mineru.net`，抓包与网关日志具名）。 |

#### A-7 wiki 生成：**没有任何字段**能指定用哪个模型写百科条目

| | |
| --- | --- |
| **表现（§1.2 的第 2 形态：字段不存在）** | `knowledge/wiki/generator.py:208-212` 的 `_default_llm()` 是裸 `create_chat_model()`，docstring 自述 “Wiki writing uses the main model (first configured)”；`app/gateway/app.py:351` 在启动时同样裸调一次（`:352-354`：失败则 `logger.exception("Main model unavailable; wiki auto-generation disabled")` 并置 `None`，自动 wiki 生成整条关掉）。 |
| **为什么是坏-A** | `RagConfig` **没有任何 wiki 模型字段**（全部字段已逐个核过：`app_config.py:188-201` 与 `:207-231`，LLM 角色字段只有 `extract_model`(`:199`) / `judge_model`(`:200`) / `vlm_model`(`:193`) 三个）。而 wiki 条目是**用户会直接阅读、且能被"生成方向"引导**的产物 ⇒ "用哪个模型写我的百科"这件事，用户没有表达位置，只能拿到 `models[0]`（G-9 那个位置默认）。 |
| **同层对照** | 同为 RAG 的 LLM 角色：图谱抽取**有** `rag.extract_model`、评测 judge **有** `rag.judge_model`，两者在设置界面都是"条目选择器"。⇒ **同一层三个 LLM 角色，两个有字段、一个没有**，这不是设计取舍的形状。 |
| **归属** | fork-new（§1.3 ①：`knowledge/wiki/generator.py` 在 merge-base 不存在）。 |
| **改法与破坏面** | 加 `rag.wiki_model`（默认 `None` ⇒ 仍落 `models[0]`，"用哪个模型"不变）＋ 照 `extract_model`/`judge_model` 的既有形状进 `rag_config.json` 与设置界面选择器（含"空 = 使用配置默认"那个既有文案）。**⚠ 2026-09-28 更正：不再能称"纯加法、不破坏任何部署"** —— 那一对同日把 ③ 裁定为乙（spec D3），顺手把 worker 那条自动生成腿从"启动期定模型"改成"每次现解析"。**这是与字段是否声明无关的行为变化**：没有可用模型时从"启动时一条一次性日志 ＋ 之后静默关闭"变成"每次触发各一条日志"，收益是配置修好即自愈、不用重启。该对的 spec §6.2 已如实登记这条代价。 |
| **✅ 已交付（2026-09-29，「对 1」）** | 与 A-8 合为 [2026-09-26 那一对](superpowers/specs/2026-09-26-rag-wiki-synthesis-model-design.md)（spec + [plan](superpowers/plans/2026-09-26-rag-wiki-synthesis-model.md)，§4.2 的「对 1」）。**其 spec D2/D3 查出本条此前漏掉的一半**：wiki 有**两个**调用点——`generator.py` 那个是惰性的（每次调用读配置、热加载生效），`app.py:351` 那个是**启动期一次性**注入 worker 的（改了要重启）。**两处必须同批改**，只改一处就造出一个只对一条腿生效的假旋钮，正是 §3.1 判为最危险的那一类。该不对称今天已存在（worker 的模型本来就 boot 冻结）。**⚠ 2026-09-28 再更正**：本行原写"本对只登记并写进界面提示，不改 boot 注入语义"——**该裁定随后被推翻**：2026-09-28 的 ③＝乙 把 worker 腿改成**每次触发现解析**、`app.py` 的 boot 建模型与它那条 `except` 一并退场（spec D3），并把它登记为该对唯一"与字段是否声明无关的行为变化"（见 A-7 的「改法与破坏面」行末）。**交付（2026-09-29）**：`RagConfig`／`RagConfigFile` 各加 `wiki_model`（并进共享空白归一 `MODEL_REFERENCE_FIELDS`）；两个调用点（手动 `generator.py:220`、worker `worker.py:848`）同批接 `require_usable_rag_target` ⇒ `wiki_model → rag.default_model → models[0]`；提交 `7d517757`（后端）／`7ba229eb`（前端两行并入既有分组）／`9ffae7c3`（模板与指南）；真栈"改完不重启即生效"已验（活体证据见 plan Task 4 腿二的甲步）。 |

#### A-8 评测题目合成：同样没有字段，且**已被登记为待办却没进任何清单**

| | |
| --- | --- |
| **表现** | `knowledge/eval/synthesis.py:139-143` 的 `_default_llm_factory()` 是裸 `create_chat_model()`，docstring 自述 “Synthesis uses the main model (first configured), **wiki-generator precedent**”。⇒ 它明确以 A-7 为先例，两条应当一起改。 |
| **已登记但未入清单** | `backend/AGENTS.md` 写着这条腿 “**no dedicated config knob**（spec §10 open point 1, deferred until after real-run observation）”⇒ 是**已知的、有意延后的**开放点，但它既不在那份 spec 的待裁里、也没进本档前一版。本条把它落到清单上。 |
| **为什么是坏-A（危害比 A-7 更硬）** | 合成出来的题目会进**评测题库**（golden bank），而题库是 Layer 1 CI 门禁的判据（`.github/workflows/rag-eval.yml` 按 Recall@k 掉点变红）⇒ **出题模型一变，门禁的基准就变**。用户对"谁出题"没有表达位置。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面** | 加 `rag.synthesis_model`（默认 `None`）⇒ 不破坏。与 A-7 同一批做最省（两处形状相同、且 `synthesis.py` 自己就引了 wiki 作先例）。 |
| **✅ 已交付（2026-09-29，「对 1」）** | 与 A-7 合为 [2026-09-26 那一对](superpowers/specs/2026-09-26-rag-wiki-synthesis-model-design.md)（§4.2 的「对 1」）。**它只有一个调用点、且比 A-7 干净**：`_default_llm_factory` 是个**工厂**（`synthesis.py:332-333` `factory = llm_factory or _default_llm_factory; llm = factory()`），每次合成调一次 ⇒ 热加载天然生效，没有 A-7 那条启动期冻结的不对称。生产路径 `knowledge_service.py:1562` 不传 `llm_factory` ⇒ 恒走默认工厂；四条既有用例都注入 `llm_factory`，不受影响。其 spec Task 3 还负责**撤掉 `backend/AGENTS.md` 那条 open point**——交付后它不再是待办。**交付（2026-09-29）**：`_default_llm_factory` 现取 `synthesis_model → rag.default_model → models[0]`（`synthesis.py:149`）；真栈腿三验了两级（显式 ⇒ 直打该条目宿主；撤销 ⇒ RAG 默认）；那条 open point 已撤，同批修正该段的四处 `doc_id` → `doc_ids` 漂移（触发签名／暂存元数据／请求体／状态载荷）。 |

#### A-9 评测 judge 的 `dashscope:` 支路：绕过 config 白名单直连一家厂商 —— ✅ **已闭合（2026-09-27 `3bf049cf`，那一对的 Task 7），登记不改**

| | |
| --- | --- |
| **写死的是什么** | `knowledge/eval/factory.py:75-82`：当 `judge_model` 以 `dashscope:` 开头时，**不走 config 模型白名单**，直接 `ChatOpenAI(model=…, base_url=DASHSCOPE_COMPATIBLE_BASE_URL, api_key=…)`；端点常量在 `:19`，钥匙从 `DASHSCOPE_JUDGE_API_KEY` 或 `DASHSCOPE_API_KEY` 读（`:77`），两者皆无则抛 `JudgeKeyMissingError`（`:22-23`/`:79`）。 |
| **前一版判错了对象（本轮更正）** | 前一版把 `:19` 那个端点常量归进 G-3「有旋钮兜着 ⇒ 好的写死」——**判错**：这个常量**没有任何旋钮**，它只服务于这条支路；支路本身按 §1.2 是坏-A（决定"评分由哪家模型做"，且用的不是用户配置的条目）。G-3 已收窄为三份常量，本条独立成项。 |
| **但它有一个站得住的理由（要一起写清）** | 模块 docstring `:5-8` 说明 judge 与答题 agent 的模型**刻意可分离**（“自评偏差是真实失败模式”），且 “judge 永远不需要 config.yaml 条目”。⇒ **需求是对的，坏的是实现方式**：把"独立于 config"实现成"硬编码一家厂商 + 一个端点常量 + 一个专属环境变量"，于是非 DashScope 用户享受不到这份独立性。 |
| **归属与现状** | fork-new（§1.3 ①）。**已有明确落点，且不止一处提到它**：<br>① [2026-09-23 那一对](superpowers/specs/2026-09-23-default-model-design.md) 的 **D9（已裁：乙）** —— spec `:154` 明写"删 `factory.py` 的 `startswith("dashscope:")` 分支 + `DASHSCOPE_COMPATIBLE_BASE_URL` + `JudgeKeyMissingError`；CLI 的对应 docstring / `--judge-model` help / `except` 分支"，`:255` 的影响面列了 `knowledge/eval/factory.py` 与 `scripts/run_ragas_eval.py`，验收 `:233` 钉到**逐字消息** `Model dashscope:qwen3.8-max not found in config` + **两个符号 grep 0 命中**；plan 侧是 **Task 7**（`plans/2026-09-23-default-model.md:142-149`，含"把分支加回 ⇒ 恰好 1 红"的 neuter）。<br>② `docs/superpowers/specs/2026-09-24-rag-retrieval-followups-design.md:67`（另一条线的 spec）也点了它：「`DASHSCOPE_JUDGE_API_KEY` 失效……等 2026-09-23 那对落地后自然消失，**本 spec 不写任何工作**」⇒ **两条线已对齐，没有第二个落点、也没有重复工作**。<br>③ 遗留面也交代了：历史文档 3 处 + `backend/AGENTS.md` 一处仍写着旧行为，**留档不改**（spec `:290`）；CI `nightly.yaml:303` 的 `dashscope:` 用法带 `if: github.repository == 'bytedance/deer-flow'` ⇒ 只在上游仓库跑、本对不改（spec `:291`）。 |
| **judge 独立性会不会被一起删掉？——不会，已由设计保住** | 这是本条唯一需要验收时确认的点，答案是**已经保住了**：D9 之后 judge 的取值面是「**条目名** / `None`（⇒ 默认模型）」（spec `:214`），而 `rag.judge_model` 本来就是设置界面里对已配置条目的**选择器**（spec `:182` 把它与 `extract_model`/`vlm_model` 并列为三格保存期校验之一）。⇒ **"judge 与答题模型分离"靠选另一个条目实现，删掉的只是"绕过 config 直连一家厂商"那条路**。独立性没丢，丢的是非 DashScope 用户本来也用不上的那个捷径。 |
| **改法与破坏面** | 归那一对的 Task 7，本档只更正归类。**别在两边同时改**（同一文件同一支路）。 |

#### A-10 追问建议：只有请求体字段、无配置字段 —— 但**是上游的，登记不改**

| | |
| --- | --- |
| **表现** | `app/gateway/routers/suggestions.py:134-140` 传 `model_name=body.model_name`（**请求体**带的），而 `SuggestionsConfig` 只有 `enabled`(`:10`) 与 `max_suggestions`(`:11`)，**没有 model 字段** ⇒ 运维无处钉住；客户端不传则经 `utils/oneshot_llm.py:55` 落 `models[0]`。 |
| **同层对照** | 同为"非图内一次性 LLM 调用"、同走 `run_oneshot_llm` 的输入润色**有** `input_polish.model_name`（`config/input_polish_config.py:9`）。 |
| **归属（决定了处置）** | **是上游原有项目的，而且本仓一个字都没改过**。两条命令为证：<br>① `git diff --stat 99c926b7 -- …/config/suggestions_config.py …/routers/suggestions.py …/config/input_polish_config.py …/routers/input_polish.py` → **输出为空**，即这四个文件与 merge-base **逐字相同**（fork 从未触碰）；<br>② `git show 99c926b7:…routers/suggestions.py \| grep -n model_name` → `:28` `model_name: str \| None = Field(default=None, description="Optional model override")`（**声明在请求体模型上**）与 `:139` `model_name=body.model_name` ⇒ **"只能由请求体带"这个设计本身就是上游的**；同一 commit 的 `input_polish_config.py:9` 却有配置字段 ⇒ **这条不对称也是上游自己的**。 |
| **判定** | 按 §1.2 它确实命中坏-A 第 2 形态（决定**终端用户可见输出**用哪个模型、且运维无表达位置）；但按 G-7 的同一条理由——**改它只是扩大与上游的 diff 面**，且上游随时可能自己补——⇒ **登记不改**。真要做，走上游 PR，不在本仓私改。 |

### 3.3 坏-C：不规范（3 条，不决定结果方向；其中 `C-3` 已交付 ⇒ 现存 2 条）

#### C-1 面向用户的错误文案只有中文，且绕过 i18n

| | |
| --- | --- |
| **写死的是什么** | `knowledge/embedder_factory.py:42` `_REBUILD_HINT`（“请改用 1024 维的模型，然后到「设置 → 模型 → 功能模型 → 重建索引」重新嵌入现有切片。”）、`:52`（维度不符）、`:108` 与 `:135`（稀疏半缺）、`:139`（声明维度不符）；`app/gateway/routers/rag_config.py:428` `_SPARSE_ALTERNATIVES`、`:372`（保存期维度 400）、`:644`（稀疏探针的 `detail`）。 |
| **为什么归坏-C 而不是坏-A** | 它不决定功能结果的方向；坏在**同一个产品两种语言策略**——界面文案走 i18n 双语，后端抛出的字符串不经任何翻译层直接到用户眼前，而这些字符串是维度不符/稀疏缺失这类故障的**唯一线索**。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面** | **不破坏部署，但会红 4 个后端测试文件里的 6 行断言**（已逐个核到；其中 **2 处是逐字全文常量**，不是子串）：<br>① 逐字全文：`tests/test_rag_config_save_probe.py:59` `_WRONG_WIDTH_MESSAGE = "嵌入模型返回 2560 维，而向量库集合固定为 1024 维 ⇒ 拒绝启用。请改用 1024 维的模型，然后到「设置 → 模型 → 功能模型 → 重建索引」重新嵌入现有切片。"`、`tests/test_rag_configuration_error.py:18` `_MESSAGE = "嵌入 provider 'openai-compatible' 只输出稠密向量 ⇒ 请改为「独立稀疏服务」或「本地 BM25」。"`；<br>② 子串断言 4 行 / 3 个用例：`test_rag_config_api.py:549`、`test_rag_config_probe.py:139` **与 `:140`**（同一个用例的两行，分别断言 `"独立稀疏服务"` 与 `"本地 BM25"`）、`test_rag_config_save_probe.py:210`。<br>**耦合是纯文字的**：`dimension_mismatch_message` 这个 helper 名在 `backend/tests` 里**零命中** ⇒ 用例断言的是消息文本本身，不是函数。<br>**前端不会红，但那边有一份独立副本**：`frontend` 侧命中 7 处 —— `i18n/locales/zh-CN.ts:1710`/`:1715`/`:1755`/`:1757`/`:1797`（**同一条指引的中文源文案**，`en-US.ts:1804`/`:1890` 是对应英文）与两个测试文件里的**注释**（`functional-models.dom.test.tsx:1299`、`config-form.test.ts:777`，不是断言）⇒ 改后端文案不会红前端。**但这正是本条的真正形状：同一件事有两处措辞**——后端抛的那份只有中文、前端那份已双语。⇒ 改法方向应是让后端抛**错误码 / 结构化字段**、由前端用它已有的双语措辞渲染（而不是把后端那句改成双语并列，那会留下第三份措辞）。<br>**且必须排在 2026-09-23 那一对之后**——那一对的 C 决定刚把这些消息钉成"四条路径逐字相同"并要求断言 `type(exc.value) is ValueError`；两份改动叠在一起会让"文案"同时被两个方向拉。 |

#### C-2 示例文件装的是我个人在用的模型名

| | |
| --- | --- |
| **写死的是什么** | `rag_config.example.json:3` `qwen3.7-text-embedding`、`:5` `qwen3-rerank`、`:7` `qwen3.7-flash`、`:8` DashScope compatible-mode、`:10` `deepseek-v4-flash`、`:15` `paraformer-zh`；`config.example.yaml:2575`/`:2577`/`:2582` 同一批名字，`:2587`/`:2590` 的注释示例也是 `deepseek-v4-flash`。 |
| **为什么归坏-C（以及它什么时候升级成坏-A）** | 示例文件的**形式是对的**（模板就是给用户改的，属 §1.1 第 1 条），坏在**内容是一个人的厂商选择**，不规范。但它有一条路会**升级成坏-A**：`make config-upgrade` → `scripts/config-upgrade.sh` 的第 2 步是「把示例里缺的字段合并进用户配置」（脚本头注释自述，改前备份 `.bak`）⇒ 已有 `config.yaml` 的人跑一次，`rag.embedding_model: qwen3.7-text-embedding` 就**被写进他自己的配置**，从"模板"变成"替他做了决定"。（另一条路 `make setup` → `scripts/configure.py:37` 是整份 `copy_if_missing`，只影响新部署。）`rag_config.example.json` 反而安全：**全仓没有脚本消费它**（`make config` 不拷它），只能手工复制。 |
| **归属** | `rag_config.example.json` fork-new；`config.example.yaml` 的 `rag:` 块 fork 新增（§1.3 ②）。 |
| **改法与破坏面** | 换成中性占位（如 `your-embedding-model`）⇒ **不破坏任何现网部署**：`config.yaml` / `rag_config.json` 都在 `.gitignore`（`:34` / `:38`），改示例不覆盖老部署；已跑过 `config-upgrade` 的人配置里已有值，合并只补缺字段、不会再次覆盖。**本机**：你以后跑一次 `config-upgrade` 就会重新引入示例值，所以这条对你也有意义。**要等 2026-09-23 那一对落地后再动**，否则两份改动会在 `rag_config.example.json:8-9` 上打架（那两键由它的 D10/Task 9 排期删除，本条只覆盖 `:3`/`:5`/`:7`/`:10`/`:15`）。 |

#### C-3 `video/asr.py` 的签名默认与 `config.yaml` 的字段默认是同一选择的两份副本

| | |
| --- | --- |
| **写死的是什么** | `knowledge/video/asr.py:89`（`__init__`）与 `:177`（函数签名）都是 `model: str = "paraformer-zh"`，与 `config/app_config.py:157` 的 `asr_model` 默认值同值。 |
| **为什么归坏-C 而不是坏-A** | 这一条**有旋钮**（`rag.video.asr_model`，且 `rag_config_file.py:63` 让设置界面也能改）⇒ 用户够得着，不算替他做决定。坏在**双真值源**：同一个选择写在三个地方，改一处忘两处就会漂移；而且直接调函数（不经配置）的路径拿到的是签名默认，与配置层可能不一致。 |
| **归属** | fork-new（§1.3 ①）。 |
| **改法与破坏面** | 让签名默认变成"必须由调用方给"（`model: str`，无默认）或从一个共享常量取 ⇒ **不破坏部署**，会破坏少量直接调用的测试（给它们补参数即可）。 |
| **✅ 已交付（2026-09-30，「对 3」）** | 见 §4.2；实施 `7aa70c59`（③＝甲：`FunAsrProvider` / `WhisperProvider` / `transcribe_video` 三处签名默认去掉，`resolve_provider` 本就必填、`resolve_leg_provider` 不收 model，各有形状守卫）；`WhisperProvider` 的 `"small"` 一并收掉（register 未数的第三处）。 |

---

## 4. 如果要做，建议的顺序

按「收益 / 风险」排，不是按严重度排。**第四轮（2026-09-26）重排**：`B-3` 已闭合移出、`A-7 + A-8` 升到第一（它们是 2026-09-23 那一对收窄之后留下的孤儿）、`B-1` 因改法岔口可能落到门 A。**第五轮（2026-09-28）修正**：`B-3`、`A-9` 均已闭合；**门 A 已于 2026-09-27 全部交付**（那一对的 plan 82/82，`bfed5529` → `305f4fa2`）⇒ 原先标着「门 A 之后」的四条（`B-2` 剩余 / `A-1` / `C-2` / `C-1`）与 `B-1` 选乙**全部解除门禁**，本节不再按门分段、只按收益排。每条属哪个门见 §4.1，分组见 §4.2。

**无任何门、现在就能起 spec/plan 的（0 条；原列表 8 条——`A-7` + `A-8` 已于 2026-09-29 交付、`A-2`／`A-5`／`A-6` 已于 2026-09-30 交付、`A-4`／`C-3` 已于 2026-09-30 交付、`A-3` 已被取代，全数移出；余下条目见下一组）**：

1. **A-7 + A-8** ✅ **已交付（2026-09-29，「对 1」，见 §4.2）——本条移出可做清单，以下为起草时的推荐理由与更正（留档）**：（wiki 生成与题目合成各加一个模型字段，默认 `None` ⇒ "用哪个模型"不变）——有现成形状可抄（`rag.extract_model` / `rag.judge_model` 就是"条目选择器"），且 A-8 是 `backend/AGENTS.md` 已登记的 open point。**⚠ 2026-09-28 更正**：该对把 ③ 裁定为乙 ⇒ 它**不再是纯加法**（worker 自动生成腿的模型生命周期也改，与字段声明无关；见 A-7 行的更正与那一对的 spec §6.2）。**建议两者同一批做**：`eval/synthesis.py:139` 的 docstring 自述 "wiki-generator precedent"，是同一个决定的两份副本。**升到第一的理由**：那一对的 spec `:27` 与 D6 `:106` 明确把它们排除在外，上游也不知道 RAG 有这两个角色 ⇒ 收窄之后没人管，越晚越像遗漏；A-8 的产物还喂进 golden bank 门 `rag-eval.yml`。
2. **A-2 / ~~A-3~~ / A-6** ✅ **已交付（2026-09-30，「对 2」，见 §4.2）——本条移出可做清单，以下为起草时的推荐理由与更正（留档）**：（`language` / ~~`ocr lang`~~ / **服务地址**提成配置，默认值不变）——A-2 是纯加法；**⚠ 2026-09-29 更正：A-6 不再是"纯加法、不破坏任何部署"** —— 那一对把它裁定为**复用既有 `parse_base_url`**（spec §6.1 ①＝乙）⇒ 云腿下该字段从"被忽略"变"生效"，是一条**已登记的行为变化**（见 A-6 行与其 spec §6.2 首条）。A-6 仍是对齐 G-3 的既有形状。**⚠ 2026-09-30：A-3 已被 VLM 路线取代、不随本对交付**（屏幕文字走 `rag.vlm_model`，不再需要语种旋钮；见 A-3 行的取代注）⇒ 本条余下 `A-2` + `A-6`。
3. **A-5** ✅ **已交付（2026-09-30，「对 2」，见 §4.2）——本条移出可做清单，以下为起草时的推荐理由（留档）**：（云侧 `model_version`）——顺序约束**已满足**（MinerU 那一对 2026-09-24 已交付，`parse_backend` 已退役为 `parse_tier`）。加旋钮不破坏（本地腿的 `rag.parse_tier` 就是现成对照），但"默认该不该是 vlm"要先拿云侧对照数据，别拿本地那张表推；建议**只做旋钮、把默认值的决定留白**（交付时按此执行：默认仍 `"vlm"`，产品决定留白）。
4. **A-4 + C-3** ✅ **已交付（2026-09-30，「对 3」，见 §4.2）——本条移出可做清单，以下为起草时的推荐理由（留档）**：（caption 的 `max_tokens` / `temperature`；ASR 双真值源）——A-4 照 `agents_config.py:194-203` 的既有形状做，先定"两条腿共用还是分腿"（spec §6.1 ①＝甲：共用一组）；C-3 是纯代码卫生，修法 ③＝甲（签名必填）。**注**：A-4 有一个更贴的上游先例（`ReasoningEffortCapabilities.default`），但要等门 B 才拿得到，见 §4.1；本对按仓内先例（`agents_config`）做。

**原「门 A 之后」的四条（2026-09-28 起不再等门 —— 那一对已交付）**：

5. **B-2 剩余载体**——那一对的 Task 9 **已按载体删行 / 删项**（三处说明 ＋ `test_parser.py` 四处）；本档只接余下三处说明（`.env.example:44` / `README.md:221` / `UPSTREAM_README.md:152`）与一处 live 门禁（`test_e2e_smoke.py:53`）。逐载体处置以 B-2 清单为准，不重复改名。
6. **A-1**（代码侧字面默认模型名）——**必须与"缺项即配置错误"的收口同时做**；归宿已定：`:193-196` 已随那一对的 D10.3 处置（`vlm_model` 的字面量默认已删、三个 VLM 字段已删），余下 `:189`/`:191`/`:157` 另起一对、照抄 D10 已建立的形状（`RagConfigurationError` + 保存期 400；`knowledge/model_target.py` 是现成落点）。
7. **C-2**（示例文件换中性占位）——不破坏现网部署；那一对已改过 `rag_config.example.json` 与 `config.example.yaml` 的 rag 段（其 spec `:242`），本档在**已交付的版本上**再改一次即可，无重复劳动。
8. **C-1**（错误文案的语言）——那一对的 D10.1 **已落地**，`RagConfigurationError(共享文案)` 已存在 ⇒ 现在改文案是**一次**（改已落地的文案），不是"先改文案再改结构"。
9. **B-1（甲／乙均已无门）**——`_RETIRED_KEYS` 机制在那一对的 Task 8 已从 tuple 扩成"名字→原因表"、并支持嵌套剥离，Task 9 已删字段且已发布 ⇒ **选乙不再与任何人撞车**，加 `embedding_dimension` 是独立一笔（沿用现成机制）。选甲仍是两行描述，可插到上面第 4 项里搭车。**⚠ 2026-09-30 更正（第六轮）：甲/乙岔口作废**（见 B-1 行）——乙会拆掉已交付的界面功能（出局），甲的内容改为「`app_config.py:207` 一处描述修正 ＋ `rag_config_file.py:141` 一处补全」；仍可搭车（对 3 的 ④ / 对 4），也可不搭。

**不排进上面顺序的两条**：`A-10`（追问建议无配置字段）是**上游的**（`suggestions_config.py` 与 merge-base 逐字节相同；上游 #5816 只加了授权、没加模型字段），登记不改，真要做走上游 PR；`A-9` 已闭合（见该条）——它原属那一对的 D9 / Task 7，2026-09-27 随 `3bf049cf` 落地，**两边不再需要同步改**；`G-1`（向量宽度可配）**不在"清理"范围内**——它是设计约束，真要做是一整套迁移工程，单独立项。

**已闭合**：`B-3`（2026-09-16 `8eed49b8`）、`A-9`（2026-09-27 `3bf049cf`）、`A-3`（2026-09-30 被 VLM 路线取代——写死项随 PaddleOCR 引擎整块退场，非改配置闭合），见各条。

**排期状态**：**「对 1」（`A-7` + `A-8`）已于 2026-09-29 交付**——[spec](superpowers/specs/2026-09-26-rag-wiki-synthesis-model-design.md) + [plan](superpowers/plans/2026-09-26-rag-wiki-synthesis-model.md)，plan **36／36**（Task 0–5 全部完成、真栈六条腿已过）、spec §6.1 **无待裁项**（①甲 ②两行分别并入既有「图谱抽取」「评测裁判」 ③乙 ④甲 ⑤甲，均在 2026-09-28／29 裁定并已落进文档）；实施提交 `7d517757`（后端）／`7ba229eb`（前端）／`9ffae7c3`（模板与文档），Task 4／5 的验收与回写另成一笔文档提交（均未推送）。**plan 复选框实数 36**（本文原写 34，按 §5 的「实施轮」更正）。**「对 2」（`A-2` + `A-3` + `A-6` + `A-5`）已于 2026-09-29 成对起草**（[spec](superpowers/specs/2026-09-29-rag-parse-knobs-design.md) + [plan](superpowers/plans/2026-09-29-rag-parse-knobs.md)：四项改法已裁定；**①② 均已裁＝乙** —— ① 服务地址复用既有 `parse_base_url`（含一条已登记的行为变化）、② 三个新控件进设置界面；**Task 0（只读核实）已完成（2026-09-29）**；**Task 1 已完成（2026-09-30 提交）**；**Task 2 已完成（2026-09-30 提交）**；**Task 3 已完成（2026-09-30 提交）**，**Task 4 已完成（2026-09-30 提交）**；**Task 5 交付回写完成 ⇒ 「对 2」已交付（2026-09-30）**——实施 `5bea5cfe`（T1 后端）／`80fe8c01`（T2 前端）／`d231e430`（T3 模板与文档）／`5dc512f1`（T4 真栈），plan **33／33**、真栈三腿两向已过、配置逐字节还原（**均未推送**）。**⚠ 2026-09-30 同日：A-3 被 VLM 路线取代、摘出本对 ⇒ 对 2 缩为 `A-2` + `A-6` + `A-5`（三项改法；② 变为两个新控件）**——见 A-3 行的取代注。**「对 3」（`A-4` + `C-3`）已于 2026-09-30 交付**（[spec](superpowers/specs/2026-09-30-rag-caption-params-asr-default-design.md) + [plan](superpowers/plans/2026-09-30-rag-caption-params-asr-default.md)：**四项已裁＝①甲 ②甲 ③甲 ④乙**；**Task 0–5 全部完成**）——实施 `46cfaf23`（Task 0 成对入库）／`7aa70c59`（T1 后端）／`e07802c6`（T3 模板与文档）／`b29ef532`（T4 真栈），plan **23／23**（Task 2 的 6 框为②甲留档）、真栈三次抓包两向已过、三份配置逐字节还原（**均未推送**）。**其余条目仍未排期**。要开工的话按项目惯例每一组单独起一对，别并进已交付的 2026-09-23 那一对；分组见 §4.2。

### 4.1 两个门：门 B（上游合并，未开）与两扇已开的门

**2026-09-26 补记**。触发：核 `99c926b7..upstream/main`（614 个提交）后发现，本档若干事项等的**不是同一个门**，此前混为一谈。**2026-09-28 修正**：核对 HEAD `47c35ca0` 时发现**门 A 早已交付**（那一对 plan 82/82，提交 2026-09-26 21:14 → 09-27 20:35）⇒ 原表把它列为"待开"是过期的；它已移入下面的「已开的门」，其解锁的四条与 `B-1` 选乙现在都无门。

| 门 | 触发条件 | 解锁 | 现在有排期吗 |
| --- | --- | --- | --- |
| **门 B** | 上游 `main` 合并进本分支 | 下表六项 | **无排期** |
| **已开的门 ①** | [2026-09-24 MinerU 那一对](superpowers/specs/2026-09-24-mineru-4x-parse-adaptation-design.md) —— Status ✅ **已交付** | `A-5` 的顺序约束**已满足**：`parse_backend` 已退役为 `parse_tier`（HEAD `app_config.py:219`、`parser.py:744`；`parse_backend` 只剩 `rag_config_file.py:56` 的退役键表与 `:53` 注释） | 已交付 |
| **已开的门 ②** | [2026-09-23 RAG 默认那一对](superpowers/specs/2026-09-23-default-model-design.md) —— **已交付**（2026-09-27，plan 82/82；`bfed5529` → `305f4fa2`） | `B-2` 剩余三处、`C-1`、`C-2`，`A-1` 的 `:189`/`:191`/`:157`（照 D10 **已落地**的「缺项即配置错误」形状抄：`knowledge/model_target.py` 的 `RagConfigurationError` + 保存期 400），以及 `B-1` 选乙（`_RETIRED_KEYS` 已可承载，不再撞车；**⚠ 该选项已于 2026-09-30 第六轮出局——见 B-1 行**） | 已交付 |

**因此现在就能起 spec/plan 的（无任何门，共 5 条）**：`A-1`、`C-1`、`C-2`，加上 `B-1`（描述修正，甲/乙岔口已作废）与 `B-2` 剩余载体。**唯一还开着的门是门 B**（上游合并，无排期），它解锁的是下面那六项。`B-3` **已闭合**（2026-09-16 `8eed49b8`）、`A-9` **已闭合**（2026-09-27 `3bf049cf`）、`A-7`／`A-8` **已闭合**（2026-09-29，「对 1」交付）、**`A-2`／`A-5`／`A-6` 已交付**（2026-09-30，「对 2」；见 §4.2）、**`A-4`／`C-3` 已交付**（2026-09-30，「对 3」；见 §4.2）、`A-3` **已被取代**（2026-09-30，VLM 路线；见其行取代注），均不属任何门。**不归本档排期的 1 条**：`A-10`（上游所有）。`G-1`–`G-9` 别动。分组见 §4.2。

**门 B 不由门 A 触发**：那一对落地之后，下表六项照样动不了——它们要检测的模块、要放行的哨兵、要抄的形状，在本分支 HEAD 里**一行都不存在**。证据：`config/managed_models.py`、`config/managed_model_providers.py`、`models/reasoning.py`、`config/knowledge_base_config.py`、`frontend/src/core/models/management.ts` 五个文件 `git cat-file -e HEAD:<path>` 全部不存在；`authorize_model_use`、`"not-required"`、`_managed_model_names` 三处 `git grep HEAD` 零命中。

下表六项**不编号、不进 §3 的计数**（「9 好 · 16 坏」与「本仓自己待修 **7 条**——16 减去已闭合/取代的 `B-3`／`A-9`／`A-7`／`A-8`／`A-3`，再减去已交付的 `A-2`／`A-5`／`A-6` 与属上游的 `A-10`」不变）；它们是门 B 打开时要重新判的**待办**，不是已判定的写死项。

| 门 B 事项 | 现在为什么改不了 | 门 B 后要做什么 |
| --- | --- | --- |
| 上游托管模型条目会**绕开** D10.1 的严格缺项检查 | 判据是 `is_ui_managed_model()`（`app_config.py:732-738`，`name in self._ui_model_names`）⇒ 只认我们的 `models_config.json`；托管条目不在里面，会落到 D10.2「厂商格不检查」那一档。而托管条目恰恰是 `provider: Literal["openai-compatible"]` + `base_url` + `api_key`，**正是严格检查针对的形状** | 把判据从「UI 来源」扩成「UI 来源**或**托管来源」，用上游的 `_managed_model_names` 私有属性 |
| `models[0]` 出现**第三个来源** | `merge_managed_models` 零命中 | 补 G-9：YAML 与 UI **都为空**时才轮到托管条目；并记「UI 名压过托管名」是合成顺序的副产物（上游的冲突判定 `yaml_names` 取自**已含 UI 条目**的 `config.models`），两边文档都没写 |
| 上游的 `"not-required"` 钥匙哨兵会**通过** D10.1 | 零命中 | 显式承认它算有效钥匙（本地 provider 无鉴权是合法形态），或加哨兵名单；别让检查声称能分辨真假钥匙 |
| `A-4` 有了更贴近的上游先例 | `models/reasoning.py` 零命中 | `A-4` 的改法照上游 `ReasoningEffortCapabilities.default`（「调用方不选时用条目声明的默认」）抄，别自造形状；本档现有的 `agents_config.py:194-203` 对照降为次选 |
| 上游对知识库配置块的**形状判断与我们不同** | `knowledge_base_config.py` 零命中 | 上游只有 `enabled` + `scope_selection_enabled`，docstring 明写「provider 连接与检索选项属于 tool 条目，不属于这个通用块」；我们整套 RAG 是一等配置域。门 B 后要重判 `rag.*` 与 `rag.default_model` 的归属 |
| 授权过滤与 RAG 后台任务的**不对称** | `authorize_model_use` 零命中 | `/api/models` 按 `model:list` 过滤，RAG worker 直接读 `config.models` 解析 `rag.default_model`、不经授权。索引属管理员域，大概率是对的，但要写成**有意**，否则会被当漏洞报 |

**顺带一条已生效的结论（不待门 B）**：上游 `app/gateway/authz.py:387` 的 `authorize_model_use` 把 `model_name is None → app_config.models[0].name` 在**授权路径**上又写了一遍（我方 10 处非文档 `models[0]`，上游 11 处）。这正是那一对「不改公共工厂」这次收窄换来的收益——若按旧的全局默认方案改 `factory.py` 的解析顺序，就会出现「授权查 A 模型、实际跑 B 模型」。详见 G-9。

### 4.2 spec/plan 分组（第四轮定 2026-09-26；第五轮 2026-09-28 更新"门"那一列）

本档整体**不需要**一份 spec/plan——它是登记档，不是待实现功能。要开工时按下面的分组各起一对：

| 对 | 条目 | 门 | 一句话范围 |
| --- | --- | --- | --- |
| **对 1** ✅ **已交付（2026-09-29）** | `A-7` + `A-8` | 无 | [spec](superpowers/specs/2026-09-26-rag-wiki-synthesis-model-design.md) + [plan](superpowers/plans/2026-09-26-rag-wiki-synthesis-model.md)：wiki 生成与考题合成各加一个模型条目字段，默认 `None`；**五项裁定全部落定**（①甲 ②两行分别并入既有「图谱抽取」「评测裁判」 ③乙 worker 腿惰性化 ④甲 接 `rag.default_model` ⑤甲 保存期检查扩到六个字段）。**已交付**：提交 `7d517757` 后端／`7ba229eb` 前端／`9ffae7c3` 模板与文档，真栈六条腿已过（Task 4／5 的验收与回写另成一笔文档提交、未推送） |
| **对 2** ✅ **已交付（2026-09-30）**；**同日缩为三项**（A-3 被 VLM 路线取代、摘出） | `A-2` + ~~`A-3`~~ + `A-6` + `A-5` | 无 | [spec](superpowers/specs/2026-09-29-rag-parse-knobs-design.md) + [plan](superpowers/plans/2026-09-29-rag-parse-knobs.md)：语种与**服务地址**／档位提成配置，**默认值不变**（**另有一条已登记的行为变化**：`parse_base_url` 的语义扩大，见 A-6 行与其 spec §6.2 首条）；**①② 均已裁＝乙**（① 服务地址**复用既有 `parse_base_url`**、② **两个**新控件进设置界面）；**⚠ A-3 已于 2026-09-30 被 VLM 路线取代、不随本对交付**（见 A-3 行的取代注）。**已交付**：实施 `5bea5cfe`（T1 后端）／`80fe8c01`（T2 前端）／`d231e430`（T3 模板与文档）／`5dc512f1`（T4 真栈），T5 交付回写为本批文档提交（**均未推送**）；plan **33／33**、真栈三腿两向已过、`config.yaml`／`rag_config.json` 逐字节还原 |
| **对 3** ✅ **已交付（2026-09-30）** | `A-4` + `C-3` | 无 | [spec](superpowers/specs/2026-09-30-rag-caption-params-asr-default-design.md) + [plan](superpowers/plans/2026-09-30-rag-caption-params-asr-default.md)：caption 的两个生成参数提成 `rag.caption_max_tokens` / `rag.caption_temperature`（默认 1024 / 0.15 不变）＋ `asr.py` 三处签名默认收掉（模型名单一来源）。**四项已裁＝①甲 ②甲 ③甲 ④乙**（② 甲 ⇒ 无文件层/无界面/无 golden、与多模态角色标题那一对零碰撞；④ 乙 ⇒ 不搭 `B-1`）。**已交付**：实施 `46cfaf23`（Task 0 成对入库）／`7aa70c59`（T1 后端）／`e07802c6`（T3 模板与文档）／`b29ef532`（T4 真栈），T5 交付回写为本批文档提交（**均未推送**）；plan **23／23**（Task 2 的 6 框为②甲留档）、真栈三次抓包两向已过（2048/0.15 → 1024/0.7 → 1024/0.15）、三份配置逐字节还原 |
| **对 4** | `B-2` 剩余 + `A-1` + `C-2` + `C-1`（+ `B-1` 描述修正，若搭车） | **无（门 A 已于 2026-09-27 交付，原先的"发布前收口"约束解除）** | 收口，四条都要碰那一对改过的文件／文案；现在是在**已交付的版本上**再改一次 |
| 门 B 之后 | §4.1 那六项 | 门 B | **无排期**，等上游 `main` 合并进本分支 |

`A-9`（已闭合）、`A-3`（已被 VLM 路线取代，2026-09-30）、`A-10`（上游）、`B-3`（已闭合）、`G-1`–`G-9`（别动）**不进任何一对**；`A-7`／`A-8` 已随「对 1」交付、**`A-2`／`A-5`／`A-6` 已随「对 2」交付**（均见 §4.2），也不再有待办。

---

## 5. 编号映射（五轮的增删与改判）

**第一版 → 第二版**：第一版按"克隆者受影响程度"分 🔴/🟡/🟢；第二版按 §1 的好/坏轴重排，**5 条换了档**：

| 前一版 | 第二版 | 移动原因 |
| --- | --- | --- |
| 🔴 R1（维度 1024） | **拆成 G-1 + B-1** | 固定宽度本身是**响的设计约束**（`backend/AGENTS.md` 称其 “a hard gate, not a default”）⇒ 好的写死；坏的是 `embedding_dimension` 那个**写着 override 却只有一个合法值**的假旋钮 |
| 🔴 R2（示例 + 字面默认） | **拆成 A-1 + C-2** | 代码侧字面默认是"替用户选厂商型号"⇒ 坏-A；示例文件形式对、内容个人化 ⇒ 坏-C（经 `config-upgrade` 那条路才升级成坏-A） |
| 🔴 R3（`SILICONFLOW_VLM_API_KEY`） | **B-2** | 从"克隆者会撞上"改判为"假旋钮"——它的危害正是"用户以为设好了" |
| 🔴 R4（MinerU 云） | **拆成 A-2 + A-6 + B-3** | 三件不同的事：语种写死（坏-A）、地址够不着（坏-A）、字段同形误导（坏-B） |
| 🔴 R5（中文文案） | **C-1** | 它不决定功能结果方向，坏在"同产品两种语言策略" |
| 🔴 R6（批次上限表） | **G-4** | **降档**：注释自证最坏只是多一次往返、不影响正确性 ⇒ 符合 §1.1 第 3 条，是好的保守缺省（只留一条"未来编辑风险"） |
| 🟡 Y1（ASR 默认 / `asr_provider` 两家） | **C-3 + G-5** | 有旋钮 ⇒ 只是双真值源（坏-C）；`Literal` 那部分是策展约束（好） |
| 🟡 Y2（`ocr.py` `lang="ch"`） | **A-3** | **升档**：决定结果方向 + 零配置通路 ⇒ 坏-A |
| 🟡 Y3（`_MAX_TOKENS` / `_TEMPERATURE`） | **A-4** | **升档**：静默截断 + 同仓 `agents_config.py` 已有反例 ⇒ 坏-A |
| 🟡 Y4（`ANTHROPIC_VERSION`） | **G-2** | 协议常量，注释自述不该是旋钮 |
| 🟡 Y5（`model_version="vlm"`） | **A-5** | **升档**：核到三层默认全无配置通路 ⇒ 坏-A（并保留"别拿本地精度表当证据"的更正） |
| 🟡 Y6（四份端点常量） | **G-3** | 有旋钮兜着 ⇒ 缺省值，好的写死（**第三轮已收窄为三份**，第四份 `eval/factory.py:19` 移入 A-9） |
| 🟢 G1（`CODEX_BASE_URL`） | **G-7** | 不变（上游所有） |
| —（前一版未列） | **G-6 / G-8 / A-1 的"中性 vs 厂商"判据** | 第二版补的边界：内部结构约定属好；用户自己填的值不算写死 |

**第二版 → 第三版**：第三轮追问「不选择指定的默认模型时各角色落到哪」⇒ 按角色枚举了全部 20 个用模型的角色（附录 §6），**新增 5 条、更正 1 条归类**：

| 第二版 | 第三版 | 原因 |
| --- | --- | --- |
| —（漏项） | **A-7 wiki 生成无字段** | 第二版按字面量 grep，扫不出"没有字面量、但也没有字段"的这一类（§1.2 第 2 形态） |
| —（漏项） | **A-8 题目合成无字段** | 同上；且 `backend/AGENTS.md` 早已把它登记为 open point，只是没进任何清单 |
| G-3 里的一项（`eval/factory.py:19`） | **移出 G-3，独立成 A-9** | **归类更正**：那个常量**没有旋钮**，只服务于 judge 的 `dashscope:` 支路；支路本身绕过 config 白名单直连一家厂商 ⇒ 坏-A。G-3 收窄为三份 |
| —（漏项） | **A-10 追问建议无配置字段** | 命中坏-A 第 2 形态，但核到**是上游自己的不对称**（merge-base 处 `SuggestionsConfig` 就没有 model 字段，而 `input_polish_config.py:9` 有）⇒ **登记不改** |
| —（未列） | **G-9 位置默认 `models[0]`** | 作为**对照基线**补入：它是上游机制、退到的是用户自己配置的第一条 ⇒ 好；但它是 §6 里 13 个角色的共同落点，不写清就无法解释 A-7/A-8/A-10 坏在哪 |
| A-5（只写了"无配置通路"） | **A-5 补一条同层对照** | 补上 `app_config.py:219-222` 的 `parse_tier`（四档 + 空 = 服务端定）：本地腿**有**字段且允许"交给服务决定"，云腿两者都没有 ⇒ 证明是漏做而非设计 |
| §1.2 判据 | **§1.2 补"够不着的两种形态" + 枚举方法** | 前一版的判据文字其实已经覆盖（"无配置通路"），但**枚举方法**只按字面量扫 ⇒ 把方法本身写进档，避免下一轮再漏 |

**补正轮（与 2026-09-23 那一对的 Task 9 对齐；由"B-2 与该 plan 对同一处给了不同处置"这个冲突触发）**：

| 原写法 | 改成 | 原因 |
| --- | --- | --- |
| B-2 建议「六处改成 `DASHSCOPE_API_KEY`」 | **按载体删行 / 删项，不改名**；三处说明与 `test_parser.py` 四处归 Task 9，其余三处说明与一处 live 门禁归 B-2、紧跟 Task 9 处理 | Task 9 退役的是 **RAG 专属环境变量回退**；模型条目仍可显式使用 `api_key: $任意名`，不能把退役误写成禁止环境变量，也不应把旧回退说明换成另一个厂商变量名 |
| B-2「全清单唯一可以立刻做的一条」 | **撤回**；"可以立刻做"改成 **B-1 / B-3**（⚠ 第四轮：`B-3` 已闭合、`B-1` 改法有岔口 ⇒ 以 §4 与 §5 第四轮表为准） | B-2 现在依赖 Task 9 落地，不再无依赖 |
| B-2 交叠行「无（那一对不动 `SECRET_ENV_VARS`）」 | **更正为"那一对的 Task 9 一并处理"**，并写全连带面（`rag_config_file.py:47` + 两处模块级 `VL_API_KEY_ENV` + 两处降级分支 + `routers/rag_config.py:176-177`）与"只删字典条目会 import 期 `KeyError`"的警告 | 与 spec `:235`、plan `:180`/GREEN ① 冲突；我那句是过期的（Task 8 确实不动 `SECRET_ENV_VARS`，但 Task 9 动） |
| A-1「`:193` 交给那一对」 | 精确到「`:194-196` 字段退役、`:193` 字段保留只删字面量默认」 | 与 spec D10 的"退役键数按载体分开数"口径对齐，别把 `vlm_model` 算进退役 |
| `test_parser.py` 的范围与 Task 9 文件清单冲突 | **归 Task 9，已同步 plan 与 B-2**：`:5` 更新说明，`:211` / `:237` / `:274` 删除无效 `setenv`，保留用例与有效断言，夹具按 Task 9 调整 | 避免同一文件分两批处理；这里只完成文档同步，尚未改测试代码 |
| —（新增） | B-2 的"文档自相矛盾"从一处扩成**两处**：补 `UPSTREAM_README.md` **同段之内**的矛盾（`:147-149` 说 caption VLM 继承条目的 endpoint 与 key，`:151-152` 又列 VLM 环境变量回退），并注明那里是**删一项不是删整行** | 核 `UPSTREAM_README.md` 归属时顺带读到的；处置粒度不同（那一行是四个变量的枚举，另三个仍生效） |

**第四轮（2026-09-26，复核轮）**：触发是「上游分支新增了模型配置，这个默认写死是不是也要改；范围能不能收成『对话模型交上游、RAG 功能模型自己管』」。核了 `99c926b7..upstream/main`（614 个提交）与 2026-09-23 那一对**收窄后的新版 spec/plan**，并按 HEAD `860dbf25` 重读引用行号 ⇒ **改判 1 条、更正 2 条、查出 1 个新缺陷、新增 §4.1 与 §4.2**：

| 前一版 | 第四轮 | 依据 |
| --- | --- | --- |
| `B-3` 是坏-B（假旋钮） | **改判：已闭合，登记不改** | 「没有任何提示说明第四个只管 local」是错的——界面标签「本地服务地址」+ 云侧 `LockedBox`「仅本地服务需要」+ 后端两处描述都以 "Local MinerU service address" 开头，三层都说了；闭合于 `8eed49b8`（2026-09-16），**早于本档成文** ⇒ 是当时没核界面，不是后来被修掉 |
| `B-1`「界面上是一个能填的框」「要同步改前端标签与 i18n 三处」 | **更正：该字段前端零暴露** | 全前端只有 `core/rag/types.ts:39` 一处 wire 类型；不在 `config-form.ts` 三个字段清单里、无 i18n key、无组件渲染 |
| `B-1` 只有"措辞"问题 | **新增一个真缺陷：一次无关的保存会把它删掉** | 它是 `RagConfigFile` 25 个字段里唯一不被 `buildRagConfigInput()` 带回的标量字段，而 PUT 是整对象替换 ⇒ 静默把「声明＝跳过探测」变回「探测」 |
| `B-1` 改法单一（改描述或改字段名） | **拆成甲／乙／丙，甲乙待裁** | 乙（从 `RagConfigFile` 退役该字段）要动 `_RETIRED_KEYS`，与那一对的 Task 8/9 撞车 ⇒ **改法决定它属哪个门** |
| `G-9`「归 2026-09-23 那一对」「是它要替换的机制」 | **更正：归上游；那一对明确不碰公共工厂** | 那一对已于 2026-09-26 收窄为 RAG 范围：spec `:21`（本期不做「公共工厂默认行为」）/`:204`（「不改变公共模型工厂的 `name=None` 行为」）/`:244`（`models/factory.py` 列入不改的生产文件） |
| §6.3 引「2026-09-23 spec `:187`/`:216` 的 b 方案」 | **更正行号为 `:151`（D10.2）** | 那份 spec 已被重写（295 → 287 行），旧行号指向别的内容 |
| 顺序表把 `A-5`/`B-3`/`B-1` 混在"立刻可做" | **新增 §4.1（门 A／门 B／已开的门）与 §4.2（分组）** | 上游六个模块在本分支 HEAD **零命中** ⇒ 它们等的是**上游合并**，不是那一对落地；两个门此前被混为一谈。另：MinerU 那一对**已交付** ⇒ `A-5` 的顺序约束早已满足 |
| §4「本档全部条目都还没有对应的 spec/plan 对」 | **补明确一句：本档整体不需要一份 spec/plan** | 它是登记档、不是待实现功能；要开工时按 §4.2 的分组**各起一对** |

**第五轮（2026-09-28）**：不对应"条目改判"，而是**状态更正** —— 门 A 已交付，而第四轮把它记成「暂不开工」。逐处：

| 更正前 | 更正后 | 原因 |
| --- | --- | --- |
| §4.1 门表把「门 A」列为待开（"有排期（plan 已就位，状态「暂不开工」）"） | **门 A 移入「已开的门 ②」**，与 MinerU 那一对并列；唯一未开的门是门 B | 那一对 plan **82/82 全勾**，提交 2026-09-26 21:14 → 09-27 20:35 已在 `git log` 里（`bfed5529` → `305f4fa2`） |
| §4「**门 A 之后（…不抢在它前面做）**」及其下 4 条 | 改为「**原「门 A 之后」的四条（2026-09-28 起不再等门）**」 | 门禁随交付解除；四条各自也不再重复劳动（`B-2` 的"三处说明"与 `test_parser.py` 已由 Task 9 做掉、`C-2` 的示例段已在交付版上、`C-1` 的文案载体已存在、`A-1` 要抄的形状已建立） |
| §4 第 9 条「`B-1`（仅当选乙）…与那一对的 Task 8/9 撞车」 | 「`B-1`（甲／乙均已无门）」，选乙改为独立一笔 | Task 8 已把 `_RETIRED_KEYS` 扩成"名字→原因表"并支持嵌套剥离，Task 9 已删字段并发布 |
| §4.1「因此现在就能起 spec/plan 的（无任何门，共 **8** 条）」＋「等门 A 的 **4** 条」 | 「共 **13** 条」；唯一未开的门是门 B | 8 ＋ 4 ＝ 12，再加 `B-1`（甲／乙都无门） |
| §4.1 门 B 表末「本仓自己待修 **14 条**」 | **13 条**（16 − `B-3` − `A-9` − `A-10`） | 与本文开头「一句话结论」同口径；第四轮那句漏了 `A-9` 已闭合 |
| `rag.default_model_name`（G-9、§4.1 门 B 表 ×2、§6 附录末段，共 4 处） | **`rag.default_model`** | 落地后的真名（`app_config.py:196`），helper 是 `knowledge/model_target.py` 的 `resolve_rag_model_name()` |
| §4.2「对 4」的门列写「门 A」 | 「无（门 A 已交付…）」 | 同上 |
| §4.2「对 1」只写"三项待裁未回" | 「**无待裁项**」——五项先后裁定：③乙、④甲（2026-09-28），①甲、②两行并入既有分组、⑤甲（2026-09-29） | 门 A 交付后这两个角色的兜底与生命周期出现新岔口；五项落定后同一张视图里的六个角色只有一套兜底、一套保存期检查 |
| §6 附录 §6.1 角色表两行（图谱抽取 / 评测 judge） | **本轮未改**，已在开头「⚠ 本轮未处理的同源过期处」登记 | 属第三轮快照；本轮只动 §4 / §4.1 / §4.2 与字段名 |

**实施轮（2026-09-29，「对 1」交付）**：登记实施中查出、与本档既有记述不符的事实（按 §5 惯例逐条列，不改写已交付的判定）：

| 与本档不符处 | 更正 | 原因 |
| --- | --- | --- |
| §4「排期状态」写「plan **34** 个复选框全未勾」 | 实数 **36**，本对交付时 **36／36** | Task 0 6 ＋ Task 1 8 ＋ Task 2 7 ＋ Task 3 3 ＋ Task 4 6 ＋ Task 5 5 |
| A-7「改法与破坏面」只列"加字段 ＋ 进 `rag_config.json` ＋ 设置界面选择器" | 两字段**必须同时进** `rag_config_file.py:74` 的共享空白归一 `MODEL_REFERENCE_FIELDS`（四 → 六） | 不进该元组，文件里的 `"wiki_model": "   "`（纯空白）不被归一成 `None`、会以"空白名字"活到运行期（`_prune_empty()` 只吃 `""`）；其 spec D1 与 plan Task 1 已按此实施 |

**第六轮（2026-09-30，账本重核）**：不对应"条目改判"，而是**登记行的状态更正**——用户侧聊拿一手事实推翻了 `B-1` / `G-1` 两行的转述。逐处：

| 更正前 | 更正后 | 原因 |
| --- | --- | --- |
| `B-1`「⚠ 第四轮更正：这个字段前端零暴露」 | **作废**：界面已有可编辑的维度行（`functional-models-view.tsx:1113` `data-slot="dimension-row"`，输入框绑 `values.embedding_dimension` ＋ 行内档位快选与状态点） | 2026-09-26 那一对给该行做了界面；第四轮那句是当时的事实、现已过时 |
| `B-1`「⚠ 第四轮新查出的缺陷：一次无关的保存会把它删掉」 | **已关闭**：`config-form.ts:197` 的 `NUMERIC_FIELDS` 把它带进每次保存的载荷（空输入＝撤销覆盖、wire 写 `null`） | 缺陷由 2026-09-26 那一对修复；本档第四轮登记的"另立一条"不再需要 |
| `B-1`「唯一合法值是 1024」（含 `embedder_factory.py:138-139` 拒别宽度的引用） | **不成立**：宽度可声明、改了触发一次迁移保存；`effective_dimension()`＝声明值或 1024；`DEFAULT_COLLECTION_DIMENSION` 只是默认 | 2026-09-26 那一对交付了「可配宽度 ＋ 新 generation ＋ 全库重建 ＋ 切换」整套迁移 |
| `B-1` 改法「甲：把 `rag_config_file` 补成'必须 1024'；乙：退役该字段」 | **甲/乙岔口作废**，收敛为「`app_config.py:207` 一处描述修正 ＋ `rag_config_file.py:141` 一处补全」；乙出局 | 甲的方向反了（陈旧的是 `app_config` 那句）；乙会拆掉一个已交付的界面功能 |
| `G-1`「不是清理，是迁移工程…本档不把它列进'该改'」 | **已落地**：宽度已是部署设置；`AGENTS.md` 的 "hard gate, not a default" 已被改写为「the model must return the width in force」；`COLLECTION_DIMENSION` 改名 `DEFAULT_COLLECTION_DIMENSION` | 同上：那一对把"将来单独立项"的那套做完了 |
| §4 第 9 条与 §4.2 对 3/对 4 的「`B-1` 甲/乙」 | 「`B-1` 描述修正（若搭车）」 | 与 B-1 行的更正同步 |


---

## 6. 附录：**不指定默认模型时**，20 个角色的实际落点

第三轮逐项核出来的基线表。读法：**"落点"列**是代码在"什么都没指定"时真正用的东西；**"有字段吗"列**回答"用户有没有表达位置"（§1.2 的第 2 形态就看这一列）；**"条目"列**指向本档对应项。

**机制**：`create_chat_model(name=None)` → `config.models[0].name`（`models/factory.py:298-299`，docstring `:273`）。`models[0]` 由 `models_config.py:191-212` 的 `merge_ui_models` 决定：config.yaml 条目原位保留、UI 条目同名替换否则**追加到末尾** ⇒ 只要 config.yaml 有模型，`models[0]` 恒为**它的第一条**（详见 G-9）。

### 6.1 聊天/推理侧（13 个角色，**零字面量**）

| 角色 | 未指定时的落点 | 有字段吗 | 条目 |
| --- | --- | --- | --- |
| 主对话 | 运行期 `model_name`（前端选的）→ 未选则 `models[0]` | 运行期参数 | G-9 |
| 摘要 | `summarization.model_name` → 未设则**用本轮自己的模型**；连本轮都没解析出来才 `models[0]`（`summarization_middleware.py:158-178`，docstring 明说"没有对 `config.models[0]` 的急依赖"） | 有（`summarization_config.py:29`） | G-9 |
| 记忆抽取 | `memory.model_name`（映射到 `backend_config.model.model`，`memory_config.py:26`/`:50`/`:187-188`）→ 未设则 `create_chat_model(name=None)`（`memory/manager.py:665-675`，docstring 自述 "host's default chat model"） | 有 | G-9 |
| 输入润色 | `input_polish.model_name`（`input_polish_config.py:9`）→ 未设 `models[0]`（`routers/input_polish.py:86-93` → `utils/oneshot_llm.py:55`） | 有（上游） | G-9 |
| 技能安全审核 | `skill_evolution.moderation_model_name`（`skill_evolution_config.py:11-14`，描述自述 "Defaults to the primary chat model"）→ 未设 `models[0]`（`skills/security_scanner.py:130`） | 有 | G-9 |
| 标题 | `title.model_name`（`title_config.py:25-28`，描述自述 “None = use local fallback title”）未设 ⇒ **根本不调模型**，走本地截断 `_fallback_title`（`title_middleware.py:205-207`） | 有 | 不落模型 |
| 目标评估 | `runtime/runs/worker.py:922` 传 **`record.model_name`**（本轮 run 的模型）⇒ **跟随本轮**，不退 `models[0]`（`runtime/goal.py:242-263`） | 无（有意跟随本轮） | 不落 `models[0]` |
| 子代理 | 子代理自己的 `model_name`（`subagents/executor.py:560`） | 有 | — |
| 图谱抽取 | `rag.extract_model`（`app_config.py:199`，描述自述 "None uses the first configured model"）→ 未设 `models[0]`（`knowledge/graph/extractor.py:117`） | 有 | G-9 |
| 评测 judge | `rag.judge_model`（`:200`）→ 未设 `models[0]`（`eval/factory.py:86`）；**另有 `dashscope:` 支路绕过 config 白名单** | 有 | **A-9** |
| **wiki 生成** | 裸 `create_chat_model()`（`knowledge/wiki/generator.py:209-213`，docstring “Wiki writing uses the main model (first configured)”；启动期 `app/gateway/app.py:351`，失败则整条自动生成关掉） | **✗ 无字段** | **A-7** |
| **题目合成** | 裸 `create_chat_model()`（`knowledge/eval/synthesis.py:139-143`，docstring 自述 “wiki-generator precedent”） | **✗ 无字段** | **A-8** |
| **追问建议** | **请求体** `body.model_name`（`routers/suggestions.py:134-140`）→ 不传则 `models[0]` | **✗ 无配置字段**（`SuggestionsConfig` 只有 `enabled`/`max_suggestions`） | **A-10** |

### 6.2 RAG 功能侧（7 个角色，**4 个落字面量厂商型号**）

| 角色 | 未指定时的落点 | 有字段吗 | 条目 |
| --- | --- | --- | --- |
| 嵌入 | `rag.embedding_model` = **字面量 `"qwen3.7-text-embedding"`**（`app_config.py:189`） | 有字段，但**默认值是厂商型号** | **A-1** |
| 重排 | `rag.rerank_model` = **字面量 `"qwen3-rerank"`**（`:191`） | 同上 | **A-1** |
| 图片说明 VLM | `rag.vlm_model` 的三个字面量（型号 `"qwen3.7-flash"` + `vlm_base_url` 的 DashScope 地址 + `vlm_api_key_env` 的 `"DASHSCOPE_API_KEY"`）**已于 2026-09-27 随 `3bf049cf`＋Task 9 退役**：字段全删、`vlm_model` 改为条目名，字面量默认与端点／环境兜底都不存在 | 同上 | **A-1**（已闭合） |
| 视频 ASR | `rag.video.asr_model` = **字面量 `"paraformer-zh"`**（`:157`；另 `video/asr.py:89`/`:177` 还有两份签名默认） | 有字段 + 有 UI（`rag_config_file.py:63`），但默认是厂商型号 | **A-1 + C-3** |
| 视频镜头说明 | `rag.video.caption_model` 默认 `""` ⇒ **复用 `rag.vlm_model`**（`:158`）⇒ 继承上一行的三个字面量 | 有字段 | 继承 A-1 |
| 文档解析（云） | `model_version="vlm"` 三层签名默认（`parser.py:686`/`:722`/`:756`），**无配置通路**；对照：本地腿有 `rag.parse_tier`（`app_config.py:219-222`，四档，None = 让服务决定） | **✗ 无字段** | **A-5** |
| 稀疏 | `rag.sparse_model` 默认 `None`（`:213`）；外部稀疏服务的请求体本来就不发 model 名 | 有字段 | 无字面量（不落此问题） |

### 6.3 一句话对照

**同一个"没指定"状态，两种语义**：13 个角色退到**用户自己配置的第一条模型**（或本轮模型、或干脆不用模型）；4 个角色退到**某个人的厂商型号字面量**。前者是位置语义（G-9 的缺点，**归上游**：2026-09-23 那一对已于 2026-09-26 收窄为 RAG 范围、2026-09-27 交付，明写不改 `models/factory.py`，只在这 13 个角色里的 4 个 RAG 角色上面加一层 `rag.default_model`），后者是别人的选择（A-1，归本档）。**「走库默认」（读 SDK 自己的端点常量）目前代码里一处都没有**——它只作为 2026-09-23 spec `:151`（D10.2）的 b 方案待实现（仅对 UI `deepseek` 缺地址时惰性读 `langchain_deepseek.chat_models.DEFAULT_API_BASE`）。

---

**相关记录**：[2026-09-23-default-model-design.md](superpowers/specs/2026-09-23-default-model-design.md)（默认模型与功能模型缺项收口：与本档 **A-1 / A-9 / B-2 / C-1 / C-2 / G-9** 有交叠——A-9 **已**由它的 D9 / Task 7 处理（`3bf049cf` 闭合）、B-2 的三处说明由它的 Task 9 按载体删行 / 删项且 `test_parser.py` 四处也归 Task 9、G-9 **不是**它要替换的机制——2026-09-26 收窄后 spec `:21`/`:204`/`:244` 明写不改 `models/factory.py`，G-9 保留为最后一层兜底、位置默认的替换归上游，见 §4.1 门 B）· [2026-09-24-mineru-4x-parse-adaptation-design.md](superpowers/specs/2026-09-24-mineru-4x-parse-adaptation-design.md)（**本地腿** `parse_backend` → `parse_tier`；其 spec `:208` **点名本档**有 4 处 `parse_backend` 引用，**已于 2026-09-24 同步改名**，其 `:65`「`mineru-cloud` 零改动」证明 **A-2 / A-5 / A-6 不在它范围内**）· [2026-09-14-rag-model-provider-adaptation-design.md](superpowers/specs/2026-09-14-rag-model-provider-adaptation-design.md)（§3.6 三档后端精度表，A-5 引用它并说明为何不能直接对比）· [2026-09-26-rag-wiki-synthesis-model-design.md](superpowers/specs/2026-09-26-rag-wiki-synthesis-model-design.md)（**本档 §4.2「对 1」＝ A-7 + A-8**，2026-09-26 成对起草，**2026-09-29 已交付**；其 spec §5.2 记了与门 A 那一对的**文件碰撞面**——12 个同文件（`app_config.py` / `rag_config_file.py` / `core/rag/types.ts` / `config-form.ts` / `functional-models-view.tsx` / 三个 locale / `response_golden.json` / `test_rag_config_api.py` / `rag_config.example.json` / `config.example.yaml`），**全是加法、无语义冲突**；那一对**已于 2026-09-27 交付**，所以本对是"在它之上加两行"，「先落地」的措辞已作废 —— 改法与随之更正的三处事实（门 A 已交付、字段真名、golden 键数）见其 spec §5.2 与 §6.1；**同日又裁定"一并接 `rag.default_model`"（甲）**，并新开 ⑤）· [MODEL_PATCH_INVENTORY.md](MODEL_PATCH_INVENTORY.md)（模型层补丁盘点，同一套归属核对方法）
