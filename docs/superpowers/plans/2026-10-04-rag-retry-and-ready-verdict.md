# RAG 重试与就绪判定对齐 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-04-rag-retry-and-ready-verdict-design.md](../specs/2026-10-04-rag-retry-and-ready-verdict-design.md)
**Status:** D1–D3 已裁=**全甲**（2026-10-04）；开工（Task 0 起）。本对落地 RFC v3 §5.2：降级可整篇重试、就绪判定按索引完整收紧、重试/删除幂等定案（不引入代次字段）。
**Architecture:** worker 终态判定改「vector 完整性」（`indexed == total`）；router 重试门加「degraded」判定（配 TS 侧同款 helper）；worker 加 per-doc 在途合并（镜像 wiki runner 先例）；后端 TDD 翻面一只既有用例 + 补矩阵，前端两处入口放宽，真栈按 A3 验收。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 降级重试范围 | ✅ 已裁=甲：任一腿 `degraded` | 图谱腿独立重跑入口 |
| D2 UI 入口形态 | ✅ 已裁=甲：状态格悬停卡复用失败卡 | 操作列新增按钮 |
| D3 防重入机制 | ✅ 已裁=甲：worker 在途合并 | 处理代次字段/条件写表结构 |
| 就绪判定收紧 | 定案（spec §2.1 矩阵；翻面 `test_worker.py:374-387`） | 检索侧状态门/原子发布 |

## 硬约束

- 不加 `degraded` 状态枚举；检索侧零改动（无门）；失败文档半截切片保留可检索，不得清理。
- 翻面用例一处（`test_worker.py:374-387`）；其余四处为守护行（`test_api.py:686`、`document-panel.dom.test.tsx:399`、`hooks.dom.test.tsx:117,190`）——行为不变、须保持绿。
- 改写产物只在本对涉及面；`chunk_count = indexed` 语义保持。

## Task 0 — 落点核实 ✅

- [x] ① 行号零漂移核对：15 处锚全零漂移（`knowledge_bases.py:246-247`、`knowledge_service.py:486-512`、`worker.py:283-284/302-308/387-389/417-421/495/500-505/579-587`、`indexer.py:65-97`、`store.py:32-34/199-201`、`document-panel.tsx:316-341/1041-1046`）；受害面复核＝翻面×1（`test_worker.py:374-387`）＋守护×4（`test_api.py:686`、`document-panel.dom.test.tsx:399`、`hooks.dom.test.tsx:117,190`）。
- [x] ② 零切片可达性实测：文本路径**不可达**（10/10 最小样本均 ≥1 切片）；视频「全空镜头」路径**可达**（`worker.py:820-839` 全 continue ⇒ `chunk_rows=[]`；`test_worker_pipeline.py:404` 只覆盖部分空）⇒ Task 1 该用例走视频全空夹具。
- [x] ③ worker 并发结构确认：`_dispatch_loop`→`_run_guarded`（`_sem`）→`process_document`；`submit` 调用面＝upload/retry/`recover()`（recaption 走独立口）；D3 合并检查点须置于 `_run_guarded` 首个 await 之前（同刻入档竞态）。
- [x] ④ 门禁基线（2026-10-04）：后端 knowledge 面 **1506 passed / 4 failed / 2 skipped / 417s**——4 红全为在案环境账（缺 key 对 `test_embed_missing_api_key`/`test_rerank_missing_api_key`＋解析器对 `test_parse_pdf_full_flow`/`test_token_read_from_env_never_from_caller`＝本机真实 MinerU token）；前端基线随 Task 3 首跑记录。

## Task 1 — 后端 TDD：就绪判定收紧

- [ ] RED：判定矩阵用例（全成→`ready`；部分→`failed`（error=N/M）；全败→`failed`；零切片→`failed`——用例走**视频全空镜头夹具**，文本路径实测不可达）＋翻面 `test_worker.py:374-387`（软失败文档 `ready`→`failed`，docstring 同步重写）；error 文案两条（索引不完整/无可索引内容）覆盖断言；neuter 预演。
- [ ] GREEN：`worker.py:417-421` 改 `done ⟺ total > 0 且 indexed == total`；`:495` 终态改「`vector == "done"` → `ready`，否则 `failed` + error 文案」；确保不遮蔽 caption/graph 子标记（追加式子标记，不整体覆写）。
- [ ] neuter：①还原 vector 判定 ⇒ 恰红（部分/全败族）；②还原终态 ⇒ 恰红（软失败族）；还原复绿。
- [ ] 门禁：knowledge 面全量 + ruff check/format 双净。

## Task 2 — 后端 TDD：降级可重试 + 幂等

- [ ] RED：router 门用例（caption `degraded`→202；graph `degraded`→202（D1=甲）；`processing`/干净 `ready`→409 新文案）；`test_api.py:686` 翻面；幂等族（并发双提交单跑、重试受理中删除不复活/无僵尸、重试后旧向量残留 0、受理序=先删向量后入队）。
- [ ] GREEN：`knowledge_bases.py:246-247` 门 + 降级判定 helper（后端一处、文档口径 spec §2.2）；D3=甲 在途合并 + 收尾补跑落 `worker.py`。
- [ ] neuter/复绿；门禁同 Task 1。

## Task 3 — 前端：降级重试入口

- [ ] RED：`document-panel.dom.test.tsx` 增降级行用例（D2=甲 形态：悬停卡含降级说明+重试按钮+breakdown 行）+ 干净行仍 Tooltip + 失败态零回归；`hooks.dom.test.tsx` 重试流补降级。
- [ ] GREEN：`document-panel.tsx` 两处入口放宽（TS 侧 `hasDegradedLeg` helper）；降级卡**独立文案分支**（不点名具体腿、不走 `classifyDocError`，zh/en）；失败侧 `classifyDocError` 加 pattern/kind + `docErrors` i18n（zh/en）覆盖新 error 文案。
- [ ] `pnpm check` 零诊断 + 前端全量绿（前端基线数字一并记入 Task 0 ④ 尾注）。

## Task 4 — 文档 + 收尾

- [ ] `backend/AGENTS.md` 增补：索引完整性=就绪前提、降级可重试、检索侧无状态门（与既有 Ingestion/状态段衔接）。
- [ ] spec 状态行回填 + 本 plan 实测回填；RFC §5.2 表行 1–4、A3/A4/A8 → 用例编号映射表（spec §4 第 8 条）。
- [ ] 提交链回填（按仓库惯例逐 Task 提交）。

## Task 5 — 真栈端到端验收（A3）

- [ ] 隔离实例（`DEER_FLOW_*` 仓外 scratch + recorder，零出网、配置 md5 前后一致）：制造 VLM 降级 → 恢复 → 整篇重试 → 图片说明补齐、文档 ID 不变。
- [ ] 重复点击重试不双跑（提交计数/日志为证）；重试受理中删除交错一相（可选）。
- [ ] 收尾：临时库/进程/文件逐项清理并核验。
