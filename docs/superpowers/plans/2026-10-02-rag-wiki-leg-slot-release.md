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

- [ ] **RED①**：新用例「同 KB 触发单飞」：N 次并发 `_spawn_wiki`（stub 挂起）→ 断 `generate_wiki` 同时在飞 ≤1 → 红。
- [ ] **RED②**：新用例「在飞期间触发合并为一次尾随」：运行中再触发 k 次 → 收尾后恰好再跑 1 次（`only_dirty=bool(existing)` 口径），k=0 时不跑 → 红。
- [ ] **GREEN**：busy/pending 集（worker 实例级）+ 收尾尾随循环；判忙含 `wiki_generation_in_progress`（手动在飞→推迟）。
- [ ] **neuter**：去掉 pending 尾随 → RED② 反证红（丢活）→ 还原。
- [ ] 门禁：`tests/knowledge` 全绿、ruff check/format 干净。

## Task 3 — 文档

- [ ] `backend/AGENTS.md` Ingestion/并发口径：补「百科腿在槽外（`ready` 即放槽），`worker_concurrency` 只算文档腿；同 KB 生成触发单飞+合并」句。
- [ ] spec 回填裁定（D1/D2 转「已裁」）与实施中发现的口径修正。

## Task 4 — 真栈验收（复刻 Task 4 撞车窗口，回填真实数字）

- [ ] 撞车复刻：临时库 + 手动「全部重建」占住 wiki 期间新传两篇 → 两篇同批并发入流水线（双 `progress_percent` 序列重叠、总时长不劣于两篇串行之和），**全程不重启网关**；对照登记放槽前行为（排队）。
- [ ] 生成正确性抽查：尾随增量吃掉新文档的 dirty 标记（新增实体条目落库、`last_run: succeeded`）。
- [ ] 收尾：临时库 DELETE 级联、验收账号删除、scratch 留仓外、仓库 `git status` 无本 Task 产物。

## 收尾

- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交。
