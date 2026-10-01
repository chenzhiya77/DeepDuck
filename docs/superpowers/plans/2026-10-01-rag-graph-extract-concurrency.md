# RAG 图谱腿 chunk 级并发 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 每个 Task 走完 RED → GREEN → neuter → revert proof → 门禁 再进下一个；「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-01-rag-graph-extract-concurrency-design.md](../specs/2026-10-01-rag-graph-extract-concurrency-design.md)
**Status:** **待开工（2026-10-01 起草，与 spec 同批成对）**。待拍：无（D1–D6 已裁，见 spec）。复选框共 **23**。

**Architecture:** `config.yaml → RagConfig.extract_concurrency`（默认 8，`ge=1, le=32`）→ worker 进图谱腿时 `get_app_config()` 现读（`table.card_mode` 先例，热生效）→ `index_document_graph(..., concurrency=N)` → `Semaphore(N) + gather` 并发跑 pending chunks，每 chunk 结果回传统一结算；`extract_graph` 内对 API 级瞬态错误退避重试 2 次后按 chunk 软失败。**除执行顺序（串行→并发）与 D3 的失败面收窄外，语义零变化**。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 | `graph/indexer.py` chunk 循环并发化（结果回传 + 结尾两笔批写不动） | 腿间并行（D6） |
| D2 | `rag.extract_concurrency`（默认 8，实测膝点）+ worker 现读传参 | 代码常量（乙已否） |
| D3 | `extract_graph` 瞬态重试 2 次 + chunk 软失败 | 改 `factory.py:402` 的 `max_retries`；整篇级重试 |
| D4 | gleaning 留 chunk 内串行（一行不动，只在用例里钉住） | gleaning 并行/可配 |
| D5 | — | 实体名 embed 攒批（`indexer.py:166`，二期） |

## 硭约束

- **断点续跑契约不动**：`pending` 过滤（`indexer.py:132`）与 `extract_status` 逐 chunk 落库是并发化的前提，任何"先聚合再落库"的改法都算违约。
- **进度单调**：`progress_callback`（`worker.py:348-350`）在并发下必须单调不减、终值 = total；现有顺序型断言改**集合语义**。
- **失败面只收窄不放大**：D3 之后，任何单 chunk 失败（解析失败或瞬态耗尽）只标该 chunk `failed`，不得把整篇文档打成 `failed`。
- **默认值有实测背书**：N=8 的依据是 2026-10-01 真调用三组数据（spec §2）；换端点按 spec §2 公式重推，不许把 8 当真理。

## Task 0 — 开工前核实（4 项，回填结论再开工）

- [ ] ① 扫 `backend/tests/knowledge/graph/test_graph_indexer.py` 全部用例，列出依赖**执行顺序**的断言清单（预计 `test_graph_indexer.py:123/182/213/238/264` 五处调用点周边），逐条标注"改集合语义 / 不动"。
- [ ] ② 核实并发化插入点与结果收集面：循环体 `indexer.py:146-178`、结尾批写 `:180-202`；确认 `backfill`/`touched_entities`/`stats` 三个收集点的合并语义在 gather 后不变。
- [ ] ③ 核实参数贯通点：`app_config.py` RagConfig（`worker_concurrency` 在 `:241`，新字段插其后）→ `worker.py` 进图谱腿处（`:352-367` 调用点）→ `index_document_graph` 签名（`indexer.py:116`）；确认 `gleaning_rounds` 走构造器（`worker.py:193/206`）与新字段**现读**策略不冲突。
- [ ] ④ 核实文档/模板落点清单：`backend/AGENTS.md` RAG 旋钮段、`config.example.yaml` rag 块（`worker_concurrency` 在 `:2626`）、`backend/tests/test_rag_config.py`（被删旋钮留下的用例位可复用）。

## Task 1 — 并发化（RED → GREEN）

- [ ] **RED① 并发上限生效**：桩 LLM 记录在飞峰值；C=12、N=4 时峰值 >1 且 ≤4 —— 今日串行实现下红（峰值恒 1）。
- [ ] **RED② 结果集等价**：混合 done/empty/failed 的 chunk 集，`stats` 与落库内容断言为**集合语义**（与串行基线逐项相等）—— 顺序断言按 Task 0 ①清单就地改写。
- [ ] **RED③ 进度单调**：`progress_callback` 收到的序列单调不减且终值 = total。
- [ ] **GREEN**：`graph/indexer.py` 循环改 `Semaphore(N) + gather`（每任务返回结算、主协程统一合并）；`app_config.py` 加 `extract_concurrency`（默认 8，`ge=1, le=32`，描述里带 spec §2 公式）；worker 进图谱腿时现读传参；`test_rag_config.py` 补默认值/校验用例。三条 RED 转绿。
- [ ] **neuter①**：N 置 1 ⇒ RED① 红（峰值 ≤1）、RED②③ 仍绿（语义等价）；**neuter②**：去掉结果统一合并（改回共享可变收集）⇒ RED② 红。两项各自可复现后还原。
- [ ] **门禁**：`tests/knowledge/graph/` 全套 + `tests/test_rag_config.py` + `make lint` 全绿；全量后端抽跑无新增红（定性用「抽 node id → HEAD 同批 → 双向 diff」法）。

## Task 2 — 瞬态兜底（RED → GREEN）

- [ ] **RED④ 瞬态软失败**：桩 LLM 第 1 次抛 APIError、第 2 次成功 ⇒ chunk 正常 done（今日行为=整篇 failed，红）；连续抛 3 次 ⇒ 该 chunk `extract_status=failed` + `error` 有原因、其余 chunk 不受影响、文档**不**整体打挂。
- [ ] **GREEN**：`extractor.py::extract_graph` 对 API 级瞬态错误退避重试 2 次（0.5s×2ⁿ，与 `embedder_openai.py:198-214` 同风格），耗尽后抛出由 `indexer.py` 的 chunk 级 catch 转软失败；`ExtractionError` 路径不动。
- [ ] **neuter③**：去掉重试 ⇒ RED④ 前半红；去掉 chunk 级 catch ⇒ RED④ 后半红（整篇打挂）。各自可复现后还原。
- [ ] **门禁**：Task 1 门禁面复跑 + `tests/knowledge/` 全套绿。

## Task 3 — 文档与模板（同批，不另起）

- [ ] `backend/AGENTS.md`：RAG 知识库段补一句"图谱腿 chunk 级并发（`rag.extract_concurrency`，默认 8，实测膝点）"+ 换端点重推公式。
- [ ] `config.example.yaml` rag 块补 `extract_concurrency: 8`（与 `worker_concurrency` 相邻）。
- [ ] spec §6 影响面核对：源文件数、配置键数与实际改动一致（不一致就地更正 spec）。

## Task 4 — 真栈验收（前后对照，回填真实数字）

- [ ] 前测基线：当前 HEAD（未并发化）重传一篇 13 chunk 级 docx（或 retry），记图谱腿墙钟 = ____s（预期 ~290s 口径）。
- [ ] 后测：GREEN 后同文档同法重传，图谱腿墙钟 = ____s；验收线 **≤ 90s**（spec §5）。
- [ ] 失败面核对：`extract_status=failed` chunk 数与串行基线持平（并发不新增失败）。
- [ ] 双文档并发（`worker_concurrency=2`）总时长不劣于两篇串行之和；`progress_percent` 前台观察单调。
- [ ] 真栈收尾：改过的配置逐字节还原（若有），临时库/临时文档清理，探针脚本零残留（`_t_probe.py` 已删）。

## 交付回写

- [ ] 完成后回写本文件 Status（提交号 + 复选框计数 + 实测表），并同步 spec Status 行一句"已交付"。
