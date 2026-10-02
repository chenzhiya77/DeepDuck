# RAG 百科触发面加固（④+⑤）—— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-02-rag-wiki-trigger-hardening-design.md](../specs/2026-10-02-rag-wiki-trigger-hardening-design.md)
**Status:** 📝 **已起草（2026-10-02）待审**——D1 待拍（甲=换序 / 乙=兜清），拍定后 Task 0 先行。

**Architecture:** ⑤ `_spawn_wiki` 换序（`create_task` → `busy.add`，同同步段原子性不变、失败即无残留）；④ 三条用例去固定 settle（`calls`/`peak` 计数断言 + `polled` Event）。**零产品语义变化。**

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 | 甲（推荐）：`create_task` 先于 `busy.add` | 乙（try/except 兜清）；`_spawn_wiki` 引入 await 的任何形态 |
| D2 | 三条用例去 settle（计数/事件断言） | 开机扫描（另一条线）；`slow_parse` 交错窗；其他测试文件 |

## 硬约束

- 上对契约全不动（单飞+合并 / `_wiki_tasks` 收编 / `already_running` / 重启残余口径）。
- 失败面只收窄（⑤ 后 `create_task` 失败不再冻结 KB）。
- 测试改写不放宽断言：新形状对三种破形状的判别力逐条反证。

## Task 0 — 开工前核实（3 项，回填结论再开工）

- [ ] ① **换序原子性前提**：`_spawn_wiki`（`worker.py:313-327`）全同步无 `await` 复核；换序后 `_wiki_tasks.add` / done_callback 仍只在创建成功后执行；`_wiki_runner` 首个可让出点在自身体内 ⇒ runner 不可能在 `busy.add` 前跑起来。
- [ ] ② **固定 settle 全扫**：`test_worker.py` 百科触发用例块的固定 sleep 逐条登记（预期 = `:1166`/`:1232`/`:1202` 三处）+ 各断言的判别方向（哪边红/哪边绿）记清，防改写时判别力倒退。
- [ ] ③ **同类辨析**：`test_a_hanging_wiki_leg_does_not_block_new_documents` 的 poll 看门狗（300×0.01）与 `slow_parse` 交错窗（`:1071`）是否属 settle（预期：前者是看门狗上限、后者是观测窗，均不动）。

## Task 1 — ⑤ RED→GREEN→neuter（换序）

- [ ] **RED**：`create_task` 换抛错桩 → 断 `_wiki_busy` 无残留、`_wiki_pending` 保持 → 现形状**红**（busy 残留）。
- [ ] **GREEN**（D1=甲）：`create_task` 提到 `busy.add` 之前 + 一行原子性注释 → 断言转绿。
- [ ] **neuter**：换回旧序（`busy.add` 在前）→ RED 反证红 → 还原。
- [ ] 门禁：`tests/knowledge/test_worker.py` 全绿、ruff 双净。

## Task 2 — ④ 去 settle（计数/事件断言）

- [ ] `single_flight`：删 1s 攒堆，改 `release.set()` → `wait_idle` → 断 `calls == 2 && peak == 1`。
- [ ] `defers_wiki`：`wiki_generation_in_progress` 探针 set `polled` Event，`wait_for(polled.wait(), 5)` 后断 `calls == 0`；尾随后断 `calls == 1` 不变。
- [ ] `coalesce`：删 `:1202` 冗余 settle，直接断 `calls == 2`。
- [ ] **判别力反证三连**：破形状（去 claim / 去推迟 / 去尾随）在新断言下各照红 → 还原。
- [ ] 门禁：`tests/knowledge` 全绿、ruff check/format 干净。

## Task 3 — 文档

- [ ] 上对 plan 修订行注记 ④⑤ 已收（指回本对提交号）；本对 Status 回填提交号。

## 收尾

- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交。
