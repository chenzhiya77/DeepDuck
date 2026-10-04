# 重建窗口 delta 复走 —— 实施计划

- 成对 spec：`docs/superpowers/specs/2026-10-05-rag-reembed-delta-pass-design.md`
- 日期：2026-10-05
- 状态：**决策已裁、待开工**（2026-10-05 他拍：D1=甲一遍 delta / D2=乙章归 delta 完整后 / ③=甲并入当重建通道加固；同日审查后追加：复走门槛=甲·指纹门，审查精化九条全采纳）

## 范围与交接

一件事：同宽换模型就地重建（D3 通道）翻转后对**动过的库**补走 delta 复走（`_content_mark` 指纹门同构宽度通道，没动过的库零嵌入），把「翻转前写入、主行走快照没覆盖」的行补进新空间，让 D2 的章=真相。**并入件 ③**：同通道的翻转写加固（replace 撞车**有界**重试 + 翻转失败落 `failed` 不留 `running`）。失败词汇定形：`failed` 只给 raise；软失败=succeeded+无章+D4 可见。与孤儿向量清扫对互补、与物化默认键补丁（`bd61109db`，已交付）无关。改动面=`rag_reembed.py` + `reindex_kb` 参数化（默认零变化）+ 盖章时序后移 + 写文件助手重试；查询路径、宽度通道、worker 写序零改动。

## 硬约束（执行期注意）

- `reindex_kb` 默认行为零变化：新参数 opt-in（`stamp` 默认 True），旧调用方（worker、手动重建 `knowledge_service.py:1755`）语义不动。
- 不动 hold/flip 语义、不动 `migrate_collections` 及其二遍（只抄它的指纹门与调用形，不抄 `_drop_documents_that_left`——in-place 删除走自己的路）。
- 失败如实：raise ⇒ 记日志 + 状态 `failed`（章留旧值/NULL，D4 可见）；软失败 ⇒ `succeeded` + 不盖章 + D4 可见。③同姿态：翻转写失败落 `failed`、replace 重试 3 次/50–100ms、耗尽按翻转失败。
- 门禁用 `backend/.venv/Scripts/python.exe`；basetemp 用仓外隔离目录、跑完删（见 [[env-induced-test-failures]]）。在案 flake 两条（图谱并发、rag_config 翻转竞态族——后者正是 ③ 的病）单跑复绿即可归因。
- 工作树有别线未提交内容，提交按线拆、逐文件看 hunk。

## Task 0 — 落点核实

- [x] ① `reindex_kb` 签名与语义（已核 2026-10-05 审查）：`include_non_terminal=True`（reindex.py:117）=整库复走、含非终态文档（:155 的跳过闸只对默认形生效）；宽度通道二遍（dimension_migration.py:141-165）带**指纹门**——`_content_mark` 基线（`get_kb_content_stats` 四信号 + 文档 id 集）对比，没动过的库零嵌入跳过；门不受重建自身写入污染（`index_chunks`/`update_document_status` 只碰 documents 表）。实体信号盲区（count only、表无时间戳列）已在 spec §2 登记。
- [ ] ② 盖章点参数化（部分已核）：写点唯一=reindex.py:198-201（`if complete:`），`stamp` 参数=一行闸；受害者清单（`test_reindex_stamps…` 等）留 RED 期一起扫。worker 首件闸不动。
- [x] ③ 插入点（已核 2026-10-05 审查）：翻转写在 try/except 外=rag_reembed.py:145-146（③ 半二实锤）；delta 循环插在 flip 后、按指纹门逐库；失败记账落 `_Run`（`failed` 只给 raise）；重跑路径 `reembed_libraries` 天然再走一遍（门基线随新 run 重拍）。
- [ ] ④ 受害者扫描：断言 flip 时序/盖章时序/`reindex_kb` 调用次数的既有用例清单（`tests/knowledge/test_rag_reembed*.py`、`test_reindex.py`），谁会被「章后移/delta 多一轮调用/翻转失败落状态」波及。
- [x] ⑤ ③ 竞态面（已核 2026-10-05 审查）：`atomic_write_rag_config`（rag_config_file.py:314，tmp+fsync+`os.replace` :347、无重试）；生产调用方唯一=`write_rag_config`（:301）⇒ 重试落助手、所有写方受益；并发读方=load（:226）+ 热重载签名检查（file_signature.py:49）——Windows 打开句柄无 FILE_SHARE_DELETE ⇒ replace 报 13。孪生 `atomic_write_models_config` 同病已登记（spec §6）。

## Task 1 — delta 复走 + 盖章后移 + 指纹门 TDD（D1=甲、D2=乙、门槛=甲）

- [ ] RED：①主行走完成不写身份、delta 完整走完才写（=当前指纹）；②两遍之间插入完成的文档（快照缝）⇒ delta 把它补进新空间；③门槛：窗口里没动过的库零嵌入跳过、动过的库整库复走；④delta raise ⇒ 章留旧值/NULL、状态 `failed`，重跑修复；软失败 ⇒ `succeeded`+无章。—— 写红进 `tests/knowledge/`（落点按 Task 0④ 定），缺键对照的牙按老规矩留 neuter 补。
- [ ] GREEN：`reindex_kb` 加 `stamp` 参数（默认不变）+ `rag_reembed._run` flip 后按指纹门逐库 `reindex_kb(include_non_terminal=True)`（基线在 run 开始拍、翻转后对比）+ 失败记账（`failed` 只给 raise）+ `reindex.py:126` docstring「exists for one caller」改两调用方（审查 6）。
- [ ] neuter：拆 delta 循环 ⇒ 窗口文档用例恰红；拆盖章后移 ⇒ 完整性用例恰红；拆门槛（基线恒等）⇒ 门槛用例恰红；还原复绿、受害者不相交。
- [ ] 门禁：knowledge 面（环境红按既有账）+ `test_rag_config_api.py` + ruff 双净。

## Task 2 — ③ 翻转写加固 TDD

- [ ] RED：①翻转写抛异常 ⇒ 状态落 `failed`（不是永驻 `running`）、后续保存不再被 409 挡死；②replace 瞬态撞车（`PermissionError(13)` 一次后成功）⇒ 有界重试后任务存活、配置落盘；③重试耗尽 ⇒ 按翻转失败落 `failed`。—— 反证桩按老打法（monkeypatch 写失败/撞车 N 次）。
- [ ] GREEN：翻转写纳入 try/except 失败记账 + `atomic_write_rag_config` 有界重试（3 次、50–100ms 退避；审查 4）。
- [ ] neuter：摘失败记账 ⇒ ①恰红；摘重试 ⇒ ②恰红；摘上限 ⇒ ③恰红；还原复绿、受害者不相交。
- [ ] 门禁：同 Task 1 面。

## Task 3 — 门禁 + 回填 + 登记

- [ ] 全量门禁 + spec/plan 回填实测数字与提交链；`backend/AGENTS.md` 的「Embedding identity & rebuilds」段更新已知缺口（delta 复走落地后删缺口行、换 delta 语义与 ③ 姿态）。
- [ ] 登记三件落文档（审查 7/8/9）：孪生竞态（models_config）、清扫 busy 面、进度观感；尾部残余（单文档嵌入时延）登记同 spec §6。

## Task 4 — 真栈验收（审查 5）

- [ ] 触发重建（改模型名→保存）→ 窗口里塞一篇文档 → 验：delta 把它补进新空间（cos 抽验复常）、章最后落、D4 静默；顺手看一眼 `reembed.state` 全程不卡。配置逐字节还原（`cp`+md5 老配方）、临时文档/库删净、scratch 留 `E:\app-model\deer-flow-scratch\`。
