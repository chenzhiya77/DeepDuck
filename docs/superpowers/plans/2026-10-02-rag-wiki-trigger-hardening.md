# RAG 百科触发面加固（④+⑤）—— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-02-rag-wiki-trigger-hardening-design.md](../specs/2026-10-02-rag-wiki-trigger-hardening-design.md)
**Status:** 🔨 **已定稿开工（2026-10-02）**——D1=甲 已拍；Task 0 三项核实已回填（本笔），进 Task 1。

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

- [x] ① **换序原子性前提**：`_spawn_wiki`（`worker.py:313-327`）全同步无 `await` ✓；`_wiki_tasks.add`/done_callback（`:326-327`）在 `create_task` 成功之后 ✓；runner 首个可让出点在自身体内（`:343` 轮询 sleep / `:344` 生成 await）⇒ 任务必晚于 `_spawn_wiki` 返回才启动 ⇒ **换序后 claim 检查与建任务仍在同一同步段、原子性不变**，`create_task` 抛错则 busy 从未占位。
- [x] ② **固定 settle 全扫**：百科触发用例块内**恰好三处** = `:1166`（1.0s 攒堆）/ `:1202`（0.05s 抓多余尾随 + 冗余二次 `wait_idle`）/ `:1232`（0.05s 断 `calls==0` 前）✓。判别方向登记：`single_flight` 现断 `peak==1`（破=peak>1；慢机攒堆不足**会漏检** ⇒ 升级 `calls==1 && peak==1`——5 连发在 runner 启动前落袋、整单吸收，无 claim 必 `calls==5`）；`coalesce` 断 `calls==2`（破=去尾随 1 / 无单飞 4）；`defers` 断 `calls==0`→`calls==1`（破=首轮即 ≥1）。
- [x] ③ **同类辨析**：`slow_parse` 的 `sleep(0.05)`（`:1071`）= 并发观测交错窗（同 `test_concurrency_cap_respected` 先例）、hanging 用例的 300×0.01 poll = 看门狗上限（带 `entered` 标志）⇒ **均非 settle 断言，不动** ✓。

## Task 1 — ⑤ RED→GREEN→neuter（换序）

- [x] **RED**：`test_a_failed_task_creation_never_freezes_the_kb`——`asyncio.create_task` 换抛错桩（无 await 窗口内换回真身）→ **红（正确红因）**：`a failed spawn froze the KB behind a dead claim`（`busy` 残留 `{'kb-1'}`）；断言含「pending 保持 + 后续触发仍能跑」。
- [x] **GREEN**（D1=甲）：`create_task` 提到 `busy.add` 之前 + 原子性注释（「本函数保持全同步，claim 检查与占位必须同一不间断步骤」）→ 转绿。
- [x] **neuter**：换回旧序（`busy.add` 在前）→ **红（同红因）** → 还原转绿。
- [x] 门禁：`test_worker.py` **39/39 全绿**、ruff check/format 双净。

## Task 2 — ④ 去 settle（计数/事件断言）

- [x] `single_flight`：删 1s 攒堆，改 `release.set()` → `wait_idle` → 断 `calls == 1 && peak == 1`。⚠️ **实施更正一处**：spec 初稿写 `calls == 2` 是把「5 连发的落袋时机」想错了（全在 runner 启动前落袋 ⇒ 整单被首次运行吸收、无尾随；尾随场景归 `coalesce`）——实测纠偏后 spec §2.2 / Task 0 ② 已同步改为 `calls == 1`。
- [x] `defers_wiki`：`wiki_generation_in_progress` 换 `_manual_gate` 探针（首次被调 set `polled` Event），`wait_for(polled.wait(), 5)` 后断 `calls == 0`；尾随后断 `calls == 1` 不变。**零计时猜测**。
- [x] `coalesce`：删 0.05s 冗余 settle + 二次 `wait_idle`（尾随在同一 runner 任务内、一次 `wait_idle` 循环排干已覆盖），直接断 `calls == 2`。
- [x] **判别力反证三连**（新断言形状下）：**A 去 claim**（每触发一任务）→ `single_flight` 红（`got 5`）+ `coalesce` 红（`got 4`）；**B 去推迟**（闸恒假）→ `defers` 红（探针不至 ⇒ `TimeoutError`）；**C 去尾随**（while→if）→ `coalesce` 红（`got 1`）。三处均还原转绿。
- [x] 门禁：`test_worker.py` **39/39 全绿**、ruff check/format 双净；`tests/knowledge` **1442 passed / 2 skipped / 2 failed**（2026-10-02）——2 条即已定性的环境红（`test_embed_missing_api_key`/`test_rerank_missing_api_key`，本机 env 带真 key）。

## Task 3 — 文档

- [ ] 上对 plan 修订行注记 ④⑤ 已收（指回本对提交号）；本对 Status 回填提交号。

## 收尾

- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交。
