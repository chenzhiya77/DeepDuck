# 嵌入探测与维度可配 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-26-rag-embedding-probe-design.md](../specs/2026-09-26-rag-embedding-probe-design.md)
**证据物:** [pr-build/rag-embedding-probe-2026-09-27/](../../../pr-build/rag-embedding-probe-2026-09-27/notes.md)——真接口实测（脚本 + 原始输出），spec §3.1 引用它
**Status:** 🟡 **进行中（2026-09-26 立；同日按 spec 定稿镜像重写 + 依「按现有项目情况审查」的 1–8 条修订；**2026-09-27 续**：§3.1 证据物入仓、四轮自审（1–9 / 1–11 / 1–5）已并入。**进度：Task 0–3 已提交（`63f3c448` 文档+证据 · `f9ac82dc` Task 1 · `4f1456c4` Task 2 · `2badc356` Task 3）；Task 4 已按 Task 0 的结论拆成 4a/4b —— 4a（生效宽度/命名/守门/尺寸检测）已提交 `9aec8521`；**4b（迁移编排）已实现、未提交**；余 Task 5（文档 + 真栈 + 门禁）**）** —— **四点全裁**（D1 乙 / D2 甲a / D3 甲′ / D4 甲）+ **D5 五条细节**（作用域部署级 / 先建后切 / 默认 1024 / 界面位置=高级设置第一行 / 连通点=两标题变按钮+四态）。落法 = 后端为主 + 设置页「维度」控件（**自动探、无按钮**）+ 两个角色标题的连通点。

**硬约束**：**通用嵌入腿**（`openai-compatible`）的请求构造 + 集合命名与生命周期 + 保存期探针 + 设置页嵌入行；**厂商腿（dashscope / ark）的入库请求零触碰**（新增的只是探测路径——按各家请求形状真发请求，但那是探针自己的请求）；rerank / parse / 稀疏腿的既有行为、检索三路逻辑零触碰（**新增**：重排腿一发连通测试 · 探测纳三腿）；**默认 1024 ⇒ 不迁移时请求与结果逐字节不变**；探针族规范（真实调用 / 只读不落盘 / 有界超时 / 三态 / 只报不拦）。

**Global Constraints:** 分支 `feat/rag-knowledge-base`；每 Task RED→GREEN→neuter（带 revert proof）→门禁（**提交时机听他发话**）；后端 `cd backend && make test`（相关面）+ `make lint`；前端 `cd frontend && PYTHONIOENCODING=utf-8 python ../scripts/pnpm.py check` + 相关 dom 用例；pytest 的 `--basetemp` 只用既有 `.pytest-tmp`（跑完即删）；真栈桩零出网。

**依赖顺序**：Task 0（只读核实）→ Task 1（探测纯函数，三腿分派）→ Task 2（两个端点 + 维度行 + 两标题连通点）→ Task 3（发参 + 批量阶梯）→ Task 4a（生效宽度 + 集合命名 + 守门 + 尺寸检测）→ Task 4b（迁移编排，**最重的一段**）→ Task 5（文档 + 真栈 + 门禁）。

---

## Task 0 — 开工前核实（只读）

- [x] 1. **集合命名的影响面**：`KnowledgeVectorStore` 四个集合名（`:132-150`）的全部消费点（worker / retrieval / eval / vector-projection / reindex / 测试夹具）⇒ 换名（带宽度后缀）要动哪些调用方、有没有外部约定（Qdrant 运维、文档）。
- [x] 2. **尺寸可读性**：`AsyncQdrantClient.get_collection()` 读回 `config.params.vectors` 的形状（本机 Qdrant 实跑一发只读调用）⇒ 确认"检测现有集合尺寸"可实现。
- [x] 3. **构造点唯一性**：`KnowledgeVectorStore(` 的生产构造点只有 `get_vector_store()`（`:501-505`）⇒ 生效宽度接进去不波及其它。
- [x] 4. **会红断言扫描**：`test_rag_config_api.py` / `test_embedder_providers.py` / `test_rag_provider_config.py` 里与「宽度=1024 拒绝」「请求体（无 `dimensions`）」「批量=10」相关的既有断言清单 ⇒ 逐条判"该红 / 该保持"。
- [x] 5. **探针先例可复用面**：`RagSparseProbeRequest`（`rag_config.py:430` 一带）/ `_probe_api_key`（`:463`）/ `require_admin_user` / `_probe_detail`（`:480`）能不能直接拼新端点。
- [x] 6. **声明字段的现有语义**：`embedding_dimension`（`app_config.py:210` / `rag_config_file.py:115`）的读写路径与 `ge=1` 约束；`_WATCHED_EMBEDDING_FIELDS`（`rag_config.py:319-326`）已含它。
- [x] 7. **迁移挂点**：`POST /{kb_id}/reindex`（reindex 路由）与 `reindex_kb` 的现状（进程内计数 / 状态 / 任务调度）⇒「先建新集合」能否作为它的前置复用；`worker.py::init_collections`（`:226`）在迁移期间的行为。
- [x] 8. **前端骑乘位**：嵌入行的结构（`functional-models-view.tsx:640-770` 一带）+ 探针 hook 先例（`hooks.ts:69-103`）+ 自动探的防抖写法（`:442-464`）⇒ 新控件与状态照抄哪一段。
- [x] 9. **标题按钮面（D5-5）**：两个角色标题（`:646-647`）的现有结构（gutter 里的 `RoleHeading`、窄屏 `max-md` 布局）⇒ 变按钮 + 状态点的落点与几何影响；`ADVANCED_SETTING_COUNT`（`:77`）与其用例镜像（`advancedLabel(count)`）现为 5。
- [x] 10. **重排腿的一发测试面（D5-5）**：`reranker_generic` / dashscope 重排的构造点与最小调用形状（query + 一条 doc）⇒ 连通探针在 rerank 分支要复用哪个客户端、不许改动它的既有请求构造。
- [x] 11. **三腿探针请求构造的复用面**：`DashScopeEmbedder`（`parameters.dimension` + `output_type`）与 `ArkEmbedder`（一次一条 content + 自己的 `dimensions`）的请求体构造能不能被探针复用/共用，还是要各写一个薄封装。

**实测（2026-09-27，十一项逐条 · 只读）**：

- ① **集合命名影响面**：消费点只有两处 —— `vector_store.py` 自身的属性/方法（四个 property + `scroll_collection`/upsert/delete 全走 `self.<prop>`）与 `projection/fetcher.py:30-33` 的四行映射（值是**属性名**不是字面集合名）；`packages`/`app` 里**没有任何地方硬编码 `kb_chunks` 这类物理名**（字面出现全是 docstring/注释：`app_config.py:186`、`graph/*.py`、`models.py:144`、`reindex.py:188`）。⇒ **换名只需改 `vector_store.py` 一处**；测试各自用随机前缀夹具（本机 Qdrant 里已积了一批 `test*`/`testt*`）⇒ 隔离不受影响。
- ② **尺寸可读性（本机实跑，只读）**：`localhost:6333` 在线，四个 `kb_*` 集合都在；`get_collection(name).config.params.vectors` 返回 **dict** —— `{'dense': VectorParams(size=1024, distance=COSINE, …)}` ⇒ `vectors["dense"].size` 可读，**尺寸检测可实现** ✓。
- ③ **构造点唯一性** ✓：生产构造点只有 `vector_store.py:505`（`get_vector_store()`），其余全是测试夹具。
- ④ **会红断言扫描（逐条判）**：
  - **该红/该改**（Task 3：初值 20 + 阶梯）——`test_embedder_providers.py:167`（`assert embedder.batch_size == 10`，通用腿）与 `:171`（`rows_per_request == [10, 10, 5]`，25 行拆批）。
  - **该红/该改**（Task 4：守门跟生效宽度）——`:260 test_declared_dimension_other_than_1024_is_refused`、`:284 test_probe_reads_the_real_length_and_refuses_non_1024`（`:291 match="1024"`）、`:308 _PROBED_DIMENSIONS == {…: 1024}`。
  - **该保持**——`:401` + `:405`（dashscope 原生腿的同名断言，本对不碰）；`test_rag_config_api.py:145-154`（1024 宽假响应夹具）；`test_rag_provider_config.py:142/154`（`embedding_dimension == 1024` 往返）。
  - **「不发 `dimensions`」类断言：零**（两文件里 `dimensions` 的命中只有 `embedding_dimension`）⇒ Task 3 的带参/不带参钉子是**新增**，不撞既有断言 ✓。
- ⑤ **探针先例可复用** ✓：`RagSparseProbeRequest` 在 `:434`（"430 一带"成立）、`_probe_api_key` `:463`、`_probe_detail` `:480`；四条路由同用 `require_admin_user`（`:281/411/560/634`）。
- ⑥ **声明字段语义** ✓：`app_config.py:210`（`ge=1`）/ `rag_config_file.py:115`；`_WATCHED_EMBEDDING_FIELDS`（`rag_config.py:319-326`）已含 `embedding_dimension`；读写与"省略=删除"语义见 spec §3 往返行。
- ⑦ **迁移挂点**：路由 `knowledge_bases.py:482`（`POST /{kb_id}/reindex`，202）+ `:497` 状态；服务 `knowledge_service.py:1703 trigger_reindex(kb_id)`（`:1711` `reindex_in_progress` 守卫）→ `:1730 reindex_kb(self.store, self.vector_store, build_embedder(), kb_id=…, graph_store=…, wiki_store=…)`；`reindex.py:74/78` 是 per-KB 进程内登记。⚠️ **行号更正**：`worker.py` 的 `init_collections` 现在在 **`:226`**（plan 原写 `:215`）；`build_embedder()` 在 `:331` / `:814`。
- ⑧ **前端骑乘位**：⚠️ **行号已漂**（前端被别线改过）——两个角色标题现在 **`:646-647`**（原写 `:620-621`）；嵌入行约 `:640-770`（`embeddingBaseUrl` 的 aria-label 在 `:760`）；稀疏来源 `:793-796`；「高级设置」触发器 `:785`；探针 hook 先例 `hooks.ts:69-103` ✓、防抖常量 **`PROBE_DEBOUNCE_MS = 400`（`:86`）** ✓。
- ⑨ **标题按钮面**：`ADVANCED_SETTING_COUNT = 5`（`:77`）✓；用例镜像 `advancedLabel(count)`（`functional-models-view.dom.test.tsx:135`）✓。
- ⑩ **重排腿一发测试**：三家构造点 `DashScopeReranker`（`reranker.py:47`）/ `GenericReranker`（`reranker_generic.py:48`）/ `TEIReranker`（`reranker_tei.py:50`），统一签名 `async rerank(query, documents, *, top_n=5)`；**`documents` 为空直接返回 `[]`** ⇒ 连通那发必须给 ≥1 条 doc（`_PROBE_TEXT` 作 query 与唯一 doc ✓）；构造走 `build_reranker(config=None, *, rag=…)`（`reranker_factory.py:16`）✓。
- ⑪ **三腿请求构造复用面**：三家 payload 都是**方法内联构造**（不是可注入 builder）——DashScope 原生 `{"model","input":{"texts"},"parameters":{"dimension","output_type":"dense&sparse","text_type"}}`（`embedder.py:200`）；Ark `{"model","input":[{"type":"text","text"}],"dimensions","sparse_embedding":{"type":"enabled"}}`（`embedder_ark.py:92-97`，**一次一条 content**）；通用腿 `{"model","input"}`（+新 `dimensions`）（`embedder_openai.py:95`）。⇒ 探针**各写一个薄封装**（复用形状，不改三家客户端）。

**两项文档级更正（随本轮回填并改）**：① `worker.py::init_collections` `:215 → :226`；② 前端两处行号 `:612-740 / :620-621 → :640-770 / :646-647`。

---

## Task 1 — 探测纯函数（怪值探 + 按型 + **三腿分派**） + 用例

> 动到的文件：**新增** `backend/packages/harness/deerflow/knowledge/dimension_probe.py`、**新增** `backend/tests/knowledge/test_dimension_probe.py`。**验收对应**：spec §4 的 1 / 13 / 14 / 15。

- [x] **RED**：先写断言（函数尚不存在 ⇒ 收集失败即红）。`httpx.MockTransport` 桩**按三型 × 请求形状**：
  - 桩 A（**范围型**）：收怪值 `333` 回 200、宽度=333 ⇒ 期望 `type="range"`、`native=` **补发那一发（不带参数）**的宽度（**有且仅有这一发额外调用**——定性那发返回的是 333、不是原生）。
  - 桩 B（**档位型**）：`333` 回 400、`1024/1536` 回 200 ⇒ 期望 `type="tiered"`、`values` 只含通过档（逐档探按候选表 `256/512/768/1024/1536/2048/2560/3072/4096`）。
  - 桩 C（**固定型**）：任何参数都被忽略、恒回 200+宽度 768 ⇒ 期望 `type="fixed"`、`native=768`、`values=[768]`（**断言没有额外的量宽调用**——参数被忽略，定性那发返回的就是原生）。
  - **三腿各一遍**（同一套三型断言换请求形状）：通用腿 body `dimensions` / dashscope 原生 `parameters.dimension`（+ `output_type: dense&sparse`）/ ark 一次一条 content + 自己的 `dimensions`——**桩按各自形状校验请求体**（断言"发出去的参数名/形状对"）。
- [x] **RED（量宽那一发，①② 都要）**：**① 与 ② 型桩都必有一发"不带参数"的量宽调用**（① 的定性那发是 400、没有向量；**② 的定性那发收 333 ⇒ 返回的是 333 宽、不是原生**）；**③ 型没有这一发**（参数被忽略、定性那发返回的就是原生）。
- [x] **GREEN**：`probe_dimensions(...)` = 怪值探定性（**怪值 `333` 提成命名常量**并注释"为什么是它"）→ **量原生宽度**（**① 与 ② 都额外发一发不带参数的**；③ 复用定性那发）→ 按型探（逐档**并发** / 只验输入值 / 读默认）；**候选表只为 ① 跑**（②/③ 不跑）；候选表常量（可改）；每发单条文本、有界超时；返回 `DimensionProbeResult(type, native, values, detail)`——**`native` 恒填**（0 档回退要用它）；**请求构造按 provider 分派**（定性/候选表/并发/三态是共用的那一层）；**候选表三腿共用同一张常量**。
- [x] **RED（0 档回退的返回形态）**：桩"任何参数都 400"（严格端点）⇒ 期望 `type="tiered"`、`values=[]`、**`native` 仍是实测默认宽度**（上层据此渲染回退，而不是空列表）。
- [x] **RED（原生宽度补验，verify-then-list）**：桩 A'——原生 640（**不在候选表**）、且 `dimensions: 640` 也 200 ⇒ 补验那一发**能观察到**、`values` 含 640；桩 A''——原生 3072、`dimensions: 3072` 回 400 ⇒ **不并入** `values`；桩 A'''——原生 1024（**在表内**）⇒ **不补验**（断言请求次数：**定性 + 量宽 + 逐档**——量宽恒有，补验因原生在表内而不发）。
- [x] **RED（钳位桩，判"通过"= 200 且宽度相等）**：桩对 1536 回 **200 但宽度 1024**（复刻 `flash` 实测行为）⇒ 1536 **不出现在 `values`**；同时验证 ① 逐档、① 原生补验、② 上界三处都按"宽度相等"判（只看状态码的实现会被本条打红）。
- [x] **RED（② 的上界验证与判歪降级）**：桩 B'（真 ②）⇒ **恒观察到一发 `dimensions: <原生>`** 且 200（上界可用）；桩 B''（"假 ②"= 真 ① 但收 333）⇒ 那一发 **400** ⇒ 探针**降级跑候选表**、`values` = 该模型真档位；桩 C（③）⇒ **没有**任何 `dimensions` 请求（只有定性那发）。
- [x] **GREEN（常量沿用）**：探测文本与超时用**探针族既有常量**（`_PROBE_TEXT` / `_PROBE_TIMEOUT_SECONDS`），不新起第二份；重排连通那发以同一文本作 query 与唯一 doc。
- [x] **neuter**：① 删怪值探 ⇒ 三桩全红（无法定型）；② 删档位型逐档 ⇒ 只有桩 B 的 `values` 红。**受害者不相交**，如实记。
- [x] **还原证明** + `make lint` 净（ruff）。

**实测（待回填）**：

---

**实测（2026-09-27，Task 1 完成 · 新增 `dimension_probe.py` + `test_dimension_probe.py`（12 例））**：

- **RED**：实现文件未建 ⇒ 收集失败（`ModuleNotFoundError: deerflow.knowledge.dimension_probe`）**1 文件红 / 0 例** ✓。
- **GREEN**：12/12 绿（11.4s）。覆盖：三型定性、**①② 各补一发"不带参数"量宽**（③ 复用定性那发、断言只 1 发）、三腿请求形状（generic `dimensions` / dashscope `parameters.dimension`+`output_type` / ark 一条 content）、0 档回退（`values=[]` 且 `native` 仍填）、verify-then-list 三分支（并入 / 钳位不并入 / 原生在表内不补发）、**钳位桩**（200 但宽度 ≠ 所求不列）、② 上界两分支（可设 ⇒ 不降级 / 不可设 ⇒ 当场降级跑候选表）、401 ⇒ `DimensionProbeError`。
- **neuter ①（删怪值探：`classify()` 不走 333 那发）**：**7 红 / 5 绿** —— {range、tiered_lists、fixed、three_legs×3、fake_range_settable} → "三桩全红"成立 ✓。
- **neuter ②（删档位型逐档：候选结果全判不通过）**：**4 红 / 8 绿** —— {tiered_lists、offtable（in-table 子案例）、clamped_200、fake_range_unsettable}。
- ⚠️ **与计划预测的偏差（如实记）**：计划写"受害者**不相交**"——实际**相交于 `test_tiered_lists…` 一条**（① 让它缺了定性那发、② 让它的 `values` 变空）。其余互相独立。
- **还原证明**：备份还原后复跑 **12/12 绿**；`ruff check` + `ruff format --check` 两文件**全净** ✓。
- **一处设计落法（与 spec 措辞的差别，先记）**：`text` / `timeout` 做**必填参数**（不给默认值）——`_PROBE_TEXT` / `_PROBE_TIMEOUT_SECONDS` 住 `app/gateway/routers/rag_config.py`，而 harness **不许 import app**（`test_harness_boundary`）⇒ "不新起第二份"靠**调用方传进来**实现；Task 2 的端点把这两个常量传下即可。
- 首跑还发现**测试自身**一处 `None` 排序问题（`sorted([333, None, …])`）⇒ 改带 key 的 `sorted`，非实现缺陷。

---

## Task 2 — 两个探针端点 + 前端「维度」行（自动探） + 两标题连通点

> 动到的文件：`backend/app/gateway/routers/rag_config.py`（两个新端点）+ 前端 `core/rag/{types,api,hooks}.ts` 与 `functional-models-view.tsx` + 两侧用例。**验收对应**：spec §4 的 1 / 2 / 10 / 12 / 14 / 15。

- [x] **RED（后端 A · 档位）**：`POST /api/rag/config/probe-dimensions` 用例（admin / `extra="forbid"` / 未知 provider 422 / 桩返回三型 / 探不出 ⇒ `detail` 带原因且**不 500**）；此刻路由不存在 ⇒ 404 红。
- [x] **GREEN（后端 A）**：请求模型仿 `RagSparseProbeRequest`（provider / model / base_url? / api_key?，sentinel 语义照旧）；`_probe_api_key` 复用；**端点 A 自构请求**（它要**逐候选变 `dimensions`**，而工厂产物是按构造固定宽度的——**走工厂的是端点 B 的两腿**）；出参带 **`candidates`**（后端那张表，供前端 ② 静态提示与 ①"部分未探到"判定——**前端不另抄**；**`values` 语义写死**：① = 探到的有效档、② = `[native]`（上界验证通过）/ `[]`、③ = `[native]`）；**超时用 `_PROBE_TIMEOUT_SECONDS`**（不新起第二份 10s）；只读不落盘。
- [x] **RED（后端 B · 连通，D5-5）**：`POST /api/rag/config/probe-connectivity` 用例——入参 `{leg, provider, model?, base_url?, api_key?, embedding_dimension?}`（`api_key` 接受哨兵）；**走工厂**（embedding ⇒ `build_embedder(rag=候选)`；rerank ⇒ `build_reranker(rag=候选)`）；embedding 腿**带所选维度**（桩"只收 1024" ⇒ 选 1536 返回 **`dimension_unavailable`** 而非"连不上"；带参被 400 ⇒ 同一态）；rerank 腿发一发最小调用、**无该态**；不可达 / 凭据被拒 ⇒ `unreachable` / `refused`、**不 500**。
- [x] **GREEN（后端 B）**：一发真调用（embedding ⇒ `embed()` 一次并顺带报实测宽度；rerank ⇒ 最小 query+doc 一发、**query 与唯一 doc 都用 `_PROBE_TEXT`**）；**未选维度 ⇒ 按生效宽度（默认 1024）发**；只读不落盘、**超时用 `_PROBE_TIMEOUT_SECONDS`**。⚠️ **时序**：**通用腿的"带维度"要到 Task 3 才真发**（那之前通用腿还不发 `dimensions`）⇒ 本 Task 阶段，B 的用例先钉 **dashscope / ark 两腿** + **通用腿的"未带参"形态**。
- [x] **RED（前端 · 维度行）**：dom 用例（结构、不钉几何）——**第一行自由填入 + 档位快捷项**（① 的档位=探到的列表、**点一下填进第一行、不可取消**；② 静态提示（**不跑候选表**）、来源取探针响应的 `candidates` **且只列 ≤ 原生**（超原生不列/置灰）；③ 第一行只读、无档位区）；**档位为空不渲染空列表**（显示"未探到共识档，请手填"）；**0 档回退**（严格端点桩 ⇒ 显示默认宽度 + 可手填 + 说明句）；**填与当前相同的值 ⇒ 不出现"改维度＝全库重建"确认**（触发判据=值变了，与输入来源无关）；**无「探测」按钮**；**自动探**（改 provider/Model/地址触发、400ms 防抖、同 key 不重探）；状态骑在行内；行在**「高级设置」第一行、稀疏来源上面**（D5-4）；`ADVANCED_SETTING_COUNT` 5 ⇒ 6；**控件形态三腿相同**（地址行的锁/放照旧由 `has_fixed_endpoint` 决定，本对不改）。
- [x] **RED（前端 · 两个标题点，D5-5）**：两个角色标题变按钮 + 状态点，**四态**（灰未测 / 转圈 / 绿通 / **橙**不通）——橙**分两种原因**（连不上 / 连得上但所选维度要不到）；点绑 `provider|model|地址|有无钥匙`，改值退回灰；缺必填 ⇒ 灰且禁用；hover 分态文案；**任何态不拦保存**；点=手动（保存期探针结果不喂给它）。
- [x] **RED（前端 · 数字字段往返，必改）**：往返用例——设维度 ⇒ 保存 ⇒ GET 仍是它；随后一次**无关编辑**保存后它**仍在**。今天必红：`RagConfigFormValues` 无此键、`buildRagConfigInput`（`config-form.ts:92-124` 三张清单）与 `hasFormChanges`（`:516-518`）都不带它，而 PUT 是整对象替换（省略=删除）。
- [x] **GREEN（前端 · 数字字段往返）**：新增**"数字字段"这一类**（表单值 / 种子 / 变更检测 / payload 携带四件齐），并把维度控件接上它。
- [x] **GREEN（前端）**：其余三文件 + 视图接线（探针 hook 复用 `hooks.ts` 的"verdict 带 key、不 invalidate、失败是状态不是 toast"契约）。
- [x] **neuter**：① 后端删 `type` 分支 ⇒ 只红对应型的前端 dom；② 把自动探改成手动 ⇒ 只红"自动探"那条；③ 把橙改成灰 ⇒ 只红连通点那条。**受害者不相交**。
- [x] **门禁**：后端窄面 + `pnpm check` + 前端相关 dom。

**实测（2026-09-27，Task 2 完成 · 后端两端点 + 前端维度行/两标题点）**：

- **后端**：新增 `tests/test_rag_config_dimension_probe.py` **13/13 绿**（RED 首跑 13 红 ⇒ 路由不存在）；两文件 `ruff check` + `format --check` 双净；`make lint` 全绿。落点：`POST /api/rag/config/probe-dimensions`（**出参加 `status: ok|unreachable`**——spec §3 端点 A 原本没有状态位，前端无从区分"未探明"与"答案"，按探针族先例补、已获他点头）与 `POST /api/rag/config/probe-connectivity`（四态；embedding 走 `build_embedder(rag=候选)` 带所选维度、rerank 走 `build_reranker(rag=候选)` 发 `_PROBE_TEXT` 一发）。
- **前端**：`pnpm check` 净；相关三套件 **3 files 全绿**（视图 dom ×2 + config-form node）。钉子：维度行在高级面板**首行**、可编辑、**无「探测」按钮**（行内唯一按钮是 ⓘ）、档位芯片渲染与回填、未探明**不渲染空列表**、两标题变按钮（`data-slot="leg-heading"`）+ 禁用/就位两态、**绿/橙两色**、**自动探一发**（无需点按钮）、位宽改动驱动既有警告且**同值不报警**；config-form 侧：数字字段往返（携带=数字 / 清空=null / 不冻结 operator 值 / 非数字不提交 / `hasFormChanges` 与 `isEmbeddingChange` 各复判）+ 两个 key 的绑定口径。
- **neuter 三刀各红 1 条、受害者不相交**：① tiered 芯片分支改空 ⇒ 只红芯片那条；② 自动探置 `return` ⇒ 只红"自动探"那条；③ 橙改灰 ⇒ 只红 amber 那条。
- **两处如实记（缺口/时序）**：① `embedding_dimension` 传非 1024（如 1536）在 **Task 4 之前**会被工厂守门挡下 ⇒ 那两条用例改成"问 1024、桩回 512"来验 `dimension_unavailable`；**"选 1536"的形态留给 Task 4 与真栈**。② spec 的"**带参被 400 拒 ⇒ 同一态**"这半**未实现**（400 与其它失败在 `EmbedderError` 上不可分，除非给错误加状态位）⇒ 现在只按"`200` 但宽度 ≠ 所求"判第四态。
- **随带**：`ADVANCED_SETTING_COUNT` 5⇒6（用例镜像改 `advancedLabel(6)`）；`RoleHeading` 由 `LegHeading` 取代（旧断言改按 `data-slot`/role 取）；两个视图测试文件的 hooks mock 各补两枚；`config-form` 的 `NUMERIC_FIELDS` 类落地（必改项）。
- ⚠️ **既有红（非本线，A/B 已证）**：`tests/test_rag_config_probe.py` **4 条在 HEAD 上就红**（根因 `RagConfigurationError: 嵌入 provider 'dashscope' 需要 rag.embedding_base_url`——09-25 端点解锁把地址改必填后该夹具没补地址）。



---

## Task 3 — 声明发参（D2=甲a） + 批量阶梯（D3=甲′）

> 动到的文件：`embedder_openai.py`、`embedder_factory.py`（注入声明值）+ 两腿用例。**验收对应**：spec §4 的 3 / 4 / 7。

- [x] **RED（发参）**：夹具声明 `embedding_dimension=1024` ⇒ 断言请求体**带** `"dimensions": 1024`；未声明 ⇒ 断言请求体**不含**该键（与今天逐字节相同）。此刻恒"不含" ⇒ 第一条红。
- [x] **RED（阶梯）**：桩端点上限 5 ⇒ **首批就是 20 行**（属性初值=阶梯顶端，桩按行数计数断言）撞 400 后沿 `20→10→5` 降档、**同一批**重试至通过；断言：(a) 该批切片**不落 failed**；(b) 之后同 embedder 实例的批直接按 5 发（请求体行数）。上限 20 的桩 ⇒ 首批即过、此后按 20 发。
- [x] **RED（判定次序）**：单行批 + 正带 `dimensions` 撞 400 ⇒ 去掉参数重试一次（而不是无限降档）；多行批 ⇒ 先降档。
- [x] **GREEN**：payload 加参（声明时）；阶梯常量 `[20, 10, 5, 2, 1]` + 进程内记档；400 判定次序如上；工厂把声明值传给通用腿（`pins_dimension` 分支照旧）。**通用腿的 `batch_size` 属性初值 = 20（阶梯顶端）**——`index_chunks` 按它先切片（`indexer.py:66-68`），初值还是 10 的话 20 那一档永远发不出去；**`DEFAULT_BATCH_LIMIT` 的值不动**（`sparse.py:104` 共用它，改了会连带稀疏腿）。
- [x] **neuter**：① 删"发参"⇒ 只有发参钉红；② 把阶梯起点改回 10 ⇒ 只有"上限 20 的桩"那条红。**受害者不相交**。
- [x] **回归（零影响证明）**：不声明维度的既有断言**零改动**全绿；厂商腿（dashscope / ark）用例零改动全绿。
- [x] **门禁**：`make test` 相关面 + `make lint`。

**实测（2026-09-27，Task 3 完成 · 已提交 `2badc356`）**：

- **改动面**：3 文件 **+201/−16** —— `embedder_openai.py`（阶梯 / 自愈 / 发参 / `_Rejected`）、`embedder_factory.py`（**+5 一行分支**：`elif declared is not None: kwargs["dimension"] = declared`，`pins_dimension` 分支未动）、`tests/knowledge/test_embedder_providers.py`（+121）。
- **发参（D2 甲a）**：未声明 ⇒ 请求体键集 `== {"model","input"}`（与今天逐字节相同）；声明 ⇒ 每一发都带 `dimensions`，拆批只改行数、不改这个键（`[1024, 1024]`）。
- **阶梯（D3 甲′）**：`BATCH_LADDER = (20,10,5,2,1)`、属性初值 `_BATCH_CAPS.get((base_url, model), BATCH_LADDER[0])` = **20**；`DEFAULT_BATCH_LIMIT` 值**仍 10**（稀疏腿共用，未动）。上限 5 的桩、30 片 ⇒ 行数序列 **`[20, 10, 5, 5, 5, 5, 5, 5]`**（首批白付一发、同一批降档重试、不落 failed、30 片全回）；学到后 `embedder.batch_size == 5`，**同端点新实例直接按 5 发**（`[5, 1]`，端点级记忆生效）✓。上限 20 的桩、25 片 ⇒ `[20, 5]`（零被拒发）✓。
- **判定次序（D3 尾）**：多行 400 ⇒ 降档；单行 + 正带参 400 ⇒ **去参重试一次**（`bodies[0]` 有 `dimensions`、`bodies[1]` 没有），并记入 `_NO_DIMENSION_PARAM` ⇒ **同端点新实例首发就不带参**（"不再白付那一发"）✓。
- **neuter（可复跑）**：① 删 `payload["dimensions"] = dimension` ⇒ **2 红**（`test_the_declared_dimension_is_sent_and_undeclared_stays_byte_identical`、`test_a_rejected_dimension_parameter_is_dropped_once_and_remembered`；都是"参数要发出去"这一行为的正反面钉子）；② `_initial_batch_size` 回落改回 `DEFAULT_BATCH_LIMIT`(10) ⇒ **3 红**（`test_the_generic_embedder_starts_at_the_ladder_top`、`test_a_batch_size_400_walks_the_ladder_down_and_remembers_where_it_landed`、`test_a_twenty_row_cap_is_used_without_a_single_rejected_request`）。**受害者不相交**（{2 发参} ∩ {3 起点} = ∅）✓；两次各自还原后 **26/26 绿**。
- **⚠️ 计划两处低估（如实记）**：计划预测 ① 只有 1 条红、② 只有"上限 20"1 条红 —— 实测各 **2 / 3** 条。差异可解释：两条发参钉子（正向 + 自愈）都靠"参数发出去"、三条起点钉子（专用 + 降档序列 + 上限 20）都靠"初值 20"，属同一行为的多个断言，不是受害者扩散。
- **RED 的有效度量是逐条 neuter，不是整文件回退**：把 `embedder_openai.py` 整体回退到 HEAD 复现 RED 时得到的是 **26 errors**（测试文件 import 新符号 `BATCH_LADDER`/`_BATCH_CAPS` 直接失败、collection 级）⇒ 若日后要复跑 RED，用上面两条逐条 neuter，别整文件回退。
- **回归**：`tests/knowledge/` + `tests/test_rag_config_api.py` ⇒ **1393 passed / 2 skipped / 2 failed**，两条失败是**环境条件红**（本机仓库根真 `rag_config.json` 带 key ⇒ `test_embed_missing_api_key` / `test_rerank_missing_api_key` 的"缺 key 必拒"前提不成立；**阳性对照**：`DEER_FLOW_RAG_CONFIG_PATH` 指向空 `{}` 后两条转绿）⇒ 非本 Task 引入，与既有环境债同族。厂商腿（dashscope / ark）用例**零改动**全绿✓。
- **门禁**：`make lint` 绿（1303 files already formatted）。

---

## Task 4a — 生效宽度 + 集合命名 + 守门跟宽度 + 尺寸检测

> 动到的文件：`embedder_factory.py`（生效宽度 + 守门）、`vector_store.py`（命名 + 尺寸检测）、`rag_config.py`（保存期探针按生效宽度判）+ 三处用例。**验收对应**：spec §4 的 6（默认零迁移）+ 4（保存期三态）+ 5 的前半（命名这一半）。**2026-09-27 开工前按 Task 0 的 1/2/3/7 结果从原 Task 4 拆出**：本段是"读/写路径跟宽度"，迁移编排留在 Task 4b。

- [x] **RED（守门跟配置）**：声明 1536 ⇒ 工厂放行（不再"≠1024 直接拒"）；未声明 ⇒ 仍按 1024（逐字节不变）。
- [x] **RED（命名）**：非默认宽度 ⇒ 四个集合名带后缀（`kb_chunks_1536` 等）；默认宽度 ⇒ **仍是今天这四个无后缀名**（否则存量部署的向量当场"消失"）。
- [x] **RED（尺寸检测）**：声明宽度 ≠ 默认且旧代（无后缀）还在 ⇒ `init_collections` **不建空代**、抛 `DimensionMigrationRequired` 并给迁移出路；`create_collections()` 作为迁移自己的入口跳过分代判定。
- [x] **GREEN**：`effective_dimension(rag)` 一个读数点（store 命名 / 运行时守卫 / 保存期探针同源）；守门改"实测 vs 生效宽度"；保存期探针改按 `pending` 的生效宽度判 + 文案重写；`get_vector_store()` 接生效宽度。
- [x] **neuter**：四组（见实测），并列明一条不满足"不相交"的组合。
- [x] **回归**：`tests/knowledge/` + `tests/test_rag_config_api.py` 宽面；默认 1024 路径的既有断言零改动全绿。
- [x] **门禁**：`make lint` + 相关面。

**实测（2026-09-27，Task 4a 完成 · 未提交）**：

- **改动面**：3 源 + 3 用例 = **6 文件**（`embedder_factory.py` / `vector_store.py` / `rag_config.py` + 新增 `tests/knowledge/test_vector_store_dimensions.py`(6 例) / `test_embedder_providers.py` / `test_rag_config_api.py`）。
- **⭐ 后缀规则（对 spec §3 措辞的一处修正）**：**后缀只在非默认宽度上出现** —— 1024 仍用 `kb_chunks` 等原名，1536 才是 `kb_chunks_1536`。理由：acceptance 6 要求"不动维度时行为与请求逐字节不变"，若 1024 也加后缀，存量部署的向量会当场读不到（§5 存量账"不迁移就完全不碰"同理）。⇒ 建议把 spec §3「存储」行的 `{prefix}_chunks_{size}` 补一句"（默认宽度不带后缀，保持存量名）"。
- **一个读数点**：`effective_dimension(rag)` = `rag.embedding_dimension or 1024`，被三处共用（store 命名、`_DimensionCheckedEmbedder` 的期望值、保存期探针），避免"写的人按一个宽度、判的人按另一个宽度"。
- **守门**：删掉 `declared != 1024 ⇒ 直接拒`（那正是 F2/F3 无解的原因）；保存期探针改为 **实测 vs 生效宽度**（选 1536 时就按 1536 判）。文案重写为「嵌入模型返回 N 维，而当前生效宽度是 M 维 ⇒ 拒绝启用。请改用该模型支持的维度（到「设置 → 模型 → 功能模型 → 高级设置 → 维度」改，改值会触发全库重建），或换模型。」
- **尺寸检测**：`init_collections` 在"生效宽度 ≠ 默认 **且** 旧代（无后缀集合）还在"时抛 `DimensionMigrationRequired`（`ValueError`，不是 `EmbedderError`——`index_chunks` 会把后者当软失败吞掉），**一个空集合都不建**；`create_collections()` 无分代判定，供 4b 的迁移建新代用。新增 `collection_size(name)` 读回现有集合宽度（`get_collection().config.params.vectors["dense"].size`）。
- **neuter（四组，可复跑）**：① `_name` 去掉后缀 ⇒ **4 红**（`a_declared_width_carries_the_suffix`、`init_creates_the_new_generation_at_the_declared_width`、`init_creates_a_fresh_generation_when_no_other_one_exists`、`create_collections_is_the_migration_entry…`）；② 把拒绝降级为"什么都不做"⇒ **1 红**（`init_refuses_to_create_an_empty_generation…`，机制已核＝`DID NOT RAISE`）；③ 恢复"声明≠1024 直接拒"⇒ **2 红**（`the_declared_dimension_is_the_live_width`、`put_judges_a_declared_width_against_the_declaration_not_1024`）；④ 保存期探针改回按默认宽度判 ⇒ **2 红**（同上那条 + `put_refuses_a_declared_width_the_model_does_not_return`）。每次还原后全绿 ✓。
- **⚠️ 一处不满足"受害者不相交"（如实记）**：③∩④ = {`put_judges_a_declared_width_against_the_declaration_not_1024`} —— 它同时依赖"工厂放行 1536"（③）与"探针按 1536 判"（④），是端到端那条钉子，无法只属一边。其余三组两两不相交。
- **两处自纠（如实记）**：⚠️ 两条"建代"钉子最初写成与 `store.collection_names` 自比（自洽的假判据）⇒ neuter ① 只红 2 条；改成钉**字面名字**后才红 4 条。⚠️ `put_refuses…` 最初只断言文案含两种宽度 ⇒ 被 neuter ③ 漏过（旧守卫的报错也含这两个数），补 `"返回" in detail` 后成为 ③ 的真受害者。
- **回归**：宽面 `tests/knowledge/` + `tests/test_rag_config_api.py` ⇒ **2 failed / 1400 passed / 2 skipped**，两条失败仍是 09-25 登记的环境红（本机 `rag_config.json` 带 key；阳性对照同 Task 3）⇒ 零新增红。补钉子后单跑 `tests/test_rag_config_api.py` = **61 passed**。
- **门禁**：`make lint` 绿（1304 files already formatted）。

---

## Task 4b — 迁移编排 + 触发入口 + 前端「改维度＝全库重建」确认（**未开工**）

> 动到的文件：迁移函数（遍历所有库四路重嵌 + 先建后切 + 差量补嵌）+ 触发入口（保存期/路由/服务）+ 前端确认 + 用例。**验收对应**：spec §4 的 5（后半：遍历所有库 / 完成才翻配置 / 失败回滚 / 中断不撞残留 / 窗口内新文档不丢）。**两件已裁（2026-09-27）**：① 窗口内新入库的文档 = **结束前扫差量**（spec D5-6，开工记 `id`/`updated_at`、翻配置前再枚举补嵌）；② 跑法 = **后台任务 + 状态面**（spec D5-7，PUT 只启动、完成才由后台翻配置、前端轮询）。

- [x] **RED（建代与切换）**：生效宽度变了 ⇒ 建新代（`create_collections()`）→ **遍历所有库**四路重嵌（切片/实体/wiki/卡片，复用 `reindex_kb`，注意它是**按库**的）→ **全绿才翻配置** → best-effort 删旧代。
- [x] **RED（差量补嵌）**：迁移窗口内新入库的文档 ⇒ 翻配置前被补进新代（D5-6：开工记 `id`/`updated_at`，翻配置前再枚举一次）。
- [x] **RED（失败回滚）**：中途失败 ⇒ 配置文件从未写过新宽度、旧代原样、检索照常（回滚＝什么都没发生）。
- [x] **RED（先删后建）**：同名新代有残留（上次中断）⇒ 先删后建，不撞半成品。
- [x] **GREEN**：迁移函数 + 后台任务 + 状态/进度端点（复用 `trigger_reindex` 的 fire-and-forget + 轮询形态）+ PUT **只启动、不写新宽度** + 前端「改维度＝全库重建」确认（保存时确认，不在行内弹）。
- [x] **neuter**：① 删差量那一遍 ⇒ 只红差量那条；② 把"完成才翻"改成"先翻" ⇒ 只红回滚那条。
- [x] **回归 + 门禁**：默认 1024 既有面零改动全绿；`make test` 相关面（含 qdrant 标记集成面）+ `make lint` + `pnpm check` + 前端迁移确认的 dom。

**实测（2026-09-27/28，Task 4b 完成 · 未提交）**：

- **改动面**：
  - **后端 7 文件**：新增 `knowledge/dimension_migration.py`（编排 + 进程内状态）与 `app/gateway/services/rag_migration.py`（启动 / 翻配置 / 清旧代 / 状态面）；`knowledge/store.py`（+`list_all_kbs()` 跨所有者）、`knowledge/vector_store.py`（+`drop_collections()`）、`knowledge/reindex.py`（+`include_non_terminal`）、`config/rag_config_file.py`（+`write_rag_config()` 唯一写入策略）、`routers/rag_config.py`（PUT 拆分写 + 启动迁移 + `GET /rag/config/migration` + 响应新增 `migration`）。
  - **后端用例**：新增 `tests/knowledge/test_dimension_migration.py`（7 例）；`tests/test_rag_config_api.py` +6 例（另改 2 例 4a 时代的用例吸收新语义）。
  - **前端 9 文件**：`core/rag/{types,api,hooks}.ts` + 新增 `migration-status.ts` + `config-form.ts`（+`changesEmbeddingDimension`）+ 视图（确认弹窗 / 在飞状态行 / 在飞时禁保存）+ 新增 `dimension-migration-dialog.tsx` + i18n ×3；用例：两份 dom（+6、并补 hook 桩）+ `config-form.test.ts`（+4）+ 新增 `migration-status.test.ts`（+3）。
- **⚠️ 对 D5-6 的一处实现更正（已补进 spec）**：**差量以"库"为单位，不是"逐文档"** —— 判据 = 复用 `get_kb_content_stats` 的内容签名（chunks `count+max(last_edited_at)` / wiki / cards / entities）+ 文档 id 集；**库动过 ⇒ 该库整遍重来**（`include_non_terminal=True`），库没动过一次都不跑（常见情形零成本）。两个原因：① **`documents` 表没有 `updated_at`**（先前说"两个时间戳现成"是错的：它只有 `created_at`；`updated_at` 只在 wiki / manual 两表）⇒ 按文档判"变过"只能看 `status`/`chunk_count`，**chunk 被编辑就漏**，按库签名能看见；② 实体/wiki/卡片三路没有逐文档归属，按库重跑才**完整**（同一文档的实体向量不会落在旧代）。
- **⭐ 非终态文档必须补嵌**：`reindex_kb` 故意跳过"还在管线里"的文档（普通重建里是对的——它的后续腿会读当前配置），但迁移期间"当前配置"仍是旧代 ⇒ 那类文档恰是最会被落下的。故差量遍用 `include_non_terminal=True`（默认 `False`，既有调用零改动）。
- **其余实现决定**：① 窗口内**被删**的文档 ⇒ 在新代清掉它的点（否则新代留孤儿、检索指向已删切片）；② **PUT 拆分写**：只把宽度留在旧值，同一次保存的其它字段立刻落盘（否则迁移失败会连带丢掉用户同一次的其它编辑）；③ **失败语义**：跑级异常（Qdrant 连不上 / 构建炸）⇒ 不翻配置、状态 `failed` 带原因；**逐文档失败仍翻配置**（与 `reindex_kb` 既有软失败契约一致），`documents_failed` 进状态面；④ 迁移在飞时第二次改宽度 ⇒ **409**；⑤ 前端在飞时禁保存并显示 `kbs_done/kbs_total`。
- **neuter（三组）**：① 关掉差量那一遍 ⇒ **3 红**（新到文档 / 在飞文档 / 窗口内被删文档）✓；② 翻配置挪到重建**之前** ⇒ **2 红**（`test_a_width_change_defers_the_width_and_starts_the_rebuild`、`test_a_migration_that_fails_never_flips_the_width`）；③ PUT 立刻写新宽度（deferral 整块去掉）⇒ **同 2 红**。**⚠️ ②③ 受害者相同、如实记**：两者破坏的是**同一个可观测性质**（"宽度只在成功之后才生效"），差别只在"谁先写"，钉子上分不开。
- **三处自纠（如实记）**：⚠️ neuter ③ 第一版是**空操作**（我只把 `written = payload` 写了一半，后面几行又把旧宽度塞回去）⇒ 测试全绿、差点当成"neuter 无效"；**判据：neuter 跑绿先怀疑 neuter 本身**。⚠️ 差量钉子第一版与后台任务**竞态**（桩立即返回 ⇒ 翻配置可能先于"文件仍是旧宽度"的断言）⇒ 改用 `threading.Event` 闸门 + `_settled` 轮询。⚠️ 闸门第一版**无上界**（`gate.wait()`）⇒ 断言先失败时 app 的 loop 卡在 `to_thread`、整轮 pytest 不返回（实测挂 40 分钟被迫 kill）⇒ 定稿 `gate.wait(10)` 并在用例里写明为什么要有界。
- **回归**：宽面 `tests/knowledge/` + `tests/test_rag_config_api.py` + 两份 rag_config 文件 ⇒ **1458 passed / 2 skipped / 6 failed**，6 条全是已登记的环境条件红（2 条缺 key + 4 条 `test_rag_config_probe.py` 的"dashscope 需要地址"，均早于本轮就红）⇒ **零新增红**；Qdrant 集成面 13 例全绿 ✓。前端：两份 dom（85 + 18）与两份 node 全绿。
- **门禁**：`make lint` 绿（1307 files already formatted）；`pnpm check`（eslint + tsc）零诊断。

---

## Task 5 — 文档 + 真栈桩腿 + 门禁

> 动到的文件：`backend/AGENTS.md` + spec/plan 的 Status 回填。**验收对应**：spec §4 的 9 / 11 + §5。

- [ ] `backend/AGENTS.md`：嵌入 provider 段改写——维度可声明/可探/可配、`dimensions` 参数语义、批量阶梯、集合命名与迁移；`config.example.yaml` / `rag_config.example.json` 相关注释同步。
- [ ] **真栈桩腿**（本机桩、零出网、配置动手前先备份）：三型探测各一条（下拉/数字/只读呈现；**自动探、无需点按钮**）；声明发参的请求断言；批量阶梯（上限 5 的桩自动降到 5）；**连通点四态各一条**（桩：通/不通/超时/未测，橙的两种原因各占一条）；**维度字段往返一条**（设值 → 保存 → GET 仍是它，且一次无关编辑后仍在）；**自由值一条**（填表外值 ⇒ 保存期拦/放各一态）；**0 档回退一条**（严格端点桩 ⇒ 非空列表 + 可手填）；**原生补验一条**（原生 ∉ 表 ⇒ 补验通过后出现在档位里）；**② 上界验证一条 + "假②"降级对照一条**（真② ⇒ 那一发通过、上界可用；真①被误判成② ⇒ 那一发失败 ⇒ 当场降级跑表、列表变成真档位）；**同值不重建一条**（填与当前相同的值 ⇒ 无迁移、无重建确认）。
- [ ] **对照组**：不声明维度 ⇒ 请求体与今天逐字节相同（证明零影响）；无桩（不可达）⇒ 探针 `detail` 报原因且**不挡保存**；改 provider/Model/地址 ⇒ 点退回灰、维度行重新自动探。
- [ ] spec §4 验收 1–15 逐条对账；§5 非目标零触碰（`git diff` 核：厂商腿**入库请求** / rerank 既有行为 / parse / 稀疏 / 检索三路零改动；`DEFAULT_BATCH_LIMIT` 值未变）。
- [ ] 门禁全跑；spec/plan Status 回填；**不提交**——改动清单摊给他，等指令。

**实测（待回填）**：
