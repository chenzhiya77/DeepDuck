# MinerU 4.x 解析线 · 原始 curl 契约实证（2026-09-24）

计划：`docs/superpowers/plans/2026-09-24-mineru-4x-parse-adaptation.md`（Task 1：部署 + 原始 curl 六步）。
性质：**完全不经我们的代码**——curl 直打自建 4.x 服务，为 Task 2 的客户端重写钉形状。

## 环境（全部在仓外 E:）

| 项 | 值 |
|---|---|
| 版本 | mineru **4.0.7** / docvortex **0.4.25** / CPython 3.12.13（uv 托管） |
| 安装 | `uv pip install "mineru>=4.0,<5"` → `E:\app-mode\mineru-4x\venv`（`UV_CACHE_DIR` 同根） |
| 模型 | `MINERU_HOME=E:\app-mode\mineru-4x\home`；`MINERU_MODEL_SOURCE=modelscope`；`mineru-kit models download --tier basic --source modelscope` ⇒ 819 MB 落 `home\models\MinerU-4_models_onnx`（`models verify` = 正常）；小模型后端 auto→**onnx**（省掉 torch 那 ≈895 MB） |
| 启动 | `mineru-api --host 127.0.0.1 --port 8000 --tier flash --upload-dir E:\app-mode\mineru-4x\uploads` |
| health | `{"status":"ok","version":"4.0.7",...,"sources":["file_id","url","inline"]}` |

## 六步（`smoke.sh`，样本 = `sample/`，86 KB 的 PDF）

| 步 | 请求 | 实测 |
|---|---|---|
| ① | `POST /v1/uploads` `{filename,bytes,mime_type,purpose:"parse"}` | `status:"pending"`、`upload_url={base}/v1/uploads/{id}/content`、`upload_method:"PUT"`、**`upload_headers={"Content-Type":"application/pdf"}`**、`file:null` |
| ② | `PUT upload_url`（带响应给的那个头） | **200** |
| ③ | `POST /v1/uploads/{id}/complete`（body `{}`） | `completed` + `file.id`（服务端回填 `sha256sum`） |
| ④ | `POST /v1/parse/jobs` `{files:[{source:{type:"file_id",file_id}}],output_formats:["zip"],tier:"flash"}` | 202 `queued`、`tier:"flash"`、`progress.total=1` |
| ⑤ | `GET /v1/parse/jobs/{id}` 轮询 | 4 次、约 8 s ⇒ `completed`（`parse.duration_ms=7827`、`parser_version=4.0.7`），取 `files[0].output_files.zip.file_id` |
| ⑥ | `GET /v1/files/{zip}/content` | 149,849 B zip |

**zip 清单**（`sample/06-zip-entries.txt`，spec §4.4 的实证答案）：

```
      559  markdown.md
     3238  middle_json.json
     2375  structured_content.json
   121243  model_output.json          <- 根级新成员，非 images/ 前缀（我们忽略）
    88413  images/page_0_table_2.jpg  <- 图片在 images/ 前缀下 ⇒ _unpack_zip 零改动
```

## 带真图的样本（`figure/`，验「引用名 == 条目名」）

第一个样本的表格被渲染成 GFM 管道表，markdown 里没有图片引用（那张 `page_0_table_2.jpg` 是内部裁片）。故补第二个样本（`make_figure.py`：文字 + 栅格图 → Chrome headless 印 PDF）：

- markdown 里 `![](images/page_0_image_3.jpg)`，zip 条目 `images/page_0_image_3.jpg` ⇒ **逐字一致**（见 `identity-check.txt` 的 `identity = True`）
- 即 `ParsedImage.ref`（取条目名）与 markdown 引用同源，解包后的链接不会 404。

## 其它实测事实

- `sha256sum` 是可选字段（`CreateUploadRequest`）：我们不发 ⇒ 恒 `pending`，三步上传必需。
- flash-only 扩展名（office/html/csv/epub/ofd）请求任意 tier 会被**静默改成 `flash`**（`batch_effective_parse_tier`）；PDF/图片是 tiered ⇒ 必须显式带服务端支持的档（本次 `tier:"flash"`）。
- 服务保持运行（`127.0.0.1:8000`），供 Task 2 的客户端 smoke 与 Task 5 端到端。
- 复现：`bash smoke.sh`（`RUN=<子目录> PDF=<path>` 可跑别的样本）。

## 文件

- `smoke.sh` / `make_figure.py` — 复现脚本
- `sample/` — 六步请求响应原文 + 轮询日志 + zip 清单 + 解包后的 markdown
- `figure/` — 第二样本的 zip 清单与 markdown
- `identity-check.txt` — 「引用名 == 条目名」的脚本输出