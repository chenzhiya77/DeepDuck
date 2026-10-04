# RAG 知识栈持有实例随配置换新 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-05-rag-store-refresh-design.md](../specs/2026-10-05-rag-store-refresh-design.md)
**Status:** 已裁（2026-10-05）——D1=甲、D2=甲；施工中：Task 0 完成（落点已回填）。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 修法 | ✅ 已裁=甲：取值口自检换新（worker + service） | 乙（重建 worker/service）、丙（迁移收尾换新）、架构级 |
| D2 卡片竞态 | ✅ 已裁=甲：点龄判据（payload `updated_at` + 宽限 60s） | 乙（写入侧自检）、丙（两轮确认）、丁（改序） |

## 硬约束

- 配置未变 ⇒ 取值口同一实例；不新增配置面；假体直通；迁移自身代次 store 钉死宽度不动；只动取值口。

## Task 0 — 落点核实

- [x] ① 取值点清单：`worker.py` 里 `self._vector_store` 全部使用点（~10 处）与既有测试对它的读写（有无直接赋值/identity 断言——上一对 wiring 测试有一条 `is worker._vector_store`）；`knowledge_service.py` 里 `self.vector_store` 使用点与 router 侧读法（`rag_config.py:686`）。
- [x] ② `KnowledgeVectorStore` 复用 client 换宽度的可行性：ctor `(url=None, client=None, collection_prefix="kb", dense_size=…)` 现状、url 未存的问题（补记）、测试里 `_FakeQdrant` 的 client 形状（`test_vector_store_dimensions.py`）。
- [x] ③ 自检读配置的代价与路径：`get_app_config()` 签名缓存现状、`effective_dimension(rag)` 是否可直传；`vector_store.py` 内惰性 import 先例（`get_vector_store()`）。
- [x] ④ 注入面清单：fake 直通（MagicMock/FakeVectorStore/SimpleNamespace）+ **真实例逐点列**（`test_e2e_smoke.py:106` / `test_phase2_smoke.py:86` 的 `client=` 构造、`test_vector_store_dimensions._store(client=…)`）——按「url 未知直通」规则应全部直通，逐点确认。
- [x] ⑤ 真栈脚本改造点：`E:/app-model/deer-flow-scratch/stale-store/e2e.py`（上一对钉死用）——翻转后把「startup 实例直用」改为「经取值口取」再入库；另加 **①相**改造点（`service.store.update_manual_card` 包闸门以撑开 [upsert → 行写] 窗口）。
- [x] ⑥ ①落点：`ManualCardUpsert` 构造点（create / update 两处 upsert）与 payload 消费面（hydration 读行不读 payload——加键零影响）；`sweep._sweep_manual_cards` 两段判据位置；既有 D5 用例对"无 `updated_at`"的依赖（应全部照旧可删、零改动）。

**实测（2026-10-05，Task 0 · 只读）**：

- ① ✓ worker `self._vector_store` **12 处**（`:261` init_collections / `:429` sweep_round / `:432` sweep_generations / `:509` 入库 / `:540`·`:574`（视频/重跑路）/ `:688-689` 删除 / `:1057`·`:1068-1069` 切片编辑 / `:1096`）；service `self.vector_store` **~26 处**（删除族、`:746` 重嵌切片、`:955`/`:1044` 卡片、检索三路 `:1112/1119/1135`、投影 `:1393`、wiki/reindex `:1725/1761/1769`）；router 只有 `rag_config.py:686` 一处读。全部为属性取值 ⇒ 属性化**零调用点改动** ✓。测试交互面全是读 mock 方法（`service.vector_store.delete_by_doc` 类断言）——mock 直通后原样 ✓；无对两属性的直接赋值（唯一 `test_api.py:732` 是往 mock 上赋方法）✓。
- ② ✓ ctor 现状 `(url=None, client=None, collection_prefix="kb", dense_size=…)`——**url 未存**（只存 `_client/_prefix/_dense_size`）；`_FakeQdrant` 是极简 client 双（collection_exists/get_collection/create_collection/create_payload_index）——换新构造不需要它做任何调用 ⇒ 可直接用作换新单测的 client ✓。
- ③ ✓ 签名=共享 `file_signature.get_config_signature` 的 `(mtime, size, sha256)`、**每次全文件哈希**（注释写明防"同秒同长换内容"）——rag_config.json 极小、量级可忽略；`effective_dimension(rag=None)` 可直传 ✓；`vector_store.py` 已有惰性 import 先例（`get_vector_store()` 内）✓。
- ④ ✓ 全仓真实例注入面 **8 文件全为 `client=` 构造**（graph/tools/wiki conftest、`test_vector_store`、`test_vector_store_dimensions`、`test_indexer`、`e2e_smoke`、`phase2_smoke`）⇒ 按「url 未知直通」规则 **100% 直通、零测试扰动**；fake 面（MagicMock/FakeVectorStore）经 isinstance 直通 ✓。
- ⑤ ✓ 脚本在；①相改造点=给 `service.store.update_manual_card` 包闸门（`knowledge_service.py:1040` 的调用处）撑开窗口 ✓。
- ⑥ ✓ `ManualCardUpsert` 构造点 = **3**（`knowledge_service.py:955` / `:1044` / `reindex.py:300`）；payload 消费面 = hydration 只读 `payload["card_id"]`（`wiki_search_tool.py:83`）+ 投影按 id 取行——**加键零影响** ✓；`_sweep_manual_cards` 两段判据在位（`:183` 候选 / `:186` 复核，`_card_is_live` `:173`）；既有 D5 用例夹具点均无 `updated_at`（新规则下=老、照删）⇒ **零改动** ✓。

## Task 1 — 取值口自检换新（TDD）

- [ ] RED：宽度差 ⇒ 换新且复用同一 client、集合名带新宽度；一致 ⇒ 同一实例；url 差 ⇒ 重建；假体直通；`url=None`（client 注入）⇒ 直通不重建（**死循环式换新回归钉**）；worker 与 service 两取值口各一（真 store + 配置桩换新、fake 原样）。
- [ ] GREEN：`vector_store.py` 补 `dense_size`/`url` 访问器（ctor 有 client 时也记 url）与 `refreshed_store(held)`（判别含 url-未知直通；换新构造带 url）；`worker._vector_store` 与 `service.vector_store` 变自检属性（存量字段改名，调用点零改动）。
- [ ] neuter：关自检（恒返回 held）⇒ 换新用例恰红；还原复绿；门禁 + 实测回填。

## Task 2 — 卡片点龄判据（①，TDD）

- [ ] RED：flag 关 + 新点（`updated_at≈now`）⇒ 保留（**当前代码会删——即合成交错的最小复现，修前红**）；flag 关 + 老点 ⇒ 删；无 `updated_at` 键的存量点 ⇒ 删；行缺 + 新点 ⇒ 保留；已删库组（kb 行无）不受龄门影响 ⇒ 照清。
- [ ] GREEN：`ManualCardUpsert` 加 `updated_at` + payload 键；create / update 两处 upsert 传 `time.time()`（重嵌 `reindex.py:300` 留默认 `0.0`=老）；`_sweep_manual_cards` 收集段加龄门（`_CARD_ORPHAN_GRACE_SECONDS = 60.0`；无键=老）。
- [ ] neuter：关龄门（恒可删）⇒ 新点保留用例恰红；还原复绿；门禁 + 实测回填。

## Task 3 — 真栈验收

- [ ] 隔离实例（stale-store 场景改造）：真迁移三步 + 不重启 → 经取值口入库成功、点落在新代、检索可读；重启对照仍过；**①相**：闸门撑开 [upsert → 行写] 窗口、跑真 `sweep_round` ⇒ 新点不被删；放闸后行开、点仍在。
- [ ] 收尾：容器/进程清理并核验。

## Task 4 — 文档与收尾

- [ ] `backend/AGENTS.md` 迁移段补一句（翻转后持有实例随配置换新，取值口自检）；清扫条补一句（D5 判据含点龄宽限）；spec/plan 状态行与实测回填。
- [ ] 提交链回填。
