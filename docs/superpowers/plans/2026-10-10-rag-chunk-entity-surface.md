# 切片→实体 模型面通路（感知链断点补强） —— 实施计划

## 范围与交接

一对一件事＝`hybrid_search` 与 `read_knowledge_document` 两处结果各带 `entities`（本片规范化实体名）＋引导（docstring/SOUL）。成对 spec 同名（`../specs/2026-10-10-rag-chunk-entity-surface-design.md`），决策点 D1–D5 见 spec §3（**已裁全甲**：数组／两处覆盖／cap 10 静默／docstring＋SOUL 半句／空数组照常）。**树归属**：主树 `feat/rag-knowledge-base` 独有——切片无实体模块与 `graph_search`，**不随带**、切片 example 零落点（spec §2.3）。**不碰**：召回/重排/引用编号链、注入面、前端、图谱/wiki 腿、recall-test 白名单投影（除复核确认）。TDD 必做（backend/AGENTS.md）；提交信息英文 conventional；只 stage 本线文件。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测＝`$(RUN) pytest tests/knowledge/… -q`（basetemp 用仓外隔离目录、跑完删）；门禁＝`ruff check`／`ruff format --check` 双净；**工具属共享面 ⇒ 加跑全量**（后台，约 18–23 分，落盘日志）。
- **薄壳零查询改动**：`entities` 取自行上（store 整行 dict 已含），禁止改查询/序列化层；上限与空态严格按 D3/D5 裁定。
- **SOUL 句改同批**：docstring 与 SOUL 半句须同笔落（不得只落一半）；句改前扫 `test_rag_agent_assembly.py` 钉句族＋SOUL 用例面。
- **有界**：cap 口径写进 docstring（「up to N」），单测钉死截断行为。
- 真栈仅测试库；临时件收尾删净；`rag_config.json` 零改动。

## Task 0 — 落点核实

> 动到的文件：只读核实＋spec/plan 回填（本对文档）

- [ ] ① 两处 item 构造行复核（`hybrid_search_tool.py:80-94`／`knowledge_documents_tool.py:76` 起）＋docstring 落句行；② 受害者扫描（终审已预扫，执行期复核）：`test_hybrid_search.py` 逐键断言（加键不破；**夹具行需补 `entities` 供 RED/GREEN**）／**`test_knowledge_documents_tool.py:129` 精确 items 列表断言（加键必改——随 Task 2 同笔更新夹具与断言）**／SOUL 用例族 `backend/tests/knowledge/test_rag_agent_assembly.py`（现况钉句 `:63` 事实性·`:69` 语料边界·`:70` list+read 引用·`:71` 读取限次——本次半句与之不相交，预期不出红）／recall-test 白名单投影（`knowledge_service.py:1160-1172` 键挑选、无 entities——不入其响应为预期）；③ SOUL 半句落点行（补检节 `:32-33`）；④ D1–D5 裁定值回填本文件与 spec §3。

**Task 0 复核结果（待执行期填）**：…

## Task 1 — `hybrid_search` 结果带 entities（TDD）

> 动到的文件：`backend/packages/harness/deerflow/tools/builtins/hybrid_search_tool.py`＋对应测试

- [ ] RED：断言 item 含 `entities`（数组、去重保序）＋cap 截断态＋空数组态；GREEN：item 构造补键（取 `row["entities"]`，按 D3 截断）＋docstring 一句（按 D4）；neuter 一次（去键恰红）。
- [ ] 门禁：knowledge 面定向（`tests/knowledge/tools/`）。

**实测（待执行期填）**：…

## Task 2 — read 工具 item 带 entities（TDD）

> 动到的文件：`backend/packages/harness/deerflow/tools/builtins/knowledge_documents_tool.py`＋对应测试

- [ ] RED：`_shape_items` 输出含 `entities`（同款三态）；GREEN：塑形补键＋read 工具 docstring 一句（按 D4）；neuter 还原。
- [ ] 门禁：knowledge 面定向。

**实测（待执行期填）**：…

## Task 3 — SOUL 半句（按 D4）

> 动到的文件：`backend/packages/harness/deerflow/agents/assets/rag/SOUL.md`（主树独有）

- [ ] 补检节补「沿实体扩展」半句（与换路/换问法并列，不动「回补」句）；`backend/tests/knowledge/test_rag_agent_assembly.py` 同批复核（预期不出红）；切片不动（复核零落差）。

**实测（待执行期填）**：…

## Task 4 — 门禁＋真栈小相＋回填

- [ ] ruff 双净＋定向＋**全量**（日志落盘）；真栈小相（W19）：实例造两跳追问（「这片提到哪些实体」→「与 X 的关系」），观察 `entities`→`graph_search` 被用；临时件收尾、配置零改动。
- [ ] 回填：本 plan 纪行（Task 0–4 逐格勾＋实测）＋spec 状态行；提交链落定。

**实测（待执行期填）**：…

## 提交链（预计，以执行期拆分为准）

- 代码一笔（Task 1＋2＋测试）／引导一笔（Task 3，含用例核正）／回填并入文档笔；均主树、不推（待令）。
