# 题库锚定可视、改锚与悬空标记 —— 实施计划

## 范围与交接

一对一件事 = ①锚定可见（抽屉逐片 ChunkCard 预览，只读态只显已锚片）②悬空标记（读时派生 `missing_chunk_ids`，行级+抽屉两面）③抽屉内改锚过同一道锚定核验（选片器=按文档折叠分组+组内分页，B′ 交互复用）。成对 spec 同名（`../specs/2026-10-05-rag-question-anchor-edit-design.md`），决策点 D1–D4 见 spec §3（已裁 D1–D3=甲、**D4=甲′ 跟锚收缩**〔审查改判：旧实体 ∩ 新锚词汇表、只删不增〕，D3 加折叠分组与分页细则）。**不碰**：`golden.jsonl` schema、评测指标口径、worker 重切片/删片路径、参考答案与题面编辑。TDD 必做（backend/AGENTS.md）；提交按线拆（工作树有别线未提交内容）。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测 = `$(RUN) pytest tests/knowledge/eval/… -q`（basetemp 用仓外隔离目录、跑完删）；门禁 = `$(RUN) pytest -m "not live" tests/` + `$(RUN) ruff check .` + `$(RUN) ruff format --check .`；前端 = `python ../scripts/pnpm.py test` + `check`。
- **检查函数不写第二份**：改锚复用 `eval/anchor_check.py` 族（`build_anchor_guard` / `guard_from_fetch`）与同一 422 结构化 detail 键；B′ 复用 `use-anchor-confirm.ts` + `anchor-block-notice.tsx`，**不新造第三套确认形态**（原按钮=复检键永不带 ack；确认钮=红块里变出来的那个；`missing_chunk` 无确认绕过）。
- `missing_chunk_ids` 是**响应派生字段**，不进 `golden.jsonl`；读时派生不落盘，worker 线零改动。
- 改锚只动 `relevant_chunk_ids`（+实体派生随锚，D4）；题面/分类/预期路径/参考答案不动。
- 真栈**仅测试2**（kb `5f532d371666482886453c62c4f13c1a`）；临时文档/临时题收尾删净；`rag_config.json` 零改动（触碰须逐字节还原）；探针/日志脱敏（key、token 两字段都掩）。
- 提交信息英文 conventional（backend/CONTRIBUTING.md）；只 stage 本线文件。

## Task 0 — 落点核实

> 动到的文件：只读核实 + 本 plan/spec 回填

- [ ] ① `question_bank` 收口形状：`add_question`（`question_bank.py:69`）/ `delete_question`（:121）/ `_atomic_write`（:134）；`update_question` 与 `add_question` 并列新增，guard 注入形状一致（keyword-only、默认 None=不拦）。核实 `dataset.validate_question` 对 `relevant_chunk_ids` 的约束——空列表是否合法（=「解除锚定」口径，与添加框无锚题同态）。
- [ ] ② 实体派生先例：`knowledge_service.create_eval_question`（`knowledge_service.py:1525`，派生在空标注分支 `synthesis.chunk_entities_union(rows)`；显式非空尊重原值）+ 合成候选实体=词汇表内**精选子集**（`synthesis.py:235`，幻觉过滤）⇒ update 口径（D4=甲′）：**跟锚收缩**=旧实体 ∩ 新锚 `chunk_entities_union` 词汇表、只删失去支撑的不新增；`update_question` 实体参数形状以 spec §2 ③ 为准（服务层把收缩结果显式传入）。
- [ ] ③ `list_eval_questions` 现响应形状（`knowledge_service.py:1521` 返回 `{"questions", "total"}` + `knowledge_bases.py:748`）与 `missing_chunk_ids` 注入点；批量取行规模：全部题锚 id 并集 → `store.get_chunks_by_ids`（`store.py:326`）一次查询（内部无 200 上限，HTTP 端点 `max_length=200` 不适用）。
- [ ] ④ 受害者扫描：直调 `add_question` 的用例族（`test_question_bank`/`test_ondemand`/`test_video_eval`/`test_table_eval`）零扰动（update 默认 guard 关）；前端 `EvalQuestion` 类型加可选字段 ⇒ 既有 dom 用例零破坏；`EvalQuestionCreateRequest` 不动。
- [ ] ⑤ 前端复用件核实：`chunk-card.tsx` props 形状（**只读=不传 `onEdit`/`onDelete`/`onReExtract`**，组件自带可选动作、抑制即纯展示）、`listChunksByIds`（`api.ts:227`，缺片静默丢弃/调用方报差额）、`listDocumentChunks`（`api.ts:209` 分页）、`useAnchorConfirm` keyed 形状（新增 key=抽屉）、`eval-question-drawer.tsx` 现卡结构（`groupChunksByDoc:43` 保留稳定序号徽章）。

## Task 1 — 后端：update 写入口 + 悬空派生 TDD

> 动到的文件：`eval/question_bank.py` / `app/gateway/services/knowledge_service.py` / `app/gateway/routers/knowledge_bases.py` / `tests/knowledge/eval/…` + `tests/knowledge/test_eval_questions_api.py`

- [ ] RED 用例（红=今天无 update 口/无闸）：①贴错锚改锚被拦（422 结构化 detail）②`anchor_ack=true` 放行（术语级）③悬空锚提交被拦**且 ack 放不过** ④合法改锚 200、实体**跟锚收缩**（失去支撑者删、不新增——精选子集保住）⑤题面/分类/路径/参考答案原样钉死 ⑥question_id 不存在 → KeyError/404 ⑦list 响应 `missing_chunk_ids` 悬空/存活/无锚三态 ⑧清空勾选=解除锚定（落库为空数组）。
- [ ] GREEN：`question_bank.update_question`（同 `_lock` 读改写、`_atomic_write`）+ `service.update_eval_question`（一次 `get_chunks_by_ids` 喂 `build_anchor_guard` + 实体收缩）+ router `PATCH /{kb_id}/eval/questions/{question_id}`（过 `_require_kb_access` 同权；body：`relevant_chunk_ids` + `anchor_ack?`；422 映射复用 `AnchorMismatchError` 分支）+ `list_eval_questions` 派生 `missing_chunk_ids`。
- [ ] neuter：①update 拆 guard ⇒ 贴错例红 ②拆实体收缩（改全覆盖）⇒ 精选被冲例红 ③派生改恒空 ⇒ 标记例红——各一次反证后还原。
- [ ] 门禁（eval 面 + knowledge API 面）+ `ruff check`/`ruff format --check` 双净。

## Task 2 — 前端：抽屉可见 + 改锚面 + 行级标

> 动到的文件：`eval-question-drawer.tsx` / `eval-question-bank.tsx` / `core/knowledge/{api,hooks,types}.ts` / `locales/{types,en-US,zh-CN}.ts` / 对应 `*.dom.test.tsx`

- [ ] RED（dom 钉）：①抽屉逐片 ChunkCard 渲染 + 悬空徽章 ②编辑保存被拦 ⇒ 红块变出「仍要保存」且**不落库**、原按钮盲重复点仍不落库 ③确认钮携 `anchor_ack=true` 落库 ④行级参考切片格：纯数字（无量词混排）+ 纯词「悬空」徽章仅悬空题显 ⑤问题列悬浮走项目 Tooltip（断言无原生 `title`）。
- [ ] GREEN：参考文档卡升级逐片 ChunkCard（只读态只显已锚片、**不传 `onEdit`/`onDelete`/`onReExtract`**；`listChunksByIds` 一次取数两用：预览+悬空差额）+「编辑锚定」入口 → **按文档折叠分组勾选区**（组头「已选 n/N」默认收起、含已锚片文档默认展开、组内切片行=内容摘要+勾选框、分页 50/页、勾后可整组收起）+ B′ 接线（keyed=抽屉）+ api `updateEvalQuestion`/hooks/types 字段 + i18n 三件 + **列口径改造**（表头 `参考文档`→`参考切片`、格子纯数字=切片数、`refDocsCount` 退役、tooltip 文档名保留；键分家三处：表头 `:331` 新词「参考切片」/排序选项 `:205` 新词「文档数」/抽屉卡头 `:155` 留「参考文档」；en-US + `types.ts` 注释随改；**合成候选卡 `eval-synthesis-review.tsx:279` 同步改切片纯数字**——「采纳前后同一单位」承诺）+ **排序保篇序**（比较器 `eval-question-bank.tsx:220` 不动=跨文档广度，仅 label 明义）+ **警示徽章**（`Badge variant="destructive"` 小号纯词「悬空」，同「检测到回退」先例）+ **悬浮统一**（封闭清单两处原生 `title` 换项目 Tooltip：`eval-question-bank.tsx:419` + `eval-question-drawer.tsx:171`；只换 DOM 原生属性、`MetricTile title=` prop 不动）。
- [ ] 门禁：前端全量 + `python ../scripts/pnpm.py check` 双净。

## Task 3 — 门禁 + 文档回填 + 登记

> 动到的文件：spec/plan 回填 + `backend/AGENTS.md`

- [ ] 全量门禁：后端 `pytest -m "not live" tests/`（basetemp 仓外、跑完删）+ 前端全量；红只许环境红带内、波及面零新增。实测数回填本 plan。
- [ ] `backend/AGENTS.md`「Write-path anchor verification」条目补「改锚口同闸」半句；spec/plan 状态行与提交链回填；§6 登记项定稿。

## Task 4 — 真栈验收（仅测试2）

> 动到的文件：零（真栈验证 + 临时件收尾）

- [ ] 环境核实（栈在跑/登录态/视口 ≥768）→ 临时文档入库（**≥2 切片**）→ 添加框造无锚题 + 召回面板造带锚题 → **删锚定那片**（留另一片当改锚目标；`DELETE /chunks/{id}` 走 `delete_chunk_cascade` 即造悬空）→ 行级 + 抽屉两面悬空标出现 → 抽屉改锚：误锚首击 422 落红块（`role="alert"`、无 error toast）→ 原「保存」盲重复点不落库 → 红块「仍要保存」落库 / 正锚首击直过 → 实体随锚收缩（失去支撑者删、不新增）。
- [ ] 收尾：临时题删净、临时文档删净、配置零改动；harness 态记录（隐藏窗口 Radix 退出动画幽灵节点等非产品缺陷照记）。
