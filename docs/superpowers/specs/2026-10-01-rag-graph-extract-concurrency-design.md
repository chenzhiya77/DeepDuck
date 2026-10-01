# RAG 图谱腿 chunk 级并发 —— 设计

**Status:** ✅ **已定稿（2026-10-01）** —— **待拍清零：D1 已裁（结构性）/ D2 已裁 = 甲（`rag.extract_concurrency` 默认 8，实测膝点）/ D3 已裁 = 乙（瞬态重试 2 次后按 chunk 软失败）/ D4 已裁（gleaning 留 chunk 内）/ D5 已裁 = 二期（实体名 embed 不攒批）/ D6 非目标固定**。配套 plan：[2026-10-01-rag-graph-extract-concurrency.md](../plans/2026-10-01-rag-graph-extract-concurrency.md)（同批成对）。

本对一件事：**图谱抽取腿从"逐 chunk 串行"改为"chunk 级有界并发"**，并发数 N 由 2026-10-01 真调用实测定为 8。除执行顺序由"逐个"变"并发"外，**语义零变化**（同样的抽取结果、同样的落库、同样的断点续跑与软失败契约）。

**相关记录**：

- [2026-09-22-reasoning-replay-default-design.md](2026-09-22-reasoning-replay-default-design.md)（模型条目线；与本对**零文件重叠**）
- 限速旋钮 `rag.extract_rate_limit_rps` 已在 2026-10-01 由用户在子会话整体删除（8 文件 −25 行，未提交）——本对**不恢复它**，节流改由并发数本身承担（D2）。

## 1. 问题

### 1.0 一眼看懂

**现状**：图谱腿是全流水线最慢阶段，且**逐 chunk 严格串行**——每个 chunk 2 次串行 LLM 调用（抽取 + gleaning 补抽）外加 1 次实体名 embed，全部排队执行。单次抽取实测 ~11s（见 §2），13 chunk 的文档仅这一条腿就要 **~5 分钟**，100 chunk 的 PDF 要 **~37 分钟**。

**本对之后**：同一循环改成 N=8 路并发，墙钟 ≈ `ceil(C/8) × 2T`；13 chunk 篇从 ~290s 降到 **~40s（约 7 倍）**，100 chunk 篇从 ~37min 降到 **~4.5min**。

```
改的                                      不改的
──────────────────────────              ──────────────────
① graph/indexer.py 的 chunk 循环（并发化）  腿间顺序（向量腿 → 图谱腿仍串行）
② RagConfig 新字段 extract_concurrency     gleaning 语义（仍 1 轮、chunk 内串行）
③ 瞬态 LLM 错误兜底（D3）                  断点续跑 / 软失败 / 进度口径 / 落库结构
④ 文档三处（AGENTS.md / example / 用例）    wiki、解析缓存、实体名 embed（二期）
```

### 1.1 为什么慢（已核实的调用账）

图谱腿每 chunk：`extract_graph`（1 次 LLM）→ gleaning（1 次 LLM，对话式追问，`extractor.py:138-151`）→ 实体名 embed（1 次 HTTP，`graph/indexer.py:166`）。循环体在 `graph/indexer.py:146` 一个 `for chunk in pending` 里**全串行**。chunk 之间没有数据依赖（跨 chunk 实体合并本就在其后的 `resolve_entity_aliases` 统一做），**天然可并行**。

## 2. 实测基线（2026-10-01，真调用）

抽取模型 = `mimo-v2.6-flash`（`extract_model` 未声明 → RAG 默认 → 合并列表第一条，`require_usable_rag_target` 解析结果）；样本 = 库内真实 chunk（2178 字符，token_count≈1024）；探针脚本一次性用后已删。

| 形态 | 墙钟 | 单发延迟 | 吞吐 | 429/错误 |
|---|---|---|---|---|
| 串行 ×3 | 32.1s（9.67 / 11.15 / 11.27） | 中位 **11.15s** | 0.09 req/s | 0 |
| 并发 8 | **10.53s** | 7.19–10.53s | **0.76 req/s** | 0 |
| 并发 16 | 20.57s | 13.02–20.57s | 0.78 req/s | 0 |

token 成本：每调用 in=887 / out≈650–1400（中位 ~1000）≈ **1.9K tok**；输出 token 速率两次并发都是 **~760 tok/s**。

**膝点判定**：8 → 16 并发吞吐几乎不变（0.76 → 0.78 req/s，输出 tok/s 两次相同），单发延迟却翻倍 ⇒ **端点在 8 路附近已饱和**（处理吞吐上限 ~760 out-tok/s，疑似档位配额），再加并发只加延迟不加吞吐。**N = 8 是这台端点的膝点**，也是全局在飞上限 `worker_concurrency(2) × 8 = 16`（实测"不亏也不赚"档）的合取。

**换端点/换模型时的重推公式**（写入字段描述与 AGENTS.md）：

```
N = min( (RPM ÷ 60) × T ,  (TPM × T) ÷ (60 × K) ,  文档粒度需要 )   ← 本机实测膝点 8
T = 单次抽取延迟（本机 11.15s），K = 每次 token（本机 ~1.9K）
```

## 3. 设计

### 3.1 D1 并发结构（已裁：结构性）

`graph/indexer.py::index_document_graph` 的 `for chunk in pending`（`:146`）改为：

- `asyncio.Semaphore(N)` + `asyncio.gather`，每 chunk 一个协程任务，任务体 = 现循环体原样（`extract_graph` → 实体名 embed → `normalize_extraction` → `graph_store.upsert_entities/relations` → `store.update_chunk_extract`）；
- 每任务**返回**本 chunk 的结算（done/empty/failed + 实体名列表），主协程统一合并 `backfill` / `touched_entities` / `stats`，**结尾的两笔批写保持现状一次执行**（`set_chunk_entities` `:181-182`、实体向量批 `:186-202`）；
- 单 chunk 失败隔离与现在相同（`ExtractionError` → `extract_status=failed` + 继续），断点续跑的 `pending` 过滤（`:132`）不动。

### 3.2 D2 并发数来源（已裁 = 甲）

**甲：新配置项 `rag.extract_concurrency`，默认 8**（`ge=1, le=32`；32 是防呆上限）。理由：N 随抽取端点的档位/延迟而变（§2 公式），固定魔法数换端点就失真；默认 8 有本机实测背书。**读取时机跟 `table.card_mode` 先例**（`worker.py:518` 每次解析前 `get_app_config()` 现读）：worker 在进入图谱腿时现读，改配置**热生效**、免重启。乙（代码常量）已否：撞档位配额时无处可调。

### 3.3 D3 瞬态 LLM 错误兜底（已裁 = 乙）

**现状缺陷（并发会放大它）**：`index_document_graph` 只捕 `ExtractionError`（JSON 解析失败）；限流/超时这类 API 级错误会穿透到 `worker.py:416` 的 `except Exception`，把**整篇文档打成 failed**（靠 retry 端点恢复）。并发 N 路后撞 429 概率同倍增长。

**乙：`extract_graph` 内对 API 级瞬态错误退避重试 2 次（0.5s×2ⁿ，与 `embedder_openai.py:198-214` 同风格），仍失败则按 chunk 软失败**——记 `extract_status=failed` + `error` 原因、继续其余 chunk（与 `ExtractionError` 同路径）。甲（只软失败不重试）已否：偶发 429 会让 chunk 白丢一次抽取；丙（维持现状）已否：整篇打挂的失败面配不上并发化。注意 `factory.py:402` 的 `max_retries=1` 不动——重试预算收在抽取这一层，不放大到所有模型调用。

### 3.4 D4–D6 边界（已裁）

- **D4**：gleaning 那一轮**留在 chunk 内部串行**（对话式追问，第二问带第一答，不可并行）——每 chunk 仍 2 次调用，chunk 与 chunk 之间并行。
- **D5**：每 chunk 的实体名 embed（`:166`）**一期不攒批**（N 路下已是 N 个并行 embed 调用，够用）；攒批列二期。
- **D6 非目标**：不与向量腿并行（向量腿秒级，重叠收益小、进度模型要重写）；不动生成 wiki、解析缓存、`worker_concurrency`、`gleaning_rounds`；不恢复限速旋钮。

### 3.5 进度与并发安全（不变式）

`progress_callback` 的 `settled` 计数（`worker.py:348-350`）在并发下的安全性：`settled += 1` 与 `await _report()` 之间没有让出点竞争窗口（asyncio 协作式调度，单线程），计数保持**单调**；任务完成顺序不定 ⇒ 现有用例的顺序型断言改为**集合语义**断言（见 §4）。

## 4. 测试计划（TDD，先红后绿）

改造面：`backend/tests/knowledge/graph/test_graph_indexer.py`（现有用例先改集合语义）+ `backend/tests/test_rag_config.py`（新字段默认值/校验，沿用被删旋钮留下的用例位）。

**RED（并发化前先写）**：
1. **并发上限生效**：桩 LLM 记录在飞峰值，C=12、N=4 时峰值 >1 且 ≤4；
2. **结果集等价**：混合 done/empty/failed 的 chunk 集，乱序完成后 `stats`/落库内容与串行版逐项相等；
3. **进度单调**：`progress_callback` 序列单调不减且终值 = total；
4. **瞬态软失败**：桩 LLM 第 1 次抛 APIError、第 2 次成功 ⇒ chunk 照常 done；连续抛 ⇒ 该 chunk `failed`、其余 chunk 不受影响、文档不整体打挂。

**GREEN 后回归**：`tests/knowledge/graph/` 全套 + `make lint`。

## 5. 验收（真栈，前后对照）

同一篇 13 chunk 级 docx 重传（或 retry 复用），记图谱腿墙钟：

| 指标 | 验收线 |
|---|---|
| 图谱腿墙钟（13 chunk 篇） | **≤ 90s**（串行口径 ~290s；目标 ~40s） |
| `extract_status=failed` chunk 数 | 与串行基线持平（并发不新增失败） |
| 两文档并发上传（worker_concurrency=2） | 总时长不劣于两篇串行之和 |

## 6. 影响面

- 源文件 3 个：`knowledge/graph/indexer.py`（循环并发化）、`knowledge/graph/extractor.py`（D3 重试）、`config/app_config.py`（新字段）+ `knowledge/worker.py` 传参一处；
- 配置面 1 个新键：`rag.extract_concurrency`（默认 8，热生效）；`config.example.yaml` rag 块与 `backend/AGENTS.md` 旋钮表同步；
- 对外 API、表结构、Qdrant、检索三路：**零变化**。
