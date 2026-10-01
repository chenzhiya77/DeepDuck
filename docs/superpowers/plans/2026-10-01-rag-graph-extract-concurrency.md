# RAG 图谱腿 chunk 级并发 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-01-rag-graph-extract-concurrency-design.md](../specs/2026-10-01-rag-graph-extract-concurrency-design.md)
**Status:** **待开工（2026-10-01 起草，与 spec 同批成对；同日两轮追补 §2.1/D7/D8）**。待拍：无（D1–D8 已裁，见 spec；D8＝思考 A/B「放一起」并入本对）。复选框共 **32**（Task 6 为条件任务，仅 A/B 判定"值得"时执行）。

**Architecture:** `config.yaml → RagConfig.extract_concurrency`（默认 8，`ge=1, le=32`）→ worker 进图谱腿时 `get_app_config()` 现读（`table.card_mode` 先例，热生效）→ `index_document_graph(..., concurrency=N)` → `Semaphore(N) + gather` 并发跑 pending chunks，每 chunk 结果回传统一结算；`extract_graph` 内对 API 级瞬态错误退避重试 2 次后按 chunk 软失败。**除执行顺序（串行→并发）与 D3 的失败面收窄外，语义零变化**。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 | `graph/indexer.py` chunk 循环并发化（结果回传 + 结尾两笔批写不动） | 腿间并行（D6） |
| D2 | `rag.extract_concurrency`（默认 8，实测膝点）+ worker 现读传参 | 代码常量（乙已否） |
| D3 | `extract_graph` 瞬态重试 2 次 + chunk 软失败 | 改 `factory.py:402` 的 `max_retries`；整篇级重试 |
| D4 | gleaning 留 chunk 内串行（一行不动，只在用例里钉住） | gleaning 并行/可配 |
| D5 | — | 实体名 embed 攒批（`indexer.py:166`，二期） |
| D8 | 双库思考 A/B（Task 5，`extract_graph` 的 `llm=` 注入、零产品代码改动）+ 条件旋钮（Task 6） | A/B 常态化；输出瘦身 / `gleaning_rounds` 可配（仍二期待裁） |

## 硭约束

- **断点续跑契约不动**：`pending` 过滤（`indexer.py:132`）与 `extract_status` 逐 chunk 落库是并发化的前提，任何"先聚合再落库"的改法都算违约。
- **进度单调 + 输出保序**：`progress_callback`（`worker.py:348-350`）在并发下必须单调不减、终值 = total；结算按 `pending` 输入序归并，`stats`/落库与串行版逐项含顺序等价（Task 0 ①②）。
- **失败面只收窄不放大**：D3 之后，任何单 chunk 失败（解析失败或瞬态耗尽）只标该 chunk `failed`，不得把整篇文档打成 `failed`。
- **默认值有实测背书**：N=8 的依据是 2026-10-01 真调用三组数据（spec §2）；换端点按 spec §2 公式重推，不许把 8 当真理。
- **A/B 对照变量唯一**（spec §3.6）：双库除 thinking 外逐参相同（同模型/同 N/同 chunker/同 embedding），否则对比无效；B 组慢是预期，不许"优化掉"。

## Task 0 — 开工前核实（4 项，回填结论再开工）

- [x] ① **顺序断言清单**（`tests/knowledge/graph/test_graph_indexer.py` 全 5 用例扫完）：**唯一真顺序断言 = `:185` `stats.failed_chunk_ids == [c1, c2]`**。处置升级：**不改断言，改实现保序**——gather 后按 `pending` 输入序归并结算，输出与串行版**逐项含顺序**等价（契约更强）。其余断言全为计数/集合/sorted/按 key 取值（`test_end_to_end` :126-140/:144-146/:155-157/:166-169；`test_resume` :216-223（单 pending ⇒ `calls[0]` 恒定）；`:240`、`:266-268`）⇒ **全部不动**。桩安全：`_RoutingLLM` 按内容路由、`_StubEmbedder` 确定性 one-hot，均并发安全；⚠️ 并发后 `llm.calls` 顺序不定，新用例断言调用只用计数/集合。
- [x] ② **并发化插入点与收集面**：循环体 `indexer.py:146-178`、结尾批写 `:180-202` 复核无误。三收集点在"每任务返回结算、主协程按 pending 序归并"下与串行逐项等价：`backfill`（dict 按 key 合并）/ `touched_entities`（set 并）/ `stats`（计数 + 保序列表）；`degraded` 在归并后由 `failed/total` 算（`:204`）不变。per-chunk `update_chunk_extract` 是独立行写、乱序无害；`settled += 1` 与 `await _report()` 无让出点竞争、单调成立；结尾两笔批写保持主协程单次执行。SQLite 并发写：`worker_concurrency=2` 今天已跨文档并发写同库 ⇒ 同文档并发不引入新级别，无需额外锁。
- [x] ③ **参数贯通点**：新字段插 `app_config.py:241`（`worker_concurrency`）之后（`extract_rate_limit_rps` 已删、位置确认）；`indexer.py:116` 签名加 `concurrency: int = 1`；调用点 `worker.py:355-367`。**读取=图谱腿入口现读 `get_app_config().rag.extract_concurrency`**（`worker.py:352` 附近；`:518` card_mode 先例、`get_app_config` 已导入）⇒ 热生效、**`app.py:355` 不动**（不经构造器）。`gleaning_rounds` 走构造器（`worker.py:193/206`）与现读策略分属不同参数，确认无冲突。
- [x] ④ **文档/模板落点**：`config.example.yaml:2626`（rag 块 `worker_concurrency: 2` 行后加 `extract_concurrency: 8`）；`backend/AGENTS.md` 两处（`:1230` Ingestion 段补并发句+重推公式+D7 三标准；`:940` Routers 表 rag 配置块清单加 `extract_concurrency`）；`backend/tests/test_rag_config.py` 复用槽位三模式（`test_loads_defaults` :11 / `test_overridable_from_dict` :21 / `test_rejects_invalid_worker_concurrency` :47）。

## Task 1 — 并发化（RED → GREEN）

- [x] **RED① 并发上限生效**：`test_concurrency_bounds_inflight_extractions`（C=12、N=4，桩记录在飞峰值）——今日串行实现下红（3/3 红，`TypeError: unexpected keyword argument 'concurrency'`）。
- [x] **RED② 结果等价**：`test_concurrent_results_match_serial_including_order`——含"完成序≠输入序"前置断言（`坏一` 延迟 0.05s 强制反转）+ `failed_chunk_ids == [c1, c4]` 输入序契约（`:185` 断言不动）。RED 期同 TypeError 红。
- [x] **RED③ 进度单调**：`test_progress_callback_monotonic_under_concurrency`——snapshot 单调不减 + 终值 = total。RED 期同 TypeError 红。
- [x] **GREEN**：`graph/indexer.py` 循环改 `Semaphore(max(1, concurrency)) + gather`（每任务返回 `(kind, chunk_id, names)`、gather 保输入序、主协程按 `pending` 序归并 stats/backfill/touched）；`app_config.py:242` 加 `extract_concurrency`（默认 8，`ge=1, le=32`，描述含重推公式）；worker `:357` 图谱腿入口现读传参（热生效、**`app.py` 零改动**）；`test_rag_config.py` 三处（默认 8 / 覆写 4 / 拒绝 0 与 33）。三条 RED 全绿。**两笔实现期插曲**：① RED 期两条红的根因在桩不在实现（桩无让出点 ⇒ 峰值恒 1；空切片文本缺路由落坏 JSON 默认）——修桩后即绿；② video 8 条**真回归**（测试夹具 `SimpleNamespace` 桩缺新字段 ⇒ `AttributeError`）——按仓库惯例改夹具（`test_worker_pipeline.py:125` / `test_recaption.py:94` 补 `extract_concurrency=1`），非实现防御。
- [x] **neuter①②**：① `Semaphore` 置 1 ⇒ RED① 红（峰值 1）、RED③ 仍绿；RED② 的**前置断言**也红（串行无反转）——原预测"RED② 仍绿"只对契约断言成立，前置断言红属预期（如实登记）；② 归并改 `reversed(outcomes)` ⇒ RED② 红（`failed_chunk_ids` 反序）、RED①③ 仍绿。两项均还原，`grep DEBUG-neuter` 零残留。
- [x] **门禁**：`make lint` 净 + 7 改动文件 `ruff format --check` 净；`tests/knowledge/graph/ + video/ + test_rag_config.py` = **274 passed / 8 skipped**；知识树全量 = **1466 passed / 2 failed / 1 error**，逐条定性：2 failed（`test_embed_missing_api_key` / `test_rerank_missing_api_key`）＝**环境性**（仓库根真实 `rag_config.json`/`models_config.json` 供 key；空配置指针实验下转绿坐实，非回归家族）；1 error（`test_only_dirty_prune_removes_vector_point`）＝**Qdrant 未起**（Docker Desktop 未运行；8 条 `@requires_qdrant` 同因 skip）——**待你起 Docker 后复跑这 9 条**。

## Task 2 — 瞬态兜底（RED → GREEN）

- [x] **RED④ 瞬态软失败**：`_FlakyLLM` 桩（按针前 N 次抛调用级错误、之后放行）三条用例——①`test_transient_llm_error_retries_then_recovers`（第 1 次抛、第 2 次成功 ⇒ chunk 正常 done）②`test_transient_llm_error_soft_fails_chunk_not_document`（连抛 ⇒ chunk `failed` + `error` 有原因、其余 chunk 不受影响、`documents.error` 不动）③`test_transient_llm_error_retry_budget_is_two_retries`（**预算钉**：恰好 3 次尝试后放弃）。RED 期 3/3 红，穿透点=今日整篇打挂路径（`extractor.py` `ainvoke` → gather → worker 外层）。
- [x] **GREEN**：`extractor.py` 加 `ExtractionCallError(ExtractionError)` + `_ainvoke_with_retry`（共 3 次尝试、0.5s×2ⁿ 退避，`embedder_openai.py:198-214` 同风格；首轮与 gleaning **两处** `ainvoke` 调用点都走它）；耗尽后抛 `ExtractionCallError`——**子类**继承 ⇒ 被 `indexer.py` 既有 chunk 级 catch 按「与 `ExtractionError` 同路径」转软失败（`_run_one` / `extract_single_chunk` 零改动 ride-along，`indexer.py` 最终与 HEAD 零差=与 §源文件清单一致：D3 只落 extractor.py）；解析失败（`ExtractionError` 本体）不参与重试、路径不动。3 条转绿。
- [x] **neuter③**：①`_RETRIES=0`（去重试）⇒ RED④ 前半红（无恢复）、**后半仍绿**（软失败不依赖重试）✓计划原文；②chunk 级 catch 改 `raise` ⇒ RED④ 后半红（整篇打挂）、前半仍绿 ✓计划原文。**如实登记**：预算钉③在两个 neuter 下都红（它同时钉重试次数与软失败落地）——计划原文只预测 RED④ 两半的分布。两项均还原，`grep DEBUG-neuter` 零残留。
- [x] **门禁**：`make lint` 净 + 3 改动文件 `ruff format --check` 净；**影响集复跑 = 277 passed / 8 skipped**（对记录基线 274/8 差额恰为新 3 条、skip 数一致 ⇒ 零回归）；`tests/knowledge/ + test_rag_config.py` 全套 = **1413 passed / 50 skipped / 2 failed / 1 error**：50 条 skip 全部「Qdrant not reachable」（Docker 未起，含上框那 9 条待复跑名单在内）；2 failed（`test_embed_missing_api_key` / `test_rerank_missing_api_key`）+ 1 error（`test_only_dirty_prune_removes_vector_point`）＝Task 1 已定性的三条**环境红**（空配置指针实验坐实 / Qdrant 未起），**无新增红**。**口径注记**：上文 Task 1「知识树全量 1466 passed」与本次 collected=1466 同数异义（本次=1413+50+2+1，其中 knowledge 树 1440 条 + `test_rag_config.py` 26 条；knowledge 树较 Task 1 时恰 +3=本框新增用例，收集面别无变化）——判为 collected 口径误记，非回归；若要钉死可跑 HEAD worktree A/B 全量双向 diff。

## Task 3 — 文档与模板（同批，不另起）

- [ ] `backend/AGENTS.md`：RAG 知识库段补一句"图谱腿 chunk 级并发（`rag.extract_concurrency`，默认 8，实测膝点）"+ 换端点重推公式 + D7 选型三标准（不带思考/JSON 遵从/解码快）。
- [ ] `config.example.yaml` rag 块补 `extract_concurrency: 8`（与 `worker_concurrency` 相邻）。
- [ ] spec §6 影响面核对：源文件数、配置键数与实际改动一致（不一致就地更正 spec）。

## Task 4 — 真栈验收（前后对照，回填真实数字）

- [ ] 前测基线：当前 HEAD（未并发化）重传一篇 13 chunk 级 docx（或 retry），记图谱腿墙钟 = ____s（预期 ~290s 口径）。
- [ ] 后测：GREEN 后同文档同法重传，图谱腿墙钟 = ____s；验收线 **≤ 90s**（spec §5）。
- [ ] 失败面核对：`extract_status=failed` chunk 数与串行基线持平（并发不新增失败）。
- [ ] 双文档并发（`worker_concurrency=2`）总时长不劣于两篇串行之和；`progress_percent` 前台观察单调。
- [ ] 真栈收尾：改过的配置逐字节还原（若有），临时库/临时文档清理，探针脚本零残留（`_t_probe.py` 已删）。

## Task 5 — 思考 A/B（D8，并入本对；零产品代码改动）

- [ ] **A/B① 对照准备**：定测试文档集 + golden 锚定（对齐 `backend/tests/fixtures/rag_eval/golden.jsonl` 的口径；缺锚定就先补 golden 问题再跑）；一次性驱动脚本走 `extract_graph(llm=...)` 注入（`extractor.py:128`），A 组 `create_chat_model(..., thinking_enabled=False)`、B 组 `True`，同条目同参。脚本不入产品代码、跑完删。
- [ ] **A/B② A 组入库**（思考关＝现状口径）：记抽取成本账（token / 墙钟 / failed chunk 数）。
- [ ] **A/B③ B 组入库**（思考开）：同口径记账；预期单发慢 ~2.5×、token 贵一个量级（spec §3.6 已提示，属预期不许"优化掉"）。
- [ ] **A/B④ 双跑 Layer-1**：`backend/scripts/run_rag_eval.py` 对 A/B 两库各跑一遍（同 golden、同 top-k），回填 **Recall@k 分 category 对比表 + 成本账**到本 Task。
- [ ] **A/B⑤ 判定交拍**：对比表交用户拍板（建议门槛：提升 <3 个百分点 ⇒ 不值得）；结论回写 spec D8（"补旋钮"或"D7 转正"）。

## Task 6 — （条件任务，仅 A/B 判定"值得"时执行）思考旋钮

- [ ] **T6①** `rag.extract_thinking` 新键（默认 false）+ `get_extract_llm` 传参一行（`extractor.py:125` 处把开关透传 `create_chat_model`）。
- [ ] **T6②** 用例：开/关两态构造断言（请求体 `thinking:{type:enabled/disabled}` 各钉一条）+ `test_rag_config.py` 键校验。
- [ ] **T6③** 文档三处（AGENTS.md / config.example.yaml / spec 回写"已交付"）。
- [ ] **T6 替代路径**：若 A/B 判定"不值得"——本 Task 不执行，勾此行写明"不值得，D7 转正"即关闭。

## 交付回写

- [ ] 完成后回写本文件 Status（提交号 + 复选框计数 + 实测表），并同步 spec Status 行一句"已交付"。
