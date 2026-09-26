# RAG 检索面收口 · 真栈验收（2026-09-25）

计划：`docs/superpowers/plans/2026-09-24-rag-retrieval-followups.md` Task 6（spec §5 的 6 / 9 / 13）。
环境：本机真栈（frontend `:3000` 本次由我起 / Gateway `:8001` 用户已在跑，启动于 19:13，含 Task 1–4 代码 / Qdrant `:6333`）。
目标库：**测试2** `5f532d371666482886453c62c4f13c1a`（10 文档：6 ready / 4 failed；21 切片 / 297 实体 / 51 百科条目 / 0 人工卡片）。
配置：嵌入 `openai-compatible | text-embedding-v4 | dashscope compatible-mode | sparse=bm25`；重排 `generic-rerank | jina-reranker-v2-base-multilingual`。
`rag_config.json` 全程逐字节备份（仓外 `E:/app-mode/deer-flow-scratch/rag_config.before.json`，md5 `b0cc81b5…`），收尾已还原并核对 md5。

## 结论速览

| 验收项 | 结果 |
|---|---|
| ① 重建链路（§5.6） | **未通过（发现真缺陷）**：切片遍 ✓（界面 202→`succeeded`、进度行四键求和实时可读）；**实体/百科/卡片三遍在本机部署上一条都没写** —— 见下「发现」。重建前后三路读数逐位相同（wiki 0.0477→0.0477、graph 6→6），正是"三遍没写"的旁证。 |
| ② 召回徽标（§5.9） | 载荷级 ✓：`score_type = {vector: "jina-reranker-v2-base-multilingual relevance", graph: "embedding cosine", wiki: "embedding cosine"}`（由服务端每请求现算，面板只渲染字符串；面板 DOM 复核待补）。可选腿（临时开 `graph_rerank`）未做。 |
| ③ TEI docker 腿（§5.13） | 未做（operator 定）。 |
| Task 5 界面四项（顺路核） | 全过：下拉三项且第三项 `TEI 重排`、「通用重排 (Cohere / Jina 形状)」；ⓘ 新提示文案逐字在页；确认弹窗新描述 + 点名「测试2」；运行行 `重建中 4/10 · 已写入向量 6`（四键求和）。 |

## 发现：兼容端点的批上限 = 10，客户端默认发 20 ⇒ 重建三遍整页 400

**证据链（全部一手）：**

1. 端点上限（直接打接口，用 `rag_config.json` 里的 key）：

   | 模型 | 20 条一批 | 10 条一批 |
   |---|---|---|
   | `text-embedding-v4`（operator 现配） | **400** | 200 |
   | `text-embedding-v3`（本次实验用） | **400** | 200 |

   400 原话：`<400> InternalError.Algo.InvalidParameter: Value error, batch size is invalid, it should not be larger than 10.: input.contents`
2. 客户端：`knowledge/embedder_openai.py:42` `DEFAULT_BATCH_LIMIT = 20`（`embed()` 按它切批，`:86-87`）。
3. 重建三遍：`reindex.py:45` `DEFAULT_PAGE_SIZE = 500`；实体遍 `list_entities` 整体返回后**按页切**（:191-192），整页交给 `embedder.embed(...)`；页内第一个 20 条请求就 400 ⇒ **整页失败**（`except` 记账继续，:`201`）。
   - 本机数目：297 实体 = 1 页；51 百科 = 1 页 ⇒ 各一次失败、**零写入**。
   - 网关日志各 4 条（两次重建 × entity + wiki）：`reindex entity batch failed …; continuing with the rest` / `reindex wiki-entry batch failed …`。
   - 切片遍不受影响：按文档切、本机每篇 ≤10 片 ⇒ 17 次 embeddings 全 200（仅 4 次 400，全来自三遍）。
4. 后台任务报 `last_run: "succeeded"`（遍失败不带走 run 的既定口径），所以**界面看不出来**：进度行只显示四键求和（本次 6 = 切片 6 + 三键 0）。

**后果**：spec §5.6 要验的「图谱证据恢复（对照 6）/ 百科分数量级恢复」在本机部署上不会发生 —— 实体/百科/卡片向量仍留在旧空间（重建前后读数逐位相同即证）。这条缺陷与模型无关（v4 同样 400），是客户端默认批上限与本端点的匹配问题。

## 本轮做过的事（时间线）

| 时刻 | 动作 | 读数 |
|---|---|---|
| 20:46 | 基准（配置 v4） | graph 命中 6 / 12 节点 / 5 证据；wiki 5 条，最高 0.047743645（任务队列）；vector 5 条 0.754915…（Jina） |
| 20:53 | 造跨空间：`embedding_model` → `text-embedding-v3`（单字段字节替换，md5 `220b648e…`） | — |
| 20:56 | 复测 | graph **0 实体**（「未找到相关的实体」）；wiki 4 条，最高 **0.039683253**；vector 分数与基准**逐位相同** |
| 21:04:15 | 界面触发重建（202，目标库=测试2） | 运行行 `重建中 0/10 · 已写入向量 0` → `4/10 · 6`；日志 2 × 400（entity/wiki 页） |
| 21:06 | 重建结束 | `in_progress=false`、`last_run="succeeded"`、`progress=null` |
| 21:11 | 还原配置（md5 回 `b0cc81b5…`）+ API 触发重建 | 再次 2 × 400（同一遍、同一原因） |
| 21:12 | 复测 | 三路读数与 20:46 基准**逐位相同** ⇒ 复原成功（实验期间被写成 v3 的 6 条切片向量已回到 v4） |

### 附带结论：向量腿「跨空间读数逐位相同」不是陈旧缓存（已用探针钉死）

换模型后向量腿的 5 条候选与重排分**逐位相同**，一度像"配置没生效"。复算（`probe_dense3.py`，Qdrant 直连 + Jina 直打）：

- 同一查询文本、同一融合调用下，v4 与 v3 的 dense 列表**不同**（`probe_dense`：`fused_top5_identical = False`）；
- 但**两版的候选池里都有同一批相关切片**，Jina 从池里挑出的前五文档集相同 ⇒ 重排分会逐位相同（分数 = f(query, 文档)，池外差异不影响已选中的 5 条）；
- 决定性对拍：我的 **v3 复现**（dense → RRF top-20 → 切片文本 → Jina top-5）产出的分数与顺序，与网关换 v3 后的读数**逐位一致**；而**百科腿**两版读数各自对上网关两次测量（v4 → 0.047744/任务队列；v3 → 0.039683/SKU-1024）⇒ **配置确实即时生效**，无缓存缺陷。

### 探针脚本（仓外，可重跑）

`E:/app-mode/deer-flow-scratch/probe_dense.py`（dense 对照）、`probe_dense2.py`（稀疏/稠密/融合分层）、`probe_dense3.py`（含 Jina 的完整复现）。

## 修复甲：客户端默认批上限 20 → 10（operator 2026-09-25 裁）

按行业先例（原生百炼腿的 `DASHSCOPE_SAFE_BATCH_SIZE = 10`：**默认取已知最低上限**）把通用客户端的
`DEFAULT_BATCH_LIMIT` 从 20 降到 10；改的是 `embedder_openai.py:41-44`（常量 + 注释写明依据）。

| 环节 | 结果 |
|---|---|
| RED | 新增 `test_the_generic_embedder_sends_batches_the_endpoint_can_take`（默认批上限下 25 片必须拆 10/10/5，且 `embedder.batch_size == 10`）⇒ **1 红**（`assert 20 == 10`），同批 19 deselected |
| GREEN | 常量 20→10 ⇒ 该文件 **19 passed / 1 env-red** |
| neuter ① | 常量回 20 ⇒ **恰好该条 1 红**；revert 后 md5 回 `acf8e628ae8317a7b70e7569481d8332`（= GREEN 态） |
| ruff | `ruff check` All checks passed + `ruff format --check` 2 files already formatted |
| 宽面 `tests/knowledge` | **1226 passed / 2 skipped / 3 failed** —— 3 红全是环境条件（见下），零新增 |

**3 条环境红的完整证法（本轮升级）**：`test_build_embedder_defaults_to_dashscope_and_keeps_its_sparse` /
`test_indexer.py::test_embed_missing_api_key` / `test_reranker.py::test_rerank_missing_api_key` —— 本机真实
`rag_config.json` + `config.yaml` 把「什么都不设 ⇒ 默认百炼」「缺 key ⇒ 须抛」两个前提都破坏了
（前者：`_stub_config` 只盖它传的字段，真实 rag 块是 `openai-compatible` ⇒ 拿到 `ComposedEmbedder`；
后者：真实条目里带着 key ⇒ 请求真发出去）。**A/B**：把 `DEER_FLOW_CONFIG_PATH`（干净 `config.example.yaml`）
与 `DEER_FLOW_RAG_CONFIG_PATH`（`{}`）同时指向**仓外**文件后 **3 passed（13.36s）**。
Task 2 实测里已登记过同一批（当时只挪了 rag 侧），本轮补上 config 侧、证得更完整。

## Task 6 ① 复验（修后，真栈）

时间线（同一查询 `SKU-1001、无线机械键盘、库存数量、单价`，库=测试2）：

| 时刻 | 状态 | 向量腿最高分 | 百科腿最高分 | 图谱腿 |
|---|---|---|---|---|
| 21:39 | 修后、v4、**未重建**（对照组） | 0.754915 | 0.047743645（任务队列） | 12 节点 / 14 关系 / 5 证据 |
| 21:40 | 造跨空间（`embedding_model` v4→v3） | 0.754915（不变） | **0.039683253**（SKU-1024） | **0 实体**（「未找到相关的实体。」） |
| 21:41:47 | 重建后（v3 空间，k=5） | 0.754915 | **0.8633182**（无线机械键盘） | 25 节点 / 10 关系 / 5 证据 |
| 21:42:59 | 重建后（v3 空间，**k=6**） | 0.754915 | 0.8633182 | **6 证据**（登记值 6 ✓，「命中 12 个实体，扩展出 25 个节点、10 条关系、6 条切片证据」） |
| 21:44–45 | 还原 v4 + 重建 ⇒ 终态（k=5 / k=6） | 0.754915 | 0.8412111 | 25 节点 / 14 关系 / 5 证据（k=6 时 message 注明「候选池共 5 片，已全量返回」） |

**重建窗口审计（两次都一样）**：44 次 `embeddings` **全 200、零 400**（缺陷态是每遍一次 400）；
Qdrant 写入 `kb_chunks ×8 / kb_entities ×1 / kb_wiki_entries ×1`。修复生效的直接证据。

**⭐ 附带发现：修前那次「对照组」本身就是旧的跨空间态。** 同一条查询、同一个 v4 空间，重建前后
wiki 最高分 0.0477 → 0.8412、图谱节点 12 → 25 ⇒ 「重建只重嵌切片」留下的陈旧 entity/wiki 向量
在本修复后**被真正修掉**。所以本轮验收不只覆盖人工造的跨空间（v3），也覆盖了库里已有的历史陈旧态；
plan 里「别把『本来就正常』当成修复证据」那句正好反向命中：修前的"正常读数"其实并不正常。

## Task 6 ② 面板级徽标 + 环境记录

面板（`/workspace/knowledge` →「测试2」→「检索测试」）三路徽标（21:47，DOM 直读）：

- 向量通道 `jina-reranker-v2-base-multilingual relevance` ✓（= 当前配置的模型名）
- 图谱通道 `embedding cosine`（证据 5 / 实体 25）✓　百科通道 `embedding cosine` ✓

⚠️ **同一时刻 `api.jina.ai` 变为不可达**（DNS 被污染：`api.jina.ai` 解析到 `2a03:2880:f12d:83:face:b00c:0:25de`
一类地址；curl `000` / exit 35，**直连与 `127.0.0.1:7897` 代理两条路都试过**）⇒ 面板后两次运行走降级
（日志 `rerank unavailable, degrading to RRF order: Rerank request failed:`，无对应 HTTP 行 = 连接层失败），
**徽标不变**（徽标是配置口径、非本跑口径 —— 与 Task 3 用例④同一条设计）。
同一时段 `ghcr.io` / `huggingface.co` / `registry-1.docker.io` 也不可达；国内镜像可达
（`ghcr.nju.edu.cn` 200 / `hf-mirror.com` 200 / `modelscope.cn` 200）⇒ ③ 改走镜像（见下）。

## Task 6 ③ TEI docker 腿（本轮做，走镜像绕开网络）

镜像与模型的下载都撞上同一时段的外网故障（`ghcr.io` / `huggingface.co` / `registry-1.docker.io` 全 `000`），
处置两条：镜像走 **`ghcr.nju.edu.cn`** 镜像、模型走 **ModelScope**（TEI 自带下载器吃不了 hf-mirror：
`Could not download model artifacts / Header content-range is missing`）。

| 步骤 | 结果 |
|---|---|
| 镜像 | `ghcr.nju.edu.cn/huggingface/text-embeddings-inference:cpu-1.9`（938MB，digest `sha256:2538ea1c…`） |
| 模型 | `BAAI/bge-reranker-base` 六个文件从 ModelScope 直下（`model.safetensors` 1 112 206 140 B，尺寸与 API 列表逐条相符）⇒ `--model-id /data/model` 绑挂载（⚠️ Git Bash 会把 `/data/model` 改写成 Windows 路径 ⇒ 必须 `MSYS_NO_PATHCONV=1`） |
| 起服 | 日志 `Starting HTTP server: 0.0.0.0:80` / `Ready`（容器 8080→80） |
| 裸探两种形状 | TEI 形状 `{"query","texts","raw_scores"}` ⇒ **200** `[{index:0,score:0.0012680654},{index:1,score:0.000037307}]`；通用形状 `{"model","query","documents","top_n"}` 打同一地址 ⇒ **422** `missing field 'texts'` |
| 配 `tei-rerank` | `rerank_provider=tei-rerank` / `rerank_base_url=http://127.0.0.1:8080` / `rerank_api_key=""` / `rerank_model=BAAI/bge-reranker-base`（TEI 行 `takes_model=False` ⇒ 该字段只当徽标用、不进请求） |
| 召回出分 | 网关日志 `POST http://127.0.0.1:8080/rerank "HTTP/1.1 200 OK"`；向量腿 5 条**带分** `[0.99493295, 0.35044152, 0.321558, 0.321558, 0.20433685]`、榜首仍是「产品库存台账.xlsx」；徽标 `BAAI/bge-reranker-base relevance`；graph/wiki 两腿不动（`embedding cosine`） |
| **对照组** | `rerank_provider=generic-rerank` 指**同一地址** ⇒ 网关日志 `POST http://127.0.0.1:8080/rerank "HTTP/1.1 422 Unprocessable Entity"` + `rerank unavailable, degrading to RRF order: Rerank failed (HTTP 422): no error detail`；向量腿 5 条**无分**（`rank` 1..5 = RRF 序） |
| 收尾 | 容器 `docker rm -f tei-rerank-test`；`rag_config.json` 逐字节还原 ⇒ md5 回 `b0cc81b51c409225e26a737ee78f50b8`；再从应用侧复核 `GET /api/rag/config` = `generic-rerank / https://api.jina.ai/v1 / jina-reranker-v2-base-multilingual / key 已设`（密钥只报「set」，不落明文） |

**一处与计划的偏差**：计划写对照组预期「422 / 空榜」，实测是 **422 + 降级到 RRF 序的无分榜**（不空）——
因为召回测试的向量腿走的是 `hybrid_search` 的降级路径（`RerankerError` ⇒ 按粗排返回），这条降级本身是既有设计。

**留着的东西（便于复跑，都不在仓内）**：镜像 938MB 留在本地 docker；模型 6 个文件 1.1GB 在
`E:/app-mode/deer-flow-scratch/tei-model/`。要清就说一声。

## 待定

- 无（三节验收均已完成；本轮唯一遗留是外网对 `api.jina.ai` / `ghcr.io` / HF 的临时不可达，与代码无关）。