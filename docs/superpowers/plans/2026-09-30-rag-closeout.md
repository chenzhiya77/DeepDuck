# 收口四条 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-09-30-rag-closeout-design.md](../specs/2026-09-30-rag-closeout-design.md)
**Status:** **2026-09-30 起草，待开工。五项待裁**（spec §6.1：① A-1 收口形状；② C-1 语言策略；③ C-2 占位与形态；④ `B-1` 搭不搭车；⑤ `config_version` 升不升）。**本计划按推荐组合起草（①甲 ②乙 ③甲 ④甲 ⑤乙），每个受裁项影响的步骤都标了另一分支的落点**；裁完只动被裁的那几行。**未实现任何生产代码、未提交**；起草轮的核实全部只读。**同日起草后审查（7 条）已就地修正 5 条**：① 基线在 HEAD `75f3a186` 复核（他线两笔全前端、零后端重叠）；③ C-2 补 `config.example.yaml` 的 `video.asr_model` 一行；④ C-1 起点句标注"账本口径、已漂移"；⑤ A-1 前端零改动结论进 spec §6.2；⑥ ASR 收口点定为 **worker 的 ASR 腿入口**。**审查 ②（C-1 家族内已英文成员的处置）按用户「先落 ①③④⑤⑥」暂留待裁**。
**相关基线:** [盘点档](../../PRE_RELEASE_HARDCODE_INVENTORY.md) §4.2「对 4」＝本对（`B-2` 剩余 + `A-1` + `C-2` + `C-1`；`B-1` 可搭车）；`knowledge/model_target.py`（D10 的 `RagConfigurationError` 形状先例）；[对 3 计划](2026-09-30-rag-caption-params-asr-default.md)（同文件、刚交付）。

**Architecture:** `config.yaml → RagConfig`（三字段 `str | None = None`）＋ **单一构建点收口**（`build_embedder` / `build_reranker` / **worker 的 ASR 腿入口** ⇒ `RagConfigurationError`，保存期自动 400）；文案改动只动字符串（语言策略见 ②）；示例只动值/注释形态。**本对唯一行为变化＝未声明模型名的部署从"静默用厂商默认"变"响亮报错"**（spec D1/§6.2）。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| A-1 | `embedding_model` / `rerank_model` / `video.asr_model` 三处去默认 ＋ 缺项收口 | 动默认值（已无默认）；动 `models[0]` 位置默认；探针化 |
| C-1 | 配置类错误文案语言统一（清单 Task 0 冻结）＋ 6 行断言同批 | 后端 i18n 框架；界面侧 i18n；`vlm_target.py` 的「文档图片配文：」前缀（登记不改） |
| C-2 | 两示例文件换中性占位（③ 甲：`config.example.yaml` 两行改注释） | 改键集/结构；动真实配置 |
| B-2 | 四载体删行/删项（Task 9 先例） | 改名；动轮次快照文档 |
| ④ ✅ 按推荐＝搭车 | `app_config.py:209` ＋ `rag_config_file.py:141` 两处描述（④ 乙则整段移出） | 动迁移机制/界面/golden |
| ⑤ ✅ 按推荐＝不升版 | 示例注释变化、`config_version` 保持 **42**（⑤ 甲则 ＋ chart 两件同升 43） | —— |

**待裁：五项**（spec §6.1）。全文按 **①甲 ②乙 ③甲 ④甲 ⑤乙** 起草；② 的甲/丙分支落点：Task 2 的文案表与断言改动量；③ 的乙分支落点：Task 3 的两行"注释 vs 活跃"；④ 乙分支：删 Task 3 的描述段；⑤ 甲分支：Task 3 的版本同批。

## 硬约束

- **A-1 是本对唯一行为变化**：收口必须**响亮且可操作**（文案含缺哪个字段、去哪填）；不许"静默回退到某个内置型号"。
- **只动"值从哪来"与文案**：`models[0]` 位置默认、公共工厂、`providers/__init__.py` 既有英文报错、维度迁移机制、界面 i18n **一行不动**。
- **C-1 清单不扩大**：以 Task 0 冻结的清单为准；账本未列的字符串（如 `vlm_target.py` 的角色前缀）留作登记不改。
- **不新增机制**：收口用现成的 `RagConfigurationError` ＋ 保存期映射；不造新错误类型、不造探针。
- **共享组件（`app_config.py`）改完必须跑全量**；示例/模板改动跑模板契约用例 ＋ 示例读取面。

## 执行纪律

- 当前分支 `feat/rag-knowledge-base`。实施按 **RED → GREEN → neuter（行为还原并记录受害者）→ revert proof → 门禁** 执行；提交／推送按届时明确授权，使用 Conventional Commits。
- 后端在 `backend/` 用 `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest <path> --basetemp=.pytest-tmp`（本机 `Temp\pytest-of-h7242` 拒访——环境条件；跑完删 `.pytest-tmp`）；ruff 用 `uv run --no-sync ruff check` 与 `uv run --no-sync ruff format --check`。
- **A-1 的 RED 要钉"响亮"**：断言错误类型（`RagConfigurationError`）、断言文案含字段名、断言保存期 400；负向对照＝声明后逐字节照旧。
- 真栈只允许临时改 **RAG 配置**；`config.yaml` / `rag_config.json` / `models_config.json` 先存档字节/md5，结束逐字节还原；只清理本次创建且可确定 ID 的资源。
- **找会被影响的既有断言按关键词子串 ＋ 界面词汇两把扫**（`qwen3.7-text-embedding` / `qwen3-rerank` / `paraformer-zh` / `deepseek-v4-flash` / 文案片段）。

**依赖顺序**：Task 0（只读核实）→ Task 1（A-1）→ Task 2（C-1）→ Task 3（C-2 ＋ 文档 ＋ B-1）→ Task 4（B-2 载体）→ Task 5（真栈）→ Task 6（回写）。**与多模态角色标题那一对的串行（spec §5.2）**：它正编辑 `README.md`（Task 4 要改 `README.md:221`）⇒ **Task 4 必须排在它落地之后**；其余 Task 与它零碰撞。

---

## Task 0 — 只读核实与清单冻结

- [x] **A-1 消费点全表（起草期已核，此处复核并冻结）**：`embedder.py:167` / `embedder_ark.py:69` / `embedder_openai.py:91` 的兜底分支（删默认后它们会拿到 `None`——逐处定"收口点在哪、兜底分支留不留"）、`embedder_factory.py:178-179`、`reranker.py:63`、`reranker_generic.py:63`、`worker.py:607`；产出**收口点清单**（几处、各在哪个函数）。
- [x] **A-1 的既有断言扫描**：按 `qwen3.7-text-embedding` / `qwen3-rerank` / `paraformer-zh` 扫 `backend/tests` 与 `frontend/tests`，逐条记录"会不会被删默认影响"（已知候选：`test_rag_config.py` 的 `test_loads_defaults`、`test_rag_config_file.py`、video 侧用例）。
- [x] **C-1 文案清单冻结**：逐处枚举（`embedder_factory.py` 的维度/稀疏半缺族、`rag_config.py` 的「提交后的配置仍不可用：…」族与两个探针 `detail`），产出**逐条清单**（文件:符号 × 现文案 × 新文案）；同时列出**受影响的 6 行断言**（4 个测试文件，标出 2 处逐字全文常量）。
- [x] **C-2 现状取样**：两示例文件的厂商型号逐处（`rag_config.example.json` 4 处、`config.example.yaml` **活跃 3**（embedding / rerank / **video.asr_model**）＋ 注释 4）；核 `embedding_base_url` 的"required"注释先例句（Task 3 照抄句式）。
- [x] **B-2 四载体复核**：`.env.example:44` / `README.md:221` / `UPSTREAM_README.md:152` / `test_e2e_smoke.py:53` 逐处记录现状行与删法（删行 vs 删项 vs 删名）。
- [x] **B-1 两处复核**（④ 甲时）：`app_config.py:209` / `rag_config_file.py:141` 现状逐字；核"测试不钉这两段文字"（`grep "Must be 1024"` / `grep "Dense dimension override"` 全仓零命中）。
- [x] **碰撞面**：核多模态角色标题那一对是否已落地（`README.md` 的 diff 是否还在树上、其 spec/plan 状态）；落地后重扫它的 `README.md` 改动面（只这一步）。
- [x] ~~**（⑤ 甲时）版本基线**：`config.example.yaml` / chart 两件的 `config_version` 现值（42）与 `check_config_version.sh` 的现状。~~ **⑤＝乙 ⇒ 不适用**（不升版）。

**实测（2026-09-30，HEAD `75f3a186`；全部只读）**：

- **A-1 收口点清单（冻结，3 处）**：① `embedder_factory.py::build_embedder`（`rag.embedding_base_url` 拒绝之后，照 :176 同款句式）；② `reranker_factory.py::build_reranker`（:38 的 base_url 拒绝之后；**条件陷阱：`spec.takes_model` 为假时（TEI）不得要求 `rerank_model`**——现有代码正是按该开关条件传参的）；③ `worker.py` 的 ASR 腿入口（`transcribe_video` 调用之前；**该 try 只捕 `AsrError`** ⇒ `RagConfigurationError` 会穿透、响亮失败，正合 A-1 目的）。
- **A-1 消费点复核（7 处）**：三个嵌入适配器在 `model is None` 时**回读 `get_app_config().rag.embedding_model`**（`embedder.py:165-167`／`embedder_ark.py:67-69`／`embedder_openai.py:89-91`）——即"只删默认不配收口"会让 `None` 一路进 `self._model`（静默坏）；另 `embedder_factory.py:178-179`（`if rag.embedding_model:`）、`reranker.py:60-63`（同款回读）、`reranker_factory.py:53-55`（无条件传 `section.rerank_model`）、`worker.py:607`。**兜底分支处置**：适配器的 `model is None` 回读分支**保留**（它们是适配器自己的 API、直接调用方仍可用；收口保证工厂路径不再送 `None`）。
- **A-1 断言扫描（12 文件命中；受害者 5 条）**：`test_rag_config.py` 的 `test_loads_defaults`（`:15`/`:16`）、`TestAppConfigRagSection::test_rag_section_has_defaults`（`:146`/`:147`）、`::test_rag_section_overridable_from_dict`（`:168` 的"Untouched fields keep their defaults"）、`TestRagVideoConfig`（`:201`，`asr_model == "paraformer-zh"`）＋ `test_embedder_ark.py:270`；其余命中皆**显式传参/夹具**（不受影响）。
- **C-1 清单冻结（配置类错误文案）**：**中文 13 处**——`embedder_factory.py` `:44`（`_REBUILD_HINT`）／`:66`（维度不符，经 `:93` 抛）／`:151`（稠密-only）／`:176`（缺 base_url）／`:211`（缺 sparse_provider）；`model_target.py` `:54`（缺 key）／`:59`（缺地址）／`:129`（无可用模型）；`parse_local.py` `:139`／`:141`；`sparse.py:111`；`asr.py:202`；`rag_config.py` `:401`/`:404`/`:435`/`:483`/`:495`（「提交后的配置仍不可用：…」）／`:598`（`_SPARSE_ALTERNATIVES`）／`:715`/`:738`/`:744`（探针 detail）。**英文 5 处**（＝审查 ② 待裁的对象）——`reranker_factory.py:38-40`、`model_target.py:43-50`（`Model … not found in config`）、`providers/__init__.py:215/222/225`、`rag_config.py:262`、`:709`。**受影响断言＝3 文件**：`test_rag_configuration_error.py:18`（逐字常量）；`test_rag_config_api.py` `:480`/`:1036`/`:1169`/`:1193`（`startswith`）＋ `:527`/`:560`/`:569`/`:581`（逐字等值、尾巴英文）；`test_rag_config_save_probe.py:67`（逐字常量）＋ `:179`（等值）。
- **C-2 取样**：`rag_config.example.json` 4 处（embedding / rerank / extract / asr_model）；`config.example.yaml` 活跃 3（`:2574`/`:2576`/`:2681`）＋ 注释 4（`:2581`/`:2589`/`:2592`/`:2596`）；先例句＝`# embedding_base_url:                  # endpoint; required (no provider fallback)`（Task 3 照抄句式）。
- **B-2 四载体**：`.env.example:44`（整行注释）／`README.md:221`（`export … # 图片说明`）／`UPSTREAM_README.md:152`（句子列举里点名）／`test_e2e_smoke.py:53`（live 门禁清单项）。
- **B-1 两处**：`app_config.py:209`（"Must be 1024…" 尾句）／`rag_config_file.py:141`（未写全）；**测试零钉**（`grep "Must be 1024\|Dense dimension override"` 在 `backend/tests` ＋ `frontend/{src,tests}` **零命中**）✅。
- **碰撞面**：多模态角色标题那一对的两份文档**已落地**（其 plan 已入库、HEAD `75f3a186`）；**`README.md` 仍带 4 行未提交的在飞改动**（intro 重写，非本对）⇒ **Task 4 待其落地**（B-2 的 `README.md:221` 未被该 diff 触及，但同文件不得混改）。
- **（⑤ 甲时）版本基线**：不适用（⑤＝乙，不升版）。

---

## Task 1 — 后端 A-1：三处去默认 ＋ 缺项收口

> 文件：`config/app_config.py`、`knowledge/embedder_factory.py`、`knowledge/reranker.py`（或对应构建点）、**worker 的 ASR 腿入口**（`knowledge/worker.py`：`cfg.asr_model is None` ⇒ 拒绝；`transcribe_video(model=…)` 经对 3 已是必填 `str`，把 `None` 传进去只会在 provider 内部炸）、`backend/tests/…`。
> **验收对应**：spec §4 的 1。

- [ ] **RED：加载链与收口**：三字段各自一条——`RagConfig()` 不再有字面默认（`is None`）；`build_embedder` / `build_reranker` / **worker 的 ASR 腿入口**在缺项时抛 `RagConfigurationError`、**文案含字段名**；负向对照＝声明后构建照常（与今天的构造参数逐字相同）。
- [ ] **RED：保存期 400**：PUT 一条缺 `embedding_model` 的配置 ⇒ 400 且 detail 是新文案（走既有 `RagConfigurationError` 映射）。
- [ ] **GREEN**：三字段改 `str | None = None`；收口落在 Task 0 冻结的收口点（一处一份文案，照 `model_target.py` 的句式）；兜底分支按 Task 0 结论处置（删或留，留则注释说明为何不可达）。
- [ ] **neuter：整体还原旧行为**，逐项独立还原并证明 GREEN 恢复、各有对应用例转红：① 三字段默认放回；② 收口点去掉 ⇒ 缺项用例转红。
- [ ] **门禁**：ruff 双净；窄面（配置链 ＋ 三条腿的构建用例）绿；`app_config.py` 是共享加载路径 ⇒ **跑后端全量**（后台执行，结果未回不回绿），与基线集合对照零新增。

**实测（待回填）**：

---

## Task 2 — 后端 C-1：配置类文案统一（② 乙：中英双语）

> 文件：`knowledge/embedder_factory.py`、`app/gateway/routers/rag_config.py`、受影响的 4 个测试文件。**清单以 Task 0 冻结为准，不扩大**。
> **验收对应**：spec §4 的 2。

- [ ] **RED：文案形状**：清单逐条一条用例（② 乙：断言"中文半边 ＋ `/` ＋ 英文半边"的形状；② 甲：断言全英文；② 丙：断言返回 code）——先写 1–2 条代表性的，全量在 GREEN 同批。
- [ ] **RED：既有断言同批**：把 Task 0 列出的 6 行断言改成新文案（**逐字全文常量 2 处**），改前逐处记录"原文 → 新文"。
- [ ] **GREEN**：清单逐条改毕；`providers/__init__.py` 的英文报错**不动**（② 乙下英文半边与之一致）；`vlm_target.py` 的角色前缀**不动**（登记不改）。
- [ ] **neuter**：① 把一条文案还原成旧中文 ⇒ 对应用例转红；② 把 400 的 detail 还原 ⇒ 保存期用例转红。
- [ ] **门禁**：ruff 双净；窄面（`test_rag_configuration_error.py` / `test_rag_config_api.py` / `test_rag_config_save_probe.py` ＋ 探针用例）绿；全量与基线集合对照零新增（与 Task 1 的全量可合并跑）。

**实测（待回填）**：

---

## Task 3 — 示例 C-2 ＋ 文档 ＋（④ 甲时）B-1 两处描述

> 文件：`rag_config.example.json`、`config.example.yaml`、（⑤ 甲时）`deploy/helm/deer-flow/values.yaml` ＋ `README.md`、`backend/AGENTS.md`、（④ 甲时）`config/app_config.py` ＋ `config/rag_config_file.py`。
> **验收对应**：spec §4 的 3 / 5。

- [ ] **RED：示例契约**：模板契约用例扩——两文件 grep 零厂商型号（`qwen3.7-text-embedding` / `qwen3-rerank` / `deepseek-v4-flash` / `qwen3-vl-plus`）；`rag_config.example.json` 仍过 `RagConfigFile.model_validate`；（③ 甲时）`config.example.yaml` 的 embedding/rerank 两行**不活跃**（照 `embedding_base_url` 先例）；（⑤ 甲时）版本底线 42 → 43。
- [ ] **GREEN**：占位按 ③ 的裁定（甲：`your-embedding-model` / `your-rerank-model` / `your-extract-model` / `your-asr-model` 语义化家族；乙：统一 `<your-model-name>`）；`backend/AGENTS.md` 三处句（A-1 收口、C-1 语言、C-2 占位）；（④ 甲时）两处描述照 spec D5 表；（⑤ 甲时）版本同批。
- [ ] **neuter**：① 把一处占位还原成厂商型号 ⇒ grep 用例转红；② （④ 甲时）把一处描述还原 ⇒ 若无用例则记"零用例风险已核"（spec §6.1 ④ 的已知代价）；（⑤ 甲时）版本回 42 ⇒ 底线用例转红。
- [ ] **门禁**：模板契约用例绿；示例读取面绿；（⑤ 甲时）`bash scripts/check_config_version.sh` OK；grep 复核两文件零厂商型号。

**实测（待回填）**：

---

## Task 4 — B-2 四载体（**前置：多模态角色标题那一对已落地**）

> 文件：`.env.example`、`README.md`、`UPSTREAM_README.md`、`backend/tests/knowledge/test_e2e_smoke.py`。
> **验收对应**：spec §4 的 4。

- [ ] **RED：载体守卫**：一条守卫用例——四载体 grep `SILICONFLOW_VLM_API_KEY` 零命中（历史/轮次快照文档排除在外，白名单按 Task 0 的结论）。
- [ ] **GREEN**：四处按 D4 表删行/删项/删名；**不改名**（Task 9 先例）。
- [ ] **neuter**：把 `.env.example` 那行放回 ⇒ 守卫用例转红。
- [ ] **门禁**：守卫用例绿；live 门禁文件仍可收集（`test_e2e_smoke.py` 不因删项而 import 失败）；grep 复核四载体零命中。

**实测（待回填）**：

---

## Task 5 — 真栈：A-1 缺项硬报错 ＋ C-1 新文案现场

> 前提：服务运行且已加载本对代码；`config.yaml` / `rag_config.json` / `models_config.json` 先存档字节/md5，结束逐字节还原。
> **验收对应**：spec §4 的 7。

- [ ] **腿一（A-1 硬报错）**：临时把 `rag.embedding_model` 行注释掉 ⇒ 触发一次构建/保存路径（如 `POST /api/rag/config` 的保存期检查或一次入库）⇒ 拿到 **`RagConfigurationError` 的新文案**（保存期则 400，detail 可读、含字段名）。
- [ ] **腿二（C-1 文案现场）**：同一响应里核对 C-1 改过的文案形状（② 乙：双语；② 甲：英文）——这是"文案真的到达用户"的唯一真栈证据（前端原样渲染 `detail`）。
- [ ] **还原**：三份配置逐字节还原（md5 一致）；只清理本次创建且可确定 ID 的资源（若有）。
- [ ] **B-2 / C-2**：无真栈面（文档/示例），在实测里注明。

**实测（待回填）**：

---

## Task 6 — 交付回写

- [ ] **spec／plan Status** 改为已交付，记录 ①②③④⑤ 的裁定；**把 A-1 的行为变化与逃逸路径写进交付纪要**（未声明模型名的部署升级后会硬报错——在 `config.yaml` 的 `rag:` 段声明即可）；逐 Task 的「实测」补齐。
- [ ] **盘点档**：`A-1` / `C-1` / `C-2` / `B-2` 标已交付并指向本对；（④ 甲时）`B-1` 标已交付；§4 可做清单与 §4.1「共 5 条」随之调整（**本仓自己待修归零**）；计数句同批（坏写死现存 6 → 2？——按各条归属重数，别照抄）。
- [ ] 提交按届时授权，Conventional Commits；不推送除非明确要求。

**实测（待回填）**：
