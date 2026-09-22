# 表格入库真栈实测（2026-09-23）

计划：`docs/superpowers/plans/2026-09-09-table-ingest.md` Task 7 末条（原「延后（环境未就绪）」）。
环境：用户本机真栈 —— frontend `:3000` + Gateway `:8001`（`rag.table.enabled: true`、Qdrant `:6333` 由 `docker start qdrant` 拉起）；知识库「测试2」。
夹具（`.deer-flow/table-smoke/`，不入库）：`产品库存台账.xlsx`（2 sheet、库存明细 40 行）· `员工花名册.csv`（37 行）· `季度采购汇总.pdf`（headless Chrome 打印的表格页，走 MinerU cloud）。

## 结果

| 项 | 结果 | 证据 |
|---|---|---|
| 上传三件套 → 五态到 ready | 三件全部 `ready 100%`（vector/graph done） | 见下方切片证据 |
| xlsx 行卡：真表格 + 每块含表头 | 抽屉里 3 张真 `<table>`：库存明细 31 行 + 9 行（**同 6 列表头重复**）+ 补货计划；标签 `表格：库存明细（第 1-31 行 / 共 40 行）` | `xlsx-drawer.dom.html`、`xlsx-drawer-tables.json` |
| chunk_count 无行爆炸 | xlsx=3 / csv=2 / pdf=1 | `pdf-chunks.json` |
| PDF（MinerU HTML 表）归一化 | 单切片即 GFM 管道表 | `pdf-chunks.json` |
| 对话检索命中正确行 | 问 SKU-1001 → 「库存数量为 128，单价为 399 元」（hybrid_search 带引用） | `chat-answer.txt` |
| 检索测试命中行卡 | 向量通道 #1 = `表格：库存明细（第 1-31 行）` 0.938 | `recall-test.txt` |
| 评测跑一轮表格 KB | 完整评测 1m37s，事实(n=2) 命中/召回/MRR/路径全 100% | `eval-after-drain-overview.txt` |

## 两条环境口径（不是产品缺陷）

1. **截图不可用**：in-app 浏览器窗口处于隐藏态（`viewport=0x0`、`visibilityState=hidden`），`take_screenshot` 直接报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`。故本目录以 **DOM/JSON/文本快照**（由页内 `fetch` POST 到本地桩落盘）替代截图。
2. **原地自动刷新未能观察**：TanStack Query v5 在窗口失焦时暂停 `refetchInterval`，隐藏窗口下轮询停摆（网络日志：触发后仅 2 次 `GET /eval-runs`）。drain 后重进视图数据即刷新（`eval-after-drain-*`），**「原地自动收敛」由 E2E（可见的 headless Chromium）覆盖**，见 `frontend/tests/e2e/eval-tab-phase2.spec.ts`。

## 截图/dump 操作要点（供下次真栈实测复用）

Radix 菜单/弹窗在隐藏窗口下需合成 `pointerdown → pointerup → click`；弹窗关闭后**留在 DOM**（退场动画不跑），判「开着」必须用 `[role=dialog][data-state=open]`，且一次性关闭要逐个点 `Close`。