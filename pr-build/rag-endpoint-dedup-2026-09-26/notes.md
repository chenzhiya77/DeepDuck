# rag-endpoint-dedup 真栈腿证据（2026-09-26）

本机一次性 HTTP 桩（`serve_stub.py`，零出网；跑完即停）：OpenAI 形状 1024 维
`/v1/embeddings` + Jina 形状 `/v1/rerank`（并服务裸 `/rerank`），逐请求记路径。

驱动 `drive.py` 走**未经修改的保存期探针** `_probe_after_save`（= `build_embedder` + 一次真实
embed 调用）与两腿直连；结果 `results.json`、路径 `requests.log`。

| 腿 | 地址形态 | 结果 |
| --- | --- | --- |
| 探针 · 嵌入 | 生态 base `…/v1` | `warning = null`（**已验证**） |
| 探针 · 嵌入 | 整端点 `…/v1/embeddings` | `warning = null` |
| 探针 · 对照组 | 旧拼接产物 `…/v1/v1`（= 旧代码为 `…/v1` 输入拼出的形态） | warning = `未能验证：未能连通（EmbedderError）：embedding endpoint HTTP 404`（桩按预期 404） |
| 重排 · 直连 | 生态 base `…/v1` | pairs `[[0, 0.9]]`，路径 `/v1/rerank` |
| 重排 · 直连 | 整端点 `…/rerank` | pairs `[[0, 0.9]]`，路径 `/rerank` |

`requests.log` 逐字：

```
/v1/embeddings      ← 探针（生态 base）
/v1/embeddings      ← 探针（整端点）
/v1/v1/embeddings   ← 对照组（两段 /v1，桩 404）
/v1/rerank          ← 重排（生态 base）
/rerank             ← 重排（整端点）
```

备注：首跑时桩只服务 `/v1/rerank`，重排整端点那一发被桩 404（**桩的缺口，非产品缺陷**）——
已补服务裸 `/rerank` 后全过；这段原样记，别当回归。
