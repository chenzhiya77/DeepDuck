# RAG 评测运行进度 Implementation Plan(轮询自锁修复 · 工具栏进度)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复"触发后总览/题库无运行态、切历史才复活"的轮询自锁 bug(乐观置位 in_flight);并为运行中评测加工具栏进度:按钮"运行中… k/N" + 工具栏底缘 h-0.5 细进度线(questions 定长 / layer1·ragas 不定长 pulse),数据走 `GET /eval-runs` 顶层 `progress` 字段复用 3s 轮询。

**Spec:** `docs/superpowers/specs/2026-09-06-rag-eval-run-progress-design.md`(已定稿:表面仅工具栏)

**基线:** `d92eadae`(分支 `feat/rag-knowledge-base`)

**Architecture:** 后端 `ondemand.py` 增模块级 `_PROGRESS: dict[kb_id, Progress]`(_IN_FLIGHT 同款单进程内存模式);phase 三段 layer1→questions→ragas,落库/finally 清除。进度更新点挂在 `ragas_eval.run_layer2_evaluation` 的**新增可选 progress hook**(签名 `(phase, done, failed, total)`,ondemand 注入闭包写 _PROGRESS;hook 缺省=None 时行为零变化,CLI 与既有测试不受影响)。service `list_eval_runs` 响应 dict 增顶层 `progress`(非 in_flight 时 null)。前端 trigger onSuccess enqueued 时乐观 `setQueryData` 置 in_flight=true(无缓存退化 invalidate)打破轮询自锁;工具栏按钮文案与底缘细线消费 `runsQuery.data.progress`,纯函数判定收 `eval-run-status.ts`。

**Tech Stack:** FastAPI + SQLAlchemy(backend,无 migration)+ React 19 + TanStack Query + TypeScript(frontend);后端 `pytest`,前端 `rstest` + `pnpm check` + `ruff`。

**Global Constraints:**
- Branch: `feat/rag-knowledge-base`;每个 task:RED → GREEN → revert proof → commit(Conventional Commits,**English subject only,无 body**)。
- Backend TDD mandatory:`cd backend && uv run pytest <file> -q`;frontend `python scripts/pnpm.py test <filter>`。
- 契约冻结(spec §3):`progress = {run_id, phase, done, total, failed, started_at, updated_at} | null`,实施后不得增删键。
- 语义纪律:ragas/layer1 段**不假百分比**(不定长 pulse);failed 独立不从 done 扣;单题失败 done 仍计。
- i18n 纪律:`tk.eval.runningProgress(done, total)` 函数键 + phase 词三处同步(types/zh-CN/en-US)。
- 高度纪律:工具栏行高 44px 锁定不变;细线 absolute 底缘不占布局高度。
- Known code facts (verified 2026-09-06):
  - 自锁链:`hooks.ts::useEvalRuns` refetchInterval = `evalRunsRefetchInterval(data)`(in_flight=false → false);eval-tab 注释明载"POST 不失效,避免与首次轮询双请求";`eval-run-history.tsx:39` 第二个 observer 挂载 refetch 打破死锁。
  - `eval-tab.tsx::handleTrigger`(L190-204):onSuccess 按 202 status 分流 toast——乐观置位加在此处(queryClient 已在作用域)。
  - 每题循环在 `ragas_eval.py::run_layer2_evaluation`(L670-693 citation judge 循环;ragas evaluate 在同函数后段)——hook 两处调用:每题毕(questions)、ragas 始(ragas)。
  - `ondemand.py::_IN_FLIGHT`(L58-69)与 finally 递减模式——_PROGRESS 清除挂同 finally。
  - service `list_eval_runs`(knowledge_service.py L1376-1393)响应 dict 即 /eval-runs body——progress 在此拼。
  - `eval-run-status.ts`:isEvalRunning / evalRunsRefetchInterval 纯函数先例——progress 判定纯函数同居。
  - 工具栏容器:eval-tab 常驻工具栏行 div(tier0/tier1 两档渲染)——细线需父级 relative,两档共用一个包裹层加线。

---

## Phase 1: 后端进度模型

## Task 1: ondemand `_PROGRESS` + run_layer2_evaluation progress hook

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/eval/ondemand.py`(+`_PROGRESS` 注册表 + `get_eval_progress(kb_id)`;run_full_eval_for_kb 三段置位(layer1 始/questions 始 via hook/ragas 始 via hook)+ finally 清除;run_layer1_for_kb layer1 瞬段)
- Modify: `backend/packages/harness/deerflow/knowledge/eval/ragas_eval.py`(run_layer2_evaluation +可选 `progress_hook` 参数:每题(agent+judge 毕)回调 ("questions", done, failed, total);ragas evaluate 前回调 ("ragas", total, failed, total);hook=None 零行为变化)
- Modify: `backend/tests/knowledge/eval/test_ondemand.py`(+progress 用例)

- [x] RED test:full run 结束后 `get_eval_progress` == None(finally 清除);运行中(hook 注入假件暂停)phase/done/failed 递增正确;单题失败 failed++ 且 done 仍计;layer1-only run 结束后 None;hook 缺省时 run_layer2_evaluation 行为不变(既有用例全绿即证)。
- [x] Run `cd backend && uv run pytest tests/knowledge/eval/test_ondemand.py -q` 记录 RED。(RED: 2 failed + 32 errors；注：Windows 临时目录权限问题需 `--basetemp=.pytest-tmp`)
- [x] Implement。
- [x] GREEN;revert proof。(62 passed；stash 还原实现后新测试红)
- [x] ruff check/format 双净。
- [x] Commit: `feat(rag): track on-demand eval run progress in memory`(117792ba)

## Task 2: `GET /eval-runs` 响应顶层 progress

**Files:**
- Modify: `backend/app/gateway/services/knowledge_service.py`(list_eval_runs 响应 +`progress: ondemand.get_eval_progress(kb_id)`)
- Modify: `backend/tests/knowledge/test_eval_runs_api.py`(in-flight mock 带 progress 透出;idle 时 null)

- [x] RED test(上述两案)。(RED: 3 failed——含既有精确 shape 用例同步加 `progress: None`)
- [x] Run `cd backend && uv run pytest tests/knowledge/test_eval_runs_api.py -q` 记录 RED。
- [x] Implement。(service 导入 `get_eval_progress`，响应拼 `progress` 键；router 无 response_model 直接透出)
- [x] GREEN;revert proof;ruff 双净。(41 passed；stash 还原后 3 failed)
- [x] Commit: `feat(rag): expose eval run progress on eval-runs list endpoint`(340e1820)

---

## Phase 2: 前端 bug 修复与工具栏进度

## Task 3: enqueued 乐观置位 in_flight(轮询自锁修复)

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(handleTrigger onSuccess:`status==="enqueued"` → `setQueryData(knowledgeEvalRunsKey(kbId), old => old ? {...old, in_flight: true} : old)`,无 old 则 invalidateQueries)
- Modify: `frontend/tests/unit/knowledge/eval-tab.dom.test.tsx`(触发后**不切视图**:runs mock 仍 in_flight=false 时按钮立即 running 态且 refetchInterval 路径激活——断言 setQueryData 调用/按钮文案)

- [x] RED test。(RED: 2 failed | 39 passed，精确命中新增两案)
- [x] Run `python scripts/pnpm.py test eval-tab` 记录 RED。
- [x] Implement。(含 `EvalRunListResponse` 类型导入；依赖数组 +kbId +queryClient)
- [x] GREEN;revert proof。(41/41；stash 还原 eval-tab.tsx 后 5 failed 含既有上期用例)
- [x] Commit: `fix(rag): optimistically set eval in_flight on enqueued to start polling`(99ca1f2a；注：eval-tab 两文件混有上期未提交工作，用 hunk 级选择性暂存——git diff --output 生成 patch + 按标记抽取 + git apply --cached --recount，余下上期 hunk 完好留在工作区)

## Task 4: 工具栏按钮 k/N 文案 + 底缘细进度线

**Files:**
- Modify: `frontend/src/core/knowledge/eval-run-status.ts`(+纯函数:`progressLabel(progress)`(questions → {done,total},否则 null)/ `isIndeterminatePhase(progress)`(layer1/ragas/null)/ aria 文案组装)
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(按钮文案 questions 段 "运行中… k/N"(tabular-nums)+ aria-label(phase 词+k/N+failed);工具栏包裹层 relative + 底缘 `absolute bottom-0 inset-x-0 h-0.5` 细线:determinate 宽 = done/total,indeterminate = pulse;非运行态不渲染;tier0/tier1 共用包裹层)
- Modify: `frontend/src/core/i18n/locales/{types,zh-CN,en-US}.ts`(+`runningProgress(done,total)` / `phaseLayer1/phaseQuestions/phaseRagas` / `failedCount(n)`)
- Modify: `frontend/tests/unit/knowledge/eval-run-status.unit.test.ts`(纯函数三案 + 降级 null)
- Modify: `frontend/tests/unit/knowledge/eval-tab.dom.test.tsx`(progress mock → 按钮 k/N + 细线 determinate 宽样式;layer1 mock → 无数字 + pulse 类;null+in_flight → 现状文案)

- [x] RED test(unit + dom)。(unit RED: 11 failed；dom RED: 3 failed（questions/layer1/无progress），空闲态例 trivially pass)
- [x] Run `python scripts/pnpm.py test eval-run-status; python scripts/pnpm.py test eval-tab` 记录 RED。
- [x] Implement。(额外：`core/knowledge/types.ts` 新增 `EvalRunProgress` + `EvalRunListResponse.progress?`；`eval-run-status.unit.test.ts` 为新建非 Modify；ESLint prefer-optional-chain 将 `!p || p.phase!==x` 改为 `p?.phase!==x`)
- [x] GREEN;revert proof;`python scripts/pnpm.py check` 净。(eval-run-status 11/11、eval-tab 45/45；stash 还原两实现文件后 RED；check eslint+tsc 双净)
- [x] Commit: `feat(rag): show eval run progress in toolbar button and edge line`(2659d1ce；注：eval-tab.tsx/zh-CN.ts/eval-tab.dom.test.tsx 混上期工作，hunk 级选择性暂存；混合 hunk `@@ -268` 行级改造——剔上期滞动注释、保留 relative；提交快照只读验证零上期符号)

---

## Phase 3: 回归与验收

## Task 5: 全量回归 + spec §7 验收

- [x] `cd backend && uv run pytest tests/knowledge/eval tests/knowledge/test_eval_runs_api.py -q` 全绿。(**343 passed**；`.pytest_cache` 权限 warning 无害，需 `--basetemp=.pytest-tmp`)
- [x] `python scripts/pnpm.py test knowledge` 套件回归(唯一允许失败:预存 chat-panel 用例)。(**61 files passed | 1 failed**；唯一失败 = `chat-panel.dom.test.tsx` model selector “restores the remembered model per kb”，断言 `context.model_name` 期望 'qwen-plus' 得 undefined——属 KnowledgeChatPanel 模型 per-kb 记忆逻辑，与本期 eval-tab/eval-run-status/types/i18n 零交集，**非本期引入**)
- [x] `python scripts/pnpm.py check` + ruff 双净。(eslint + tsc 无错；ruff check/format 6 个改动文件双净)
- [ ] 手动验收(spec §7，**待用户 UI 实测**):点击完整评测 → 工具栏立即"运行中…" + pulse 细线(**无需切历史**);答题段变"运行中… k/N" + 定长细线随 3s 轮询推进;ragas 段回 pulse;落库瞬间按钮复原、细线消失;L1 快速档 pulse 一下即消。
- [x] 验收结论回写本 plan 尾注。

---

## Task 5 回归结论(2026-09-06)

**自动化回归全部通过**(Task 1–4 提交后，分支 `feat/rag-knowledge-base` HEAD=`2659d1ce`):

| 项 | 结果 |
|---|---|
| 后端 ruff check + format | 双净(6 个改动文件) |
| 后端 pytest(eval + eval_runs_api) | **343 passed** |
| 前端 knowledge 套件 | **61 files passed \| 1 failed**(唯一失败 = 预存 chat-panel model-selector，已取证与本期无关) |
| 前端 pnpm check(eslint + tsc) | 双净 |

**手动验收清单**(spec §7，需启动 `make dev` 后在知识库评测 tab 实测，逐项勾选):

1. [ ] 点“完整评测”确认 → 工具栏按钮**立即**转"运行中…" + 底缘 pulse 细线，**无需切到历史视图**(验证 Task 3 乐观置位修复了轮询自锁)。
2. [ ] 进入答题段 → 按钮变"运行中… k/N"(k 随 3s 轮询递增) + 底缘细线按 done/total 定长推进。
3. [ ] 进入 ragas 段 → 细线回 pulse(不定长，不假百分比)，按钮回裸"运行中…"。
4. [ ] 落库瞬间 → 按钮复原为"运行评测"、细线消失，总览/趋势/历史自动刷新(drain 边)。
5. [ ] 点“快速评测”(L1) → 细线 pulse 一下即消(秒级，无答题段)。
6. [ ] (可选)单题失败时 → 细线 aria-label 带"失败 N"后缀(failed 独立不从 done 扣)。

> 手动验收需真实 LLM 链路(qwen3.8-flash 已配为主模型)，由用户在 UI 完成；自动化回归已覆盖后端进度模型/API 透出/前端纯函数/工具栏渲染的全部分支。

---

## Phase 4: 验收缺口修复(2026-09-06 追加,用户 UI 实测触发)

用户 UI 实测发现验收项 1 与运行态观感未达标;缺口 1 终版含**后端**根因(`progress` 冻结契约未动,仅改 `_IN_FLIGHT` 自增时机)。三个缺口均已实现+回归,**尚未 commit**。

## Task 6: 缺口1 — 触发后无运行态/非切历史不复活(轮询竞态)

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(乐观置位改**无条件**:缓存存在并入 in_flight=true,空缓存**创建**最小条目 `{runs:[],total:0,progress:null,in_flight:true}`,删 invalidate 退化分支)
- Modify: `backend/packages/harness/deerflow/knowledge/eval/ondemand.py`(`_IN_FLIGHT` 自增前移 runner 第一行(任何 await 之前);空题库 raise 前先 `_release_run`)
- Create: `frontend/tests/unit/knowledge/eval-tab-trigger-live.dom.test.tsx`(不 mock hooks、只 mock api 的真实 useQuery 触发链路三案:立即转运行态/轮询启动/在飞旧查不覆盖乐观值)
- Modify: `backend/tests/knowledge/eval/test_ondemand.py`(`test_in_flight_incremented_before_load_questions`:load 期间断言在途已真)

- [x] 复现+根因:集成测试证明前端链路正确 → 定位后端 `_IN_FLIGHT` 晚自增窗口(trigger create_task 到 load 完成),早期 poll 读 false 覆盖乐观值、杀轮询;切历史挂第二 observer 才复活。
- [x] Implement(前端无条件乐观 + 后端自增前移)。
- [x] GREEN:后端 **344 passed**、eval-tab **50/50**、knowledge **880 passed|1** 预存无关、check/ruff 双净。
- [x] Commit:与 Task 7/8 及档位单选/工具栏收敛/去代号/趋势重设计合并为单提交 `36e16620`(eval-tab/i18n 跨功能 hunk 交织,无法原子拆分;2 个无关 research 文档保持未跟踪)。

## Task 7: 缺口2 — 运行态假状态 → 三段阶段名 + n/3

**Files:**
- Modify: `frontend/src/core/knowledge/eval-run-status.ts`(+`phaseStep`/`EVAL_PHASE_COUNT`;退役 `progressLabel`)
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(按钮文案 `runningPhase(阶段名,n,3)`;`showCounter`)
- Modify: `frontend/src/core/i18n/locales/{types,zh-CN,en-US}.ts`(`runningPhase` + 4 字 phase 词;退役 `runningButton`/`runningProgress`)
- Modify: `frontend/tests/unit/knowledge/{eval-run-status.unit,eval-tab.dom}.test.tsx`

- [x] Implement(用户定案:4 字阶段名+n/3 与 4 字按钮对齐;快速档 L1 不显计数避免"1/3 到不了 3/3";k/N 归底缘细线+aria)。
- [x] GREEN:eval-run-status **10/10**、eval-tab **50/50**。
- [x] Commit:`36e16620`(合并提交,见 Task 6 注)。

## Task 8: 缺口3 — 右键/行⋮/批量评测绕过头部按钮

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/eval-question-bank.tsx`(新增必填 `onTrigger` prop;`handleBulkTrigger` 改委托;移除自持 `useTriggerEvalRun`)
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(`onTrigger={handleTrigger}`;选择清空归 onSuccess 的 `input.question_ids` 分支)
- Modify: `frontend/tests/unit/knowledge/eval-question-bank.dom.test.tsx`(触发用例改断言 onTrigger payload)

- [x] Implement(触发权上收,禁止子组件自持 trigger mutation)。
- [x] GREEN:bank **28/28**、eval-tab **50/50**、knowledge **880 passed|1**、check 双净。
- [x] Commit:`36e16620`(合并提交,见 Task 6 注)。

**Phase 4 回归**:后端 **344 passed**(含 `test_in_flight_incremented_before_load_questions`)、前端 eval-tab **50/50**(含 `eval-tab-trigger-live.dom`)+ eval-run-status 10/10 + bank 28/28、knowledge **880 passed | 1 failed**(预存 chat-panel)、`pnpm check` 与 ruff 双净。验收项 1–3 现由自动化覆盖;仍需用户 UI 复核真实 LLM 链路观感(验收项 4–6)。

## Phase 5: 进度容器重设计(spec §9;取代底缘细线,不修直接删)

## Task 9: 后端 ragas 逐 job 进度 + progress 十键契约

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/eval/ragas_eval.py`(**实施校正**:ragas 无逐样本循环——单次批量 `evaluate`,其 Executor 按 (样本×指标) 提交 job;改为 `expected_ragas_jobs()` + `_RagasJobBar` 鸭子对象经 `evaluate(_pbar=...)` 接住每 job `update(1)`,`compute_ragas_scores` 增可选 `on_progress`;第三段 total = ragas_jobs + 逐题 citation judge,judge 循环补 hook)
- Modify: `backend/packages/harness/deerflow/knowledge/eval/factory.py`(evaluator 协议增可选 `on_progress` 透传)
- Modify: `backend/packages/harness/deerflow/knowledge/eval/ondemand.py`(entry 增 `phase_started_at`(ms)/`phase_durations`/结构化 `tail`;phase 切换结算上段耗时+重置起点;done 增→item、failed 增→fail;`get_eval_progress` 嵌套拷贝并对旧形状补默认 → 恒十键)
- Modify: `backend/tests/knowledge/eval/{test_ragas_eval,test_ondemand,test_eval_factory}.py` + `backend/tests/knowledge/test_eval_runs_api.py`(逐 job 推进/expected_ragas_jobs/协议转发/tail 与 durations/十键透出与补默认)

- [x] RED test:ragas 段 done 逐 job 递增(非进入时一次到 total);第三段含 judge 尾段单调到满;phase 切换记 duration 且 tail.kind=phase;done 增 item、failed 增 fail;evaluator 转发 on_progress。(RED:test_ragas_eval ImportError 阻断收集 + ondemand/factory 2 failed)
- [x] Run `cd backend && uv run pytest tests/knowledge/eval -q --basetemp=.pytest-tmp` 记录 RED。
- [x] Implement。(含 §3 冻结契约七键→十键的正式扩展与两处实施校正,已回写 spec §9)
- [x] GREEN;revert proof;ruff check/format 双净。(351 passed;stash 三个实现文件后 3 failed、恢复后复绿;All checks passed + 25 files already formatted)
- [x] Commit: `feat(rag): report per-job ragas progress and richer eval run registry`(本提交)。

## Task 10: 前端纯函数 加权整体分数 + ETA

**Files:**
- Modify: `frontend/src/core/knowledge/types.ts`(EvalRunProgress 增 phase_started_at/phase_durations/tail)
- Modify: `frontend/src/core/knowledge/eval-run-status.ts`(`PHASE_WEIGHT_PRIOR` 完整档 10/35/55、快速档 100;`adaptiveWeights` 段完成用实测替换先验并按先验比例重归一剩余;`overallFraction` f=已完成段权重和+当前段权重×(段内 done/total);`etaSeconds` warmup 门控 f>6% 且 elapsed>20s 否则 null,`elapsed×(1−f)/f`)
- Modify: `frontend/tests/unit/knowledge/eval-run-status.unit.test.ts`(冷启动先验/段完成自适应/f 单调/ETA warmup 与取整)

- [ ] RED test(上述四案)。
- [ ] Run `python scripts/pnpm.py test eval-run-status` 记录 RED。
- [ ] Implement。
- [ ] GREEN;revert proof。
- [ ] Commit。

## Task 11: EvalRunBanner 组件 + i18n

**Files:**
- Create: `frontend/src/components/workspace/knowledge/eval-run-banner.tsx`(单轨加权条:phase 边界 1px 刻线/当前段跨度提亮/填充连续;右侧**仅 ETA**取整分钟;第二行单行日志 tail→i18n 句、truncate、新事件淡入替换、failed 徽标、aria-live=polite)
- Modify: `frontend/src/core/i18n/locales/{types,zh-CN,en-US}.ts`(etaRemaining/etaEstimating + logPhase/logItem/logFail)
- Create: `frontend/tests/unit/knowledge/eval-run-banner.dom.test.tsx`

- [ ] RED test:条填充=f、刻线位置=累积权重、ETA warmup 前后文案、日志单行与失败徽标。
- [ ] Run `python scripts/pnpm.py test eval-run-banner` 记录 RED。
- [ ] Implement。
- [ ] GREEN;revert proof。
- [ ] Commit。

## Task 12: 总览挂载 + 退役底缘细线

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(总览视图检索质量卡上方挂载 banner,仅 in_flight、drain 卸载;删除底缘细线 JSX 与 progressFraction/isIndeterminatePhase 细线用途;按钮阶段文案保留;题库/历史不动)
- Modify: `frontend/tests/unit/knowledge/eval-tab.dom.test.tsx`(删细线断言、增容器断言:总览运行态条/ETA/日志行)

- [ ] RED test(容器断言)。
- [ ] Run `python scripts/pnpm.py test eval-tab` 记录 RED。
- [ ] Implement。
- [ ] GREEN;revert proof。
- [ ] Commit。

## Task 13: 回归 + 手动验收 + 回写

- [ ] knowledge 套件 + `pnpm check` + ruff 双净(预存 chat-panel 失败除外)。
- [ ] 手动验收(spec §9):完整档 → 总览容器出现、条随三段推进且刻度自适应、ETA warmup 后显分钟级剩余、日志单行滚动;drain 后容器卸载;快速档单段条满格即消;题库/历史按钮阶段名不变。
- [ ] 文档回写确认(spec §9 冻结、plan 本 Phase 勾选)。
