# RAG 工作簿内嵌图片提取（.xlsx）小对 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. 「实测」段回填真实命令与数字，不预填、不估算。

**Spec:** [2026-10-03-rag-workbook-image-extraction-design.md](../specs/2026-10-03-rag-workbook-image-extraction-design.md)
**Status:** ✅ **已裁（D1=甲 / D2=乙 / D3=甲）** —— 2026-10-03 成对起草、同日裁定；评审九项已并入（③=甲：caption 清洗=Task 3）；Task 0 已核 5 项（含 D2=乙 锚点语义 probe，下）；**Task 1 已交付**（窄面 15 绿 / neuter 3 红 / 整文件 88 绿 / ruff 双净）；**Task 2 已交付**（RED 11 红 / GREEN 窄面 25 绿 / neuter 4 红 / `tests/knowledge` 全套 1470 绿 + 2 条在册环境红）；可开工 Task 3。

**Architecture:** `.xlsx` 走本地腿不变（calamine 读行 + `sheet.start` 原点）；新增 stdlib 解析（`workbook.xml`→…→drawing XML 锚点 `xdr:from` + `a:blip r:embed`→drawing rels）取 `xl/media/*` → `ParsedImage(ref=images/…)`；锚点命中 ⇒ 图链接**并入该单元格文本**（`start` 归一；越界/绝对锚回退 sheet 段尾）；`_parse_excel` 改返 `ParsedDocument`；现配文腿/落盘链吃图（唯一配套=Task 3 caption 落笔前清洗）。

## 范围与交接

| 决策 | 本期落点 | 明确移出 |
| --- | --- | --- |
| D1 `.xls` 图片 | **已裁=甲**：不覆盖（`.xls` 纯文本 GFM，矩阵如实标注） | `.xls` 图片覆盖与矩阵该格补注 |
| D2 图片挂位 | **已裁=乙**：单元格级行列映射（越界/绝对锚回退 sheet 段尾） | 绝对锚/越界锚坐标精度；合并区修正 |
| D3 依赖 | **已裁=甲**：stdlib（zipfile + xml.etree） | — |
| caption 落表清洗（评审③） | **已裁=甲**：并入本对（`apply_captions`：先 `\`→`\\`，换行→空格、`|`/`[`/`]` 转义 + 用例） | 其余 caption/落盘/展示链改动 |
| RFC 两格升级 | Task 5（先重读全文——常手改） | L47「工作表与行来源」样例验收（归②批次，另账） |
| RFC 六处「需验收/验证」 | **0 处在本对**（本对只产图片能力证据，Task 5 升级 L47 两格） | L45 切分 / L45 标题定位 / L46 表格行来源 / L47 工作表行来源 → ②批次（L47 那条跟本对交付后同跑）；L48 逐组合 / L49 图片文档链 → ③批次 |

## 硬约束

- 改动两处：`parser.py` 工作簿腿 + `captioner.py::apply_captions` 清洗一处（评审③=甲）；worker/chunker 零改动。
- 零回归：无图 `.xlsx`/`.xls`/`.csv`/`.tsv` 输出逐字节不变；`_workbook_rows_to_markdown` 单参兼容（`test_table_eval.py:122`）。
- 零新依赖（D3=甲）；TDD + 门禁 `tests/knowledge` + ruff 双净。

## Task 0 — 起草时核实（5 已核）+ 动手前复核（2，2026-10-03 全绿）

已核（2026-10-03，起草时）：

- [x] ① **调用面**：`_parse_excel` 仅 dispatch（`parser.py:794`）与测试直调；`_workbook_rows_to_markdown` 另有单参调用（`test_table_eval.py:122`）⇒ 扩展须默认参兼容；`backend/AGENTS.md` 表格段引用它（Task 4 更新）。
- [x] ② **通道**：`python_calamine` 0.8.2 `dir` 无任何图片接口 ⇒ 提取走 zip+XML 自解析。
- [x] ③ **先例**：Dify / RAGFlow「仅 xlsx 抽图；`.xls` 纯文本」（源码核）——D1=甲 有据。
- [x] ④ **夹具**：venv 有 `openpyxl 3.1.5` + `Pillow 12.3.0` ⇒ 真 xlsx e2e 可直接造图（skipif 兜 CI）。
- [x] ⑤ **D2=乙 锚点语义 probe**（`E:\app-model\deer-flow-scratch\workbook-images\`）：openpyxl 锚=`oneCellAnchor`+`xdr:from`(col,row) 0-based、media Target 写**绝对** `/xl/…`；calamine `start=(2,1)`（B3 起数据）且 `to_python()` 以 start 为原点、空 sheet `start=None`（⇒ 全回退尾挂）。

动手前复核（2026-10-03 已跑）：

- [x] ① 装配点未漂移：dispatch 本地三分支（`parser.py:791-796`）与 `if parsed.images:` 两触发点（`worker.py:576` / `:590`）已重开核，未漂移。
- [x] ② 兼容面全绿（当次快照）：`cd backend && pytest tests/knowledge/test_parser.py tests/knowledge/eval/test_table_eval.py --basetemp=../.pytest-tmp -q` ⇒ **85 passed / 39.25s / 0 failed**（工作树仅无关文档改动，backend 代码干净）。

## Task 1 — 提取器（stdlib，TDD）

- [x] ① RED：夹具 helper（手造最小 OOXML zip：两 sheet、sheet 有无 drawing 各一、**oneCell+twoCell+absoluteAnchor 三形态、命中锚与越界锚各一、Target 绝对/相对各一**、两真图 png/jpeg、一 emf 引用、一悬空媒体、**一 `r:link` 外部链接图、一越界媒体（`xl/embeddings/…`）**）+ 用例：映射与字节/媒体类型；**锚点行列提取（twoCell 取 from；absolute→无锚）**；白名单滤（emf 跳过）；**`r:link` 跳过**；**越界媒体跳过（硬界）**；悬空/孤儿不取；**单件缺件（drawing/media）跳过不炸（件级）**；同媒体去重归首见；无 rels sheet 不炸；坏 zip 抛 `BadZipFile`。**实测：5 红 / 2 绿**（新 5 用例全因 `ImportError` 红）——落地为 `test_parser.py` 新区段（夹具 5 helper + 富夹具 7 锚 + 5 用例，插在 Excel 区段与 caption 区段之间）。
- [x] ② GREEN：`_xlsx_sheet_images(zf)`（rels 链 + drawing XML 锚点 + `r:embed`/`xl/media/` 双闸，返回 sheet→[(ParsedImage 素材, row|None, col|None)]）+ `_extract_xlsx_images(path)`（读字节；件级容错；入 `run_file_io`）。**实测：窄面 7 绿**。实现= `parser.py` 新增 `import posixpath`、`import xml.etree.ElementTree as ET`、5 命名空间常量 + 7 助手（`_rels_part`/`_resolve_part`/`_read_rels`/`_anchor_cell`/`_drawing_images`/`_xlsx_sheet_images`/`_extract_xlsx_images`）；`_extract_xlsx_images` 为 sync（`run_file_io` 包裹归 Task 2 调用方）；`_parse_excel`/dispatch 本任务零改动。
- [x] ③ neuter：断锚点解析一处（如 from 不读）⇒ 锚点用例红；还原。**实测：`from_el = None` ⇒ 3 红**（断言锚点的 maps/dedupes/skips_missing）+ 4 绿；已还原、窄面复绿。
- [x] ④ 窄面：`pytest backend/tests/knowledge/test_parser.py -k "xlsx or workbook"` 绿 + ruff。**实测：15 passed / 15.8s；整文件 88 passed 零回归；ruff check + format --check 双净（2 文件）**。

## Task 2 — 挂载与接线（TDD）

- [x] ① RED：**并入规则**（命中空格→仅链接；命中非空格→`原文本 ![图片]`；数字格经 `_cell_to_text` 不写成 `120.0`；多图同格空格连接）；**回退**（越界行/超表宽/absoluteAnchor/空 sheet `start=None`→sheet 段尾图行，图片间空行）；仅图无行 sheet 出段；`_parse_excel`→`ParsedDocument`（fake calamine 扩 `start`（默认 `(0,0)`）+ 真 zip：markdown 行内 refs、images 扁平序）；坏 zip 尽力腿（`BadZipFile`/`ET.ParseError`/`KeyError` → `images==[]` + 正文照出 + caplog warning）；`.xls` 不尝试 zip。**实测：11 红**（merge 3 + trailing 1 + `_parse_excel` 形状 4 + 错误降级参数化 3（`[exc0-2]`）+ `.xls` 1；成因=缺 `_merge_anchor_links`/参数不支持/返回仍是 str）；fixture 扩 `_install_fake_calamine(..., starts=None)`（默认 `(0,0)`，显式 `None` 模拟空 sheet）。
- [x] ② GREEN：`_merge_anchor_links(rows, start, images)`（或内联）；`_workbook_rows_to_markdown(..., trailing_images_by_sheet=None)` 扩展（尾挂回退专用）；`_parse_excel` 返 `ParsedDocument`；dispatch 一行；既有直调用例同步改取 `.markdown`（形状变化，计划内显式列出）。**实测：窄面 25 绿**。实现＝ `_merge_anchor_links`（start 归一、越界/无锚/无 start 回退尾挂、命中并入 `原文本/仅链接`）+ builder 增 keyword-only `trailing_images_by_sheet`（尾挂每图一行、空行分隔、仅图无行也出 `##` 段）+ `_parse_excel` 重写（`_blocking` 三tuple 读行 + `.xlsx` 才尽力读 zip + catch 集 `{BadZipFile, ET.ParseError, KeyError}` → 英文 warning + `images` 扁平序=calamine sheet 序×锚点文档序）+ dispatch `return await _parse_excel(path)`；既有 `test_parse_excel_happy_path_via_fake_calamine` 改「写假字节 + 取 `.markdown` + `images==[]`」（顺带吃回退腿）。
- [x] ③ neuter：去掉并入逻辑或尾挂 append ⇒ 对应用例红；还原。**实测：去掉并入写回 ⇒ 4 红**（3 单测 + 1 集成 `merges_anchor_links`）+ 21 绿；已还原、窄面复绿。
- [x] ④ 零回归：`tests/knowledge` 全套（含 `test_table_eval.py`）零回归 + ruff 双净。**实测：1470 passed / 2 skipped / 2 failed（576.9s）**；2 条=在册环境红对（`test_indexer.py::test_embed_missing_api_key` / `test_reranker.py::test_rerank_missing_api_key`，本机真 `rag_config.json` 带 key ⇒「缺 key 须抛」前提不成立）；**阳性对照**（`DEER_FLOW_RAG_CONFIG_PATH=<仓外空 {}>`）⇒ **2 passed** 当场齐绿（同树隔离法）。ruff check（knowledge 包 + tests/knowledge）+ format --check（2 文件）双净。

## Task 3 — caption 落 markdown 清洗（captioner.py，TDD；评审③=甲）

- [ ] ① RED：`apply_captions` 用例——换行 caption（`\r\n`/`\n`）落笔后行仍单行（GFM 表行不中断）；`|`→`\|`、`[`/`]` 转义（渲染等价）；组装产物（表行内 ref、多图同格）alt 就地重写（评审⑤钉点）。既有 plain-caption 断言（`test_parser.py:245`）保持不变。
- [ ] ② GREEN：`apply_captions` `_sub` 落笔前清洗（先 `\`→`\\`，再换行→空格、再 `|`/`[`/`]` 转义；调用点唯一 `worker.py:580`，视频腿不经此处）。
- [ ] ③ neuter：去清洗 ⇒ 换行用例红；还原。
- [ ] ④ 窄面：`pytest backend/tests/knowledge -k "caption"` 绿 + ruff。

## Task 4 — 真 e2e 与文档

- [ ] ① 真 `.xlsx` e2e：openpyxl+PIL 造（数据 + 命中锚图 + 远锚图）→ `parse_document` → images 数、ref 字节==原图、命中图链接在锚点**行内**、远锚图回退 `## {sheet}` 段尾；skipif（calamine/PIL/openpyxl 缺）。
- [ ] ② 文档：`parser.py` 模块 docstring 本地腿段、`_EXCEL_SUFFIXES` 注释、`_parse_excel`/`parse_document` docstring；`apply_captions` docstring（清洗口径）；`backend/AGENTS.md` 表格/摄取段补行。
- [ ] ③ 门禁：`tests/knowledge` 全绿 + `ruff check` + `ruff format --check`。

## Task 5 — RFC 两格升级与收尾

- [ ] ① **先重读 RFC v3 全文**：L47「内嵌图片」「现状与缺口」两格 → 按裁定升级（如「.xlsx 已实现：zip 提取 + 行列锚点并入所在单元格（越界回退 sheet 段尾），入现配文腿；`.xls` 不覆盖」）；L355 去「待补图片实现」。
- [ ] ② plan 复选框全勾 + 提交号回填；spec/plan 成对提交（`docs(rag): draft the workbook embedded-image extraction spec+plan pair`）。

## 收尾

- [ ] 复选框回填、提交链回填；RFC 升级笔与代码交付笔相邻。
