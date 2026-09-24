# 本地 MinerU 解析腿:迁到上游 4.x 契约 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-09-24-mineru-4x-parse-adaptation-design.md](../specs/2026-09-24-mineru-4x-parse-adaptation-design.md)
**Status:** 📝 **草稿（2026-09-24）** —— 未开工；三项已裁（D1 替换 / D2 `parse_tier` / D3 新起一对），**两项同日改判：① 部署 + 原始 curl 契约实证提前到 Task 1（甲）；② 客户端重写与配置面合并为 Task 2 的单个提交**（工厂 kwarg 与客户端构造签名是同一条链，拆开必留已知红的中间提交）。**✅ Task 0 已核（2026-09-24）——六项全勾、`实测` 已回填；两处更正：zip 图片前缀定案（`images/`，`_unpack_zip` 零改动）、API 侧没有「档位×扩展名」校验（真规则见 spec D8）。** 开工顺序：Task 0 → 1 → 2 → 3 → 4 → 5。
**Parent:** [2026-09-14-rag-model-provider-adaptation.md](2026-09-14-rag-model-provider-adaptation.md)（本对收它的**腿2**；该 plan :197 的挂起行已加本对注记）

**Architecture:** 一条腿四块 —— **① 客户端 + 配置面（Task 2，一个提交）**（`parse_local.py`：三步上传 → `POST /v1/parse/jobs` → 轮询 → 文件注册表取 zip → `_unpack_zip` → 归一化；`parse_backend` → `parse_tier`：`RagConfig` / `RagConfigFile` / 工厂 / allowlist 行，旧键剥离不建模）**② 前端**（表单字段/选项/「解析档位」行/i18n 三文件）**③ 文档**（README / backend AGENTS / example yaml / 研究档）**④ 部署 + 验收**（Task 1：本机起 4.x 服务 + 原始 curl 契约实证；Task 5：应用级端到端 + 两条负向）。

**硬约束（spec 已裁，实现时不许自行放松）：**

- **替换而非并存**（D1）：`mineru-local` 的 3.4.5 形状整体删掉，不留双实现、不留开关。
- **`mineru-cloud` 零改动**（云腿 `/api/v4` 流程一行不碰；既有守护用例继续绿）。
- **不引入上游依赖**：`mineru` 不进 pyproject；`mineru/parser/api_client.py` 只作调用序列参照。
- **结果只走 zip 一份**（D3）：`output_formats:["zip"]`，解包复用 `_unpack_zip`（`parser.py:658-671`）。
- **旧键处理**：`RagConfigFile.from_file()` 剥离 `parse_backend` + warning；**不**把它留成模型字段（`_build_response` 按 `model_fields` 反射，死字段会连带 `getattr(config.rag, …)` 炸）。
- **tier 值域**：`flash | basic | standard | advanced` + 空（空 = 服务端决定）；不做 `vlm/hybrid` 值映射（4.x 无语义对应）。
- **错误三件套沿用**（`MineruError` / `MineruParseFailedError` / `MineruTimeoutError`）；服务不可达带地址；401 带 `status`。

**Global Constraints:**

- 分支 `feat/rag-knowledge-base`；每个 Task：**RED → GREEN → neuter（带 revert proof）→ 门禁 → commit**（Conventional Commits）。
- **后端命令**：`cd backend && uv run pytest <paths>`（窄面）；`make lint`（ruff check + format）。全量跑法按既有口径（`.pytest-tmp` basetemp、后台跑）。
- **前端命令**：`cd frontend && PYTHONIOENCODING=utf-8 python ../scripts/pnpm.py <script>`；门禁 = `pnpm check` + `pnpm test`。
- **与 [2026-09-24-rag-retrieval-followups](../specs/2026-09-24-rag-retrieval-followups-design.md)（未开工）在 i18n 三文件上同文件 ⇒ 串行**（谁先开工谁先改；另一对开工前重读）。
- **每个 Task 的 `**实测**` 行必须回填**（RED 几条红 / GREEN 几条绿 / neuter 受害者 / 门禁数字）——未回写的 plan 不算交付。
- **不推送**（除非 operator 发话）。
- **scope fence（明确不做）**：服务端 `--api-key` 支持 · `local`/`url`/`inline` 源 · 多文件 job / `page_range` / `callback` · `html/latex/docx` · 上游包依赖 · 3.4.5 形状保留 · `_unpack_zip` 无谓重写（**Task 0 已定案：图片在 `images/` 前缀下 ⇒ 零改动**）。

**依赖顺序**：Task 0（只读核实）→ **Task 1（部署 + 原始 curl 契约实证；装不动 ⇒ 回落到 Task 5 由 operator 环境做，代码侧不受影响）** → Task 2（后端：客户端 + 配置面，一个提交）→ Task 3（前端）→ Task 4（文档）→ Task 5（应用级端到端验收）→ 交付后回写。

---

## Task 0 — 开工前核实（只读）

- [x] 1. **zip 图片前缀**（spec §4.4 开放项）：下载 `docvortex`（上游依赖 `>=0.4.24,<1`）读 `assets.validate_image_sidecar_path` 与 `export.materialize_middle` 的路径约定；确认 4.x zip 的图片条目在 `images/` 前缀下。若与云端不同 ⇒ 最小扩展 `_unpack_zip` 的收集条件（按官方客户端 `api_client.py:953-990` 的双候选规则），并在本 Task 记下结论。
- [x] 2. **job 校验层与 400 文案**：读 `mineru/parser/api_server.py` 里 `ensure_tier_supported_for_parse_extension` 的调用点，记下「tier × 扩展名不匹配」的实际 400 文案（Task 5 负向要用）；确认 `tier` 非法值也由服务端拒（我们的 Literal 只做本地防御）。
- [x] 3. **`parse_backend` 影响面全清单复核**：后端 `app_config.py:219-222` / `rag_config_file.py:103` / `parser.py:744` / `providers/__init__.py:127` / `test_parse_local.py`（**4 处**：:154/:257/:258/:259）/ `test_rag_provider_config.py:96/:124/:134/:245-251` / `test_rag_config_api.py:345/:352/:367` / `fixtures/rag_config/response_golden.json`（5 处）；前端 `config-form.ts:52/:108/:153` / `types.ts:49` / `functional-models-view.tsx:509/:1031-1040/:1057` / `locales` 三文件 `:1741-1742`(types) `:1729-1730`(zh) `:1823-1824`(en) / 测试 2 文件（`config-form.test.ts:76/:103/:449`、`functional-models-view.dom.test.tsx:236/:246`）；文档 `README.md:46/:113`、`backend/AGENTS.md:1176`、`config.example.yaml:2607`、`docs/PRE_RELEASE_HARDCODE_INVENTORY.md:167/:305/:343`。**逐条核一遍有没有漏掉的消费者**（support bundle / i18n manifest / 其它测试夹具），把差异回报。（已预扫：`MineruLocalParseProvider` 只出现于 allowlist + 本测试；support bundle 不露该字段；`contracts/` 无关——复核时确认即可。）
- [x] 4. **前端解析行现状复核**：条件渲染（`mineru-local` 才显示地址/档位行，`:1017`）、`OptionSelect` 的 `labels[option] ?? option` 兜底（`:146-147`）、`:236/:246` 两条 dom 断言的写法（`labelCount("parseBackend")`）。
- [x] 5. **部署条件探针（只探不装）**：磁盘余量、`uv`/Docker 可用性、网络可达性（**已实测 2026-09-24：HuggingFace 不通（HTTP 000）/ ModelScope 通（200）**；小模型包体积 ≈858 MB(ONNX) / ≈895 MB(torch)，ModelScope 上量的）；确认 `--tier flash` 的依赖预检要点（默认档 `standard` 需 torch/VLM 模块，基础包不给 `--tier` 会起不来——`mineru/parser/tier.py:63-77`）⇒ 结论写进 Task 1。
- [x] 6. **`upload_headers` 真实形态**：读官方客户端 `_same_origin_upload_headers`（`mineru/parser/api_client.py`）与上传内容处理（`mineru/parser/api_server.py:1743` 一带），确认 PUT 的目标 origin 与我们该带的头（我们无凭据，预计 = 响应给的 `upload_headers` 原样）。

**实测（2026-09-24 逐条回填；上游 clone `/tmp/mineru-407` @ tag `mineru-4.0.7-released`，docvortex 0.4.25 wheel 从 PyPI 解包读源）：**

- **① zip 图片前缀 = `images/`，已定；`_unpack_zip` 零改动。** 两条独立证据：`docvortex/export/_images.py:58` `path = validate_image_sidecar_path(f"images/{stem}{duplicate}.{extension}")`（stem = `page_{page_idx}_{kind}_{owner.index}`，即 `materialize_middle` → `ParseResult.save()` 这条、也就是 zip 用的那条）；`docvortex/export/bundle.py:38` `path = f"images/{sha256(payload).hexdigest()}.{extension}"`（model_output 外置）。markdown 侧的链接文本 = `join_asset_base_url("", image_path)` 逐字返回 `image_path`（`docvortex/render/_internal/markdown/assets.py`；再做一次 URL quote，而 `page_0_image_1.png` 全在 safe 集合内 ⇒ 恒等）⇒ **zip 条目名 == markdown 链接 == `ParsedImage.ref`**。官方客户端那条「不在 `images/` 下就再试 `images/{path}`」的双候选（`api_client.py:959-962`）是给**旧写法**兜底的，我们**不需要**；`_MEDIA_TYPES` 覆盖 png/jpg/jpeg/webp…（`parser.py:111-118`）与 docvortex 的 `_IMAGE_EXTENSIONS` 同族。
- **② ⚠️ 推翻了 spec/plan 的原判断：API 侧根本没有「tier × 扩展名」这条校验。** `ensure_tier_supported_for_parse_extension`（`mineru/filetypes.py:179`）**只有一个调用点 = CLI**（`mineru/kit/commands/parse.py:94`）；API 走的是 `batch_effective_parse_tier`（`filetypes.py:186-189`）：**扩展名是 flash-only 时静默改成 `flash`，其余原样**（不是报错）。API 侧**真实的** tier 错误只有三条（`mineru/parser/api_server.py:1921-1955`）：**503 `quality_tier_unavailable`**（请求不带 tier + 服务端没有默认质量档 + 整批不是 flash-only ⇒ 文案「No basic, standard, or advanced tier available in this server. Pass tier='flash' explicitly for flash parsing.」）、**400 `Tier 'X' not available in this server`**（显式档该服务端服务不了、且该批不能回落 flash）、**400「Flash parsing is disabled in this server…」**（`--no-flash` + 有 flash-only 输入）。另两条事实：**`--tier` 只收 `flash|basic|standard`（`SERVER_TIERS`，`types.py:114`）——`advanced` 不是启动档**，它由 `--tier standard` 一并服务（`TIERS_BY_SERVER_TIER`，`:120-124`）；**`--tier flash` 的服务端 `default_tier=None`**（`select_default_quality_tier` 只在 standard/basic 里挑，`:157-163`）⇒ **空 `parse_tier` + PDF = 503**（只有整批 flash-only 输入才能落 flash）。非法 tier 取值由 pydantic 拦（`CreateJobRequest.tier: Tier | None`）⇒ 422。
- **③ 影响面清单与 plan 一致，三处补记 + 三处否定**。补记：`parse_local.py:53`（注释点名 `rag.parse_backend`）/ `:116`（错误文案「未知的 parse_backend …」）在重写范围内，**新文案要改成 tier**；`providers/__init__.py` 里**没有** `parse_backend`（那行只改 `path`，plan 口径正确）。否定：**support bundle 无字段消费者**（`scripts/support_bundle.py:246-248` `collect_rag_summary` = `redact_data(_read_json(...))` 结构无关 dump）；**i18n manifest 不覆盖本命名空间**（只有 constitution/delivery/pulse/run-status 四个实例）⇒ 本线唯一的网仍是 `types.ts` 的编译期约束；**`README.md` 里 `parse_backend` 零命中** ⇒ Task 4 的 README 两处是**纯增补**（4.x 序列 + 档位口径），不是换键。
- **④ 前端解析行与 plan 逐条对上**：条件渲染 `:1017`（`values.parse_provider === "mineru-local"`，本地支三行 = 地址 Input / 档位 OptionSelect / token LockedBox，云端支反之）、兜底 `:146-147`、`PROVIDER_LABELS[""] = F.parseBackendAuto` 在 `:509`、dom 两条正是 `labelCount("parseBackend")`（`:236` =0 / `:246` >0；`labelCount` = `queryAllByLabelText(label).length`，`:131`，而 i18n mock 回**key 名**作文案 ⇒ 改键就得改这三处字符串）。**新发现**：`PROVIDER_LABELS` 被 **5 个下拉共用**（嵌入 `:595` / 重排 `:607` / 解析 provider `:1007` / 解析档位 `:1036`；sparse 另有自己的 map `:521-524`，注释点名「shared one borrows the parse backend's wording」）⇒ **改 key 名安全，改 `""` 的值会连带影响另外三行**（Task 3 里别顺手改文案）。
- **⑤ 部署条件（含一条会挡路的）**：`uv 0.11.2` ✓、`docker 29.6.2` ✓、**PyPI 通（200 / 0.86s）**、**ModelScope 通（302 / 0.20s）**、**HuggingFace 不通（000 / 12s 超时）** ⇒ 必须 `MINERU_MODEL_SOURCE=modelscope`。⚠️ **磁盘：C: 仅剩 4.8 GB（98% 满），E: 27 GB** —— 而 MinerU 的模型**不落 HF/ModelScope 缓存**，落 **`model.base_dir` = `$MINERU_HOME/models`（`mineru/config.py:37-44` / `:502`，`MINERU_HOME` 默认 `~/.mineru`）** ⇒ **Task 1 必须把 `MINERU_HOME`（连同 venv、`UV_CACHE_DIR`）放 E:**，否则 C: 会被撑爆。预检要点更正：`_preflight_tier_dependencies`（`api_server.py:2158-2168`）**`--tier flash` 直接 return（完全免预检）**；`basic` 要 `onnxruntime`（+ torch 模块，若小模型后端解析成 torch）；`standard` 要 `onnxruntime` + VLM 模块（除非配了远端 `vlm.server_url`）——**默认 `_DEFAULT_API_SERVER_TIER="standard"`（`:81`）**，所以基础包不带 `--tier` 会起不来。可用现成命令预热/校验：`mineru-kit models download|verify|show`（`docs/en/usage/model_source.md:33-40`），`MINERU_MODEL_SMALL_BACKEND` / `MINERU_MODEL_VLM_ENGINE` 可显式钉后端。
- **⑥ `upload_headers` = 服务端给的字符串映射，原样发。** 本地 `FileStore.create_upload`（`api_server.py:687-712`）→ `_make_upload_response`（`:858-877`）在 `pending` 时给 `upload_url = {base}/v1/uploads/{id}/content`、`upload_method="PUT"`、**`upload_headers = {"Content-Type": <mime>}`**；`status=="completed"` 只出现在 **sha256 去重命中**那条路（我们不发 `sha256sum` ⇒ 恒 `pending`，三步上传是必需的）。官方客户端 `_same_origin_upload_headers`（`api_client.py:1099-1112`）**只在同源时把鉴权头并进去**（`_http_origin` 比较 scheme/host/有效端口）——我们无凭据 ⇒ 用响应里的头即可。另记：官方 `_complete_upload`（`:401+`）对 `upload_already_terminal` 有重试 + `GET /v1/uploads/{id}` 回查，**薄客户端不做这套**（单次 POST，≥400 即报错），与 plan 的客户端骨架一致。

**⇒ 由 ② 引出的文档修订（本轮已改）：spec D8 重写为 API 侧真规则、§4.5 启动档口径 + flash-only 服务端要显式档的告诫、§5 负向② 换成可复现的那条（`tier=standard` 打 `--tier flash` 服务端 ⇒ 400 `Tier 'standard' not available in this server`）、§8 增一条登记；plan Task 5 负向② 同步。**

---

## Task 1 — 起本地 4.x 服务（部署 + 原始 curl 契约实证）

> **有副作用的一步**（已裁「甲」＝部署提前）：独立 venv 或 Docker，**不动主 venv、不碰 `config.yaml`**。约 **2 GB±** 下载（pip 依赖 + 小模型包；ONNX ≈858 MB / torch ≈895 MB，ModelScope 实测）。**本机实测（Task 0.5）：HuggingFace 不通（HTTP 000）、ModelScope 通（200/0.2s）、PyPI 通** ⇒ 必须 `MINERU_MODEL_SOURCE=modelscope`；**C: 仅余 4.8 GB、E: 27 GB ⇒ venv / `UV_CACHE_DIR` / `MINERU_HOME`（模型落 `$MINERU_HOME/models`）一律放 E:**。**若本机装不动 ⇒ 回落到 Task 5 由 operator 环境部署，Task 2–4 不受影响。**
> **验收对应**：spec §4.4 的实证答案（zip 布局）＋ §5 的 6 的前置条件。

- [ ] 装：`uv pip install "mineru>=4.0,<5"`（独立 venv，路径在**仓外** scratch，且**放 E:**——Task 0.5 实测 C: 仅余 4.8 GB；`UV_CACHE_DIR` 也指到 E:）；或 Docker（`docker/global/Dockerfile`）；**记下版本号与实际路径**。
- [ ] 起：`MINERU_MODEL_SOURCE=modelscope MINERU_HOME=E:\… mineru-api --host 127.0.0.1 --port 8000 --tier flash`（基础包必须带 `--tier`；`--tier` 只收 `flash|basic|standard`，`advanced` 由 `--tier standard` 一并服务）；`GET /v1/health` 通。**建议先 `mineru-kit models download --tier basic --source modelscope` 预热再起**（Task 0.5：`--tier flash` 免预检、模型落 `$MINERU_HOME/models`）。
- [ ] **原始 curl 六步**（完全不经我们的代码）：① `POST /v1/uploads`（JSON `{filename, bytes, mime_type, purpose:"parse"}`）→ ② `PUT` 上传内容（**记下 `upload_headers` 的实际形态**）→ ③ `POST …/complete` → ④ `POST /v1/parse/jobs`（`source.type=file_id` + `output_formats:["zip"]` + `tier:"flash"`）→ ⑤ 轮询到终态（记下 `output_files.zip.file_id`）→ ⑥ 下载 zip。
- [ ] **看 zip 内容**：确认 `markdown.md` 在、图片在 `images/` 前缀下（与 Task 0.1 的源码结论交叉验证）——**这是 spec §4.4 的实证答案**。
- [ ] 服务**保持运行**（供 Task 2 的客户端 smoke 与 Task 5 用）；证据落 `pr-build/mineru-4x-smoke-2026-09-24/`（版本/命令/health/六步请求响应片段/zip 清单）。

**实测（开工时回填）：**

---

## Task 2 — 后端一并交付：4.x 客户端重写 + `parse_backend` → `parse_tier`（**一个提交**）

> 动到的文件：`packages/harness/deerflow/knowledge/parse_local.py`（重写）、`knowledge/parser.py`（工厂那两行）、`config/app_config.py`、`config/rag_config_file.py`、`knowledge/providers/__init__.py`、`tests/knowledge/test_parse_local.py`（重写）、`tests/knowledge/test_rag_provider_config.py`、`tests/test_rag_config_api.py`、`tests/fixtures/rag_config/response_golden.json`。
> **验收对应**：spec §5 的 1 / 2 / 3。
>
> ⚠️ **为什么客户端与配置面必须是同一个提交**：工厂 `build_parse_provider` 传下去的 kwarg 与客户端的构造签名是**一条链**：客户端改收 `tier` 而工厂还传 `backend`（或反过来），保存期构造检查（`_reject_unusable_after_save` → `build_parse_provider`）当场 `TypeError`，`test_rag_config_api.py:343/:426` 两条 PUT 用例立刻红。拆两个提交就必然留一个**已知红的中间提交**；合并是一个用户可见行为变更（「这条腿按 4.x 说话、按档位配置」）的原子切法。RED/GREEN 在任务内部仍**分两波**做。

- [ ] **RED（波 A · 客户端契约）**：按 spec §4.2 的序列写契约用例（MockTransport）：① 上传三步（JSON 字段集 = `filename/bytes/mime_type/purpose`、**无 `sha256sum`**；PUT 带 `upload_headers`；complete 路径）；② job 请求体（`files[0].source == {"type":"file_id","file_id":…}`、`output_formats == ["zip"]`、**`tier` 仅在配置非空时出现**）；③ 轮询序列 queued → running → completed；④ zip 解包（`markdown.md` 被 `.md` 兜底接住、`images/*` → `ParsedImage`、ref 逐字一致）；⑤ 归一化两步仍在（文末标题搬迁 + HTML 表→GFM）；⑥ 错误面（不可达带地址 / `failed` 带原文 / `partial` 判失败 / 超时 / 缺 zip 或缺 markdown 报错 / 401 带 status）；⑦ 防御：未知 tier ⇒ `RagConfigurationError`；⑧ **两个照抄官方客户端的防御分支**——create 响应已是 `status:"completed"` 时短路取 `file.id`、`upload_url` 以 `/` 开头时前缀 `base_url`（我们不发 sha256sum，前者大概率不触发，但照抄更稳）。此刻实现还是 3.4.5 形状 ⇒ 红。
- [ ] **RED（波 B · 配置面）**：① 新用例 —— 含旧键的 `rag_config.json`（`{"parse_backend": "hybrid", …}`）**仍可载**且 `caplog` 里有 warning（剥离而非报错）；② `parse_tier` 收四值 + 空、拒 `vlm`/`hybrid`/`pipeline`；③ `PUT /api/rag/config` 带 `parse_tier: "flash"` round-trip 且 `sources` 标 `ui`；④ PUT 带旧键 `parse_backend` ⇒ **422**（extra_forbidden）；⑤ golden 夹具换键。此刻模型还是旧字段 ⇒ 红。
- [ ] **GREEN**：重写 provider（构造参数：`base_url` 必填、`tier` 可选、`client` / `poll_interval_seconds` / `timeout_seconds`；`_request` 的 JSON 包法沿用，二进制下载另走一条）；改 `RagConfig`（删 `parse_backend`、加 `parse_tier`）、`RagConfigFile`（同上 + `from_file()` 剥离旧键并 `logger.warning`）、`build_parse_provider` 传 `tier=`、allowlist 行 `path` 改 `/v1/parse/jobs`；同步 `response_golden.json`（该夹具是**「纯增」守卫**（`test_rag_config_api.py:443-470` 的 `_assert_pure_addition`）——**字段改名属有意的形状变更、不是违规**，夹具按新键更新即可）。
- [ ] **neuter ①（zip）**：把 `output_formats` 改回 `["markdown"]` ⇒ 波 A 的 zip 解包那组断言红。
- [ ] **neuter ②（tier）**：`tier` 无条件写进 job 体（空值也发）⇒ 波 A 的「仅配置时出现」红。
- [ ] **neuter ③（终态）**：终态判定放宽成「非 failed 即成功」⇒ 波 A 的 `partial` 那条红。
- [ ] **neuter ④（剥离）**：`from_file()` 去掉剥离步骤 ⇒ 波 B ① 转红（`extra_forbidden` 把文件判死）。
- [ ] **neuter ⑤（值域）**：`parse_tier` 的 Literal 加回 `"vlm"` ⇒ 波 B ② 转红。
- [ ] **门禁**：`cd backend && uv run pytest tests/knowledge/test_parse_local.py tests/knowledge/test_rag_provider_config.py tests/test_rag_config_api.py` 全绿；`make lint` 双净。
- [ ] **Commit**：`feat(rag): retarget the local MinerU client to 4.x and retire parse_backend`

**实测（开工时回填）：**

---

## Task 3 — 前端：`parse_tier` 字段、「解析档位」行、i18n 三文件

> 动到的文件：`src/core/rag/config-form.ts`、`src/core/rag/types.ts`、`src/components/workspace/settings/functional-models-view.tsx`、`src/core/i18n/locales/{types,zh-CN,en-US}.ts`、`tests/unit/rag/config-form.test.ts`、`tests/unit/components/workspace/settings/functional-models-view.dom.test.tsx`、`tests/unit/settings/functional-models.dom.test.tsx`（**顺手**：`:1234` 注释里的「解析后端」措辞改「解析档位」，非断言）。
> **验收对应**：spec §5 的 4。

- [ ] **RED**：① `config-form.test.ts` 换键（seed 空值 / 提交 `parse_tier` / **断言 `PARSE_TIER_OPTIONS` = 5 项、顺序 `""` + `flash|basic|standard|advanced`**）；② dom 用例 `labelCount("parseTier")`（`:236/:246` 改成新 key）；③ i18n 三文件加 `parseTier` / `parseTierAuto` / `parseTierHint`（zh 值按 spec §4.6 表）——`types.ts` 缺 key 时 tsc 当场红。
- [ ] **GREEN**：`config-form.ts`（字段类型 / `PARSE_TIER_OPTIONS = ["", "flash", "basic", "standard", "advanced"]` / `SELECT_FIELDS` / seed）、`types.ts`、`functional-models-view.tsx`（`PROVIDER_LABELS[""] = F.parseTierAuto`、行标签 `F.parseTier` + `info={F.parseTierHint}`、`update("parse_tier", …)`）、locale 三文件。
- [ ] **neuter（行条件）**：把档位行的条件渲染反转为「只在 mineru-cloud 下显示」⇒ dom 用例 :236/:246 红。
- [ ] **门禁**：`pnpm check` 净；前端全量 `pnpm test` 0 失败；全仓前端面 `parse_backend` 零残留（`Grep` 复核）。
- [ ] **Commit**：`feat(rag): expose the MinerU parse tier in the functional-model settings`

**实测（开工时回填）：**

---

## Task 4 — 文档同步

> 动到的文件：`README.md`（:46 / :113）、`backend/AGENTS.md`（:1176「Parse provider dimension」段）、`frontend/AGENTS.md`（核 :266 一带是否引旧字段）、`config.example.yaml`（:2607）、`docs/PRE_RELEASE_HARDCODE_INVENTORY.md`（未提交档，:167/:305/:343，顺手）。
> **验收对应**：spec §5 的 7。

- [ ] README 两处：轻客户端形态仍成立；补「上游 4.x」与 `parse_tier`（档位）口径。
- [ ] `backend/AGENTS.md:1176`：把「`POST /tasks` multipart → poll → `/result`」与 `parse_backend` 换掉，改成 4.x 序列（上传三步 / `/v1/parse/jobs` / 文件注册表 zip）+ `parse_tier`。
- [ ] `config.example.yaml:2607`：`# parse_tier:   # flash | basic | standard | advanced; empty lets the local service decide`。
- [ ] `frontend/AGENTS.md`：核一遍，如需改则改。
- [ ] `docs/PRE_RELEASE_HARDCODE_INVENTORY.md`：三处引用同步（该档未提交，属于顺手，不做阻塞）。
- [ ] **Commit**：`docs(rag): document the MinerU 4.x local parser`

**实测（开工时回填）：**

---

## Task 5 — 应用级端到端验收（设置页 → 上传 → 解析）

> 服务应在 Task 1 已起好；**若 Task 1 回落**（本机装不动）⇒ 按 Task 1 的口径先在本机或 operator 环境部署再走本任务。**无鉴权 ⇒ 只绑回环/内网**。
> **验收对应**：spec §5 的 6。

- [ ] 前提：`GET /v1/health` 通（Task 1 的服务仍在跑；版本号 / 启动命令 / 模型来源沿用 Task 1 记录）。
- [ ] 设置页切 `mineru-local` + `parse_base_url` + `tier=flash`（终态路由 `/workspace/chats/new?settings=models`）→ 保存 200。
- [ ] 端到端：上传一份 PDF → 文档状态 `ready` → 图片落盘并就地渲染 → HTML 表归一 GFM（切片抽屉里看行卡/正文）。
- [ ] 负向 ①：服务停掉再上传 ⇒ 错误里带服务地址（`MineruError`）。
- [ ] 负向 ②：把设置页的 `parse_tier` 切到 `standard`（服务端是 `--tier flash`）→ 上传 PDF ⇒ 服务端 400 原文 `Tier 'standard' not available in this server`（Task 0.2 实测更正：**没有**「档位×扩展名」那条 400——那是 CLI 的规则，API 侧对 flash-only 扩展名是**静默归一到 flash**）。
- [ ] 证据落 `pr-build/mineru-4x-smoke-2026-09-24/`（本任务的日志片段 / 结果快照 / 负向输出；版本与命令沿用 Task 1 证据；按 `jina_`/`sk-` 正则做泄漏自检）。

**实测（开工时回填）：**

---

## Final verification

- [ ] `cd backend && make lint` 双净 + 窄面全绿；全量按**当次基线**口径收（环境红条数随线走、不写死；判据 = **失败集合逐行 diff 不变**）。
- [ ] `cd frontend && pnpm check` 净 + 前端全量套件 0 失败。
- [ ] 老配置守护：`config.yaml` 只有旧字段可载；`rag_config.json` 含 `parse_backend` 可载 + warning（Task 2 用例覆盖）。
- [ ] 真服务证据齐：Task 1 的原始 curl 契约实证（六步 + zip 清单）+ Task 5 的应用级端到端与两条负向（并记录实际走的路径：独立 venv / Docker）。
- [ ] 本对 spec/plan 的 `Status` 翻「已实现 / 已交付」并回填全部 `**实测**` 行 —— 未回写的 plan 不算交付。

## 运行期遗留（不属本 plan 交付，供后续决策）

- **服务端 `--api-key`**：本客户端不支持（401 会以 `MineruError` 呈现）；要支持就是加一个可选 `parse_api_key`（加性）。
- **服务端并发默认 1**（`--concurrency`）：超出排队；我们的 `worker_concurrency=2` 不撞闸但可能排队——本 plan 只保持默认。
- **4.x 迭代快**（8 天 8 个稳定版）：契约钉在 `4.0.7`；升级时按 spec §4.1 重新核（路由 / 请求字段 / 终态集合 / zip 布局）。
- **`partial` 单文件语义**：按失败处理；验收时若发现单文件也会 `partial` 且带可用结果，回报再定。
- **`config.yaml` 里的旧 `parse_backend` 静默忽略**（pydantic 对未知键的既有行为，知情选择）。