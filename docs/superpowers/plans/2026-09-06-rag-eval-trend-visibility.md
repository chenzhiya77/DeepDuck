# RAG 评测趋势可见性 Implementation Plan(picker · sparkline · 数据契约)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为评测 Tab 落地 spec 冻结的 11 指标分层可见性——后端 trend payload 扩 10 键 + 顶层 `sparks`(7 键);前端 7 个 L2 瓦片嵌入 sparkline(纯 SVG);趋势卡头新增 picker 下拉多选(4 个稀疏指标)进主图,稀疏空点断开 + tooltip"该档未跑";L1 表格与主图默认/图例零改动。

**Spec:** `docs/superpowers/specs/2026-09-06-rag-eval-trend-visibility-design.md`(已定稿,含 F1–F3 与 L1 sparkline 落点纠正)

**基线:** `d92eadae`(分支 `feat/rag-knowledge-base`)

**Architecture:** 后端 `eval/trend.py::aggregate_trend_points` 周期点 dict 扩 4 键(path_accuracy + 引用三,取值=该层周期末次行同现状口径);`sparks` 在 trend 响应装配处新增——按 7 个 L2 键各取 run 级(created_at 升序)近 10 个非空值,独立于 granularity。前端 `types.ts` 同步扩型;新组件 `eval-sparkline.tsx`(纯 SVG polyline,无 echarts 依赖,jsdom 可直测)经 `EvalMetricsOverview` 新 prop `sparks` 接入 7 个 L2 瓦片(sparks 数据源 = eval-tab 已有的 `useEvalTrend` query,不新增请求);`eval-trend-chart.utils.ts` 增 `PICKER_METRICS` 表(4 项),picker 选中态为 eval-tab 会话级 `useState`,**条件性并入 series**(picker 系列不进 legend.data,故不走 legend.selected);稀疏语义靠 echarts `connectNulls` 默认 false + tooltip 补"该档未跑"哑行。

**Tech Stack:** FastAPI + SQLAlchemy(backend,无 migration)+ React 19 + TanStack Query + TypeScript(frontend);后端 `pytest`,前端 `rstest`(`pnpm test`)+ `pnpm check` + `ruff`。

**Global Constraints:**
- Branch: `feat/rag-knowledge-base`;每个 task:RED → GREEN → revert proof(stash 实现→RED→pop→GREEN)→ commit(Conventional Commits,**English subject only,无 body**)。
- Backend TDD mandatory:`cd backend && uv run pytest <file> -q`;frontend `python scripts/pnpm.py test <filter>`;收尾 `python scripts/pnpm.py check` + `ruff check/format` 双净。
- 契约冻结(spec §6):周期点 10 键与 `sparks` 7 键实施后不得增删;`sparks` 与 granularity 解耦。
- i18n 纪律:新文案走 `tk.eval.trend.*`(types.ts / zh-CN.ts / en-US.ts 三处同步)。
- 样式纪律:sparkline 中性 `text-muted-foreground`(不引入第 11 套颜色词汇);picker 四线色冻结:path_accuracy `#84CC16`(L1 实线)、citation_precision `#F97316`、citation_recall `#14B8A6`、seed_hit_rate `#A855F7`(L2 虚线)——与图例六色不撞。
- 密度纪律:picker 触发器与趋势卡头粒度段控同档;瓦片内 sparkline **缩档 28×12(w-7 h-3)、
  与数值同行右置**(数值行 `flex items-center justify-between gap-1`),进度条 h-1 保留瓦片底部;
  26rem 下限数学:值 ≈52 + gap 4 + 28 = 84 ≤ 87 放得下;不破 MetricTile 现有解剖(名称+ⓘ/值/进度条)。
- y 轴纪律(spec §4.5-6):随可见序列自适应(图例开关经 `legendselectchanged` 回流 React state);
  seeds 含阈值线值;padding 0.05 按 5% 取整、yMax 封顶 1;**最小轴程 10pp**;yMin>0 时卡头芯片
  "Y轴 xx%–yy%"(i18n `trend.yAxisRange`)。
- Known code facts (verified 2026-09-06):
  - `trend.py::aggregate_trend_points`(L97-138):周期点 dict 现 6 键;每层周期末次行经 `latest_layer_row`;响应含 `points/granularity/baseline/has_data`(has_data 驱动 eval-tab 空态)。
  - run 级源:`store.list_eval_runs(kb_id)` 行带 `layer2_metrics`(ragas 四键 + 引用三键);sparks 非空过滤后取近 10、升序。
  - 前端 `TrendPoint`(types.ts ~L511)6 键 + `layer1_run_id/layer2_run_id/regression/is_baseline_update`。
  - `eval-trend-chart.utils.ts::METRICS`(6 项,defaultOn 2)+ `legend.selected`;`buildTrendTooltipHtml` 从 params 取数(null 点不进 axis params → "该档未跑"哑行需显式补)。
  - `eval-metrics-overview.tsx::MetricTile`:7 个 L2 瓦片 = RAGAS 4 + 引用 3(grid-cols-4 引用组留空槽);null/disabled = opacity-60 语义不变。
  - `eval-tab.tsx` 趋势卡头:toggle 左簇 + ⓘ + 阈值红芯片 + 粒度段控;picker 加在同一头部行(toggle 只包左簇先例,防按钮嵌套)。
  - 测试基建:backend `tests/knowledge/eval/test_trend.py`;frontend `eval-trend-chart.unit.test.ts` / `eval-metrics-overview.dom.test.tsx` / `eval-tab.dom.test.tsx`(hooks mock 注入先例)。

---

## Phase 1: 后端数据平面

## Task 1: trend 周期点扩 10 键 + 顶层 `sparks`(7 键)

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/eval/trend.py`(周期点 dict +4 键;新增 sparks 装配函数:7 个 L2 键 × run 级近 10 非空值升序)
- Modify: trend 响应装配处(service/router,实施时定位;+`sparks` 字段透出)
- Modify: `backend/tests/knowledge/eval/test_trend.py`(+键集合与 sparks 语义用例)

- [x] RED test:周期点键集合 == 10(6 现状 + path_accuracy + citation_precision/recall + seed_hit_rate),缺层仍 null;
  - sparks:7 键齐;run 数 <10 → 数组等长于可用非空 run;全 null 键(ragas 未装)→ 空数组;
  - granularity 无关:day/week/month 三次调用 sparks 恒等;
  - 升序与"非空过滤"语义:含 null 的 run 被跳过而非占位。
- [x] Run `cd backend && uv run pytest tests/knowledge/eval/test_trend.py -q`,记录 RED。
- [x] Implement(trend.py 扩键 + sparks 装配 + 响应透出)。
- [x] GREEN;revert proof:stash 实现 → RED → pop → GREEN。
- [x] ruff check/format 双净。
- [x] Commit: `feat(rag): extend eval trend payload with picker keys and tile sparks`

> **Task 1 实施注记(2026-09-06,commit `5c78aaa9`)**:除 plan 列出的 3 个文件外,`backend/tests/knowledge/test_eval_runs_api.py` 也必须同步——空历史用例做精确 dict 相等断言,响应新增 `sparks` 键后补 7 条空数组;另加两条服务级用例(跨 day/week/month `sparks` 恒等 + `sparks` 含窗口外 run),坐实"`sparks` 取**全量** rows、与 granularity/时间窗口解耦"。设计落点:`build_sparks` 为 trend.py 新增纯函数(无 granularity 形参 → 构造上即粒度无关,`MAX_SPARKS=10` 近端截断);周期点 `path_accuracy` 取 L1 `summary`、引用三取 L2 `arch_specific`;退役的 `context_recall` 只进 `sparks` 不进周期点。`get_eval_trend` 端点无 `response_model`,`sparks` 直接透出。验证:`tests/knowledge/eval` 326 passed。

---

## Phase 2: 前端类型与 sparkline 扫描面

## Task 2: `TrendPoint` 扩键 + `TrendResponse.sparks` 类型

**Files:**
- Modify: `frontend/src/core/knowledge/types.ts`(TrendPoint +4 可空键;TrendResponse +`sparks: Record<SparkMetricKey, number[]>`,7 键联合类型导出)

- [x] 扩型并跑 `python scripts/pnpm.py check` GREEN(类型层无独立 RED,编译即证)。
- [x] Commit: `feat(rag): type eval trend payload picker keys and sparks`

> **Task 2 实施注记(2026-09-06,commit `483cc53f`)**:新增 4 键与 `sparks` 按冻结契约设为**必填**(后端恒返回),故 4 个测试文件的 TrendPoint/TrendResponse mock 必须同步补键——`eval-tab.dom.test.tsx`(TREND)、`eval-trend-chart.unit.test.ts`(point() 助手)、`eval-trend-chart.dom.test.tsx`(POINTS)、`hooks.dom.test.tsx`(EVAL_TREND)。其中第 4 处由 `pnpm check`(tsc)捕获(grep 25 条上限漏掉),印证"扩共享型后必跑 tsc 兜底枚举构造点"。`SparkMetricKey` 7 键联合型已导出,与后端 `SPARK_KEYS` 一一对应。check 双净 + 受影响套件全绿(trend-chart 27 / eval-tab / hooks)。

## Task 3: sparkline SVG 组件 + 7 个 L2 瓦片接入

**Files:**
- Create: `frontend/src/components/workspace/knowledge/eval-sparkline.tsx`(纯 SVG polyline:values → 归一化折线 + 端点实心圆;stroke 走 `currentColor` + 外层 `text-muted-foreground`;**固定 28×12(w-7 h-3)**;values.length < 2 → 返回 null)
- Modify: `frontend/src/components/workspace/knowledge/eval-metrics-overview.tsx`(MetricTile +可选 `spark?: number[]` prop:**数值行改 `flex items-center justify-between gap-1`,数字左/迷你线右**;组件新 prop `sparks?` 由 eval-tab 的 `useEvalTrend` 数据传入,7 个 L2 瓦片按键接线)
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(把 trend query 的 sparks 透传 overview)
- Modify: `frontend/tests/unit/knowledge/eval-metrics-overview.dom.test.tsx`(sparks 注入 → 7 瓦片各含 svg 且**与数值同行**(value-row 容器内兄弟节点);缺键/空数组 → 无 svg;context_recall 瓦片有 sparkline;L1 表格区零 svg)

- [ ] RED test(上述 dom 断言)。
- [ ] Run `python scripts/pnpm.py test eval-metrics-overview`,记录 RED。
- [ ] Implement(sparkline 组件 + 瓦片接线 + 透传)。
- [ ] GREEN;revert proof。
- [ ] Commit: `feat(rag): add L2 tile sparklines from trend sparks`

---

## Phase 3: picker 与主图稀疏语义

## Task 4: picker 下拉多选(4 候选)+ 图表 option 扩展 + i18n

**Files:**
- Modify: `frontend/src/components/workspace/knowledge/eval-trend-chart.utils.ts`(+`PICKER_METRICS` 表 4 项:key/labelKey/color/layer,线型沿用 layer 语义;`buildChartOption` +`pickerSelected`/`visibleKeys` 入参 → 条件并入 series + **y 轴按可见序列自适应**(seeds 含阈值、padding 0.05、5% 取整、最小轴程 10pp);`buildTrendTooltipHtml` +已选 picker 键入参 → null 日期补"该档未跑"哑行;新增 `buildYAxisRangeLabel` 供卡头芯片)
- Modify: `frontend/src/components/workspace/knowledge/eval-tab.tsx`(趋势卡头 +DropdownMenu 多选(trigger 与粒度段控同档、aria-label)+ **echarts `legendselectchanged` 回流可见集 state** + yMin>0 时卡头芯片"Y轴 xx%–yy%";会话级 `useState<string[]>`;项尾注"仅完整档";选中态传入 option 组装)
- Modify: `frontend/src/core/i18n/locales/{types,zh-CN,en-US}.ts`(+`trend.pickerTrigger/pickerAria/fullTierOnly/notRunInTier/yAxisRange`)
- Modify: `frontend/tests/unit/knowledge/eval-trend-chart.unit.test.ts`(picker 系列并入/移除、线型实/虚、tooltip 哑行;**y 轴:隐藏低值指标不撑轴/最小轴程/阈值入 seeds/范围标签文案**)
- Modify: `frontend/tests/unit/knowledge/eval-tab.dom.test.tsx`(picker 开合、勾选透传、项尾注文案、会话级不持久化;**legendselectchanged 回流后 y 轴重建;zoom 芯片显隐**)

- [ ] RED test(utils unit + eval-tab dom 上述断言)。
- [ ] Run `python scripts/pnpm.py test eval-trend-chart; python scripts/pnpm.py test eval-tab`,记录 RED。
- [ ] Implement(utils 扩展 + picker UI + i18n 三处)。
- [ ] GREEN;revert proof。
- [ ] `python scripts/pnpm.py check` 净。
- [ ] Commit: `feat(rag): add trend metric picker for sparse full-tier metrics`

---

## Phase 4: 回归与验收

## Task 5: 全量回归 + spec §8 验收

- [ ] `cd backend && uv run pytest tests/knowledge/eval -q` 全绿。
- [ ] `python scripts/pnpm.py test knowledge` 套件回归(唯一允许失败:预存 chat-panel 模型选择器用例)。
- [ ] `python scripts/pnpm.py check` + `cd backend && uv run ruff check/format` 双净。
- [ ] 手动验收(spec §8):重启 gateway → 评测 tab 7 个 L2 瓦片**数值行右侧**出现 28×12 迷你线;picker 勾"引用准确率"主图加虚线且快速档空点断开、tooltip 显"该档未跑";context_recall 不在图例/picker 但瓦片有迷你线;L1 表格与主图默认/图例零视觉变化;**80–95 高分簇铺满图高,zoom 时卡头芯片显"Y轴 xx%–yy%"**。
- [ ] 验收截图/结论回写本 plan 尾注。
