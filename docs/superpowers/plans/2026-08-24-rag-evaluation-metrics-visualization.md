# RAG Evaluation Metrics Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为评测 Tab 实现数据可视化层——指标总览组件（Layer 1 表格 + Layer 2 卡片网格）与趋势图组件（ECharts 多线时间序列），含后端 trend API 契约；本 plan 仅分解实施任务，所有设计决策见 spec。

**Spec:** `docs/superpowers/specs/2026-08-24-rag-evaluation-metrics-visualization-design.md`（已定稿）

**基线：** `534bbbf0`（RAG 评估体系 Task7 收尾提交，分支 `feat/rag-knowledge-base`）

**Architecture:** 后端新增 `eval_runs` 表持久化评估结果（同一 SQLite 数据库，Alembic migration 0017），新增 `GET /eval-runs/trend` 端点聚合时间序列；前端复用 `vector-canvas.tsx` 的 echarts 适配层模式，新增 `eval-metrics-overview.tsx`（静态表格+卡片）与 `eval-trend-chart.tsx`（动态折线图）两个组件，均通过 `next/dynamic ssr:false` 懒加载。

**Tech Stack:** FastAPI + SQLAlchemy + Alembic（backend）+ ECharts 5.6 + React 19 + TypeScript（frontend）；后端测试 `pytest`，前端测试 `rstest` + `pnpm check`。

**Global Constraints:**
- Branch: `feat/rag-knowledge-base`（沿用当前工作分支）; each task: RED → GREEN → regression proof (revert→RED→restore→GREEN) → commit (Conventional Commits)。
- Backend TDD mandatory: `cd backend && uv run pytest <file> -q`；frontend DOM tests (`pnpm test`)，收尾 `pnpm check` + `ruff` 双净。
- ECharts 懒加载纪律：`next/dynamic ssr:false`，不进首屏 SSR 预算测量面（对齐 vector-canvas 先例）。
- 指标颜色语义与 CI 门禁同源：回退阈值从后端读取，不硬编码前端。
- Layer 1 实线 / Layer 2 虚线视觉规范冻结（spec §4.3.2），实施时不得变更。
- 数据库纪律：新增表使用同一 SQLite 数据库（`deerflow.persistence.base.Base`），Alembic migration 编号 0017，不新增数据库文件。
- Known code facts (verified 2026-08-24, pre-construction):
  - 后端数据结构：`backend/packages/harness/deerflow/knowledge/eval/ragas_eval.py::Layer2Report` 含 `aggregate: Mapping[str, Any]` / `results: tuple[QuestionEvalResult, ...]` / `ragas_available: bool` / `generated_at: str`——**当前仅写文件不持久化，需新增 `eval_runs` 表**。
  - 数据库现状：`backend/packages/harness/deerflow/persistence/migrations/versions/` 最新为 `0016_manual_knowledge_table.py`，新增表为 `0017_eval_runs_table.py`。
  - 前端组件库：`frontend/src/components/ui/` 已有 `card.tsx` / `badge.tsx` / `progress.tsx` / `tabs.tsx` / `dialog.tsx`——**缺 `table.tsx`，需新增**（shadcn/ui 标准实现）。
  - ECharts 适配层先例：`frontend/src/components/workspace/knowledge/vector-canvas.tsx`（`next/dynamic ssr:false` 模式）。
  - 评测 Tab 挂载点：`frontend/src/components/workspace/knowledge/middle-tabs.tsx`（`KnowledgeMiddleTab` 需扩展 `"eval"`）。
  - 后端路由挂载点：`backend/app/gateway/routers/knowledge_bases.py`（**现有无 `/eval-runs` 端点，全部新增**）。

---

## Phase 1: 基础设施（前置依赖）

### Task 0a: 新增 eval_runs 数据库表 ✅ 已完成（2026-08-24）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/models.py`（+`EvalRunRow`）
- Create: `backend/packages/harness/deerflow/persistence/migrations/versions/0017_eval_runs_table.py`
- Create: `backend/tests/knowledge/eval/test_eval_runs_model.py`

- [x] RED test：EvalRunRow 字段完整性（id/kb_id/status/layer1_metrics/layer2_metrics/created_at/completed_at/langfuse_trace_url/baseline_diff）；JSON 字段可序列化/反序列化。
- [x] Run `cd backend && uv run pytest tests/knowledge/eval/test_eval_runs_model.py -q`，记录 missing-table RED。
- [x] Implement `EvalRunRow` + Alembic migration 0017。
- [x] Run migration：`cd backend && uv run alembic upgrade head`（成功升级至 0017）。GREEN→RED→upgrade → GREEN。
- [x] ruff check/format 双净。
- [x] Commit: `feat(rag): add eval_runs table for evaluation metrics persistence`（`d5952f1c`）

### Task 0b: 评估运行持久化——修改 run_ragas_eval.py 保存到数据库

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/eval/ragas_eval.py`（+`save_run_to_db` 函数）
- Modify: `backend/scripts/run_ragas_eval.py`（调用 `save_run_to_db`）
- Modify: `backend/tests/knowledge/eval/test_ragas_eval.py`（持久化断言）

- [ ] RED test：评估运行完成后 `eval_runs` 表新增一行；字段与 `Layer2Report` 对齐。
- [ ] Implement `save_run_to_db(report, session_factory)`。
- [ ] GREEN；revert proof。
- [ ] ruff 双净。
- [ ] Commit: `feat(rag): persist evaluation runs to eval_runs table`

### Task 0c: 创建前端 table.tsx 组件（shadcn/ui 标准）

**Files:**
- Create: `frontend/src/components/ui/table.tsx`

- [ ] 实现 shadcn/ui 标准 Table 组件（Table/TableHeader/TableBody/TableRow/TableHead/TableCell）。
- [ ] 参照 `card.tsx` / `badge.tsx` 风格（Tailwind + cn()）。
- [ ] Commit: `feat(frontend): add table component to ui library`

---

## Phase 2: 可视化功能

### Task 1: 后端 trend API——时间序列聚合端点

**Files:**
- Modify: `backend/app/gateway/routers/knowledge_bases.py`（+GET `/{kb_id}/eval-runs/trend`）
- Modify: `backend/app/gateway/services/knowledge_service.py`（+`get_eval_trend` 方法）
- Create: `backend/tests/knowledge/test_eval_trend_api.py`

- [ ] RED test（对齐 `test_vector_projection_api.py` 基建）：
  - day 粒度聚合：当日多次运行取最后一次 completed
  - week/month 粒度聚合：取该周期内 completed 运行的平均值
  - skipped/error 状态：该日期无数据点（`recall_at_k: null`）
  - baseline 返回：含当前 baseline 值与 threshold_percent
  - 空历史：返回 `has_data: false`
  - 未知 kb：404
- [ ] Run `cd backend && uv run pytest tests/knowledge/test_eval_trend_api.py -q`，记录 missing-endpoint RED。
- [ ] Implement `get_eval_trend(kb_id, granularity, days_back)`：
  - 从存储层读取历史 `Layer2Report`（需确认当前是否持久化；若无，需新增轻量存储或从报告文件聚合）
  - 按粒度聚合为 `TrendPoint` 列表
  - 返回 `TrendResponse` schema（spec §4.1）
- [ ] GREEN（全部用例通过）；revert proof：stash 实现 → RED → 恢复 → GREEN。
- [ ] ruff check/format 双净。
- [ ] Commit: `feat(rag): add eval trend API endpoint for time-series aggregation`

---

## Task 2: 前端指标总览组件——Layer 1 表格 + Layer 2 卡片

**Files:**
- Create: `frontend/src/components/workspace/knowledge/eval-metrics-overview.tsx`
- Create: `frontend/src/components/workspace/knowledge/eval-metrics-overview.utils.ts`（着色逻辑纯函数）
- Modify: `frontend/src/core/knowledge/types.ts`（+`MetricsOverview` / `Layer1Metrics` / `RagasMetrics` / `ArchSpecificMetrics`）
- Create: `frontend/tests/unit/knowledge/eval-metrics-overview.dom.test.tsx`

- [ ] RED test：
  - Layer 1 表格：5 行渲染（4 category + 汇总）、单元格着色（正常/警告/回退三态）
  - Layer 2 卡片：RAGAS 四指标 + 架构专属三指标渲染
  - 状态处理：null 值显示 `-`、`ragas_available=false` 显示 Badge、`has_graph_questions=false` 时 seed_hit_rate 卡片禁用态
  - skipped 状态：整个总览灰色 + 跳过原因显示
- [ ] Run `cd frontend && pnpm test eval-metrics-overview`，记录 missing-component RED。
- [ ] Implement `eval-metrics-overview.tsx` + `eval-metrics-overview.utils.ts`：
  - `Layer1MetricsTable`：表格渲染 + `getCellColorClass(delta, threshold)` 纯函数
  - `RagasMetricCard` / `ArchMetricCard`：卡片渲染 + `getProgressBarColor(value)` 纯函数
  - 着色阈值与后端 `--fail-threshold` 同源（从 `baseline_diff.threshold_percent` 读取）
- [ ] GREEN；revert proof：stash 实现 → RED → 恢复 → GREEN。
- [ ] `pnpm check` 双净。
- [ ] Commit: `feat(frontend): add eval metrics overview with Layer 1 table and Layer 2 cards`

---

## Task 3: 前端趋势图组件——ECharts 折线图 + 粒度切换

**Files:**
- Create: `frontend/src/components/workspace/knowledge/eval-trend-chart.tsx`
- Create: `frontend/src/components/workspace/knowledge/eval-trend-chart.utils.ts`（`buildChartOption` 纯函数）
- Modify: `frontend/src/core/knowledge/types.ts`（+`TrendPoint` / `TrendResponse`）
- Modify: `frontend/src/core/knowledge/api.ts`（+`getEvalTrend`）
- Create: `frontend/tests/unit/knowledge/eval-trend-chart.dom.test.tsx`
- Create: `frontend/tests/unit/knowledge/eval-trend-chart.unit.test.ts`（纯函数测试）

- [ ] RED test：
  - 粒度切换按钮组渲染（Day/Week/Month）
  - 切换粒度触发 API 重新请求（mock `getEvalTrend` 断言调用参数）
  - loading 状态显示 spinner
  - 无数据状态显示「该时间范围内暂无评估数据」
  - `buildChartOption` 纯函数：
    - 6 条指标线配置正确（颜色/线型/默认显示状态）
    - 阈值线 markLine 计算正确（`baseline - threshold%`）
    - 图例默认选中状态正确（Layer 1 三指标显示，Layer 2 隐藏）
    - 回退点标红逻辑正确
    - tooltip formatter 输出格式正确
- [ ] Run `pnpm test eval-trend-chart`，记录 missing-component RED。
- [ ] Implement `eval-trend-chart.tsx` + `eval-trend-chart.utils.ts`：
  - ECharts 懒加载（`next/dynamic ssr:false`，对齐 vector-canvas 模式）
  - `buildChartOption`：6 条 series + markLine + dataZoom + tooltip 配置
  - 点击数据点回调 `onPointClick(runId)`
- [ ] GREEN；revert proof：stash 实现 → RED → 恢复 → GREEN。
- [ ] `pnpm check` 双净。
- [ ] Commit: `feat(frontend): add eval trend chart with ECharts and granularity switching`

---

## Task 4: 评测 Tab 集成——挂载到 middle-tabs

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/middle-tabs.tsx`（`KnowledgeMiddleTab` 扩 `"eval"` + TabsTrigger/TabsContent + `eval: ReactNode` prop）
- Modify: `frontend/src/core/i18n/locales/types.ts` / `zh-CN.ts` / `en-US.ts`（`tk.tabs.eval` = 评测 / Evaluation）
- Modify: `frontend/src/app/workspace/knowledge/page.tsx`（接线 eval pane）
- Create: `frontend/src/components/workspace/knowledge/eval-tab.tsx`（组合 metrics-overview + trend-chart）
- Modify: `frontend/tests/unit/knowledge/middle-tabs.dom.test.tsx`（补 eval prop）

- [ ] RED test：
  - 第六个 trigger 渲染「评测」
  - 点击切 tab pane active
  - 六 pane forceMount keep-alive
  - `eval-tab.tsx` 组合渲染 metrics-overview + trend-chart
- [ ] Implement：
  - `middle-tabs.tsx` 扩展 `"eval"` tab
  - `eval-tab.tsx`：页面布局（上：运行配置占位；中：metrics-overview；下：trend-chart）
  - i18n 三处
- [ ] `pnpm test` GREEN（含 middle-tabs 回归）；revert proof。
- [ ] `pnpm check` 双净。
- [ ] Commit: `feat(frontend): mount eval tab with metrics overview and trend chart`

---

## Task 5: 数据联通——从后端获取真实数据

**Files:**
- Modify: `frontend/src/core/knowledge/hooks.ts`（+`useMetricsOverview` / `useEvalTrend`）
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`（接通数据）
- Create: `frontend/tests/unit/knowledge/eval-tab.dom.test.tsx`（数据联通测试）

- [ ] RED test：
  - `useMetricsOverview`：从 `GET /eval-runs/latest` 获取数据并转换为 `MetricsOverview`
  - `useEvalTrend`：从 `GET /eval-runs/trend` 获取数据
  - 数据加载中显示 skeleton
  - 数据错误显示错误提示
- [ ] Implement hooks + eval-tab 数据接通。
- [ ] `pnpm test` GREEN；revert proof。
- [ ] `pnpm check` 双净。
- [ ] Commit: `feat(frontend): connect eval tab to backend APIs with hooks`

---

## Task 6: 交互完善——点击下钻 + 趋势图联动

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/eval-trend-chart.tsx`（点击数据点跳转）
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`（路由跳转逻辑）
- Modify: `frontend/tests/unit/knowledge/eval-trend-chart.dom.test.tsx`

- [ ] RED test：
  - 点击趋势图数据点 → 调用 `onPointClick(runId)`
  - `eval-tab.tsx` 中 `onPointClick` 实现路由跳转 `/workspace/kb/{kbId}/eval/run/{runId}`
- [ ] Implement 点击跳转。
- [ ] `pnpm test` GREEN；revert proof。
- [ ] `pnpm check` 双净。
- [ ] Commit: `feat(frontend): add trend chart point click drill-down`

---

## Task 7: 文档同步 + 全量回归 + Live 冒烟

**Files:**
- Modify: `backend/AGENTS.md`（RAG 小节补评测 Tab 可视化段）
- Modify: `docs/superpowers/specs/2026-08-24-rag-evaluation-metrics-visualization-design.md`（状态翻转「已落地」+ 日期）
- Create: `pr-build/rag-eval-metrics-*.png`（冒烟截图）

- [ ] Spec 状态翻转为「✅ 已落地」；AGENTS.md 落档。
- [ ] `cd backend && uv run pytest tests/knowledge -q` 全量 GREEN；`ruff check/format` 双净。
- [ ] `cd frontend && pnpm test && pnpm check` 双净。
- [ ] Live 冒烟（真实 KB + 后端运行）：
  | 冒烟项 | 步骤 | 预期 | 结果 | 证据 |
  |---|---|---|---|---|
  | 指标总览渲染 | 打开评测 Tab | Layer 1 表格 + Layer 2 卡片正确显示 | ☐ | `pr-build/rag-eval-metrics-overview.png` |
  | 趋势图渲染 | 查看趋势图 | ECharts 折线图出图，阈值线显示 | ☐ | `pr-build/rag-eval-trend-chart.png` |
  | 粒度切换 | 点击 Day/Week/Month | 图表刷新，数据正确 | ☐ | `pr-build/rag-eval-granularity.png` |
  | 点击下钻 | 点击趋势图数据点 | 跳转单次运行详情页 | ☐ | `pr-build/rag-eval-drilldown.png` |
- [ ] Commit: `docs(rag): sync agent guides and spec status for eval metrics visualization`

---

## Final verification

- [ ] 后端 `GET /eval-runs/trend` 端点返回正确聚合数据（day/week/month 三粒度）。
- [ ] 前端指标总览正确显示 Layer 1 表格与 Layer 2 卡片，着色逻辑与 CI 门禁阈值同源。
- [ ] 前端趋势图正确渲染多指标折线图，粒度切换、阈值线、点击下钻功能正常。
- [ ] 评测 Tab 在 middle-tabs 中正确挂载，六 pane keep-alive 切换正常。
- [ ] `backend/AGENTS.md` 已更新；`pytest` / `ruff` / `pnpm check` 全绿。
- [ ] Live 冒烟四项全部通过，截图归档。

---

## 运行期遗留（不属本 plan 交付，供后续决策）

- **单次运行详情页**：趋势图点击跳转的目标页 UI 设计另立 spec（当前仅冻结跳转契约）。
- **历史数据存储**：若后端当前未持久化 `Layer2Report`，trend API 需新增轻量存储或从报告文件聚合（Task 1 需确认）。
- **多 KB 对比**：跨知识库趋势对比另立 spec。
- **自定义阈值**：阈值由后端配置，前端只读展示；如需用户可调阈值，另立 spec。