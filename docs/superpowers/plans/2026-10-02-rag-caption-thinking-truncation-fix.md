# RAG caption 思考截断修法小对 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-02-rag-caption-thinking-truncation-fix-design.md](../specs/2026-10-02-rag-caption-thinking-truncation-fix-design.md)
**Status:** 🔨 **Task 0 在飞（2026-10-02）**——成对起草即开工 Task 0（端点能力实测），数据回填后拍 D1/D2。

**Architecture:** Task 0 用带外探针打四变体（基线 1024 / `enable_thinking=false` / `thinking_budget` / 4096）测端点认不认参数与空返率；D1 主修法（关思考/独立预算/涨预算/兜底）+ D2 兜底叠加拍板后走 TDD，修点在 `caption_client.py` 单处，失败语义不放宽。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 主修法 | 待拍（甲=关思考 / 乙=thinking_budget / 丙=涨 4096 / 丁=兜底） | caption prompt/质量调优；抽取腿/wiki 思考口径 |
| D2 兜底叠加 | 待拍（甲=常开推荐 / 乙=主修法失效才上） | 重试策略重构 |

## 硬约束

- 修点单处（`caption_client.py`，两腿共用出站口）；失败语义不放宽（兜底也空才降级）。
- 零/一旋钮（D1=丙 才动 `caption_max_tokens` 默认值）；实测先行（拍板依据=Task 0 能力表）。
- 探针与产物在仓外 `E:\app-model\deer-flow-scratch\caption-knee\`，key 脱敏、config 不改。

## Task 0 — 端点能力实测（开工即跑，回填后拍 D1/D2）

- [ ] ① **四变体探针**（同 640px 夹具、每变体 6 发）：基线（1024）/ `enable_thinking=false` / `thinking_budget`（小值逼截断转正文）/ `max_tokens=4096` ⇒ 逐发记 HTTP 码（**400=参数被拒、200 且 reasoning 依旧=静默忽略**）、`finish_reason`、content/reasoning 长度、`reasoning_tokens`、空返率。
- [ ] ② **判读表**：端点认哪些参数（甲/乙是否可行）；4096 对照空返率（丙的效果）；`reasoning_content` 是否稳定返回（丁的可行性）。
- [ ] ③ **兜底样本**：空返发的 reasoning 内容抽查（草稿里有没有可救的正文级信息），给 D2 提供依据。

## Task 1 — 依 D1/D2 裁定 TDD

- [ ] RED：空返桩用例（content 空 + reasoning 有货 ⇒ 现形状降级占位）写红，红因=丢图。
- [ ] GREEN：按裁定改 `caption_client.py`（请求体参数 / 解析兜底 / 默认值），转绿。
- [ ] neuter：反证（去掉修点 ⇒ RED 照红）→ 还原；门禁 `tests/knowledge` + ruff 双净。

## Task 2 — 复验与收尾

- [ ] 修后同夹具同档位空返率复验（目标：甲/乙=0%、丙+丁≈0%），对照修前 30–52%。
- [ ] spec/plan 数字回填、提交链回填；scratch 留档。

## 收尾

- [ ] plan 复选框全勾 + 提交号回填；spec/plan 成对提交（本笔起草起）。
