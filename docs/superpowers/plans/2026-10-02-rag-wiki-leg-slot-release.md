# RAG 百科腿放槽 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-02-rag-wiki-leg-slot-release-design.md](../specs/2026-10-02-rag-wiki-leg-slot-release-design.md)
**Status:** 🔨 **已定稿开工（2026-10-02）**——D1=乙 / D2=乙 已拍；Task 0 四项核实已回填（本笔），进 Task 1。

**Architecture:** `process_document` 写完 `ready` 后 `self._spawn_wiki(kb_id, embedder)`（`:416` 一行改）→ 同步判忙（worker 本地 busy 集 ∪ `wiki_generation_in_progress`）→ 不忙则 `asyncio.create_task(_maybe_generate_wiki…)` 入 `self._wiki_tasks`（`wait_idle`/`stop` 排干）；忙则记 `pending`，运行收尾补一轮 `only_dirty=bool(existing)` 尾随增量。信号量只包文档腿。**除「谁在什么时候占槽」与 D2 的并发面收窄外，语义零变化。**

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 | 乙：派生受跟踪任务（`_spawn_wiki` + `_wiki_tasks`，`wait_idle`/`stop` 收编） | 甲（同任务出槽续跑）；丙（独立 wiki 队列） |
| D2 | 乙：单飞 + 合并（busy/pending 集，尾随增量 `only_dirty=bool(existing)`） | 甲（维持现状）；丙（`generator` 级统一闸，二期） |
| — | `backend/AGENTS.md` 口径句（工位只算文档腿） | 任何配置旋钮、UI、镜像口径 |

## 硬约束

- **断点续跑契约不动**（spec §3）：`recover()` 只重入非终态文档；wiki 腿不落 `documents.path_status`。
- **进度单调**：`ready` + 100% 先于任何 wiki 工作写入（`worker.py:415`→`:416` 不得反转）。
- **失败面只收窄**：wiki 失败只记日志、永不影响文档状态；同 KB 撞车不得互相打挂。
- **手动腿一字不动**：`already_running` / 202 载荷 / 逐触发模型解析（spec 2026-09-26 D3）全保留。
- **零 UI、零新旋钮**；判忙的 check-and-claim 必须同步段（无 `await`）。

## Task 0 — 开工前核实（4 项，回填结论再开工）

- [x] ① **触发与脏标链路全扫**：`_maybe_generate_wiki` 全仓产品调用**唯一 = `worker.py:416`** ✓；`mark_dirty_for_entities` 在 `:412`（ready 前）✓；recaption 收尾 `:851` 只标脏不触发 ✓；`_maybe_generate_wiki` 体内 = `wiki_trigger_ready` 早退（`:871-872`）→ 模型逐触发解析（`:873-879`）→ 兜底 except（`:890-891`）✓；`test_worker.py:958/981/999` 三个直呼 `_maybe_generate_wiki` 的用例不经 `process_document`，**不受落点移动影响** ✓。
- [x] ② **受影响用例清单**（逐条处置）：`test_ready_document_auto_triggers_wiki_generation`（`:492-512`，`main_llm=_WikiLLM` 真跑生成、断条目 + `upsert_wiki_entries` 计数）**受影响** → 断言前补 drain；`test_entity_resolution_failure_degrades_without_blocking`（`:551-577`，断 wiki 未被阻断）**受影响** → 同上；`test_new_document_marks_touched_wiki_entries_dirty`（`:581-608`）**轻度**：dirty 标记 `:412` 内联落库、断言即时成立，但为确定性补 drain（该用例阈值门 1/2<0.9 本就不触发，docstring 已钉）；`test_wiki_dirty_hook_failure_never_blocks_ready`（`:612-625`）**不受影响**（只断文档状态，spawn 走兜底 except 永不抛）。`wait_idle` 全消费者仅 `test_worker.py:440`/`:469`（均不断 wiki 产物）⇒ 扩 drain 安全；smoke（`test_e2e_smoke.py:144`/`test_phase2_smoke.py:126`）走 `stop()` + API 轮询。
- [x] ③ **生命周期面**：`wait_idle`（`:278-287`）= queue.join + inflight gather ⇒ `_wiki_tasks` 排干加在其后、**循环判空**（D2 尾随会再入任务）；`stop()`（`:235-242`）= dispatcher cancel → inflight gather ⇒ `_wiki_tasks` 同法 gather。**外层停机上限既有**：`app.py:430` `wait_for(worker.stop(), 5.0)`（常量 `:66`），超时取消传播到被 gather 的任务——今天卡 15 min 的生成同样被 5s 掐断，放槽前后同形。`test_concurrency_cap_respected`（`:415-445`）峰值断言只量 `parse_fn` 并发（wiki 不经 parse）⇒ 不受影响。
- [x] ④ **跨路径闸核对**：`wiki_generation_in_progress`（`generator.py:69`）读 `_IN_FLIGHT`，`generate_wiki` 在首个 await 前 `+1`（`:403`）、finally 归还（`:461-465`）⇒ worker 运行期间手动闸命中 ✓。双向判据：worker 在飞 → `trigger_wiki_generation` 回 `already_running`（`knowledge_service.py:573-576`）；手动在飞 → worker 判忙推迟、收尾尾随 ✓。原子性：worker 侧 check-and-claim 全同步（判忙与 busy 集写入同一同步段）✓。**残余窗口（登记不改）**：worker claim 到 `_IN_FLIGHT +1` 之间隔 `wiki_trigger_ready` 一次 DB 查询（ms 级），此窗内手动触发可与 worker 运行重叠——既有形态（手动闸早就有），放槽不放大；丢活面由 D2 尾随兜住。

## Task 1 — RED→GREEN 放槽（D1=乙）

- [x] **RED①**：`test_a_hanging_wiki_leg_does_not_block_new_documents`——`generate_wiki` 换挂起 stub + `wiki_trigger_ready` 恒 True（隔离阈值门），W=2：doc-1 走完触发挂起后同批提 doc-2/3 → **红（正确红因）**：`new documents never entered the pipeline while the wiki leg hung`（挂起腿吃掉 1 槽，doc-3 卡死在 `uploaded`，parse 峰值 0）。
- [x] **RED②**：`test_wait_idle_covers_the_detached_wiki_leg`——契约守卫（改前内联形态天然绿，"移动但不收编"才红）。**写法修正一笔**：首版把读取放在 `stop()` 之后，被 `stop()` 的 gather 兜住 ⇒ neuter① 反证不出差异；改为「`wait_idle` 与 `stop` 之间读条目」后该点位才真正钉住 `wait_idle`；stub 写入延迟定 0.2s（≫ 排干间隙，反证不可竞过）。
- [x] **GREEN**：`worker.py` 四处——`__init__` 加 `_wiki_tasks`；`_spawn_wiki`（`:311-323`，spawn 入 `_wiki_tasks` + done-callback discard）；`:436` 调用点 `await …`→`self._spawn_wiki(…)`；`wait_idle` 尾部循环排干 `_wiki_tasks`、`stop()` 同法 gather。三条既有用例断言点后补 `await worker.wait_idle()`（`:492`/`:551`/`:581` 三处，各带一行注释）。`test_worker.py` **35/35 全绿**。
- [x] **neuter①**：摘掉 `wait_idle` 的 wiki 排干 → `test_wait_idle_covers_the_detached_wiki_leg` **红（entries 空）** → 还原转绿。
- [x] **neuter②**：调用点回退槽内 `await` → `test_a_hanging_wiki_leg_does_not_block_new_documents` **红（entered False）** → 还原转绿。
- [x] 门禁：`tests/knowledge` **1437 passed / 2 skipped / 3 failed**（2026-10-02）——3 条全非本对：`test_embed_missing_api_key` / `test_rerank_missing_api_key` = **环境红**（本机 env 带真 key ⇒ 期望的 `*AuthError` 不抛、反而发出真调用）；`test_progress_callback_monotonic_under_concurrency` **复跑即绿**（flake，且不触 worker）。ruff check/format 两文件双净。

## Task 2 — RED→GREEN 单飞+合并（D2=乙）

- [x] **RED①**：`test_same_kb_wiki_triggers_are_single_flight`——5 连发 `_spawn_wiki` + 挂起 stub 记并发峰值 → **红（5 重叠）**。⚠️ 首版计时竞速假绿（peak 真值=1：配置冷启/DB 让 5 任务全落在 release 之后、stub 串行）⇒ 改事件驱动（首入桩后定住 1s 让红侧攒堆）后红因才真。
- [x] **RED②**：`test_wiki_triggers_during_a_run_coalesce_into_one_trailing_run`——在飞期间 3 连发 → **红（got 4：4 轮重叠）**。
- [x] **RED③（跨路径）**：`test_worker_defers_wiki_while_a_manual_run_is_in_flight`——手动在飞时 worker 触发必须让路、事后恰好跑 1 次 → **红（worker run overlapped the manual run）**。
- [x] **GREEN**：`_spawn_wiki` = 同步 claim（`_wiki_pending` 记意图 + `_wiki_busy` 单飞）→ 每 KB 一个 `_wiki_runner` 循环（消费 pending → `wiki_generation_in_progress` 在飞则等 0.5s 轮询让路 → `_maybe_generate_wiki`，其 `only_dirty=bool(existing)` 即尾随口径）；`wait_idle` 排干无需改（尾随在同一 runner 任务内，无新任务）。**注**：claim 只按 worker 自己的 busy 集判（union 进 `wiki_generation_in_progress` 会让推迟的触发无人认领）；跨路径互斥放在 runner 体里等 manual 排空——效果=双向不重叠 + pending 不丢，与 D2 表述同义。`test_worker.py` **38/38 全绿**。
- [x] **neuter**（三连反证）：**A 摘尾随循环** → RED② 红（`got 1`＝丢活实证）；**B 摘 claim（回退每触发一任务）** → RED①② 双红（`5 overlapped`/`got 4`）；**C 摘跨路径等待** → RED③ 红（overlapped）。三处均还原转绿。
- [x] 门禁：`tests/knowledge` **1441 passed / 2 skipped / 2 failed**（2026-10-02）——2 条即 Task 1 已定性的环境红（`test_embed_missing_api_key`/`test_rerank_missing_api_key`，本机 env 带真 key）；`test_worker.py` 38/38 全绿；ruff check/format 两文件双净。
- [x] **重启残余面（2026-10-02 审查补，如实登记）**：`_wiki_pending`/`_wiki_busy` 是 worker 实例级内存集、**重启即丢**——兜底链存在：dirty 标记落库（`worker.py:412`）+ `wiki_trigger_ready` 每次文档完成重算阈值 ⇒ **下一篇文档的 `only_dirty` 补跑**；但 **若之后再无新文档，剩余 dirty 只能等手动按钮**（spec §3 硬约束 1 / §5 非目标已登记"下一次触发或手动按钮补"，本格补进验收口径防 Task 4 踩空）。与放槽前同形：重启丢一轮在飞生成是既有行为，本对不放大。

## Task 3 — 文档

- [x] `backend/AGENTS.md` Ingestion 段补口径：百科腿在槽外（`ready` 即放槽）、`worker_concurrency` 只算文档腿、同 KB 触发单飞+合并（`_spawn_wiki`/`_wiki_runner`）、手动按钮 `already_running` 不变、内存集重启即丢+dirty 兜底链（2026-10-02 审查两缺口一并写入）。
- [x] spec 回填：D1/D2 已裁（`a420ed8c`）+ D2 **实施口径修正**（claim 只判 worker busy 集——union 进 `wiki_generation_in_progress` 会让推迟触发无人认领；跨路径互斥移到 runner 体 0.5s 轮询让路，效果与表述同义）。

## Task 4 — 真栈验收（复刻 Task 4 撞车窗口，回填真实数字）

- [ ] 撞车复刻：临时库 + 手动「全部重建」占住 wiki 期间新传两篇 → 两篇同批并发入流水线（双 `progress_percent` 序列重叠、总时长不劣于两篇串行之和），**全程不重启网关**（上一对靠重启解撞车，本对要证明不重启也能并发；重启会丢 pending/在飞生成，见 Task 2 重启残余面格）；对照登记放槽前行为（排队）。
- [ ] **负载叠加核对（2026-10-02 审查补）**：撞车复刻窗口记**抽取腿单发耗时**（`gateway.log` 逐请求时间戳口径，同图谱并发对 Task 4 仪器）对比无 wiki 并发的基线带——不劣化才算过。预期影响小（百科生成是串行单发、不占抽取 8 路并发预算），但未实测不得当免检。
- [ ] 生成正确性抽查：尾随增量吃掉新文档的 dirty 标记（新增实体条目落库、`last_run: succeeded`）。
- [ ] 收尾：临时库 DELETE 级联、验收账号删除、scratch 留仓外、仓库 `git status` 无本 Task 产物。

## 收尾

- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交。
