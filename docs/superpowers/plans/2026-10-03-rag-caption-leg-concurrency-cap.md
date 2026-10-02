# RAG caption 腿限流口径统一小对 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-03-rag-caption-leg-concurrency-cap-design.md](../specs/2026-10-03-rag-caption-leg-concurrency-cap-design.md)
**Status:** 📝 **待拍 D1/D2（2026-10-03）** —— 成对起草（本笔）：D1=口径统一（甲=固定常数 4 推荐 / 乙=W×2 / 丙=维持）、D2=W 值（甲=保持 2 推荐 / 乙=3 / 丙=4+补测）。

**Architecture:** 两腿锁收敛到单一共用常量（D1=甲 时 W=2 零行为差异）；W 值随 D2 裁定，是已有配置 `rag.worker_concurrency`。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 口径统一 | 待拍（甲=常数 4 推荐 / 乙=W×2 / 丙=维持） | 抽取/wiki/图谱腿并发口径 |
| D2 W 值 | 待拍（甲=保持 2 推荐 / 乙=3 / 丙=4） | N=32 膝点补测（除 D2=丙） |

## 硬约束

- 单点定义（常量一处、两腿引用）；W=2 零行为差异；prompt/降级/失败语义不动；不新增旋钮。

## Task 0 — 落点核实（开工即跑，回填后拍 D1/D2）

- [ ] ① 两处 Semaphore 现址复核（`captioner.py:100` / `video/captioner.py:94`）+ 常量落点定（倾向 `caption_client.py`）+ 既有用例扫描（谁断言了并发上限）。

## Task 1 — TDD

- [ ] RED：两用例钉「两腿并发上限同源同值」写红（红因=公式分叉、改 W 行为不可算）。
- [ ] GREEN：提共用常量、视频腿改引用，转绿。
- [ ] neuter：拆一处引用 ⇒ RED 照红 → 还原；门禁 `tests/knowledge` + ruff 双净。

## Task 2 — W 裁定执行 + 收尾

- [ ] D2 若调 W：改 `rag.worker_concurrency`（配置值）+ 真栈一批入库观测两腿并发。
- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交（本笔起草起）。
