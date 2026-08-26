# RAG 检索质量评估报告（Layer 2 · 端到端 / RAGAS）

- run_id：`ragas-20260826T123507Z-339d10fc`
- kb_id：`8581c87b6cf148339b1c1ff8cb2d09cd`
- 生成时间：2026-08-26T12:38:31.186061+00:00
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
| 路径选择准确率 | 75.0% |
| 引用 precision | 69.5% |
| 引用 recall | 47.6% |
| 图谱落点命中率 | 12.5% |
| ragas faithfulness | - |
| ragas answer_relevancy | - |
| ragas context_precision | - |
| ragas context_recall | - |

## 按类别

| 类别 | 题数 | 路径选择准确率 |
|---|---|---|
| fact | 5 | 100.0% |
| relation | 3 | 33.3% |

## 逐题明细

| 题目 | 预期路径 | 实际工具序列 | 路径命中 | 引用 P/R | 图谱落点 | 备注 |
|---|---|---|---|---|---|---|
| q001 | vector | hybrid_search, wiki_search | ✅ | 71.4%/50.0% | 0.0% |  |
| q002 | vector | hybrid_search | ✅ | 85.7%/80.0% | 0.0% |  |
| q003 | vector | hybrid_search, hybrid_search | ✅ | 78.6%/30.0% | 0.0% |  |
| q004 | vector | hybrid_search, wiki_search | ✅ | 76.9%/37.5% | 0.0% |  |
| q005 | vector | wiki_search, hybrid_search | ✅ | 69.2%/62.5% | 0.0% |  |
| q006 | graph | wiki_search, hybrid_search | ❌ | 90.9%/50.0% | 0.0% |  |
| q007 | graph | hybrid_search, graph_search | ✅ | 45.5%/33.3% | 100.0% |  |
| q008 | graph | wiki_search, hybrid_search | ❌ | 37.5%/37.5% | 0.0% |  |
