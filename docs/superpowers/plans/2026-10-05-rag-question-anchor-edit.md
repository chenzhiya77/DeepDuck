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

- [x] ① `question_bank` 收口形状：`add_question`（`question_bank.py:69`）/ `delete_question`（:121）/ `_atomic_write`（:134）；`update_question` 与 `add_question` 并列新增，guard 注入形状一致（keyword-only、默认 None=不拦）。`dataset.validate_question` 空锚**合法**（`dataset.py:59` `_require_str_list` 只查类型、空表过；字段本身 required=必须在）⇒ 清空勾选=解除锚定口径成立；条目须过 `_CHUNK_ID_RE`（`<doc_id>#NNNN`），update 入参同约束。
- [x] ② 实体派生先例：`knowledge_service.create_eval_question`（`knowledge_service.py:1525`，派生在空标注分支 `synthesis.chunk_entities_union(rows)`〔`synthesis.py:118`〕；显式非空尊重原值）+ 合成候选实体=词汇表内**精选子集**（`synthesis.py:235`，幻觉过滤）⇒ update 口径（D4=甲′）：**跟锚收缩**=旧实体 ∩ 新锚 `chunk_entities_union` 词汇表、只删失去支撑的不新增；`update_question` 实体参数形状以 spec §2 ③ 为准（服务层把收缩结果显式传入）。
- [x] ③ `list_eval_questions`（`knowledge_service.py:1521` 返回 `{"questions": [...asdict], "total": n}` + `knowledge_bases.py:748`）⇒ `missing_chunk_ids` 按题加进 asdict 后的 dict（**不进 golden schema**）；批量取行：全部题锚 id 并集 → `store.get_chunks_by_ids`（`store.py:326`）一次查询（内部无 200 上限，HTTP 端点 `max_length=200` 不适用）。
- [x] ④ 受害者扫描：直调 `add_question` 用例族=`test_question_bank`/`test_ondemand`/`test_video_eval`/`test_table_eval`/`test_synthesis`/`test_anchor_check` + API 层 `test_eval_questions_api`/`test_synthesis_api`；guard 默认 None ⇒ 预期零扰动（Task 1 门禁实测复核）。前端 `EvalQuestion`（`types.ts:722`）加可选 `missing_chunk_ids?: string[]` ⇒ 既有 dom 用例零破坏；`EvalQuestionCreateInput` 不动。
- [x] ⑤ 前端复用件核实：`chunk-card.tsx:66` props——**只读=不传 `onEdit`/`onDelete`/`onReExtract`**（`:150` `hasFooterActions` 派生）；`listChunksByIds`（`api.ts:227`，缺片静默丢弃/调用方报差额）；`listDocumentChunks`（`api.ts:209` 分页）；`useAnchorConfirm`（`components/workspace/knowledge/use-anchor-confirm.ts`，keyed=**任意字符串** ⇒ 抽屉直接用 `question.id` 做 key，比"key=抽屉"更细）；`eval-question-drawer.tsx:43` `groupChunksByDoc`（稳定序号徽章保留）。CSRF 走 `core/api/fetcher` 共享 fetcher（`api.ts:7` import），PATCH 自动带。

## Task 1 — 后端：update 写入口 + 悬空派生 TDD

> 动到的文件：`eval/question_bank.py` / `app/gateway/services/knowledge_service.py` / `app/gateway/routers/knowledge_bases.py` / `tests/knowledge/eval/…` + `tests/knowledge/test_eval_questions_api.py`

- [x] RED 用例（红=今天无 update 口/无闸）：①贴错锚改锚被拦（422 结构化 detail）②`anchor_ack=true` 放行（术语级）③悬空锚提交被拦**且 ack 放不过** ④合法改锚 200、实体**跟锚收缩**（失去支撑者删、不新增——精选子集保住）⑤题面/分类/路径/参考答案原样钉死 ⑥question_id 不存在 → KeyError/404 ⑦list 响应 `missing_chunk_ids` 悬空/存活/无锚三态 ⑧清空勾选=解除锚定（落库为空数组）。**实测红 12**：API 7 红 + 单测收集红 1（`update_question` 未建，含 5 用例）；18 旧例过=零受害者。
- [x] GREEN：`question_bank.update_question`（同 `_lock` 读改写、`_atomic_write`、guard 用存库答案对新锚跑）+ `service.update_eval_question`（一次 `get_chunks_by_ids` 喂 `build_anchor_guard` + 实体收缩=旧实体∩新锚词汇表）+ router `PATCH /{kb_id}/eval/questions/{question_id}`（`EvalQuestionUpdateRequest` extra=forbid；过 `_require_kb_access`；404/422 结构化/422 字段串/500 四分支）+ `list_eval_questions` 派生 `missing_chunk_ids`（锚 id 并集一次取行）。**46 绿/0 红**。
- [x] neuter：①update 拆 guard ⇒ 贴错例+悬空例恰 2 红 ②拆实体收缩（改全覆盖）⇒ 精选被冲例恰 1 红 ③派生改恒空 ⇒ 标记例恰 1 红——各一次反证后还原复绿。
- [x] 门禁（eval 面 + knowledge API 面）：knowledge 全面 **1595 绿/4 环境红**（缺 key 对+parser 两条预存账，零新增）+ `ruff check`/`ruff format --check` 双净。

## Task 2 — 前端：抽屉可见 + 改锚面 + 行级标

> 动到的文件：`eval-question-drawer.tsx` / `eval-question-bank.tsx` / `core/knowledge/{api,hooks,types}.ts` / `locales/{types,en-US,zh-CN}.ts` / 对应 `*.dom.test.tsx`

- [x] RED（dom 钉）：①抽屉逐片 ChunkCard 渲染 + 悬空徽章 ②编辑保存被拦 ⇒ 红块变出「仍要保存」且**不落库**、原按钮盲重复点仍不落库 ③确认钮携 `anchor_ack=true` 落库 ④行级参考切片格：纯数字（无量词混排）+ 纯词「悬空」徽章仅悬空题显 ⑤问题列悬浮走项目 Tooltip（断言无原生 `title`）。（实现随写、各钉落前逐一验红——非独立红跑，如实记录）
- [x] GREEN：参考文档卡升级逐片 ChunkCard（只读态只显已锚片、**不传 `onEdit`/`onDelete`/`onReExtract`**；`listChunksByIds` 一次取数两用：预览+悬空差额）+「编辑锚定」入口 → **按文档折叠分组勾选区**（组头「已选 n/N」默认收起、含已锚片文档默认展开、组内切片行=内容摘要+勾选框、分页 50/页、勾后可整组收起）+ B′ 接线（keyed=question.id；**原「保存」请求体物理不带 `anchor_ack` 键**）+ api `updateEvalQuestion`/hooks/types 字段 + i18n（`columnRefChunks`/`sortDocsCount`/`danglingBadge`/`anchorEdit`/`anchorBlock.confirmUpdate`，`refDocsCount` 退役、`columnRefDocs` 留抽屉卡头）+ **列口径改造**（表头「参考切片」、格子纯数字=切片数、tooltip 文档名保留；合成候选卡同步纯数字）+ **排序保篇序**（比较器不动，label「文档数」）+ **警示徽章**（destructive 纯词「悬空」）+ **悬浮统一**（bank:419 + drawer 组头两处原生 `title` 换项目 Tooltip；`MetricTile title=` prop 未动）。
- [x] 门禁：前端全量 **248 文件 / 2816 绿 / 0 红**（+11 净增钉）+ `pnpm check`（eslint+tsc）双净。

## Task 3 — 门禁 + 文档回填 + 登记

> 动到的文件：spec/plan 回填 + `backend/AGENTS.md`

- [x] 全量门禁：后端 `pytest -m "not live" tests/`（basetemp 仓外 `E:\app-model\deer-flow-scratch\pytest-tmp-anchor-edit-full`、跑完删）**153 failed / 13030 passed / 109 skipped（20:49，2026-10-06）**——红全在历史环境红带（145–164）内且全为根级环境红族（provisioner/rag_config_probe/sandbox/skillscan/wechat…），波及面零新增（knowledge 全面 1595 绿/4 预存环境红、eval 面 46 绿）；前端全量 248 文件 / 2816 绿 / 0 红（Task 2 实测）；`ruff check`/`ruff format --check` 双净、`pnpm check` 双净。
- [x] `backend/AGENTS.md`「Write-path anchor verification」条目补「改锚口同闸」半句（`update_question` 同注入 guard、实体跟锚收缩、`missing_chunk_ids` 读时派生，引本对 spec）；spec/plan 状态行回填；§6 登记项定稿（改答案/自动改锚/添加框勾选区/合成暂存改锚/切片跳转五条登记，L1 悬空口径不改）。

## Task 4 — 真栈验收（仅测试2）

> 动到的文件：零（真栈验证 + 临时件收尾）

- [ ] 环境核实（栈在跑/登录态/视口 ≥768）→ 临时文档入库（**≥2 切片**）→ 添加框造无锚题 + 召回面板造带锚题 → **删锚定那片**（留另一片当改锚目标；`DELETE /chunks/{id}` 走 `delete_chunk_cascade` 即造悬空）→ 行级 + 抽屉两面悬空标出现 → 抽屉改锚：误锚首击 422 落红块（`role="alert"`、无 error toast）→ 原「保存」盲重复点不落库 → 红块「仍要保存」落库 / 正锚首击直过 → 实体随锚收缩（失去支撑者删、不新增）。
- [ ] 收尾：临时题删净、临时文档删净、配置零改动；harness 态记录（隐藏窗口 Radix 退出动画幽灵节点等非产品缺陷照记）。
