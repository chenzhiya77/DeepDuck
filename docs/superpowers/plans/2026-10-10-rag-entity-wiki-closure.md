# 实体↔wiki 收口（两格） —— 实施计划

## 范围与交接

一对一件事＝两格一起做：①`graph_search` 加 `entity` 直参（wiki→实体→按键跳；`query` 变可选）②新增 `list_wiki_entries`（模型面枚举；注册面随批）。成对 spec 同名（`../specs/2026-10-10-rag-entity-wiki-closure-design.md`），决策点 D1–D7 见 spec §3（**已裁全甲**：①单实体 `entity`／②如实空态／③主键 getter／④只列生成条目／⑤全量＋计数／⑥新独立工具／⑦docstring＋SOUL 同批）。**树归属**：主树 `feat/rag-knowledge-base` 独有——切片无实体/wiki 模块与 wiki/graph 工具，**不随带**、切片 example 零落点。**不碰**：三路检索链本体（召回/重排/扩张/引用编号）、wiki 生成与脏标记、图谱抽取/合并、注入面、前端、recall-test 投影。TDD 必做（backend/AGENTS.md）；提交信息英文 conventional；只 stage 本线文件。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测＝`$(RUN) pytest tests/knowledge/… -q`（basetemp 用仓外隔离目录、跑完删）；门禁＝`ruff check`／`ruff format --check` 双净；**工具属共享面 ⇒ 加跑全量**（后台，约 15–23 分，落盘日志）。
- **薄壳口径**：① 直取复用现有 seed/扩张链、零查询改动（D3 甲 例外：store 一行 `get_entity` getter）；② 只读 `list_entries`（零查询改动）。
- **注册面三件（新工具特有）**：`builtins/__init__` 导出＋`config.example.yaml` 条目＋装配钉句扩一行（`test_rag_agent_assembly.py` 两个装配用例各扩一条 pin：在 rag 组、不在默认组）。
- **配置面（本批唯一例外，明示）**：t6 实例配置与仓内 gitignored `config.yaml` 各补一条启用条目（同 doc-tools 先例；随证据/回填记档）。
- **SOUL 句改同批**：docstring 与 SOUL 半句同批落；句改前扫 `test_rag_agent_assembly.py` 钉句族（`:58-:71`）。
- **门控一致**：①② 三分支（未绑定/无权限/跨库）文案与三路检索同款。
- 真栈仅测试库；临时件收尾删净；`rag_config.json` 零改动。

## Task 0 — 落点核实

> 动到的文件：只读核实＋spec/plan 回填（本对文档）

- [ ] ① 实读行复核（`graph_search_tool.py:175` impl／短路缝 `:211-245`（抽取/回退/空态/查询嵌入/匹配/未命中空态）／`:257-266` 扩张入参（`query_vector=query_dense` 双用尺）／`:332` trace／`:395-396` @tool 两参）；② `wiki_store.list_entries`（`wiki/store.py:91-97`）＋`list_knowledge_documents` 消息/空态先例复核；注册面三件（`builtins/__init__` 导入＋`__all__`、`config.example.yaml:697-708/712-718`、装配钉句 `:74-79` 与默认组排除用例 `:82-87`）＋仓内 `config.yaml:70-83` 启用面；③ `graph/store.py:29-30` `_entity_id`＋`:107-111` `list_entities`；④ 受害者扫描：`test_graph_search.py` 逐用例（query 路不破）／`test_rag_agent_assembly.py` 两装配用例＋钉句族／`test_wiki_search*.py`（不受影响——本批不动 wiki_search）／example 外部消费者（`test_local_registration_gate`、`test_config_version`、`test_doctor` 等——终审已扫零钉工具名，执行期复核）；⑤ D1–D7 裁定值回填本文件与 spec §3。

**Task 0 复核结果（待执行期填）**：…

## Task 1 — ① `graph_search` 加 `entity` 直参（TDD）

> 动到的文件：`backend/packages/harness/deerflow/tools/builtins/graph_search_tool.py`＋（D3 甲）`knowledge/graph/store.py`＋对应测试

- [ ] RED：entity 命中（种子＝该实体、跳抽取与匹配、扩张/引用正常）／未命中如实空态／两者皆缺引导／门控三分支／（D3 甲）getter 主键查；GREEN：impl 加 keyword 参数＋直取短路（`entity_scores={entity: 1.0}` 汇入扩张；下游打分尺＝嵌入实体名一次、零 LLM）＋`query` 变可选＋docstring Args 行（按 D7 句）；neuter 一次（去直取恰红后还原）。
- [ ] 门禁：knowledge 面定向（`tests/knowledge/tools/`）。

**实测（待执行期填）**：…

## Task 2 — ② 新增 `list_wiki_entries`（TDD）

> 动到的文件：新 `tools/builtins/wiki_entries_tool.py`（名待定，按 D6）＋`builtins/__init__.py`＋`config.example.yaml`＋对应测试＋`test_rag_agent_assembly.py` 两 pin 扩行

- [ ] RED：清单（title/status/updated_at＋诚实计数）／空库／门控三分支／有界按 D5；GREEN：工具实现（`list_entries` 只读）＋注册三件；neuter 一次（恰红后还原）。
- [ ] 门禁：定向＋装配两用例复核。

**实测（待执行期填）**：…

## Task 3 — 引导（docstring＋SOUL，按 D7）

> 动到的文件：两工具 docstring（随各自 Task）＋`agents/assets/rag/SOUL.md`（主树独有）

- [ ] `graph_search` docstring（`entity` 用法句）／list 工具 docstring（用法＋覆盖面「只覆盖过门槛的头部实体」）；SOUL：语料边界节加「有哪些百科条目」条＋`:34` 第三步扩 entity 直参半句；`test_rag_agent_assembly.py` 同批复核（预期不出红）。

**实测（待执行期填）**：…

## Task 4 — 门禁＋真栈小相＋回填

- [ ] ruff 双净＋定向＋**全量**（日志落盘）；真栈小相（W21，t6 实例）：① `graph_search(entity="证件")` 直取邻域；②「知识库里有哪些百科条目？」→ `list_wiki_entries`；**实例配置补启用条目**（配置面例外，随证据记）；临时件收尾。
- [ ] 回填：本 plan 纪行（Task 0–4 逐格勾＋实测）＋spec 状态行；提交链落定（含仓内 gitignored `config.yaml` 启用条目状态）。

**实测（待执行期填）**：…

## 提交链（预计，以执行期拆分为准）

- 开工首笔（spec+plan 成对）／代码一笔（Task 1＋2＋docstring＋测试＋注册面三件）／引导一笔（Task 3 的 SOUL 部分）／回填并入文档笔；**仓内 gitignored `config.yaml` 启用条目**随代码笔或单列（执行期定，它不是 git 面文件）；均主树、不推（待令）。
