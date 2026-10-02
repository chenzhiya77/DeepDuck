# RAG VLM 腿并发膝点核查（captioner 膝点） —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-02-rag-caption-knee-check-design.md](../specs/2026-10-02-rag-caption-knee-check-design.md)
**Status:** 📝 **待裁（D1/D2）**——2026-10-02 起草，等拍后开工。

**Architecture:** 带外探针（默认 D1=甲）按并发档直打 `resolve_vlm_target` 解析出的同一 VLM 目标，两个请求形状各出一条吞吐/延迟曲线 → 膝点档 → 推导「W×腿上限 ≤ 膝点」的 W 推荐值 + 两腿口径裁定建议。**默认零代码改动**（D2=甲）。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 测法 | 待拍（甲=带外探针推荐 / 乙=真栈日志 / 丙=甲+一格校准） | 抽取腿、wiki 腿的端点 |
| D2 落点 | 待拍（甲=只出报告+建议推荐 / 乙=统一两腿口径 / 丙=落旋钮） | 改默认 W（4 号）；限流策略重构 |

## 硬约束

- key 不落仓：脚本与产物全在 `E:\app-model\deer-flow-scratch\caption-knee\`，报表脱敏，config 不改。
- 成本预算先行：Task 0 ③ 回填总发数与预估费用，超预算先报再跑。
- 只测不动（默认 D2=甲）；D2=乙/丙 才进 Task 3 且必须走完整 TDD。
- 不打扰真栈：带外探针不过网关；校准格（若有）临时库/账号用后全清。

## Task 0 — 开工前核实（3 项，回填结论再开工）

- [ ] ① **限流落点与调用时序复核**：spec §1.1 初核（图片腿 `captioner.py:100` 写死 4；视频腿 `video/captioner.py:94` W×2；屏幕文字腿共用骨架；单文档内两腿顺序 `await`（`worker.py:719→743`）、跨文档 W 份并行）——开工时复核行号并确认「无并行叠加路径」（如 resume 路 `:671`/`:863` 与主路是否可能同文档双开）。
- [ ] ② **探针目标解析**：`resolve_vlm_target(cfg, cfg.rag.vlm_model)` 在本机解析出的 provider/endpoint/model id 回填；key 只进探针进程内存/环境变量，产物与日志脱敏（`sk-…`→`sk-<redacted>`），**不落仓**。
- [ ] ③ **成本预算**：两形状（单图转录 / 三帧描述）× N∈{1,2,4,8,16} × 每档轮数 ⇒ 总发数、预估 token/费用回填；夹具用固定 64×64 纯色图（视觉端点有最小尺寸，8×8 曾 400）。

## Task 1 — 探针脚本 + 预跑校准

- [ ] scratch 落探针脚本（asyncio + 信号量扫并发档；逐发记墙钟；两个形状参数化；纯 ASCII 请求体——中文经 GBK 控制台会写坏成假 400）。
- [ ] 预跑 N=1/2 各 2 发：校准夹具尺寸、鉴权、计时口径（连接建立是否计入）——不动正式档。

## Task 2 — 膝点扫描 + 两个裁定建议

- [ ] 两形状 × 5 档全扫，回填曲线表（吞吐 req/s / p50 / p95 / 错误率）+ 膝点档高亮（判据：吞吐增幅 <20% 的最小档）。
- [ ] **W 推导格**：总在飞 = W × 腿上限 ≤ 膝点 ⇒ W 推荐值，与现状 W=2 对照（= 排序 4 号的答案）。
- [ ] **口径裁定建议格**：两腿统一还是保持，逐条给数据理由（含 W≠2 时的分叉表复核）。

## Task 3 — （仅 D2=乙/丙）口径统一 TDD

- [ ] D2=甲 时整块勾销（「已裁不做」注明即可）。
- [ ] RED：破形状用例（按裁定口径写红）→ GREEN → neuter 反证 → 还原。
- [ ] 门禁：受影响测试文件全绿 + ruff check/format 双净。

## Task 4 — 文档与收尾

- [ ] spec §2.3 曲线与判据、plan 全格回填真实数字；排序表 2 号 → 完成、4 号挂本对数据（在记忆/汇报里指回）。
- [ ] 收尾：scratch 产物留档或删除（按他口径）；若动过真栈，临时库/验收账号/cookies 全清并核验。

## 收尾

- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交（本笔起草起）。
