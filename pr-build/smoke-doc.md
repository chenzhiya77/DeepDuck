# DeerFlow 评测系统手册

## 三层检索路径

DeerFlow 的检索有三条路径。向量路径叫 hybrid_search,使用 RRF 融合与 qwen3-rerank 重排。图谱路径叫 graph_search,基于结构驱动的子图选择。百科路径叫 wiki_search,消费预生成的百科词条。三条路径共享同一个分块底座。

## Layer 1 确定性指标

Layer 1 有四个指标。Hit Rate 衡量标注分块是否出现在 top-k。Recall@k 衡量标注分块的命中比例。MRR 是首个正确结果排名的倒数。路径准确率衡量预期检索路径的选择正确率。

## Layer 2 概率性指标

Layer 2 使用 RAGAS 框架,包含 faithfulness、answer_relevancy、context_precision、context_recall 四项。RAGAS 依赖裁判模型打分,存在 judge 方差,因此只报告不进 CI 门禁。

## 回退门禁机制

CI 门禁采用 per-category 口径:任一 category 的 Recall@k 相对基线回退超过阈值即判红,默认阈值是 3%。阈值线画在 summary 层面,等于基线 Recall@k 减去阈值。

## 基线管理

基线通过 --mark-baseline 标记,每个知识库同时只有一行基线。标记新基线时旧基线在同一事务内被清除。--baseline auto 直接读取数据库中的基线行做差分。

## 运行环境隔离

每次评测运行都记录 environment 字段,取值为 local、ci、nightly 三者之一。CI 环境的运行会留痕但默认不进入趋势图取数,防止拉取请求的频繁运行污染趋势。
