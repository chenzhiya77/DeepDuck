"""Build the Task 5 acceptance fixtures: PDFs carrying a figure *and* a table.

Why one file: the acceptance has to see image persistence / in-place rendering and the
GFM table normalization in the same ingest. The raster figure is the table crop from the
Task 1 run (embedded as a data URI so headless Chrome needs no file access); the table is
inline HTML, which is the shape the normalization pass exists for.

Two sizes, because the graph leg of this deployment embeds *all* entity names of one
extraction in a single call and the embedding provider here is `openai-compatible`
(20-row default) pointed at DashScope's compatible endpoint (10-row cap): a text-rich
page crosses 10 entities and the document ends `failed` on that unrelated leg. The rich
page is what the two negative cases upload; the trimmed page is the positive end-to-end
(its parse output still carries both the figure and the table).

The intermediate HTML is written next to this script and removed again. The PDFs land in
``OUT`` **outside the repo** (same convention as Task 1's samples), and their sha256 is
recorded in ``notes.md`` so the exact uploaded bytes stay pinned without committing them.
"""

from __future__ import annotations

import base64
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = Path(r"E:\app-mode\mineru-4x\evidence\task5")
OUT.mkdir(parents=True, exist_ok=True)
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
JPEG = Path(r"E:\app-mode\mineru-4x\evidence\zip-view\images\page_0_table_2.jpg")

if not JPEG.is_file():
    sys.exit(f"missing source image: {JPEG}")

b64 = base64.b64encode(JPEG.read_bytes()).decode("ascii")

STYLE = (
    "<style>body{font-family:'Microsoft YaHei',sans-serif;margin:48px}"
    "h1{font-size:22px}h2{font-size:16px}p,td,th{font-size:13px;line-height:1.7}"
    "figure{margin:20px 0}figcaption{font-size:12px;color:#555}</style>"
)


def table(rows: list[tuple[str, str, str, str, str]]) -> str:
    head = "<tr><th>季度</th><th>采购品类</th><th>数量</th><th>金额(万元)</th><th>负责人</th></tr>"
    body = "".join(
        f"<tr><td>{q}</td><td>{item}</td><td>{n}</td><td>{amt}</td><td>{who}</td></tr>"
        for q, item, n, amt, who in rows
    )
    return "<table border='1' cellspacing='0' cellpadding='6' style='border-collapse:collapse'>" + head + body + "</table>"


FIGURE = (
    f"<figure><img src='data:image/jpeg;base64,{b64}' style='width:520px'>"
    "<figcaption>图 1 2026 年季度采购金额分布</figcaption></figure>"
)


def build(name: str, html_body: str) -> None:
    out_pdf = OUT / name
    html = HERE / (name.replace(".pdf", ".html"))
    html.write_text(
        "<!doctype html><html><head><meta charset='utf-8'>" + STYLE + "</head><body>" + html_body + "</body></html>",
        encoding="utf-8",
    )
    cmd = [
        str(CHROME),
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        f"--user-data-dir={HERE / 'chrome-profile'}",
        f"--print-to-pdf={out_pdf}",
        html.as_uri(),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    html.unlink(missing_ok=True)
    if not out_pdf.exists():
        print(f"{name}: PDF MISSING; stderr tail:", (proc.stderr or "")[-800:])
        sys.exit(1)
    print(f"{name}: exit={proc.returncode} {out_pdf.stat().st_size} bytes")


build(
    "acceptance.pdf",
    "<h1>2026 年季度采购汇总（验收样本）</h1>"
    "<p>本页同时携带一张表格与一幅栅格图，用于验证解析腿：表格应归一为 GFM 管道表，"
    "栅格图应落盘并在原位渲染。</p>"
    "<h2>一、采购明细表</h2>"
    + table(
        [
            ("2026-Q1", "工业级边缘网关", "45", "21.1", "周砚"),
            ("2026-Q2", "无线机械键盘", "300", "12.0", "李行舟"),
            ("2026-Q3", "星云冷链温度传感器", "320", "41.6", "沈观澜"),
            ("2026-Q4", "服务器内存条", "160", "28.8", "程既白"),
        ]
    )
    + "<h2>二、金额分布图</h2>"
    + FIGURE
    + "<p>结论：第三季度采购品类最多，第四季度单笔金额最高。</p>",
)

build(
    "acceptance-small.pdf",
    "<h1>采购汇总（小样本）</h1>"
    "<p>表格与配图同页。</p>"
    + table([("2026-Q1", "边缘网关", "45", "21.1", "周砚")])
    + FIGURE,
)