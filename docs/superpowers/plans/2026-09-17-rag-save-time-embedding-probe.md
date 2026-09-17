# 保存期嵌入探测（G1 + G2 合并） —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-17-rag-save-time-embedding-probe-design.md](../specs/2026-09-17-rag-save-time-embedding-probe-design.md)
**Status:** 未开工（2026-09-17 起草）
**Parent:** [2026-09-17-rag-ark-embedding-provider.md](2026-09-17-rag-ark-embedding-provider.md)（那份 plan 的 spec §6 把 G1/G2 判为「同因、合并成独立一条」）

**Architecture:** 把 PUT 从「只做静态判定」变成「**静态判定 → 真打一次 → 才写盘**」，但那一次调用**只在相关字段真的变了时才发**（改 rerank/parse 等一律零延迟）。一次调用同时答两问（宽度 / 稀疏在不在），因为运行期本来就是同一段代码同时判这两件事。平台不可达**不拦**——改配置的动机常常正是"当前这份不能用"，拦住等于堵死出口——而是 200 加一句 `warning`（**始终存在、无话时为 `null`**；刻意**不用** `models/config/validate` 那个 `exclude_none` 的写法——它是递归的，会把嵌套 `config` 里的 null 一并剔掉，理由见 spec D3）。

**依赖顺序**：Task 1（后端）→ Task 2（前端）→ Task 3（文档 + 真栈）。

---

## Task 0 — 开工前的五项核实（只读，不改代码）

**起草终审时已按代码核实、不必再核的**（列出来免得重复劳动）：PUT 的顺序是 `_prune_empty` → `_reject_unusable_after_save` → `atomic_write`；**哨兵解析排在静态校验之前**（`submitted[name] = keep`），所以值比较落在 `payload` 上就够；`_PROBE_TIMEOUT_SECONDS = 10.0` 与 `_PROBE_TEXT = "probe"` 就在同一模块；`TEISparseEncoder` 连不上抛的是 `EmbedderError`（401 才是 `EmbedderAuthError`）；**`response_model_exclude_none` 是递归的**（实测会把 `config` 里所有 null 一并剔掉）。

- [ ] 1. `probe-embedding` 读稀疏/宽度的那段**断言代码**在哪、能不能抽成共享的一段（D4 要求"走同一套类型与常量"——不共享代码也行，但要确认**没有另写一套判定**）。
- [ ] 2. `_PROBED_DIMENSIONS` 的键与语义再确认一次（D6 已限定成"只有被 `_guard` 包装的 provider 才写"）。
- [ ] 3. **golden 那份 PUT payload 里嵌入字段的确切变化**（决定那条形状守卫的放宽幅度）。
- [ ] 4. 前端**保存成功那条路径**在哪里（`useSaveRagConfig` 的 `onSuccess`）+ `models-add-dialog` 渲染 `warning` 的写法 ⇒ `warning` 显示在哪、用什么形态（**别新造控件**）。
- [ ] 5. 兄弟用例**桩网络的确切写法**（`monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=MockTransport(handler)))`）与 handler 计数怎么读 ⇒ Task 1 照抄这一招。

**门禁**：无（只读）。

---

## Task 1 — 后端：相关字段变了才探（D1–D5）

- [ ] **RED**：新建 `backend/tests/test_rag_config_save_probe.py`（与既有 `test_rag_config_sparse_probe.py` 同构）。**桩的做法照抄兄弟文件**——`monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler)))`（那边的原话是 *Nothing here touches the network*），handler 里**记计数**。用例：
  1. **宽度不对**（桩返回 2560 维）⇒ **400**，`detail` 以 `提交后的配置仍不可用：` 开头、含**重建索引**指引，且正文与 `_DimensionCheckedEmbedder` 那句**逐字一致**；
  2. **稀疏为空** + `sparse_source=provider` ⇒ **400**，`detail` 含「独立稀疏服务」与「本地 BM25」（即 `SparseHalfMissingError` 那句）；
  3. **反例**：同一个空稀疏端点但 `sparse_source=bm25` ⇒ **200**；
  4. **`external` + 死的稀疏服务** ⇒ **200 + `warning`**（**不是 400**）——D3 那张映射表唯一的入口，今天没有用例覆盖；
  5. **不可达**（死端口）⇒ **200 + `warning`**，且**配置确实写进去了**（读回有效值）；
  6. **凭据被拒**（桩返回 401）⇒ **200 + `warning`**，且措辞说的是"凭据被拒"**不是**"连不上"；
  7. **只改无关字段**（`rerank_model`）⇒ **handler 计数为 0**、PUT 200；
  8. **值没变则不探**：payload 带着嵌入字段但值与当前相同（含**掩码哨兵**那一情形）⇒ **计数为 0**；
  9. **失败不半写**：被拒的写 ⇒ 落盘为零（读回与写前逐字节相同）；
  10. **`warning` 始终在**、无话时值为 `null`；**且 `config` 里原本是 `null` 的字段仍在**（断言 `config.judge_model` 是 `null` 而不是缺键——这条守的是"不许用 `exclude_none`"）。
- [ ] **GREEN**：
  - `app/gateway/routers/rag_config.py`：新增触发判据（六个字段的值比较，落在 `payload` 上）与探测（`build_embedder(config, rag=pending)` + `asyncio.wait_for(embedder.embed([_PROBE_TEXT]), _PROBE_TIMEOUT_SECONDS)`）；**异常按 D3 那张表分派**（`RagConfigurationError` ⇒ 400；`EmbedderError`/`EmbedderAuthError`/超时 ⇒ 200 + `warning`，措辞按原因分）；两条 400 与探测一起插在静态校验之后、`atomic_write` 之前；探测失败/不可达各记一条 warning 日志。
  - `RagConfigResponse` 加 `warning: str | None = None`（**不加 `exclude_none`**，理由见 spec D3）+ `_build_response` 收一个可选的 warning 参数。
  - 400 的正文**复用既有两个异常的文案**（D5），断言逻辑复用 `COLLECTION_DIMENSION`，不另写一套。
- [ ] **neuter 三条（都必须有牙）**：① 去掉触发器（无条件探）⇒ 用例 7/8 红；② 探测改成不真打（只 build）⇒ 用例 1/2 红；③ 把"不可达放行"改成拒绝 ⇒ 用例 4/5/6 红（三条一起红是**对的**：它们属同一类结局）。
- [ ] **门禁**：`ruff check` + `ruff format --check` 干净；窄面（`tests/test_rag_config_api.py` + 新文件 + `tests/knowledge/`）绿；**全量后端后台跑**，跑完**抽全部 FAILED 的 node id 去 HEAD 跑同一批、双向 diff**（`xargs -d '\n'`，别用 unquoted `$(cat ids)`——有一条 id 的参数本身就是 `; rm -rf /`）。

## Task 2 — 前端：把 `warning` 显示出来（D3 的另一半）

- [ ] **RED**：`frontend/tests/unit/settings/functional-models.dom.test.tsx` 加用例：保存成功但响应带 `warning` ⇒ 页面出现那句话（断言文本）；**没有 `warning` ⇒ 什么都不出现**（不是为了显示而显示）。
- [ ] **GREEN**：`core/rag/types.ts`（PUT 响应类型加 `warning: string | null`——**非可选**，它始终在）、`hooks.ts`/`api.ts` 把它带回来、`functional-models-view.tsx` 用**既有**的提示形态渲染（Task 0 第 4 项定的落点，别新造控件）；i18n 三处按需加键。
- [ ] **neuter 一条**：去掉渲染 ⇒ 用例红。
- [ ] **门禁**：`pnpm check`（eslint + tsc；**tsc 的允许集只有宠物线那一条** `pet-sprite.dom.test.tsx` 的 `"greet"`——若它已修，则应为零诊断）；prettier **逐文件与 HEAD 比数字**；**全量前端**。

## Task 3 — 文档同步与真栈验收

- [ ] `backend/AGENTS.md`（RAG 配置一节）：补 PUT 的**三条结局**、**异常 → 结局的映射**（哪一类是"确定的错"、哪一类只是"没问到答案"）、**"只在相关字段变了才探"**及那六个字段、**PUT 从此可能出网 ⇒ 最坏多等 `_PROBE_TIMEOUT_SECONDS`（10s）**、以及 **`warning` 始终存在（无话为 `null`）——并写明为什么刻意不用 `exclude_none`**（它是递归的，会剔掉 `config` 里所有 null）。
- [ ] `frontend/AGENTS.md`（功能模型一节）：补保存成功但带警告时的呈现（`warning` 是 **`null` 而不是缺席**；为 `null` 时什么都不显示）。
- [ ] **真栈腿①（宽度）**：配一个宽度不对但**能连上**的模型 ⇒ 保存当场被拒、提示含重建索引。
- [ ] **真栈腿②（不可达）**：地址指向死端口 ⇒ 保存**成功** + 页面给出"未能验证"的提示。
- [ ] **真栈腿③（零负担，用计数桩真观测）**：本机起一个**计数桩**当嵌入端点（一次性脚本，跑完即删）⇒ 改一个嵌入字段保存：计数 **+1**；接着**只改 rerank** 保存：计数**保持不变**。⇒「不每次出网」是**观测到的**，不是嘴上说的。
- [ ] **收尾**：配置**逐字节还原**（md5 与动手前相同）、密钥不落盘、不新建文件（计数桩脚本已删）、浏览器里被改过的表单重载丢弃。
- [ ] **门禁**：两份 `.md` 的 prettier 与 HEAD 同数；`rag_config.json` md5 未变。

---

## 提交切分

| 提交 | 内容                                              |
| ---- | ------------------------------------------------- |
| 0    | **本计划 + 它的 spec 成对**                        |
| 1    | Task 1（后端：触发判据 + 探测 + `warning` + 用例） |
| 2    | Task 2（前端：显示 `warning` + 用例）              |
| 3    | Task 3（文档 + 真栈结论）                          |

不改表、不改 `rag_config.json` schema、**不动任何默认值**。
