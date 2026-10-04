# 题库标注锚定核验门禁 —— 实施计划

## 范围与交接

一对一件事 = 写入口「锚定核验」机械门禁 + 存量 q008 修锚。成对 spec 同名（`../specs/2026-10-05-rag-golden-anchor-guard-design.md`），决策点 D1–D5 见 spec §3（D5 前端已裁零控件）。**不碰** dataset schema、评测指标口径、前端组件。TDD 必做（backend/AGENTS.md）；提交按线拆（工作树有别线未提交内容）。

## 硬约束（执行期注意）／Global Constraints

- **TDD 命令**（照 `backend/Makefile` 的 RUN 变量）：`RUN = PYTHONPATH=. PYTHONIOENCODING=utf-8 PYTHONUTF8=1 uv run --no-sync`；单测 = `$(RUN) pytest tests/knowledge/eval/… -q`（basetemp 用仓外隔离目录、跑完删）；门禁 = `$(RUN) pytest -m "not live" tests/` + `$(RUN) ruff check .` + `$(RUN) ruff format --check .`；前端 = `python ../scripts/pnpm.py test` + `check`。

- 分词复用 `knowledge/sparse.py::_tokenize`，**不引 jieba**（spec §2 先例）；若 `_tokenize` 是模块私有，导出或提共享助手，**不复制第二份**。
- 两条豁免（无参考答案跳过 / 多片题只拦单片零命中）写死进判据，用例钉住。
- 拦截响应必须带机器判定明细（术语命中表 + 建议锚）。
- q008 修锚两份同步：运行库 `backend/.deer-flow/data/knowledge/8581c87b…/golden.jsonl` + git fixture `backend/tests/fixtures/rag_eval/golden.jsonl`。
- 审计脚本留 scratch 不进仓；改锚前留旧值对照。

## Task 0 — 落点核实

> 动到的文件：只读核实 + 本 plan/spec 回填

- [x] ① `question_bank.add_question(path, *, query, category, expected_paths, relevant_chunk_ids=(), relevant_entities=(), reference_answer=None)`（`question_bank.py:69`）；两调用方核实无误：`knowledge_service.py:1543`（create）/ `synthesis.py:399`（在 `accept_candidate(bank_path, staging_path, candidate_id)`，`synthesis.py:384`）⇒ guard 需给 `accept_candidate` 加透传参数。注入形状定为 **keyword-only 可选参数（默认 None=不拦）** ⇒ 直接调 `add_question` 的既有用例（`test_question_bank` / `test_ondemand` / `test_video_eval` / `test_table_eval`）零扰动。
- [x] ② `_tokenize` 在 `knowledge/sparse.py:57`（模块私有）⇒ 提共享导出、不复制第二份。二元组口径实测复核（14 有答案题 20 锚）：q008 锚 `#0002` h=5 vs 同文档最佳 B=8（差 3 ⇒ 被「B−h≥2 且锚非最佳」拦，`#0001` 是最佳片）；单片 10 锚全 h==B 零误报、多片 5 处压制全被豁免 ⇒ **1 拦 0 误杀**（注意：`#0002` 二元组口径不是零命中，「h=0」那半不触发，判据靠差值半拦住）。
- [x] ③ `KnowledgeStore.get_chunk(chunk_id) -> dict | None`（`store.py:342`）取单片正文；create 路复用既有 `get_chunks_by_ids(chunk_ids, *, kb_id=None)`（`store.py:326`，与实体派生同一次取数）。guard 的 fetch 注入形状=async callable（拿 chunk id 列表回正文）。
- [x] ④ 受害者扫描：直调 `add_question` 的用例族=`test_question_bank` / `test_ondemand` / `test_video_eval` / `test_table_eval`；accept 链=`test_synthesis.py` + API 层 `test_eval_questions_api.py` / `test_synthesis_api.py`。guard 默认关 ⇒ 预期零受害者（Task 1 门禁实测复核）。错误形状：`QuestionBankInvalidQuestion` → `knowledge_bases.py:767` `HTTPException(422, detail=str(exc))` 纯字符串 ⇒ 拦截走**独立异常类 + 结构化 detail**（`miss_terms`/`suggested_chunk`/`hits`/`best_hits`），router 加 except 分支映射 422，4xx 选型随 D1=甲′。

## Task 1 — 核验函数 + 收口挂载 TDD

> 动到的文件：`eval/anchor_check.py`（新）/ `question_bank.py` / `synthesis.py` / `knowledge_service.py` / `knowledge_bases.py`（结构化 detail）/ 前端 `eval-add-question-dialog.tsx` + `eval-save-question-dialog.tsx` + `eval-synthesis-review.tsx`（B′ 三处、逻辑一份 hook）/ 对应测试

- [ ] RED：q008 形状贴错被拦（红=今天创建成功）/ **带确认标记重存放行**（甲′ 绕过）/ 空答案放行 / 多片 BEATEN 放行 / 多片单片 ZERO 拦 / create 与 accept 双口过闸。—— 用例数与红因逐条记录。
- [ ] GREEN：`eval/anchor_check.py`（纯判定函数 + store 取正文的 async 包装）+ `add_question` guard 注入 + 两调用方传 guard；拦截响应带明细。
- [ ] neuter：拆豁免 ⇒ 假阳例红；拆收口（只挂 create）⇒ accept 例红；放宽判定阈值 ⇒ q008 形状例红。受害者按实测报。
- [ ] 前端交互 B′（spec §2 末细则）：行内红字明细块 + 按钮换文案「仍要入库/仍要接受」；dom 三钉=红字出现且不入库 / 换文案后点击才入库 / 重复点原「保存」不入库（先例=recall-test-panel dom 测试）。
- [ ] 门禁：eval 面 + knowledge API 面 + 前端 dom + ruff/pnpm check 双净。

## Task 2 — 存量修复（q008 修锚）

> 动到的文件：运行库 `golden.jsonl` + `backend/tests/fixtures/rag_eval/golden.jsonl`（只动 q008 行）

- [ ] 按 D3 裁定修锚（运行库 + git fixture 两份），改前留旧值对照；复跑审计 **✓14/✗0/—5**。
- [ ] L1 口径处置：改锚后 q008 分数与历史不可比——登记 + `eval_runs` 基线按需重标（Layer 1 是确定性零成本，可直接重跑刷数）。

## Task 3 — 门禁 + 回填 + 登记

> 动到的文件：spec/plan 回填 + `backend/AGENTS.md`

- [ ] 全量门禁 + spec/plan 回填实测数字与提交链；`backend/AGENTS.md`「Retrieval quality evaluation」段补锚定核验一行。
- [ ] 登记项落 spec §6 定稿（徽章 / 重入库重验 / rel=0 坏题 / 无答案覆盖缺口）。

## Task 4 — 真栈验收

> 动到的文件：零（真栈只读验证 + 临时题收尾）

- [ ] UI 手工创建 q008 形状贴错题被拦（响应含明细）→ 点「仍要入库」入库成功 → 改正锚再存成功；合成 accept 过闸路径通；收尾临时题删净、配置零改动。
