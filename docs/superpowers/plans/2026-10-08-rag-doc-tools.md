# RAG 知识库文档级只读工具（文档感知补强） —— 实施计划

## 范围与交接

一对一件事＝`list_knowledge_documents`＋`read_knowledge_document`（只读、双寻址）＋检索结果补 `doc_id`/`chunk_index`＋门控扩列＋SOUL 语料边界节（＋D1 篇内检索）。成对 spec 同名（`../specs/2026-10-08-rag-doc-tools-design.md`），决策点 D1–D4 见 spec §3（**已裁全甲**：篇内检索随／双寻址／引用不进／限次宽松档）。**已裁口径**：并进首期（A）——RFC v3 声明句／25 条清单加行／审计 re-pin／验收材料补充相＝**随带组**，挂切片移植批次、RFC 发布前完成（spec §5 四处落点）。**实现序**：主树先；切片随带（与 ② 刻度轨恢复同批次机制）。**不碰**：检索主路（召回/重排/引用编号链；除 spec §2.2/§2.3 两处小改）、注入面、前端、编辑族、图谱/wiki 腿。TDD 必做（backend/AGENTS.md）；提交按线拆（工作树有别线未提交内容）。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测＝`$(RUN) pytest tests/knowledge/… -q`（basetemp 用仓外隔离目录、跑完删）；门禁＝`$(RUN) pytest -m "not live" tests/`＋`ruff check`／`ruff format --check` 双净；前端零改动（不跑）。
- **两树同名同契约**：`list_knowledge_documents` / `read_knowledge_document`；切片侧门控集合与工具**同批**扩（`knowledge_scope_middleware.py` 两处），否则 disabled 下漏网。
- **fail-closed 与不信前缀**：`chunk_id` 归属以行校验（存在＋属本 kb＋属本用户）；未绑定/无权限/跨库＝与检索工具同款拒绝文案。
- **有界与诚实**：read limit 默认 20、上限 50；list 全量＋诚实计数；窗口边界收拢必注明「第 K/共 N 片」。
- **只读**：新工具零写库；SOUL 与各树 L7 强制句**同批**修订（两树 L7 非同一句，按各树检索链各自适配），不得只落一半。
- **引用合同（D3=甲）**：list/read 输出零 `citation_no`（不调 `claim_citation_range`、不发 artifact）；过大输出走通用预算，不并入 `{knowledge_search, task}` 特判。
- 真栈仅测试库；临时文档收尾删净；`rag_config.json` 零改动；提交信息英文 conventional；只 stage 本线文件。

## Task 0 — 落点核实

> 动到的文件：只读核实＋spec/plan 回填

- [ ] ① 两树对照重核 spec §1 各锚（结果构造 81-87／store 282-326／vector_store 62·316-320·删除路 609/613（切片 :336）／chunker 369／服务 268·364（切片 160·100）／切片门控 25＋两处按名）；② 工具注册点（主树 `config.yaml` tools[]＋rag 资产 `tool_groups`；切片 acceptance config）；③ 两树 SOUL L7 强制句确切行；④ `chunk_positions` 语义重核（活体位置 vs `chunk_index` 差与换算）；⑤ 受害者扫描：结果 payload 新键的既有断言、门控常量改名影响面、SOUL 句改的用例面（点名主树 `test_rag_agent_assembly.py`：`test_builtin_rag_soul_contains_citation_and_refusal_rules`——L7 句改必撞、随 Task 5 同步；`test_rag_group_tools_are_exactly_the_three_retrieval_tools`——断言是超集⇒仍过、名称「exactly」陈旧可顺手更新）、预算中间件特判面（切片 `:665`／主树无）、**按名引用点全集**（切片 `knowledge_scope_admission.py:17-20·36`／`routers/features.py:122-128`／`community/ragflow/sources.py:82`／前端 `citations.ts:13`·`sources.ts:34`／`src/AGENTS.md:213`＋主树对应面 `citations.ts:17`·`core/pet/tools.ts:56-58`——预期全零改动，核实确认）。

## Task 1 — 检索结果补字段（TDD）

> 动到的文件：`harness/deerflow/tools/builtins/hybrid_search_tool.py`＋对应测试

- [ ] RED：payload 断言 `doc_id`（＋`chunk_index`）出现；GREEN：item 构造（主仓 L81-87／切片 L137 起）补键——`chunk_index` 取 DB 行键（两树 payload 无此键）、`doc_id` payload／行俱有——＋docstring 提及结果含 `doc_id`/`chunk_index`（供 read 追问）；neuter 一次（去键恰红）。
- [ ] 门禁：knowledge 面定向。

## Task 2 — list 工具（TDD＋注册）

> 动到的文件：新模块 `harness/deerflow/tools/builtins/knowledge_documents_tool.py`＋测试＋`config.example.yaml`／本地 `config.yaml`（注册双落）

- [ ] RED：多文档/混合状态/诚实计数；未绑定＝引导；空库；跨用户＝拒绝。GREEN：新模块（镜像检索工具写法：`@tool(parse_docstring=True)`＋`resolve_kb_scope` fail-closed＋**主树模块级 import**（照 `hybrid_search_tool.py:18-25`；函数内 import 是切片形态、见下条）；注册面可导）；主树注册两条（`group: rag, opt_in: true`）**双落**：`config.example.yaml`（tracked 模板）＋本地 `config.yaml`（gitignored 运行时）；rag 资产 `config.yaml` 零改动（`tool_groups: [rag]` 组已在）。
- [ ] 切片形态草稿（函数内 import `deerflow_knowledge`）——随带组备件，本对不动切片树。

## Task 3 — read 工具（TDD）

> 动到的文件：同 Task 2 模块＋测试

- [ ] RED：①`doc_id` 分页（offset/limit/has_more/边界）②`chunk_id` 居中窗口（`#` 序号→活体位置换算、边界收拢、第 K/共 N）③非 `ready` 拒绝（含状态文案）④跨库/不存在拒绝 ⑤伪造 `chunk_id` 前缀＝拒绝 ⑥超长单条：截断并标 `truncated`（不静默）。GREEN＋neuter（换算拆掉恰红、守卫拆掉恰红）。
- [ ] 门禁定向。

## Task 4 — 篇内检索（D1=甲，随本对）

> 动到的文件：检索工具＋`knowledge/vector_store.py`（`hybrid_query` 可选 `doc_id`）＋测试

- [ ] RED：`doc_id` 过滤命中/未命中/跨库；GREEN：工具可选入参＋filter 一处＋docstring。

## Task 5 — SOUL＋门控收口

> 动到的文件：`agents/assets/rag/SOUL.md`（两树各自适配，非逐字同文）＋切片 `knowledge_scope_middleware.py`（草稿）

- [ ] 主树 SOUL：新增「语料边界问题」节（工作流＋D4 限次取值）＋L7 强制句两分修订；切片版草稿（按切片两件检索链适配；两树 L7 非同一句）。
- [ ] 切片门控集合扩列草稿（`{knowledge_search, list_knowledge_documents, read_knowledge_document}`，两处）＋拒绝文案收正（`_disabled_tool_message`：ToolMessage `name=` 与 content 按被拦工具名回填／泛化；`access.py:37` 同句一并核——第三处同句 `ragflow/tools.py:539` 属 RAGFlow 自答、不随扩列，维持不动）。

## Task 6 — 真栈验收（主树）

> 动到的文件：零（真栈验证＋临时件收尾）

- [ ] 两问回归＋追问链＋篇内检索一问（D1=甲）；临时件收尾、配置零改动。

## Task 7 — 门禁＋提交＋回填

> 动到的文件：spec/plan 回填＋验收反馈记录第八节状态行同步＋`backend/AGENTS.md`／`README.md`（文档同步面）

- [ ] 全量门禁（后台跑）＋提交链（英文）＋spec/plan 状态回填＋验收反馈记录第八节状态行同步＋文档同步面：`backend/AGENTS.md` 两处（L968「the three retrieval tools」、L1264 工具清单）＋`README.md` 两处（L32「三个检索工具」、L74-76 清单）随工具组扩为五件修订；快照类（`docs/HARNESS_EXECUTION_FLOW_MAP.md`／`docs/AGENT_HARNESS_VISUALIZATION_RESEARCH.md`）不追、登记。

## Task 8 — 随带组交接单（切片移植批次）

> 动到的文件：交接单（挂 ② 刻度轨恢复同批次）

- [ ] 交接单：切片形态工具模块＋结果字段（切片同段）＋门控集合（两处）＋门控文档行同步（切片 `middlewares/AGENTS.md:47`「blocks `knowledge_search`」→三件套表述）＋SOUL（两树各自适配）＋配置（acceptance）＋验收相（同两问回归，基准会话 `c4af859d`）＋口径四处（RFC L17 句／清单行／审计 re-pin／材料补充相——发布前完成）。
- [ ] **提交前四门复核**（口径＝`../specs/2026-10-08-rag-slice-ci-fix-design.md` §2.5）：切片树任何提交前必过——① `cd backend && make lint`（ruff check＋format 双净）② 仓库根 `python scripts/check_agent_guidance.py --base-ref <基座> --head-ref HEAD` → **errors=0** ③ `cd frontend && pnpm format`（prettier 零 diff）④ 后端定向 pytest（口径按批次）；既有绿项（`uv lock --check`／`pnpm lint`・`typecheck`・`build`）随门联跑；凡动 `.github/workflows/*` 的批次，另以推送后首跑复核（本地无 GitHub workflow 校验器）。
