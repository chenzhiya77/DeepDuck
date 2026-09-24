"""Build the second smoke sample: a PDF that carries a real raster figure.

Uses the table crop from the first smoke run (images/page_0_table_2.jpg) as the
figure, embedded as a data URI so headless Chrome needs no file access, then
prints the page to PDF with its own profile dir.
"""

from __future__ import annotations

import base64
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
JPEG = HERE / "zip-view" / "images" / "page_0_table_2.jpg"
HTML = HERE / "figure.html"
PDF = HERE / "figure.pdf"

if not JPEG.is_file():
    sys.exit(f"missing source image: {JPEG}")

b64 = base64.b64encode(JPEG.read_bytes()).decode("ascii")
HTML.write_text(
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<style>body{font-family:'Microsoft YaHei',sans-serif;margin:48px}"
    "h1{font-size:22px}p{font-size:14px;line-height:1.7}figure{margin:24px 0}"
    "figcaption{font-size:12px;color:#555}</style></head><body>"
    "<h1>季度采购汇总（图文版）</h1>"
    "<p>下表给出 2026 年四个季度的采购情况概览，随后是图表与结论段落。</p>"
    f"<figure><img src='data:image/jpeg;base64,{b64}' style='width:520px'>"
    "<figcaption>图 1 2026 年季度采购金额分布</figcaption></figure>"
    "<p>结论：第三季度采购品类最多，第四季度单笔金额最高。</p>"
    "</body></html>",
    encoding="utf-8",
)

cmd = [
    str(CHROME),
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    f"--user-data-dir={HERE / 'chrome-profile'}",
    f"--print-to-pdf={PDF}",
    HTML.as_uri(),
]
proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
print("exit:", proc.returncode)
if not PDF.exists():
    print("PDF MISSING; stderr tail:", (proc.stderr or "")[-800:])
    sys.exit(1)
print("pdf:", PDF.name, PDF.stat().st_size, "bytes")