# MinerU 4.x 解析线 · Task 5 应用级端到端（2026-09-24）

计划：`docs/superpowers/plans/2026-09-24-mineru-4x-parse-adaptation.md`（Task 5）。
性质：**驱动用户本机的真栈**（前端 `localhost:3000` + 网关 `:8001`，无 nginx），解析腿打到本机自建的 4.x 服务（`127.0.0.1:8000`，Task 1 起的那一个）。所有 UI 交互都在隐藏窗口下用 `evaluate_script` 合成事件完成（真实点击不可用），同源 API 调用带 `X-CSRF-Token`。

## 前提

| 项 | 值 |
|---|---|
| 服务 | `GET /v1/health` → 200 `{"status":"ok","version":"4.0.7",...}`（跑完后按原命令重启，仍在运行） |
| 启动命令 | `cd /e/app-mode/mineru-4x && MINERU_HOME='E:/app-mode/mineru-4x/home' MINERU_MODEL_SOURCE=modelscope ./venv/Scripts/mineru-api.exe --host 127.0.0.1 --port 8000 --tier flash --upload-dir 'E:/app-mode/mineru-4x/uploads'` |
| 目标库 | KB **测试2** `5f532d371666482886453c62c4f13c1a`（可写库；测试1 未触碰） |

## 设置页 → 保存 200

功能模型页终态路由 `/workspace/chats/new?settings=models`：解析提供方 `MinerU 官方云 → 本地 MinerU 服务`、本地服务地址 `http://127.0.0.1:8000`、解析档位 `flash` ⇒ `PUT /api/rag/config` **200**，`rag_config.json` 精确新增 `parse_provider` / `parse_base_url` / `parse_tier` 三键（原十键逐字未动）。保存后重载页面回读，三行与文件一致。细节见 `ui-snapshots.txt`。

## 正样本（上传 PDF → 解析）

夹具：`acceptance-small.pdf`（一页：标题 + 一句话 + 1 行表格 + 一幅栅格图；sha256 `de17c495…062a`），另有一份内容更满的 `acceptance.pdf`（sha256 `ef85f5f5…c55e`）用作负向①/②的载荷。两份都在仓外 `E:\app-mode\mineru-4x\evidence\task5\`，由 `make_acceptance_pdf.py` 生成。

**解析腿本身跑通了，逐条有证**：

- **服务端日志**（`service-log-excerpt.txt`）留下我们客户端打出的完整 4.x 序列：`POST /v1/uploads 200` → `PUT /v1/uploads/upload_a43b36e4…/content 200` → `POST …/complete 200` → `POST /v1/parse/jobs 202` → `GET /v1/parse/jobs/job_3f55a1c1…` → `GET /v1/files/file-7f6e33fc…/content 200`。
- **切片内容**：3 个切片，含 GFM 管道表（表头 + 分隔行 + 数据行）与 `![](images/page_0_image_6.jpg)` 引用。
- **图片落盘 + 可就地渲染**：`…/images/page_0_image_6.jpg` 在文档目录落盘 134109 B，应用自己的文件端点回 `200 / image/jpeg / 134109 B`（与磁盘逐字节同尺寸）；另有 MinerU 附带的表格裁片 `page_0_table_4.jpg`。

**未达成的那半条：文档状态没有走到 `ready`。** 失败不在解析腿，而在 **graph 腿的嵌入调用**，且是**本机这套配置的既有条件、与本线无关**：

- 文档记录 `error` = `embedding endpoint HTTP 400: … batch size is invalid, it should not be larger than 10.`，`path_status = {vector: done, graph: failed}`；`vector: done` 正说明解析 → 分块 → 切片嵌入都过了。
- 机制：`embedding_provider = openai-compatible`（`rag_config.json`）走的 `OpenAICompatibleEmbedder` 默认 **20 行/批**（`embedder_openai.py:42 DEFAULT_BATCH_LIMIT = 20`，且无配置旋钮）；而 `text-embedding-v4` 在 DashScope **兼容端点**上**硬上限 10 行**——本机用它自己的 key 直打实测：**10 行 → 200（1024 维）、11 行 → 400、20 行 → 400**，报错原文与文档记录一致。
- graph 腿一次调用就要嵌完整批实体（`graph/indexer.py:92/:163` 一次嵌一组抽取结果，`:187` 一次嵌本次触达的全部实体），行数超 10 ⇒ 必然 400 ⇒ 外层把文档判 `failed`（`worker.py:396-401`）。`rag.graph` 没有「关掉」的开关，所以这条腿无法跳过。
- 时间线佐证：KB 里 5 份 `ready` 文档的摄入时间都早于 `rag_config.json` 的 mtime（文档 2026/09/23 00:16 / 09/13，配置文件 **2026/09/23 03:47**）⇒ 换成 openai-compatible 之后这批配置还没跑成过一次摄入。
- 影响力：这不是本对引入的（本对一行都没碰嵌入面），但它**当前让任何摄入都到不了 `ready`**，属实的既有阻塞项，登记给用户裁决。

## 负向 ①：服务停掉再上传 ⇒ 错误带地址

停服务（`TaskStop` + 端口实测 `000`）后上传 `acceptance-service-down.pdf` ⇒ 文档 `failed`，`error` 原文：

```
本地 MinerU 服务不可达（http://127.0.0.1:8000/v1/uploads）：All connection attempts failed
```

服务端此时无日志（服务已停），证据就是客户端这条错误本身。随后按原命令把服务重启（`/v1/health` 复 200，见上表）。

## 负向 ②：档位服务不了 ⇒ 服务端 400 原文

设置页把解析档位切到 `standard`（服务端是 `--tier flash`）→ 保存 200（文件 `parse_tier: "standard"`）→ 上传 `acceptance-tier-standard.pdf` ⇒ 文档 `failed`，`error` 原文：

```
本地 MinerU HTTP 400: {"error":{"type":"invalid_request_error","code":"invalid_request","message":"Tier 'standard' not available in this server","param":null}}
```

服务端日志同时留下 `POST /v1/parse/jobs HTTP/1.1" 400 Bad Request`。随后把档位切回 `flash` 并保存 200。

## 还原与收尾

- `rag_config.json` 按原十键重写并**逐字节核验**：622 B / md5 `b0cc81b51c409225e26a737ee78f50b8`（= 首次保存前读到的 md5）。
- 4.x 服务按原命令重启并保持运行（`/v1/health` 200）。
- Launcher 桩（`serve_fixture.py`，`127.0.0.1:8791`）在验收期间提供夹具字节，跑完仍在后台；它只读夹具目录。
- KB 测试2 里留了四份验收文档（三份 `failed` + 一份 `failed` 但切片齐），未删——它们是本任务的现场证据，用户可随时在「知识库 → 测试2」里删。

## 文件

| 文件 | 内容 |
|---|---|
| `make_acceptance_pdf.py` | 两个夹具的生成脚本（Chrome headless 印 PDF；输出到仓外 `E:\app-mode\mineru-4x\evidence\task5\`） |
| `serve_fixture.py` | 带 CORS 的只读桩，供页面取夹具字节（`127.0.0.1:8791`） |
| `doc-records.json` | 四份验收文档的记录（status / path_status / error 原文） |
| `ui-snapshots.txt` | 设置页三行读数（保存前 / 保存后 / 重载后）、知识库列表、失败行的 hover 卡片与抽屉、切片与图片端点的实测 |
| `service-log-excerpt.txt` | 4.x 服务日志摘录（含负向②的 400 行与正样本的完整六步） |
| 夹具（仓外） | `acceptance.pdf` sha256 `ef85f5f5a88ce234add3f484773bafa664bbf2df21d6e6c47405d2e6d75ec55e`；`acceptance-small.pdf` sha256 `de17c495100489e60b0e6c05e1cee684de7a2cc3b3b07780b9be7292b339062a` |