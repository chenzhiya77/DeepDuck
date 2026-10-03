# RAGAS 评测预算修正与提速 —— 实施计划

- 成对 spec：`docs/superpowers/specs/2026-10-04-rag-eval-budget-and-speed-design.md`
- 日期：2026-10-04
- 状态：待执行（Task 0 起）

## 范围与交接

四决策：D1 `recursion_limit` 60→300（已改在工作树 `ragas_eval.py:839`、已实测，本对正式提交）/ D2 每题答题墙钟 180s / D3 ragas `RunConfig` 重试 10→2+超时 600→120s / D4 逐 LLM 调用计时日志。乙‴/丙 不做（spec §2.5 翻案）。改动面全在评测链（`knowledge/eval/` + 测试）；chat/gateway 零改动。数字 180s/2/120s=初值跑一阵校准。

## 硬约束

- 不动 chat/gateway/channels/subagent 的 recursion 配置。
- `eval_runs` 语义不变（超时=question 级 `failure`）。
- 计时日志 debug 级、无正文无密钥。
- 门禁用 `backend/.venv/Scripts/python.exe`（见 [[env-induced-test-failures]]）；basetemp 用仓外隔离目录、跑完删。

## Task 0 — 落点核实

- [ ] ① `ragas_eval.py:839` 零漂移确认（`build_lead_agent_runner` run config 内）；工作树已改 300 ⇒ 核对 diff 仅此一行。
- [ ] ② D2 落点核实：`run_layer2_evaluation` 逐题循环的现状（异常处置/`failure` 字段写法/`on_progress` 语义），确认 `asyncio.wait_for` 包裹点与 `failures` 记账的最小改面。
- [ ] ③ D3 落点核实：`ragas_eval.py:543` `RunConfig` 构造点；受害者=是否有用例断言 `max_retries==10`/`timeout==600`（含 `ragas` 库内部语义：`max_retries` 覆盖哪类异常）。
- [ ] ④ D4 落点核实：`build_lead_agent_runner` 的 config["callbacks"] 现状（langfuse 已挂）；计时 callback 的挂法与 `on_llm_end` 能拿到的字段（模型名/token）。
- [ ] ⑤ 受害者扫描：`test_ragas_eval*.py` / `test_eval_*.py` 中断言 recursion_limit、RunConfig、runner config 的用例清单。

## Task 1 — D1+D2 TDD：预算钉 300 + 答题墙钟

- [ ] RED：新增用例 ①断言 runner config `recursion_limit == 300`（现状 60 ⇒ 红）；②假 agent_runner 拖 >180s ⇒ 期望该题 `failure="timeout"` 且下一题继续（现状无墙钟 ⇒ 红）。
- [ ] GREEN：`ragas_eval.py:839` 300（已在工作树，补注释=15 步/轮×20 轮刻度）+ `run_layer2_evaluation` 逐题 `asyncio.wait_for(..., 180)`，超时记 `failure="timeout"` 续跑。
- [ ] neuter：①还原 60 ⇒ 恰红 A2；②拆墙钟 ⇒ 恰红 A3；两处反证面不相交，还原复绿。
- [ ] 门禁：knowledge/eval 面 + ruff 双净。

## Task 2 — D3+D4 TDD：RunConfig 收紧 + 计时日志

- [ ] RED：①断言 `RunConfig` `max_retries == 2` 且 `timeout == 120`（现状 10/600 ⇒ 红）；②跑一次假评测 ⇒ debug 日志应含逐调用计时行（现状无 ⇒ 红）。
- [ ] GREEN：`ragas_eval.py:543` 改 2/120 + 计时 callback 挂 `build_lead_agent_runner` config（`on_llm_end` 记 模型名/耗时/token，debug 级、一行一调用）。
- [ ] neuter：①还原 10/600 ⇒ 红；②摘 callback ⇒ 红；还原复绿。
- [ ] 门禁：knowledge/eval 面 + ruff 双净。

## Task 3 — 门禁 + 文档

- [ ] 全量门禁：knowledge 面全绿（环境红按既有账登记）+ ruff check/format 双净；受害者按「给夹具补值」处置并登记。
- [ ] 文档：`backend/AGENTS.md` 评测段补一句（recursion 300=20 轮刻度 + 每题墙钟 + RunConfig 口径）；spec/plan 回填实测数字与提交链。

## Task 4 — 真评测复测 + 收尾

- [ ] 测试1 全 17 题 L1+L2 复测（`ragas-perf/repro_full.py` 配方：cwd=backend + 4 个 `DEER_FLOW_*CONFIG_PATH` + `RAGAS_DO_NOT_TRACK=true`；模型=mimo-v2.6-flash，qwen 额度未恢复则保持）：验收 A1（零 `GraphRecursionError`、17/17）+ A5（计时日志可见）+ 前后时间账对比。
- [ ] 收尾：scratch 脚本留 `ragas-perf/` 不进仓；工作树核对仅本对改动（其他线未提交内容不入提交）；提交链回填。
