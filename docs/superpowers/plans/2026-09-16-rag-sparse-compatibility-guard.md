# RAG 稀疏来源编辑期拦截 —— 实施计划

**Spec:** [2026-09-16-rag-sparse-compatibility-guard-design.md](../specs/2026-09-16-rag-sparse-compatibility-guard-design.md)
**Status:** 未开工（2026-09-16 起草）

**Architecture:** 让**后端允许名单成为唯一事实源**，并把它沿已有通道推到两个边界上——读到界面（`GET /api/rag/config` 加一个只读能力块，前端据此在编辑期拦下并禁用保存），写到磁盘（`PUT` 落盘前用 `build_embedder()` 试构建一次，失败即 400 并回传同一句原因）。运行期的配置类拒绝改抛 `RagConfigurationError(ValueError)`，网关只为一个类型注册 400 映射，给手工改过 `rag_config.json` 的部署留一条可读出口；worker 与工具的失败语义一律不动。

**依赖顺序**：Task 1 → Task 2 → Task 3 是后端一条链（能力块先落地，PUT 与异常类型复用同一段判定）；Task 4 依赖 Task 1 的字段；Task 5 收尾。

---

## Task 0 — 开工前的三项核实（只读，不改代码）

1. `RagConfigResponse` 加字段是否会打破 `TestGatewayConformance` 或前端 `RagConfigView` 的必填项（预期：纯加法，不会；如会，先改契约再动手）。
2. 异常处理器该注册在哪：`app/gateway/app.py` 的 `create_app()` 里（`include_router` 附近），确认那里能在注册路由前后加 `app.add_exception_handler` 且对全部 router 生效。
3. `deerflow.knowledge.providers.provider_ids("embedding")` 是否已导出（D1 需要按它枚举，**不要**在前端或路由里再写一份 id 列表）。

---

## Task 1 — 后端：能力块随配置下发（D1）

**状态：已交付 2026-09-16。**

**交付纪要**

- 夹具 `backend/tests/fixtures/rag_config/response_golden.json` 由**改动前的端点真跑**捕获（临时脚本用完即删）：GET（空 `rag_config.json` 叠在 `YAML_RAG` 上）与一次成功 PUT（那份覆盖全部新字段的 payload）。捕获时验了可复现——GET 连跑两遍相等、换新文件重跑 PUT 相等——并查验夹具无绝对路径泄漏、密钥字段皆为哨兵。
- 三条用例落在 `tests/test_rag_config_api.py` 末尾：能力列表（顺序取自 `provider_ids("embedding")`，值钉死 `dashscope=True / openai-compatible=False`）、GET 形状守卫、PUT 形状守卫。plan 里的 bullet 2/3 合并成 `_assert_pure_addition` 的两条有序断言：先键集（形状变了就点名那个键），再深层相等（值动了就 diff 出字段）。
- 实现：`app/gateway/routers/rag_config.py` 新增 `RagEmbeddingProviderCapability` 与 `RagConfigResponse.embedding_providers`（`default_factory=list`，纯加法），`_build_response` 按 `provider_ids("embedding")` 顺序用 `resolve_provider(...).emits_sparse` 填。字段说明写明「只报嵌入 leg」的理由。
- **有牙证明**：(a) 把 `emits_sparse` 写死 `True`（忽略允许名单）→ 能力用例红（`{'openai-compatible': True}` vs `False`）；(b) 键集不变、只把 `sources["qdrant_url"]` 改成 `ui` → GET 与 PUT 两条形状守卫同时红，diff 指出值变了。
- **门禁**：`tests/test_rag_config_api.py` 24 passed；周边子集（`tests/knowledge/` + 三个 rag_config 文件）绿；`ruff check` / `ruff format --check` 干净；全量后端 `pytest -m "not live" tests/` = **145 failed / 12328 passed**，其中 144 个可复现的失败**在 HEAD 上跑同一批 id 得到逐条相同的集合**（差集为空），即全部预存；余下 1 个是偶发（重跑即过）。本机跑全量需 `--basetemp=<可写目录>`，否则 `tmp_path` 用例成批 ERROR。

**RED**

- **第 0 步：先捕获 golden（必须在改任何代码之前做）。**
  - 跑既有的 `GET /api/rag/config` 与一次成功 `PUT`，把两个响应体原样存成夹具 `backend/tests/fixtures/rag_config/response_golden.json`（**端点真跑出来的字节，不手写**）。
  - 同一次运行里连跑两遍、断言相等，确认它可复现——否则夹具本身不可信。
  - 夹具里密钥字段是**掩码哨兵**、不含真实值；`sources` 依赖环境变量，所以夹具要连同"生成它的环境前提"一起记下来，测试用同一套 env 夹具复现。
- 再写三条用例：
  1. `embedding_providers` 等于允许名单的嵌入 leg（dashscope=True / openai-compatible=False），顺序与 `provider_ids("embedding")` 一致；
  2. **形状守卫**：`GET` 与 `PUT` 成功路径的响应体，键集恰好 = `golden 的键 ∪ {"embedding_providers"}`，且**除该键外与 golden 逐字节相等**（deep-equal，不归一化、不排序、不裁字段）。**不能整体比对**——加字段与"逐字节相同"互斥，这条要写成"只多这一个键、其余一字不改"。
  3. 抠掉 `embedding_providers` 后与 golden **深层相等**：把"纯加法"这件事单独钉一次，失败信息能直接指出是哪个字段被动了。

**GREEN**

- `rag_config.py`：加 `RagEmbeddingProviderCapability(BaseModel)` 与 `RagConfigResponse.embedding_providers: list[...] = Field(default_factory=list, ...)`；`_build_response` 填它（数据来自 `resolve_provider("embedding", pid).emits_sparse`）。
- 说明写进字段 description：**只报嵌入 leg**——只有它的允许名单行带「能力标志」这种需要界面预判的字段；rerank / parse 的地址约束是取值依赖，不在这一层（spec §3 D1）。
- **改完立刻重跑形状守卫**：它由绿转绿的这一跑，就是"纯加法"的证据（而不是靠人看 diff 下结论）。

**门禁**：`cd backend && make test`（窄面：先跑 `tests/test_rag_config_api.py -v`，再全量）。

---

## Task 2 — 后端：PUT 用同一段代码判定（D3）

**RED**

- 三条用例：
  1. `{embedding_provider: "openai-compatible", embedding_sparse_source: "provider"}` → **400**，`detail` 以 `提交后的配置仍不可用：` 开头、含 provider id 与「独立稀疏服务 / 本地 BM25」两条出路；
  2. 同请求落盘为零——断言读回的配置与写前一致（**不能出现半写**）；
  3. 同一请求把来源换成 `bm25` → 200 且落盘（反例：证明不是一刀切）。

**GREEN**

- `embedder_factory.build_embedder` 增加覆盖参数（spec §3 D3 接口）：`rag = rag if rag is not None else config.rag`；现有调用点**一个都不用改**。
- `put_rag_config` 在 `atomic_write_rag_config` **之前**校验：

```python
merged = merge_rag_config(config.rag.model_dump(exclude_none=True), RagConfigFile.model_validate(_prune_empty(submitted)))
try:
    build_embedder(config, rag=RagConfig.model_validate(merged))
except RagConfigurationError as exc:
    raise HTTPException(400, detail=f"提交后的配置仍不可用：{exc}") from exc
```

- 校验的是**将要写入的**合并结果，不是当前 `config.rag`。
- 写入必须排在校验之后——失败路径上一次 `atomic_write` 都不能发生。
- `detail` 带前缀：错误可能指向用户本次没动过的字段（spec §3 D3 已知副作用），前缀负责把这件事说清。
- **成功路径必须仍过 Task 1 的形状守卫**：这次改动重排了 PUT 内部的顺序（先校验后写），所以那条断言要在本任务里再跑一次——它保证"只加了一条失败分支，成功路径一字未变"。

**门禁**：同上；并确认既有 PUT 用例（哨兵保留密钥、清空即回落环境变量）仍全绿。

---

## Task 3 — 后端：配置类拒绝有可读出口（D4）

**RED**

- `RagConfigurationError` 存在且 `isinstance(exc, ValueError)`；
- `build_embedder` 在四种配置错误下都抛它（稀疏不匹配、缺 base_url、维度不是 1024、声明与集合不符）；
- 网关处理器把该类型映射成 400 + `detail=str(exc)`（用 `TestClient` 直接打一个会触发的端点）；
- 反例：只开了这一个口子——断言 `app.exception_handlers` 里**只有** `RagConfigurationError` 一个键、**没有** `ValueError`（比造一个故意抛 ValueError 的端点稳，也不依赖某个端点的内部实现）。

**GREEN**

- `knowledge/embedder_factory.py`（或 `providers` 旁）新增 `RagConfigurationError(ValueError)`，把该模块现有 `ValueError` 换成它；
- `app/gateway/app.py` 注册 `app.add_exception_handler(RagConfigurationError, handler)`，返回 `JSONResponse(400, {"detail": str(exc)})`；
- 确认 harness → app 方向依赖不变（`test_harness_boundary.py` 必须全绿）。

**门禁**：`make test` 全量（这步动了共享层，必须全量）。

---

## Task 4 — 前端：编辑期拦下并禁用保存（D2）

**RED**

- `frontend/tests/unit/settings/functional-models.dom.test.tsx`（及其 isolated 版）加：
  1. `emits_sparse=false` + `source=provider` → `role="alert"` 告警出现，Save `disabled`，**且 Save 旁出现同一句原因**；
  2. 来源改 `bm25` → 告警消失、Save 回落到既有「有改动才可点」规则；
  3. **旧响应兼容**：响应里没有 `embedding_providers` 时不告警、不崩（「拿不到能力就不提示」的降级语义）；
  4. **判定取表单当前值**：只改 `embedding_provider`（不改来源、不保存）就立刻出现告警——证明它读的是表单值而不是已保存值。

**GREEN**

- `core/rag/types.ts`：`RagConfigView.embedding_providers?: { provider_id: string; emits_sparse: boolean }[]`；
- `components/workspace/settings/functional-models-view.tsx`：由 `values.embedding_provider` 与 `view.embedding_providers` 派生 `sparseUnusable`，渲染告警（与 `embeddingChangeWarning` 同处、同 `role="alert"` 形态），并入 Save 的 `disabled` 条件，并在 Save 左侧（复用既有 `noChanges` 的位置）显示同一句原因；
- i18n 三处（`zh-CN.ts` / `en-US.ts` / `types.ts`）键名固定为 **`sparseProviderUnsupported`**，中英各一句，与后端 `embedder_factory.py:87` 同一事实（spec §3 D2 已给出两个可落地的句子）。

**门禁**：`pnpm check` + 全量 `pnpm test`（改了共享设置视图，必须全量）。

---

## Task 5 — 文档同步与真栈验收

- `frontend/AGENTS.md` 功能模型一节：补能力随配置下发 + 编辑期拦截 + Save 禁用并给出原因；
- `backend/AGENTS.md` RAG 配置一节：补 `embedding_providers` 字段、PUT 的 400 语义（含 `提交后的配置仍不可用：` 前缀）、以及 `build_embedder` 新增的 `rag=` 覆盖参数；
- 真栈（spec §6）：
  1. 界面上切到 `openai-compatible` 保持「跟随向量模型」→ 告警出现、Save 灰并给出原因；改回 `dashscope` 恢复；再用 `?settings=models` 复核深链仍可用。
  2. **D4 的出口**：手工把 `rag_config.json` 写成坏组合，curl 一个用到嵌入的接口（或 PUT）→ 400 + 可读 detail，不是裸 500。这一步不经前端。

---

## 提交切分

| 提交 | 内容                                                 |
| ---- | ---------------------------------------------------- |
| 1    | Task 1（能力块）+ 用例                               |
| 2    | Task 2 + Task 3（PUT 拦截 + 异常类型与处理器）+ 用例 |
| 3    | Task 4（前端拦截）+ 用例                             |
| 4    | Task 5（文档 + 真栈结论）                            |

不改表、不改 `rag_config.json` schema，无迁移。
