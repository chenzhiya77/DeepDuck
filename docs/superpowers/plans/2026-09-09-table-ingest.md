# 表格文档入库实施 plan（2026-09-09）

对应 spec：`docs/superpowers/specs/2026-09-09-table-ingest-design.md`（章节引用以「spec §N」
标记）。任务按序执行；每任务 RED → GREEN → revert proof → 提交。

验证基线（对齐视频 plan）：后端 `cd backend && uv run pytest tests/knowledge -q`（沙箱需
`--basetemp=.pytest-tmp/<sub>` + PYTHONPATH/PYTHONIOENCODING/PYTHONUTF8 三 env，Makefile 同款）
+ `ruff check/format` 双净；前端 `python ../scripts/pnpm.py check` + `test run tests/unit/knowledge`。

架构基调（spec §3）：parser 归一 → chunker 表格感知 → worker 零改动 → 复用现有三通道。
**无新 store 表、无新 path_status 腿、无 resume**——比视频轻。

## Task 0: MinerU 表格语法实测门（spec §5/§11）

**目的**：冻结「parser 是否需要 HTML→GFM 归一器」这一唯一实测未知项。

- [x] 用一份含表格的真实 PDF 跑 MinerU 云 API v4 + `model_version="vlm"`（`MINERU_API_TOKEN`
      就位），抓取 `full.md`，确认表格实际语法：GFM 管道表 / HTML `<table>`。
- [x] 结论写回 spec §5/§11（归一器是「必需路径」还是「幂等 no-op 安全网」）。
- [x] ~~无 token/网络时的降级预案~~ **未触发**：token + 网络均就位，实测门已真跑（两次）。
      归一器仍按「无论如何都实现」推进（HTML→GFM + 幂等 no-op），chunker 对残留 HTML
      `<table>` 做原子块防御（spec §6）。

### 实测结论（2026-09-09，已冻结进 spec §1/§5/§6/§11）

**取证**：自制单页 PDF（一张普通 4×5 表 + 一张含 rowspan/colspan 合并单元格的表 + 一行含
shell 管道符的散文），无第三方 PDF 库、纯字节手写；走生产 `parse_document`（v4 + 默认
`model_version="vlm"`，即 `worker._reparse_and_chunk` 的真实路）跑两次（带/不带表头底纹）。
另从 live DB 只读扫描 16 份已入库文档的 `chunks.text` 作旁证。产物：
`pr-build/t0-mineru-table-gate/`（两份 PDF + 两份 `full.md` + 两份运行日志 + 两个探针脚本）。

1. **语法定调：HTML `<table>`，不是 GFM。** 两次实跑 + DB 中 7 张历史表格（docx 路）全部为
   HTML；GFM 分隔行/管道行命中数 **0**。→ **Task 2 的 `_normalize_tables_to_gfm` 是必需路径**，
   不是幂等 no-op 安全网（no-op 分支仅对用户 authored `.md` 有意义）。
2. **两种形态都要吃**：PDF 路无 `<thead>`/`<th>`（**表头 = 首个 `<tr>`**、单元格无嵌套标签、
   整表压在一行）；docx 路有 `<thead><th>` 且单元格内嵌 `<p>`/`<strong>`，**单格可多个 `<p>`**。
3. **行宽不齐真实存在**：`colspan="3"` 行只回 **1 个 `<td>`** → 归一器必须按表头列数补空/截断，
   否则不是合法 GFM、前端渲染不出真表格（破 spec §8 零改动前提）。
4. **合并单元格双表达**：显式 `rowspan="2"`/`colspan="3"`（PDF 路）**与**隐式空 `<td></td>`
   （docx 路）同时存在 → 扁平化规则对两者都要健壮。
5. **§1 的现状损坏拿到真实复现**：`3.java并发.docx` chunk `db10e8f7…#0011` `token_count` 恰为
   1024，HTML 表被从 `<td><p>` 标签中间截断；续块 `#0012` 仅 53 token 悬空尾巴且**无表头**。
6. **散文里的 `|` 不会被 MinerU 误判为表格**（实测 `cat sales.csv | grep north | wc -l` 原样
   输出）→ Task 4 的误伤风险面仅来自用户 authored `.md`，双条件 + fence 守卫仍必要。
7. **附带观察**：表头带灰色底纹时 VLM 把整行表头读成空 `<td></td>`（去底纹后完整）——上游
   保真度损失，归一器无法凭空补列名，已记入 spec §11 风险行；zip 内 2 张表格裁切图但
   `full.md` 无图片引用（不触发 caption 路）；`MINERU_ZIP_PROXY` 不可达时直连降级成功。

> 注：本任务不产代码，只产实测结论。探针脚本为一次性取证工具，置于 `pr-build/` 作证据留存，
> **不进产品代码路径**；Task 7 浏览器实测阶段可用真实业务 PDF 再补一轮旁证。

## Task 1: 配置门控与后缀并集（spec §4）

**Files:**
- Modify: `backend/packages/harness/deerflow/config/app_config.py`（`RagTableConfig`：
      `enabled=False` / `max_size_mb` / `card_mode: Literal["markdown","linearized"]="markdown"`；
      `RagConfig.table` 字段紧邻 `video:196`）
- Modify: `backend/packages/harness/deerflow/knowledge/parser.py`（`TABLE_UPLOAD_SUFFIXES`
      frozenset `{".xlsx",".xls",".tsv"}`；`table_ingest_enabled()`；`supported_upload_suffixes()`
      门控并入；`SUPPORTED_UPLOAD_SUFFIXES` 文本集**不动**）
- Modify: `config.example.yaml` + `config.yaml`（`rag.table` 注释段）
- Test: `backend/tests/knowledge/test_api.py`（门控两态：off 拒 `.xlsx` / on 收 `.xlsx`；`.csv`
      恒在；三后缀 `.xlsx`/`.xls`/`.tsv`；`max_size_mb` 体积门）

- [x] RED：门控两态用例 failed（端点恒返文本集）。—— 6 条新用例 RED（4 条
      `ImportError: TABLE_UPLOAD_SUFFIXES`、2 条 400≠202）。
- [x] Implement：配置段 + frozenset + 端点并集 + 体积门。
- [x] GREEN + revert proof（摘 `table_ingest_enabled` 门控 → 用例 RED）。—— 恢复后
      `tests/knowledge` + `tests/test_rag_config.py` 全量 **1005 passed / 2 failed / 2 skipped**
      （6m41s），ruff check + format 双净；revert proof 把 `table_ingest_enabled()` 摘成恒
      `return False` → 4 条 on 态用例 RED → 恢复。
- [x] Commit: `feat(rag): gate table upload suffixes behind rag.table.enabled`

### 交付纪要（2026-09-09）

- **预存缺陷顺手修了（本任务同一咽喉）**：三条 off 态门控用例（`test_api.py` 两条 +
  `test_parser.py::test_video_upload_suffixes_contract`）**开发机上本来就红**：它们声称「测试
  环境默认 off」却直读真实 `config.yaml`（本机 `rag.video.enabled: true`）。已改为双腿
  config stub（`_stub_rag_gates` / `_stub_gates`）——stub 必须同时带 video 与 table 两条腿，
  否则另一腿走 AttributeError 降级路，会把真实行为掩盖成「恰好也是 off」。基线从
  67 passed/3 failed → 79 passed/0 failed。
- **两个冻结细节**：①`max_size_mb` 默认 **50**（spec 只给 `ge=1` 未给值；电子表格远小于视频
  的 2048）；②**体积门只管被门控的三后缀**，`.csv` 不受 `rag.table.max_size_mb` 约束——它是
  既有文本集成员，spec §4「.csv 不门控」推到体积面就是不得为本特性给它新增限制（已用
  `test_table_size_gate_does_not_apply_to_csv` 钉死）。
- **额外覆盖面**（plan Files 未列、对标视频 Task 1 同名提交 `787e817e` 补齐）：
  `tests/test_rag_config.py::TestRagTableConfig`（6 例：默认值/覆盖/非法 literal/非法下界/
  两腿独立/**shipped config.example.yaml 的 `rag.table` 段能被模型吃下且值与文档一致**）；
  路由 `/supported-formats` docstring 补表格腿。`config.example.yaml` 新增注释段；`config.yaml`
  同步加 `table.enabled: false`（gitignored，仅本机；Task 7 实测时再开门）。
- **遗留的预存失败（与本任务无关，未动）**：`test_rag_config.py` 两条用例仍钉
  `vlm_model == "Qwen/Qwen3-VL-30B-A3B-Instruct"`，而 HEAD 上默认值已是 `qwen3.7-flash`
  （本次 diff 对这两个文件纯增量 +67/-0，未触碰该行）；`ruff format --check` 全仓另有一处
  预存未格式化文件 `tests/knowledge/tools/test_graph_search.py`（git 未修改，非本次引入）。

## Task 2: 分隔文本解析 CSV/TSV → GFM（spec §5）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/parser.py`（`_parse_delimited(path)`：
      标准库 `csv`、编码复用 UTF-8/GBK 回退 + BOM 剥离、`.tsv` 固定 tab / `.csv` Sniffer 嗅探、
      首行表头 → GFM 管道表；`parse_document` 把 `.csv`/`.tsv` 从 `_read_local_text` 改路由到
      `_parse_delimited`，`parser.py:322-323`）
- Modify（依 Task 0——**已实测定为必需路径**）: `parser.py`（`_normalize_tables_to_gfm(markdown)`：
      HTML `<table>`→GFM，仅 MinerU 分支调用；对已是 GFM 的输入幂等 no-op。**Task 0 冻结的四项
      必须覆盖**：①两形态（无 `<thead>`/`<th>` 时表头回落首 `<tr>`；单元格剥内嵌 `<p>`/`<strong>`
      且多段 `<p>` 以**空格**连接、绝不插换行；HTML 实体反转义）②**行宽按表头列数补空/截断**
      （`colspan` 行只回 1 个 `<td>`）③rowspan/colspan 扁平化 + 隐式空 `<td>` 容忍④表头全空
      （底纹表头失读）时不猜列名、退化为无列名行组）
- Test: `backend/tests/knowledge/test_parser.py`（CSV 逗号/分号 → GFM 表头+行；TSV tab；编码
      回退；空表/单行/无表头退化；HTML→GFM 归一含 rowspan/colspan 扁平化；**两形态 fixture 直接
      取 `pr-build/t0-mineru-table-gate/t0_mineru_full*.md` 的实测输出**（无 `<thead>` 形 / 嵌套
      `<p><strong>` 形 / colspan 行补齐 / 隐式空 `<td>`）；`.md`/`.txt` 原始直读回归不变）

- [x] RED → Implement → GREEN → revert proof。—— 28 条新用例 RED（27 条 ImportError/断言 + 1 条
      更新后的 CSV 逐字直读用例）→ 实现两函数 + 路由接线 → `test_parser.py` **61 passed**、
      `tests/knowledge` 全量 **1012 passed / 2 skipped / 0 failed**（5m57s）、ruff check+format 双净；
      revert proof 把 `_parse_delimited` 摘成原始 dump + `_normalize_tables_to_gfm` 摘成 no-op →
      **23 条 RED**（no-op/残留/本地守卫 6 条正确恒绿）→ 恢复 61 passed。
- [ ] Commit: `feat(rag): parse delimited text into GFM tables and normalize MinerU HTML tables`

### 交付纪要（2026-09-09）

- **实现落点**（`parser.py`，+265 行，纯增量；仅动 `parser.py` + `test_parser.py`）：
  - `_parse_delimited(path)`：复用 `_read_local_text`（UTF-8 严格→GBK 回退）+ BOM 剥离；`.tsv`
    固定 tab、`.csv` 用 `csv.Sniffer(delimiters=",;")` 回退逗号；首行表头 → GFM；行宽按表头补空/
    截断、跳过空行、空输入→`""`（worker 触发 `EmptyParseResultError`，与空文本一致）。
  - `_normalize_tables_to_gfm(markdown)`：`_find_table_spans` 栈匹配顶层 `<table>` 段（嵌套表标记后
    原样残留）→ `_TableCellParser`（`HTMLParser`，`convert_charrefs` 自动反转义实体；单元格剥内嵌
    标签、同级 `<p>` 以空格连接绝不换行、空白折叠）→ `_flatten_rows`（rowspan 值下沉、colspan 首列
    取值余列空、按表头列数补齐/截断）→ `_gfm_row`（字面 `|` 转义为 `\|`）。表头 `<th>`/`<thead>`
    优先、缺失回落首 `<tr>`；全空表头保留空列名（绝不臆造）。
  - 路由：新增 `_DELIMITED_SUFFIXES={.csv,.tsv}`，`parse_document` 先判分隔文本→`_parse_delimited`，
    再判 `is_local_suffix`→原始直读；`.tsv` 并入 `_LOCAL_READ_SUFFIXES`（永不触 MinerU）。MinerU
    分支在 `_relocate_trailing_title` 后追加 `_normalize_tables_to_gfm`（仅 MinerU 路，本地 `.md`
    绝不归一）。
- **冻结的实现决策**：①rowspan **下沉填充**（非留空）——检索行卡自足（`Widget A | Weight | 2.4 kg`
  优于空首列），spec §5「下沉填充或留空」二选一取前者；②colspan 首列取值、余列空（spec §5 明定）；
  ③底纹空表头 → 输出空列名 GFM（`|  |  |  |  |`），仍合法可渲染、绝不猜列名（spec §5 ④/§11）；
  ④单元格字面 `|` 转义 + 空白折叠 → 保证输出恒为单行合法 GFM（Task 4 表检测与前端 streamdown 渲染
  前提）；⑤嵌套/畸形表原样残留 HTML，交 chunker 原子块防御（Task 4，spec §6），归一器只吃 T0 两形态。
- **fixture 来源**：形态 A 两条（含 rowspan/colspan 的 plain + 底纹全空表头的 shaded）**逐字内嵌**
  `pr-build/t0-mineru-table-gate/t0_mineru_full{_plain,}.md` 实测输出（`pr-build/` 被 gitignore，故
  内嵌而非读盘，保 CI 自足）；形态 B（`<thead><th>` + 嵌套 `<p><strong>` + 单格多 `<p>` + 隐式空
  `<td>`）无 fixture 文件（源自 live DB docx 路观测），按 spec §5 实测样例构造。
- **顺手修的过时用例**：`test_parse_csv_local_read_gbk` 原钉「CSV 逐字直读」（`assert "苹果,3" in`）
  ——正是本任务升级的旧行为，已改钉 GFM 输出（GBK 回退仍生效）。`test_api.py` 两条 `.csv` 用例只验
  上传门控（202）+ stub worker，不触解析，未受影响。
- **遗留（与本任务无关，未动）**：`tests/test_rag_config.py` 两条 vlm_model 漂移失败（Task 1 已记录，
  在 knowledge 目录外）；`ruff format --check .` 全仓预存 `tests/knowledge/tools/test_graph_search.py`
  未格式化（非本次引入，未触碰）。

## Task 3: Excel 解析 .xlsx/.xls → 每 sheet 一张 GFM 表（spec §5）

**Files:**
- Modify: `backend/pyproject.toml`（加 `python-calamine`）
- Modify: `backend/packages/harness/deerflow/knowledge/parser.py`（`_parse_excel(path)`：延迟
      import `python_calamine`、缺失/门控 off 抛清晰降级错误、blocking 读取经 `run_file_io`、
      每 sheet → `## {sheet_name}\n\n<GFM 表>`、空 sheet 跳过、多 sheet 顺序拼接；`parse_document`
      加 Excel 分支）
- Test: `backend/tests/knowledge/test_parser.py`（fake calamine 覆盖多 sheet/空 sheet/表头推断/
      sheet 名进 `##` 标题；真实 `.xlsx` 端到端标 `skipif`——本机无 calamine 不阻塞回归，对齐
      视频 Task 3 skipif 纪律）

- [ ] RED → Implement → GREEN → revert proof（neuter `_parse_excel` → Excel 用例 RED）。
- [ ] Commit: `feat(rag): parse Excel workbooks into per-sheet GFM tables via calamine`

## Task 4: 表格感知 chunker（spec §6/§7，核心）

**Files:**
- Modify: `backend/packages/harness/deerflow/knowledge/chunker.py`：
  - `_split_by_headings:61` 增强：检测连续 GFM 管道表块（行 `^\s*\|.*\|\s*$` + 次行分隔行
        `^\s*\|[\s:|-]+\|\s*$`），代码 fence 内 `|` 不误判（复用 `in_fence`），块标记 `is_table`，
        表块作原子块保留。
  - **残留 HTML `<table>` 原子块防御**（Task 0 实测后升为必需兜底，spec §6）：归一器未覆盖的
        表形态可能残留 HTML（且 MinerU 整表压在**一行**），此时整段 `<table>…</table>` 作原子块
        保留、**绝不进 `_hard_split_tokens`**（live DB 已复现从 `<td><p>` 中间截断的损坏）；不做
        行组切分（无 GFM 表头可锚）。
  - 新增 `_chunk_table_block(path, header, delimiter, rows, max_tokens, card_mode)`：小表单块；
        大表贪心行组打包（表头+分隔+组内行 ≤ cap，目标 512±256）；**每块重复表头**；多块拆分时
        每块顶加溯源说明行 `表格：{名}（第 {起}-{止} 行 / 共 {N} 行）`；退化：单行+表头超 cap 时
        整行保留不中切。
  - `card_mode` 两态：`markdown`（默认，GFM 表格行）/ `linearized`（`列名: 值 | ...` 句子）。
  - 管线：`_split_by_headings`（tag 表格）→ 非表块 `_subdivide_oversized`（不变）→ 表块
        `_chunk_table_block` → `_merge_small_blocks`（表块已原子不拆）。`chunk_markdown:148`
        统一枚举保 `chunk_index` 连续、`chunk_id={doc_id}#NNNN`。
  - chunker 需读到 `card_mode`：经 `chunk_markdown` 新增可选参 `card_mode="markdown"`，worker
        调用点从 `get_app_config().rag.table.card_mode` 传入（worker 仅传参、无逻辑分支）。
- Test: `backend/tests/knowledge/test_chunker.py`（**最大测试面**：表头在每个行组 chunk 重复；
      小表单块；超宽行不中切；内嵌表继承 heading_path；Excel sheet 名进 heading_path；代码
      fence 内 `|` 不判为表；残留单行 HTML `<table>` 整块保留不中切（fixture 取 Task 0 实测输出）；
      card_mode 两态逐字钉死冻结模板（spec §7）；溯源说明行仅多块拆分带；
      chunk_index 连续 + id 合规 `[0-9a-f]{32}#\d{4}`；**非表格散文回归逐字不变**守现有行为）

- [ ] RED → Implement → GREEN → revert proof（摘表头重复 → 「每块含表头」用例 RED；摘表格检测
      → 表块回落硬切、散文回归恒绿）。
- [ ] Commit: `feat(rag): table-aware chunking with header-anchored row groups`

## Task 5: worker 兼容性验证 + eval 接入（spec §3/§9）

**Files:**
- Verify: `backend/packages/harness/deerflow/knowledge/worker.py`（文本腿零改动即处理表格文档：
      `path_status` 仍三腿 `{vector,graph,wiki}`、无新腿；`_reparse_and_chunk:432` 仅在
      `chunk_markdown` 调用处传 `card_mode`；`_is_video_path` 分支**不**新增表格类比）
- Create: `backend/tests/knowledge/eval/test_table_eval.py`（真实 store 建 fake 表格 KB：.csv/
      .xlsx 文档 → 行卡 chunk，用生产 `chunk_markdown` 组装 → 跑 `run_layer1_for_kb` + stub
      searchers → 断言 ①行卡 chunk_id 过 `add_question` golden 校验（零 schema 改造）②
      recall@k/hit_rate/path_accuracy 有数）
- Create: `backend/docs/table-kb-question-authoring.md`（按列值提问型 / 跨行聚合型不可锚定说明 /
      card_mode 消融对比流程，镜像 `video-kb-question-authoring.md`）

- [ ] RED → Implement → GREEN。（表征测试 naturally GREEN + revert proof 补牙：neuter
      `chunk_markdown` 生成不合规 id → `validate_question` 抛 `QuestionBankInvalidQuestion` →
      用例 RED → 恢复，对齐视频 Task 11 手法）
- [ ] Commit: `docs(rag): table KB question authoring guide and eval integration test`

## Task 6: 前端表面层（spec §8）

**Files:**
- Modify: `frontend/src/core/knowledge/supported-formats.ts`（`FALLBACK_SUPPORTED_SUFFIXES:7-20`
      += `.xlsx`/`.xls`/`.tsv`；后端端点仍是真源）
- Modify: `frontend/src/components/workspace/knowledge/file-type-badge.tsx`（`KIND_BY_SUFFIX`
      加 `.tsv: "sheet"`，xls/xlsx/csv 已在 `46-48`；可选补 sheet 的 `MIME_SPECS` 拖拽 accept）
- Verify: `frontend/src/components/workspace/knowledge/chunk-card.tsx`（`MarkdownContent:214-219`
      渲染 GFM 表格为真表格——预期零改动；若 streamdown 默认 remarkPlugins 不含 gfm 表格则显式加）
- Test: `frontend/tests/unit/knowledge/*.dom.test.tsx`（markdown 模式行卡渲染为 `<table>`；
      `.tsv` 落 sheet 徽章；linearized 模式渲染为文本行）

- [ ] RED → Implement → GREEN（`pnpm check` 双净）→ revert proof（stash 实现文件、留测试 →
      RED 同初始形；散文 chunk 渲染回归恒绿）。
- [ ] **prettier 陷阱**（对齐视频 Task 10 教训）：prettier 非本仓门禁、勿跑 `--write`，
      `pnpm check`（eslint+tsc）才是；匹配周围风格即可。
- [ ] Commit: `feat(frontend): spreadsheet suffixes and native GFM table rendering in chunk cards`

## Task 7: 收官——全量回归 + 浏览器实测 + 指南落档

- [ ] 后端 `pytest tests/knowledge -q` 全量 GREEN + `ruff check/format` 双净；前端 `pnpm check`
      双净 + knowledge 套件对基线（仅预存无关失败，如 chat-panel model selector / umap）。
- [ ] 浏览器实测：上传真实 `.xlsx`（多 sheet）+ `.csv` + 一份含表格的 PDF（补验 Task 0 实测门）
      → 五态到 ready → 切片抽屉行卡**渲染为真表格且每块含表头** → 对话检索命中正确行 →
      检索测试命中行卡 → 评测跑一轮表格 KB；核对 chunk_count 合理（无行爆炸）。截图落 `pr-build/`。
- [ ] Modify: `backend/AGENTS.md`（`### Knowledge Base / RAG` 小节补「表格入库」段：门控
      `rag.table.enabled` + `TABLE_UPLOAD_SUFFIXES` / parser 归一 CSV-TSV-Excel-MinerU 表格 → GFM /
      chunker 行组 + 重复表头 + card_mode 消融 / 无新 store 表无新腿 / chunk_id 扁平序进 L1）。
      对齐 orientation-layer 原则（模块+职责+契约口径，不含 commit hash/RED-GREEN/验收清单）。
- [ ] Commit: `docs(rag): sync agent guide for table ingest and smoke evidence`

## 风险登记（实施期新增即补此行下表）

| 风险 | 触发任务 | 缓解 |
|---|---|---|
| ~~MinerU 云 API v4 表格输出 HTML 而非 GFM~~ **T0 已实测坐实（非风险、是事实）** | T0 已关 / T2 承接 | 归一器升格为必需路径；两形态 + 行宽补齐 + span/空单元格双表达已冻结进 spec §5；chunker 残留 HTML 原子块防御仍做 |
| MinerU 对底纹/反白表头识别失败 → 表头整行为空 `<td></td>`（T0 实测） | T2/T4 | 上游保真度损失，不猜列名；退化为无列名行组，仍优于现状硬切（spec §11） |
| `python-calamine` 依赖安装/平台轮子问题 | T3 | 延迟 import + 缺失降级；真实端到端 skipif；CI 用 fake 不装重依赖 |
| 超宽表单行 + 表头 > 1024 token | T4 | 整行保留不中切、容忍轻微溢出（优于现状中切丢表头） |
| 巨型电子表格行爆炸 → chunk 数暴涨 | T4/T7 | 行组按 token cap 打包；`max_size_mb` 门口限流；实测核对 chunk_count |
| 表格检测误伤散文中的 `|`（如 shell 管道） | T4 | 需满足「行 + 次行分隔行」双条件 + 代码 fence 守卫；散文回归用例钉死。**T0 实测收窄**：MinerU 不会把散文里的 `|` 变成表格，风险面仅来自用户 authored `.md` |
