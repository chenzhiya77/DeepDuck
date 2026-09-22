# 评测 tab 二期真栈冒烟五项（2026-09-23）

计划：`docs/superpowers/plans/2026-08-27-rag-eval-tab-phase2.md` Task 9 / Final verification。
环境：用户本机真栈（frontend `:3000` + Gateway `:8001` + Qdrant `:6333`），知识库「测试2」。

| # | 冒烟项 | 结果 | 证据 |
|---|---|---|---|
| ① | 题库空态 → 手动添加一题 → 表格出现 | 空态文案正确；经「更多选项 → 添加考题」加一题，表格出现该行（分类=事实） | `question-bank-after-add.txt` |
| ② | 运行评测 → running 态 → drain 后刷新 | 完整评测：running 横幅（「估算中…／评测已启动，等待首个进度事件…」）→ 1m37s 完成；总览层二指标（忠实度 100%、相关性 89.4%）与历史新行随后呈现 | `eval-running-state.txt`、`eval-overview-running.txt`、`eval-after-drain-overview.txt`、`eval-after-drain-history.txt` |
| ③ | 召回面板勾选 chunk 存为考题 → 题库出现且锚定列正确 | 新题 `q_3f792b99` 的 `relevant_chunk_ids` = `e6dd4f5e4af740b0821253342c902966#0000`（该行卡），题库「参考文档」列显示「1 篇」，抽屉显示「1 切片 / #0000」+ 自动带 58 个实体 | 见 table 夹 `recall-test.txt` 与本夹抽屉证据 |
| ④ | 题库行 ↗ → 跳召回 tab 且 query 预填 | 抽屉「在召回测试面板复现」→ 活动 tab 变为「检索测试」，输入框逐字为题干 | （同上流程） |
| ⑤ | 历史行点击 → drawer 打开 | 行整行可点（复选框格 `stopPropagation`）；抽屉「评测运行详情」含 run_id、两组指标 | `eval-run-drawer.txt` |

## 两条环境口径（不是产品缺陷）

1. **截图不可用**：in-app 浏览器窗口隐藏（`viewport=0x0`），`take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`；本目录以 DOM/文本快照替代。
2. **原地自动收敛未能观察**：TanStack Query v5 在窗口失焦时暂停 `refetchInterval`（隐藏窗口下触发后仅 2 次 `GET /eval-runs`）。drain 后重进视图即取到新数据；**「drain 边自动刷新」由 `frontend/tests/e2e/eval-tab-phase2.spec.ts` 在可见的 headless Chromium 里覆盖**（2026-09-23 已跑通 2/2）。该 spec 对「开着鉴权的真栈」需要真会话——`/workspace/*` 是**服务端**守卫、`page.route` 拦不到——故照 `tests/e2e-real-backend` 先例注册一次性账号（`e2e-eval-*@example.com`），会在库里留下对应测试用户行。

## 交互要点（隐藏窗口下复用）

Radix 弹窗关闭后仍留在 DOM（退场动画不跑）⇒ 判「开着」用 `[role=dialog][data-state=open]`；菜单/复选用合成 `pointerdown → pointerup → click`；页面里同时可能挂着多个已关闭弹窗，误取第一个会把表单填进旧弹窗。