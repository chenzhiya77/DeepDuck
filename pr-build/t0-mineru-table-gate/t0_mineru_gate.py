"""Task 0 empirical gate: what table syntax does MinerU v4 + vlm actually emit?

Two stages, both offline-safe to import:

1. ``make_table_pdf()`` — hand-build a one-page PDF containing a plain 4x5 table
   plus a second table with a vertical merge (rowspan), a full-width merged row
   (colspan) and a prose line containing shell pipes (``|``) so we can also see
   whether MinerU mistakes pipes in prose for a table. Pure stdlib, no deps.
2. ``run_mineru()`` — call the production ``parse_document`` (v4, model_version
   default ``vlm``, token from ``MINERU_API_TOKEN`` in backend/.env), dump the
   returned ``full.md`` to temp/ and report the observed table syntax.

Usage:
    .venv\\Scripts\\python.exe ..\\temp\\t0_mineru_gate.py pdf    # only build the PDF
    .venv\\Scripts\\python.exe ..\\temp\\t0_mineru_gate.py run    # build + live MinerU
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

TEMP = Path(r"e:\app\python\agent\deer-flow\temp")
PDF_PATH = TEMP / "t0_table_probe.pdf"
MD_PATH = TEMP / "t0_mineru_full.md"
ENV_PATH = Path(r"e:\app\python\agent\deer-flow\backend\.env")

PAGE_W, PAGE_H = 595, 842
MARGIN = 56


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class _Builder:
    """Accumulates PDF content-stream operators for one page."""

    def __init__(self) -> None:
        self.ops: list[str] = []

    def text(self, x: float, y: float, value: str, *, size: float = 11, bold: bool = False) -> None:
        font = "/F2" if bold else "/F1"
        self.ops.append(f"BT {font} {size} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm ({_esc(value)}) Tj ET")

    def shade(self, x: float, y: float, w: float, h: float) -> None:
        self.ops.append(f"0.90 0.90 0.90 rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")

    def grid(self, segments: list[tuple[float, float, float, float]], *, width: float = 0.8) -> None:
        self.ops.append(f"0 0 0 RG {width} w")
        for x1, y1, x2, y2 in segments:
            self.ops.append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def stream(self) -> str:
        return "\n".join(self.ops) + "\n"


def _table(
    b: _Builder,
    *,
    top: float,
    cols: list[float],
    rows: list[list[str | None]],
    row_h: float = 22.0,
    header: bool = True,
    shade: bool = True,
    vmerge: list[tuple[int, int]] | None = None,
    hmerge_rows: set[int] | None = None,
) -> float:
    """Draw a bordered table; ``None`` cell = covered by a merge (no text).

    ``vmerge`` entries ``(row, col)`` mean "no horizontal separator below this
    cell" (visual rowspan). ``hmerge_rows`` are rows drawn without internal
    vertical separators (visual colspan across the whole row).
    """
    left, right = cols[0], cols[-1]
    bottom = top - row_h * len(rows)
    vmerge = vmerge or []
    hmerge_rows = hmerge_rows or set()
    # header shading first so the grid stays visible on top of it
    if header and shade:
        b.shade(left, top - row_h, right - left, row_h)
    segments: list[tuple[float, float, float, float]] = []
    # outer top/bottom borders are always full width
    segments.append((left, top, right, top))
    segments.append((left, bottom, right, bottom))
    # interior horizontal separators, interrupted where a rowspan crosses them
    for i in range(1, len(rows)):
        y = top - i * row_h
        run_start: float | None = None
        for c in range(len(cols) - 1):
            if (i - 1, c) in vmerge:  # the cell above spans down past this line
                if run_start is not None:
                    segments.append((run_start, y, cols[c], y))
                    run_start = None
            elif run_start is None:
                run_start = cols[c]
        if run_start is not None:
            segments.append((run_start, y, right, y))
    # vertical separators: outer ones full height, inner ones per row (skipping
    # full-width merged rows)
    for c, x in enumerate(cols):
        if c in (0, len(cols) - 1):
            segments.append((x, bottom, x, top))
            continue
        for i in range(len(rows)):
            if i in hmerge_rows:
                continue
            segments.append((x, top - (i + 1) * row_h, x, top - i * row_h))
    b.grid(segments)
    for i, row in enumerate(rows):
        for c, cell in enumerate(row):
            if cell is None:
                continue
            b.text(cols[c] + 6, top - i * row_h - 15, cell, size=10, bold=header and i == 0)
    return bottom


def make_table_pdf(path: Path = PDF_PATH, *, shade: bool = True) -> Path:
    b = _Builder()
    y = PAGE_H - 62
    b.text(MARGIN, y, "Quarterly Sales Report", size=16, bold=True)
    y -= 26
    b.text(MARGIN, y, "The tables below summarize regional sales performance and product", size=11)
    y -= 14
    b.text(MARGIN, y, "attributes for fiscal year 2025.", size=11)
    y -= 28
    b.text(MARGIN, y, "Table 1. Regional sales by quarter (thousand units)", size=12, bold=True)
    y -= 20
    y = _table(
        b,
        top=y,
        cols=[56, 176, 276, 376, 506],
        rows=[
            ["Region", "Q1", "Q2", "Total"],
            ["North", "120", "135", "255"],
            ["South", "98", "112", "210"],
            ["East", "143", "150", "293"],
            ["West", "87", "94", "181"],
        ],
        shade=shade,
    )
    y -= 30
    b.text(MARGIN, y, "Table 2. Product attributes (contains merged cells)", size=12, bold=True)
    y -= 20
    y = _table(
        b,
        top=y,
        cols=[56, 196, 336, 506],
        rows=[
            ["Product", "Attribute", "Value"],
            ["Widget A", "Color", "Red"],
            [None, "Weight", "2.4 kg"],  # rowspan=2 on the Product cell above
            ["Widget B", "Color", "Blue"],
            ["Notes: measured at 20 C under dry conditions.", None, None],  # colspan=3
        ],
        shade=shade,
        vmerge=[(1, 0)],
        hmerge_rows={4},
    )
    y -= 30
    b.text(MARGIN, y, "Pipeline note: the shell command cat sales.csv | grep north | wc -l", size=11)
    y -= 14
    b.text(MARGIN, y, "counts the northern rows. End of report.", size=11)

    stream = b.stream().encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))
    return path


def _load_mineru_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key.startswith("MINERU"):
            continue
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


_HTML_TABLE = re.compile(r"<table", re.I)
_HTML_DELIM = re.compile(r"^\s*\|[\s:|-]*-[\s:|-]*\|\s*$", re.M)
_HTML_PIPE = re.compile(r"^\s*\|.*\|\s*$", re.M)
_ROWSPAN = re.compile(r"rowspan", re.I)
_COLSPAN = re.compile(r"colspan", re.I)
_NESTED_TAG = re.compile(r"<(p|strong|em|b|i|br|span|div)\b", re.I)


def _report(markdown: str) -> None:
    print("\n=== observed table syntax ===")
    print(f"  <table> tags          : {len(_HTML_TABLE.findall(markdown))}")
    print(f"  GFM delimiter rows    : {len(_HTML_DELIM.findall(markdown))}")
    print(f"  GFM-looking pipe rows : {len(_HTML_PIPE.findall(markdown))}")
    print(f"  rowspan attrs         : {len(_ROWSPAN.findall(markdown))}")
    print(f"  colspan attrs         : {len(_COLSPAN.findall(markdown))}")
    print(f"  nested inline tags    : {len(_NESTED_TAG.findall(markdown))}")
    print("\n=== full.md (verbatim) ===")
    print(markdown)


async def _run(*, shade: bool = True) -> None:
    from deerflow.knowledge.parser import parse_document

    pdf_path = PDF_PATH if shade else TEMP / "t0_table_probe_plain.pdf"
    md_path = MD_PATH if shade else TEMP / "t0_mineru_full_plain.md"
    pdf = make_table_pdf(pdf_path, shade=shade)
    print(f"probe PDF: {pdf} ({pdf.stat().st_size} bytes, header shading={shade})")
    parsed = await parse_document(pdf, poll_interval_seconds=5.0, timeout_seconds=900.0)
    md_path.write_text(parsed.markdown, encoding="utf-8")
    print(f"full.md dumped to: {md_path} ({len(parsed.markdown)} chars, {len(parsed.images)} images)")
    _report(parsed.markdown)


def main() -> None:
    stage = sys.argv[1] if len(sys.argv) > 1 else "pdf"
    if stage == "pdf":
        pdf = make_table_pdf()
        print(f"wrote {pdf} ({pdf.stat().st_size} bytes)")
        pdf2 = make_table_pdf(TEMP / "t0_table_probe_plain.pdf", shade=False)
        print(f"wrote {pdf2} ({pdf2.stat().st_size} bytes)")
        return
    _load_mineru_env()
    if not os.environ.get("MINERU_API_TOKEN"):
        print("MINERU_API_TOKEN not set — cannot run the live gate", file=sys.stderr)
        raise SystemExit(2)
    asyncio.run(_run(shade=stage != "run-plain"))


if __name__ == "__main__":
    main()
