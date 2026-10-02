# RAG 百科腿放槽 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-02-rag-wiki-leg-slot-release-design.md](../specs/2026-10-02-rag-wiki-leg-slot-release-design.md)
**Status:** 📝 **已起草（2026-10-02）待审**——D1/D2 两项待拍，拍定后 Task 0 先行。

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

- [ ] ① **触发与脏标链路全扫**：`_maybe_generate_wiki` 全仓调用点（预期唯一 = `worker.py:416`）；`mark_dirty_for_entities` 在 `:412`（ready 前）；recaption 收尾 `:851` 只标脏不触发；`_maybe_generate_wiki` 体内 `wiki_trigger_ready` 早退分支；`test_worker.py:958/981/999` 三个直呼 `_maybe_generate_wiki` 的用例是否受落点移动影响（预期不受——它们不经 `process_document`）。
- [ ] ② **受影响用例清单**：直调 `process_document` 且断言 wiki 产物的用例逐条给处置——`test_ready_document_auto_triggers_wiki_generation`（`:492-512`）、`test_entity_resolution_failure_degrades_without_blocking`（`:551-577`，断 wiki 未被阻断）、`test_new_document_marks_touched_wiki_entries_dirty`（`:581-608`）；`wait_idle` 全消费者盘点（`:440`/`:469` 及 e2e smoke）。
- [ ] ③ **生命周期面**：`stop()`（`:235-242`）/`wait_idle()`（`:278-287`）现语义与 `_wiki_tasks` 收编点；`test_concurrency_cap_respected`（`:415-445`）的 parse 峰值断言不被 wiki 触及（wiki 不经 `parse_fn`）；`stop()` 里 dispatcher cancel 后 gather 的顺序。
- [ ] ④ **跨路径闸核对**：`wiki_generation_in_progress`（`generator.py:69`）与 `generate_wiki` 的 `_IN_FLIGHT` 同源 ⇒ worker 运行时手动闸命中、手动运行时 worker 可查得；两方向判据写清（worker 在飞→按钮 `already_running`；手动在飞→worker 触发推迟尾随）；check-and-claim 无 `await` 原子性成立的依据。

## Task 1 — RED→GREEN 放槽（D1=乙）

- [ ] **RED①**：新用例「wiki 挂起不占工位」：`_maybe_generate_wiki` 换慢速 stub（事件等待），W=2 连提 3 篇 → 断 parse 并发峰值 = 2（放槽前 = 1）→ 红。
- [ ] **RED②**：新用例「`wait_idle` 覆盖 wiki 任务」：stub 生成落一条目，`wait_idle()` 返回后断条目已定稿 → 红。
- [ ] **GREEN**：`_spawn_wiki` + `self._wiki_tasks` 实现；`:416` 改调用点；`wait_idle` 排干（循环判空）、`stop` gather；Task 0② 三条用例按处置转绿（后置 drain）。
- [ ] **neuter①**：去掉 `wait_idle` 的 `_wiki_tasks` 排干 → RED② 反证红 → 还原。
- [ ] **neuter②**：把 `_spawn_wiki` 改回槽内 await → RED① 反证红 → 还原。
- [ ] 门禁：`tests/knowledge` 全绿、ruff check/format 干净。

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
