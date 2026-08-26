# RAG 检索质量评估报告（Layer 2 · 端到端 / RAGAS）

- run_id：`ragas-20260826T125446Z-41548fe0`
- kb_id：`39ffdcaffddb41b2a4f0563f9189feca`
- 生成时间：2026-08-26T12:56:29.964186+00:00
- 题目数：8（失败 0）

## 人工校准

- human_sample_ratio：未回填
- cohens_kappa：未回填
- 约定：每月抽样 ≥10% 人工评分后回填 human_sample_ratio 与 cohens_kappa。

## 执行状态

- ragas：skipped（ragas 未安装（可选依赖；`uv sync --extra ragas` 后可用））
- langfuse：未推送（langfuse 未启用或未安装）

## 汇总（不含失败题）

| 指标 | 值 |
|---|---|
| 路径选择准确率 | 100.0% |
| 引用 precision | 88.0% |
| 引用 recall | 40.3% |
| 图谱落点命中率 | 25.0% |
| ragas faithfulness | - |
| ragas answer_relevancy | - |
| ragas context_precision | - |
| ragas context_recall | - |

## 按类别

| 类别 | 题数 | 路径选择准确率 |
|---|---|---|
| concept | 2 | 100.0% |
| fact | 3 | 100.0% |
| global | 1 | 100.0% |
| relation | 2 | 100.0% |

## 逐题明细

| 题目 | 预期路径 | 实际工具序列 | 路径命中 | 引用 P/R | 图谱落点 | 备注 |
|---|---|---|---|---|---|---|
| q001 | vector | hybrid_search, graph_search | ✅ | 100.0%/66.7% | 100.0% |  |
| q002 | vector | wiki_search, hybrid_search | ✅ | -/0.0% | 0.0% |  |
| q003 | vector | wiki_search, hybrid_search | ✅ | 50.0%/50.0% | 0.0% |  |
| q004 | vector | hybrid_search, hybrid_search, wiki_search | ✅ | 85.7%/50.0% | 0.0% |  |
| q005 | vector | hybrid_search, graph_search | ✅ | 80.0%/66.7% | 0.0% |  |
| q006 | vector | hybrid_search | ✅ | 100.0%/50.0% | 0.0% |  |
| q007 | vector | hybrid_search, hybrid_search | ✅ | 100.0%/25.0% | 0.0% |  |

## Global 类题目（单独分区，结果不计入门禁解读）

| 题目 | 预期路径 | 实际工具序列 | 路径命中 | 引用 P/R | 图谱落点 | 备注 |
|---|---|---|---|---|---|---|
| q008 | wiki | hybrid_search, wiki_search, hybrid_search, hybrid_search, graph_search | ✅ | 100.0%/14.3% | 100.0% |  |
