# RAG provider 适配线 · 真服务冒烟（2026-09-23）

计划：`docs/superpowers/plans/2026-09-14-rag-model-provider-adaptation.md`（Final verification 的"真实服务"两手）。
用户裁定：**腿2（本地 MinerU）先挂**，本轮只做腿1（重排）+ 腿3（嵌入）。
环境：本机真栈（frontend `:3000` / Gateway `:8001` / Qdrant `:6333`），知识库「测试2」。密钥一律未落盘到本目录（`rag-config-after.masked.json` 已脱敏、目录做过泄漏自检）。

## 腿3（嵌入 → `openai-compatible`）✅ 已接

| 步骤 | 结果 | 证据 |
|---|---|---|
| 端点/维度预打真接口 | `text-embedding-v4` @ `https://dashscope.aliyuncs.com/compatible-mode` → **200、1024 维** | `dashscope-compat-embed-probe.json` |
| 设置页保存（provider 切 `openai-compatible`、稀疏来源切 `本地 BM25`） | 200；保存期探测的 warning 见下"踩坑②" | — |
| 重建索引（界面「设置 → 重建索引 → 目标知识库=测试2」） | `202` → 一串 `POST …/compatible-mode/v1/embeddings 200` → `last_run: succeeded` | `gateway-log-reindex-embeddings.txt` |
| ④ 检索验证 | 召回向量通道 #1 = 该行卡（671 ms）；对话答「128 / 399 元」带引用 | `recall-test-after-reindex.txt`、`chat-after-reindex.txt` |

## 腿1（重排 → `generic-rerank`）✅ 已接

| 步骤 | 结果 | 证据 |
|---|---|---|
| 形状预打真接口 | `POST {base}/rerank` + `{model,query,documents,top_n}` → 认 `results[].relevance_score`；Jina 模型 `jina-reranker-v2-base-multilingual` 实测 **200**（0.85 vs 0.06，排序合理） | `jina-rerank-probe-ok.json` |
| 旧 key 失效 | `.env` 原 `JINA_API_KEY`（17 字符）直连/代理均 `401 AUTH_INVALID_API_KEY` | `jina-rerank-probe.json` |
| 新 key（用户提供）→ 文件层 | `rag_config.json` 的 `rerank_api_key`（+两份 .env 的 `RAG_RERANK_API_KEY`） | — |
| 界面切换并保存 | 重排行：`通用重排` + 模型 + `https://api.jina.ai/v1` → 200，无 warning | — |
| 链路验证 | 召回向量通道 **1094 ms**、#1 仍是该行卡（分数换了一批：0.743/0.314/0.271/0.264/0.156，对照切换前 0.938/0.445/0.386/0.356/0.350） | `recall-after-rerank-switch.txt` |
| 网关日志 | `POST https://api.jina.ai/v1/rerank "HTTP/1.1 200 OK"`（切换前同位置是 `dashscope.aliyuncs.com/compatible-api/v1/reranks`） | `gateway-log-rerank-switch.txt` |

- DashScope 兼容 rerank 是**复数路径** `/compatible-api/v1/reranks`（实测 200，形状同款），与 generic 客户端固定的 `/rerank` 不匹配（单数实测 404）⇒ **顶不上，必须第三方服务**（`dashscope-rerank-plural.json` / `-singular.json`）。

## 两条踩坑（可复用）

1. **`.env` 里有失效 key**：兼容面对 `DASHSCOPE_API_KEY` / `DASHSCOPE_JUDGE_API_KEY` 回 401，有效的是 `DASHSCOPE_EMBEDDING_API_KEY` / `DASHSCOPE_RERANK_API_KEY`（逐把实测）。00:26 日志里那条 caption 401 就是它。
2. **进程 env 是启动快照**（dotenv `override=False`）：改 `.env` 后网关不认新值（保存期探测一路 401）⇒ 显式值写 `rag_config.json`（文件层，优先级 > env）立即生效，**无需重启网关**。

## ⚠️ 登记（三件）

**① 换 provider 后图谱/百科腿跨空间**

`reindex.py` 的注释与实现都只重嵌**切片**（`index_chunks`），**不碰 entity / wiki 向量** ⇒ 换嵌入 provider 后：向量腿正常，图谱腿实体匹配失效（本查询证据 **6→0**）、百科腿分数 ~**0.29→0.04**。设置页那句"重建索引，否则检索质量会下降"的承诺比实现宽 —— 属已知范围（spec §5 只承诺切片），但值得后续登记（要么补 entity/wiki 重嵌，要么把文案说窄）。

**② 召回面板的分数来源标签写死**：`app/gateway/services/knowledge_service.py:1064` 的 `_RECALL_SCORE_TYPES = {"vector": "qwen3-rerank relevance", ...}` 是硬编码 ⇒ 换重排 provider 后界面仍显示「qwen3-rerank relevance」（本次实测：标签写 qwen3-rerank、实际跑的是 Jina）。建议按当前 `rag.rerank_model` 派生，或不带型号只留「reranker relevance」。

**③ UI 标签里的 "TEI 形状" 待核**：重排 provider 的下拉文案是「通用重排 (Cohere / Jina / TEI 形状)」，而我们客户端读的是 `results[].relevance_score`（Jina/Cohere 系）。TEI 的 `/rerank` 若回裸 `[{index, score}]`（印象如此，未逐字核），该标签会误导 —— 值得对 TEI 文档核一次，或把标签缩到 Jina/Cohere。

## 配置漂移

`config.yaml` 未动（md5 与 `md5-before.txt` 一致）；`rag_config.json` 按预期变化：`embedding_provider/model/base_url/sparse_source` + `embedding_api_key`（脱敏版见 `rag-config-after.masked.json`）。