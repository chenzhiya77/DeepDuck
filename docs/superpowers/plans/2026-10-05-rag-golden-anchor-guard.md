# 题库标注锚定核验门禁 —— 实施计划

## 范围与交接

一对一件事 = 写入口「锚定核验」机械门禁 + 存量 q008 修锚。成对 spec 同名（`../specs/2026-10-05-rag-golden-anchor-guard-design.md`），决策点 D1–D5 见 spec §3（D5 前端已裁零控件）。**不碰** dataset schema、评测指标口径、前端组件。TDD 必做（backend/AGENTS.md）；提交按线拆（工作树有别线未提交内容）。

## 硬约束（执行期注意）

- 分词复用 `knowledge/sparse.py::_tokenize`，**不引 jieba**（spec §2 先例）；若 `_tokenize` 是模块私有，导出或提共享助手，**不复制第二份**。
- 两条豁免（无参考答案跳过 / 多片题只拦单片零命中）写死进判据，用例钉住。
- 拦截响应必须带机器判定明细（术语命中表 + 建议锚）。
- q008 修锚两份同步：运行库 `backend/.deer-flow/data/knowledge/8581c87b…/golden.jsonl` + git fixture `backend/tests/fixtures/rag_eval/golden.jsonl`。
- 审计脚本留 scratch 不进仓；改锚前留旧值对照。

## Task 0 — 落点核实

- [ ] ① `question_bank.add_question` 签名与两个调用方（`knowledge_service.py:1543` create / `synthesis.py:399` accept）；guard 注入形状（保持文件层纯度 + 现有测试不受扰）。
- [ ] ② `_tokenize` 可复用性（私有→导出/共享）+ CJK 二元组对 q008 判据的实测复核（"装箱/拆箱"二元组在 `#0001` 命中、`#0002` 零命中）。
- [ ] ③ 服务层拿切片正文的路径（`KnowledgeStore.get_chunk`；guard 的 fetch 注入形状）。
- [ ] ④ 受害者扫描：既有题库相关用例（`test_synthesis.py` / `test_question_bank` 族 / eval API 用例）受影响面；`EvalQuestionCreateRequest` 的校验/错误码形状（4xx 选型随 D1）。

## Task 1 — 核验函数 + 收口挂载 TDD

- [ ] RED：q008 形状贴错被拦（红=今天创建成功）/ **带确认标记重存放行**（甲′ 绕过）/ 空答案放行 / 多片 BEATEN 放行 / 多片单片 ZERO 拦 / create 与 accept 双口过闸。—— 用例数与红因逐条记录。
- [ ] GREEN：`eval/anchor_check.py`（纯判定函数 + store 取正文的 async 包装）+ `add_question` guard 注入 + 两调用方传 guard；拦截响应带明细。
- [ ] neuter：拆豁免 ⇒ 假阳例红；拆收口（只挂 create）⇒ accept 例红；放宽判定阈值 ⇒ q008 形状例红。受害者按实测报。
- [ ] 门禁：eval 面 + knowledge API 面 + ruff 双净。

## Task 2 — 存量修复（q008 修锚）

- [ ] 按 D3 裁定修锚（运行库 + git fixture 两份），改前留旧值对照；复跑审计 **✓14/✗0/—5**。
- [ ] L1 口径处置：改锚后 q008 分数与历史不可比——登记 + `eval_runs` 基线按需重标（Layer 1 是确定性零成本，可直接重跑刷数）。

## Task 3 — 门禁 + 回填 + 登记

- [ ] 全量门禁 + spec/plan 回填实测数字与提交链；`backend/AGENTS.md`「Retrieval quality evaluation」段补锚定核验一行。
- [ ] 登记项落 spec §6 定稿（徽章 / 重入库重验 / rel=0 坏题 / 无答案覆盖缺口）。

## Task 4 — 真栈验收

- [ ] UI 手工创建 q008 形状贴错题被拦（响应含明细）→ 点确认后入库成功 → 改正锚再存成功；合成 accept 过闸路径通；收尾临时题删净、配置零改动。
