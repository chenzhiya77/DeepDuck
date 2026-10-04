# 重建窗口 delta 复走 —— 实施计划

- 成对 spec：`docs/superpowers/specs/2026-10-05-rag-reembed-delta-pass-design.md`
- 日期：2026-10-05
- 状态：**决策已裁、待开工**（2026-10-05 他拍：D1=甲一遍 delta / D2=乙章归 delta 完整后 / ③=甲并入本对当重建通道加固）

## 范围与交接

一件事：同宽换模型就地重建（D3 通道）翻转后补走每库 delta 复走，把「翻转前写入、主行走没覆盖」的行补进新空间，让 D2 的章=真相。**并入件 ③**：同通道的翻转写加固（replace 撞车瞬态重试 + 翻转失败落 `failed` 不留 `running`）。与孤儿向量清扫对互补（清扫判「行不存在」删点；本对修「行都在、空间错」的活文档）、与物化默认键补丁（`bd61109db`，已交付）无关。改动面=`rag_reembed.py` + `reindex_kb` 参数化（默认零变化）+ 盖章时序后移；查询路径、宽度通道、worker 写序零改动。

## 硬约束（执行期注意）

- `reindex_kb` 默认行为零变化：新参数 opt-in（D2=乙 的 `stamp` 亦默认 True），旧调用方（含 worker、存量脚本）语义不动。
- 不动 hold/flip 语义、不动 `migrate_collections` 及其二遍。
- 失败如实：delta 失败记日志 + 状态 `failed`，不翻回、不遮掩（D2=乙 ⇒ 章留旧值/NULL，D4 可见）；③同姿态：翻转写失败落 `failed`、replace 撞车重试不打死任务。
- 门禁用 `backend/.venv/Scripts/python.exe`；basetemp 用仓外隔离目录、跑完删（见 [[env-induced-test-failures]]）。在案 flake 两条（图谱并发、rag_config 翻转竞态族——后者正是 ③ 的病）单跑复绿即可归因。
- 工作树有别线未提交内容，提交按线拆、逐文件看 hunk。

## Task 0 — 落点核实

- [ ] ① `reindex_kb` 签名与语义：`include_non_terminal=True` 的精确行为（哪些行进重嵌集、游标/批次怎么走）、宽度通道二遍（`dimension_migration.migrate_collections` 的 `include_non_terminal=True`）怎么调它——delta 复走要同构。
- [ ] ② 盖章点参数化：`reindex_kb` 现在「全程完整后写身份」的写点在哪一行、加 `stamp: bool = True` 后哪些既有断言受害（`test_reindex_stamps…` 等）、worker 首件闸要不要跟着动（预期：不动）。
- [ ] ③ 插入点：`rag_reembed._run` 的 flip 前后结构——delta 循环插在哪、单库 delta 失败的记账落点（`_Run` 状态/日志）、重跑路径（`reembed_libraries` 入口）是否天然吃 delta（预期：重跑=再走一遍主行走，delta 语义不变）。
- [ ] ④ 受害者扫描：断言 flip 时序/盖章时序/`reindex_kb` 调用次数的既有用例清单（`tests/knowledge/test_rag_reembed*.py`、`test_reindex.py`），谁会被「章后移/delta 多一轮调用/翻转失败落状态」波及。
- [ ] ⑤ ③ 竞态面核实：`atomic_write_rag_config` 的 tmp+`os.replace` 落点与调用方集合、`_run` 翻转写的 try/except 覆盖现状（实锤=翻转写在罩外）；重试的落点选「写文件助手」还是「调用方」（判据：所有写配置路径受益 vs 只保重建通道）。

## Task 1 — delta 复走 + 盖章后移 TDD（D1=甲、D2=乙）

- [ ] RED：①主行走完成不写身份、delta 完整走完才写（=当前指纹）；②模拟窗口文档（行落在主行走游标后）⇒ delta 把它补进新空间；③delta 失败 ⇒ 身份留旧值/NULL、状态 `failed`，重跑修复。—— 写红进 `tests/knowledge/`（落点按 Task 0④ 核实结果定），缺键对照的牙按老规矩留 neuter 补。
- [ ] GREEN：`reindex_kb` 加 `stamp` 参数（默认不变）+ `rag_reembed._run` flip 后每库 delta 复走（`include_non_terminal=True`）+ 失败记账。
- [ ] neuter：拆 delta 循环 ⇒ 窗口文档用例恰红；拆盖章后移 ⇒ 完整性用例恰红；还原复绿、受害者不相交。
- [ ] 门禁：knowledge 面（环境红按既有账）+ `test_rag_config_api.py` + ruff 双净。

## Task 2 — ③ 翻转写加固 TDD

- [ ] RED：①翻转写抛异常 ⇒ 状态落 `failed`（不是永驻 `running`）、后续保存不再被 409 挡死；②replace 瞬态撞车（`PermissionError(13)` 一次后成功）⇒ 重试后任务存活、配置落盘。—— 反证桩按老打法（monkeypatch 写失败/撞车一次）。
- [ ] GREEN：翻转写纳入 try/except 失败记账 + replace 瞬态重试（落点按 Task 0⑤）。
- [ ] neuter：摘失败记账 ⇒ ①恰红；摘重试 ⇒ ②恰红；还原复绿、受害者不相交。
- [ ] 门禁：同 Task 1 面。

## Task 3 — 门禁 + 回填

- [ ] 全量门禁 + spec/plan 回填实测数字与提交链；`backend/AGENTS.md` 的「Embedding identity & rebuilds」段更新已知缺口（delta 复走落地后删除该缺口行、换一句 delta 语义与 ③ 姿态）。
- [ ] 尾部残余登记：单文档嵌入时延（D1=甲）写进 spec 非目标/残余，与宽度通道同口径。
