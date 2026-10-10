# 感知链余口补强（三格） —— 实施计划

## 范围与交接

一对一件事＝三格一起做：①`wiki_search` 加 `title` 直取（实体→wiki 确定性）②wiki item 带 `source_chunk_ids`（wiki→切片回溯）③`graph_search` 证据片补 `doc_id`（凭据对齐）。成对 spec 同名（`../specs/2026-10-10-rag-perception-handles-design.md`），决策点 D1–D6 见 spec §3（**已裁全甲**：①`title` 参数／②如实空态／③不过滤口径／④全量照返／⑤manual 缺键／⑥docstring＋SOUL 同批）。**树归属**：主树 `feat/rag-knowledge-base` 独有——切片无实体/wiki 模块与 wiki/graph 工具，**不随带**、切片 example 零落点。**不碰**：召回/重排/引用编号链、wiki 生成与脏标记、图谱抽取/扩张、注入面、前端（锚定通道在服务层已有）、recall-test 投影键集。TDD 必做（backend/AGENTS.md）；提交信息英文 conventional；只 stage 本线文件。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测＝`$(RUN) pytest tests/knowledge/… -q`（basetemp 用仓外隔离目录、跑完删）；门禁＝`ruff check`／`ruff format --check` 双净；**工具属共享面 ⇒ 加跑全量**（后台，约 15–23 分，落盘日志）。
- **薄壳零查询改动**：①②③ 取数全在现有行/dict 上（`get_entry` 全列／`row["doc_id"]` 变量），禁止改查询与序列化层；① 直取路不建 embedder（lazy）。
- **SOUL 句改同批**：docstring 与 SOUL 半句须同批落（不得只落一半）；句改前扫 `test_rag_agent_assembly.py` 钉句族（`:58-:71`）＋wiki/graph 两工具用例面。
- **门控一致**：① 直取三分支（未绑定/无权限/跨库）文案与三路检索同款。
- 真栈仅测试库；临时件收尾删净；`config.yaml`/`rag_config.json` 零改动。

## Task 0 — 落点核实

> 动到的文件：只读核实＋spec/plan 回填（本对文档）

- [ ] ① 实读行复核（`wiki_search_tool.py:33/55-71/72-79/86-93/96-97/114-115`）＋`wiki_entry_id`（`store.py:23-24`）与 `get_entry`（`:86-88`）两个复用点＋impl 调用点 `knowledge_service.py:1142`（kwargs，加参不碰）；② `source_chunk_ids` 列实核＋服务层同款口径复核（锚定通道 `knowledge_service.py:1190-1199`；**wiki hit 已带同款键** `:1216-1217`，manual→缺键——② 键名/口径照抄）；③ `graph_search_tool.py:300-321` 证据 item 六键＋`doc_id` 变量（`:308`）复核；④ 受害者扫描：`test_wiki_search.py`（逐键断言——加键/加参逐条复核）／`test_wiki_search_manual_merge.py`（citation 列表断言、manual 混排）／`test_graph_search.py:229` 子集断言／工具组钉句 `test_rag_group_tools_are_exactly_the_three_retrieval_tools`（D1 甲下不相交，乙须动）／SOUL 钉句族 `test_rag_agent_assembly.py:58-:71`；⑤ D1–D6 裁定值回填本文件与 spec §3。

**Task 0 复核结果（待执行期填）**：…

## Task 1 — ① `wiki_search` 加 `title` 直取（TDD）

> 动到的文件：`backend/packages/harness/deerflow/tools/builtins/wiki_search_tool.py`＋对应测试

- [ ] RED：title 命中＝返回该条目（六键＋citation_no）／未命中＝空态文案（按 D2）／无绑定与无权限两分支同款文案；GREEN：impl 加 keyword 参数＋直取短路（跳过嵌入）＋docstring Args 行；neuter 一次（去直取恰红后还原）。
- [ ] 门禁：knowledge 面定向（`tests/knowledge/tools/`）。

**实测（待执行期填）**：…

## Task 2 — ② wiki item 补 `source_chunk_ids`（TDD）

> 动到的文件：同 Task 1 文件＋对应测试

- [ ] RED：wiki 条目 item 带 `source_chunk_ids`（与行一致）＋manual 按 D5；GREEN：item 构造补键；neuter 还原。
- [ ] 门禁：定向；顺核 merge 用例（manual 混排）不破。

**实测（待执行期填）**：…

## Task 3 — ③ graph 证据片补 `doc_id`（TDD）

> 动到的文件：`backend/packages/harness/deerflow/tools/builtins/graph_search_tool.py`＋对应测试

- [ ] RED：证据 sample 带 `doc_id`（与业务行一致、与同片 hybrid item 一致）；GREEN：一行补键；neuter 还原。
- [ ] 门禁：定向（`test_graph_search.py`）。

**实测（待执行期填）**：…

## Task 4 — 引导（docstring＋SOUL，按 D6）

> 动到的文件：两工具 docstring（随各自 Task）＋`agents/assets/rag/SOUL.md`（主树独有）

- [ ] `wiki_search` docstring（title 用法＋`source_chunk_ids` 回溯句）／`graph_search` docstring（doc_id 半句）；SOUL 半句按裁落（候选 `:19` 凭据句扩／`:34` 第三步扩）；`test_rag_agent_assembly.py` 同批复核（预期不出红）。

**实测（待执行期填）**：…

## Task 5 — 门禁＋真栈小相＋回填

- [ ] ruff 双净＋定向＋**全量**（日志落盘）；真栈小相（W20，t6 实例）：三跳——「实体名 → `wiki_search(title=…)` 直取条目 → 条目 `source_chunk_ids` → `read(chunk_id)` 回溯；`graph_search` 证据带 `doc_id` → `read(doc_id)` 读篇」；临时件收尾、配置零改动。
- [ ] 回填：本 plan 纪行（Task 0–5 逐格勾＋实测）＋spec 状态行；提交链落定。

**实测（待执行期填）**：…

## 提交链（预计，以执行期拆分为准）

- 代码一笔（Task 1＋2＋3＋docstring＋测试）／引导一笔（Task 4 的 SOUL 部分）／回填并入文档笔；均主树、不推（待令）。
