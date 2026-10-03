# RAGAS 评测预算修正与提速 —— 实施计划

- 成对 spec：`docs/superpowers/specs/2026-10-04-rag-eval-budget-and-speed-design.md`
- 日期：2026-10-04
- 状态：执行中（Task 5 丙 已完成；Task 0–4 + Task 6 待「开工」）

## 范围与交接

六决策：D1 `recursion_limit` 60→300（已改在工作树 `ragas_eval.py:839`、已实测，本对正式提交）/ D2 每题答题墙钟 180s（兜底，**与 D5 互为条件、同批落**）/ D3 ragas `RunConfig` 重试 10→2+超时 600→120s（兜底）/ D4 逐 LLM 调用计时日志（观测）/ **丙 judge 并行化（结构修，✅ 已完成见 Task 5）** / **D5 答题题间并发 W=4（结构修，基准 3.3× 已背书，见 Task 6）**。乙‴ 不做（spec §2.7 翻案）。修法分类：D1/丙/D5=结构修、D2/D3=兜底、D4=观测。**并发口径他拍「统一 4」**：`_JUDGE_CONCURRENCY` 8→4（已改）与 `_ANSWER_CONCURRENCY=4` 同值、全局一个旋钮。改动面全在评测链（`knowledge/eval/` + 测试）；chat/gateway 零改动。数字 180s/2/120s/4=初值跑一阵校准。

## 硬约束

- 不动 chat/gateway/channels/subagent 的 recursion 配置。
- `eval_runs` 语义不变（超时=question 级 `failure`）。
- 计时日志 debug 级、无正文无密钥。
- 门禁用 `backend/.venv/Scripts/python.exe`（见 [[env-induced-test-failures]]）；basetemp 用仓外隔离目录、跑完删。

## Task 0 — 落点核实（✅ 2026-10-04 核完）

- [x] ① `build_lead_agent_runner` run config 零漂移：diff 恰一行 60→300。⚠️ 行号漂移：现 `ragas_eval.py:875`（丙并行改动 +36 行，旧号 839 作废，spec/plan 已改引用为函数名）。
- [x] ② D2 落点钉住：`run_layer2_evaluation` 逐题循环（现 :737–745）= `try: outcomes[qid] = await agent_runner(q) / except Exception → failures[qid]`，progress 每题毕回调。最小改面=包 `asyncio.wait_for(..., 180)`（TimeoutError 落同一 except）；`_failure_result` 的 failure 串=`"{type(exc).__name__}: {exc}"` ⇒ 精确记 `failure="timeout"` 需抛 `TimeoutError("timeout")` 或特判（Task 1 拍一个）。D5 改 gather 时记账/progress 语义可直接搬。
- [x] ③ D3 落点 `ragas_eval.py:568`（旧号 543 作废）：**代码只写 `RunConfig(timeout=600)`、`max_retries` 未写**（=ragas 默认 10，源码确认：默认 timeout 180/max_retries 10/exception_types=(Exception,) 任何异常都重试）⇒ D3 的「10→2」实为「显式写 2」。⚠️ **待他重拍**：代码注释明记「ragas 默认 180s 对慢 judge（qwen-max 长 faithfulness prompt）太紧 ⇒ 故意抬 600」，spec 的 120s 低于上游默认 180 ⇒ 会复触发注释里的「太紧」；甲=120（spec 原裁）/乙=180（上游默认、比 600 紧 3.3×、2.6× 于观测最大 70s），推荐乙。max_retries 2 无冲突。
- [x] ④ D4 落点：`build_lead_agent_runner` 不显式挂 callbacks——langfuse handler 由 `make_lead_agent(config)` 内挂（`_langfuse_trace_id_from_callbacks` 读 `config["callbacks"]` 可证）⇒ 计时 handler 也是挂 config["callbacks"] 列表追加，与 langfuse 共存。`on_llm_end` 可拿：`LLMResult.generations[0][0].message.usage_metadata`（token）+ `invocation_params`/`serialized`（模型名）；耗时由 start/end 自记。
- [x] ⑤ 受害者扫描（`tests/knowledge/eval/` 全部 + `test_eval_*`）：**零受害者**——无用例断言 recursion_limit/RunConfig/runner config 值；唯二引用 `build_lead_agent_runner` 的用例（`test_eval_persistence.py:490`、`test_ondemand.py:113`）monkeypatch 整体替换 runner 不碰内部；`test_ragas_eval_cli.py:283` 的 timeout=180 是 subprocess 墙钟无关。RED 全新增、无需给夹具补值。

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

- [ ] 测试1 全 17 题 L1+L2 复测（`ragas-perf/repro_full.py` 配方：cwd=backend + 4 个 `DEER_FLOW_*CONFIG_PATH` + `RAGAS_DO_NOT_TRACK=true`；模型=mimo-v2.6-flash，qwen 额度未恢复则保持）：验收 A1（零 `GraphRecursionError`、17/17）+ A5（计时日志可见）+ A7（答题并发生效）+ 前后时间账对比（基线=985s 那轮）。
- [ ] 收尾：scratch 脚本留 `ragas-perf/` 不进仓；工作树核对仅本对改动（其他线未提交内容不入提交）；提交链回填。

## Task 5 — 丙（结构修）：citation judge 并行化（✅ 2026-10-04 先行完成）

他拍「跑并行改造验证耗时」→「补 TDD 落成结构修，同时更新 spec+plan」，故先于 Task 0–4 执行。

- [x] GREEN：`citation_precision_recall` 题内 `asyncio.gather` 并发（按入参序收割）+ `run_layer2_evaluation` 题间全任务共享 `Semaphore(_JUDGE_CONCURRENCY=8)` 按题序收割（`ragas_eval.py`）。
- [x] RED/TDD：`test_ragas_eval.py::TestJudgeParallelism` 四例（题内 3 并发 / semaphore=2 截流 / 题间 12 任务共享上限恰 8 / 并行下 `unsupported` 序不变），绿基线 54 例全绿。
- [x] neuter：①题内改串行 ⇒ 3 红（顺序例不红=正确）；②信号量失效 ⇒ 2 红（恰限流两例）；受害者不相交，还原复绿。
- [x] 门禁：`tests/knowledge/eval/` 334 例全绿 + ruff check/format 双净。
- [x] 实测（17 题 mimo，scratch `ragas-perf/run_parallel_judge.log`）：judge 尾巴 57.2s vs 工作量 462.9s = **8.1×**（打满 8）；评分段 564→**281s（2.0×）**；总 1078→985s（答题段赶上端点慢 455→576s 吃掉差额）；17/17 出分零失败。
- [x] spec 回填：§1.1-6 实测证据 + §2.5 丙=结构修 + D3 改标兜底 + 验收 A6 + 非目标换「指标削减待拍」。
- [x] 追记（2026-10-04）：他拍「统一 4」⇒ `_JUDGE_CONCURRENCY` 8→4（与 D5 同值，用例钉符号值零改动、334 例仍绿）；§1.1-6 的 8.1× 为 8 路时代数字，4 路预期尾巴 ~110s/17 题。

## Task 6 — D5（结构修）：L2 答题题间并发 W=4（待「开工」）

他拍「按甲落地」（并入同一对、不另起）；基准已背书（spec §1.1-7，scratch `bench_l2_concurrency.py`：4 题两遍 146.4→44.8s = 3.3×）。**与 Task 1 的 D2 同一循环区域，建议同批执行**。

- [ ] RED：新增用例 ①多题 `agent_runner` 重叠执行（假 runner 记并发峰值 ⇒ 现状串行=1 红）；②`_ANSWER_CONCURRENCY` 截流（N 题 >W 时峰值恰 W）；③结果仍按题序、`progress_hook` 计数不变；④一题超时（配 D2 墙钟）不拖累他题。
- [ ] GREEN：`run_layer2_evaluation` 答题循环改 `asyncio.gather` + 共享 `Semaphore(_ANSWER_CONCURRENCY=4)`，按题序收割进 `outcomes`；`failure`/降级契约不变。
- [ ] neuter：①答题改串行 ⇒ A7 并发红；②信号量失效 ⇒ A7 截流红；两处反证面不相交，还原复绿。
- [ ] 门禁：knowledge/eval 面 + ruff 双净。
- [ ] 实测：4 题基准两遍复跑（`bench_l2_concurrency.py`）+ Task 4 的 17 题全程账对比。
