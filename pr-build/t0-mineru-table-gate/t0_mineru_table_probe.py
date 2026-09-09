"""Task 0 probe: what table syntax does MinerU actually emit into chunks?

Read-only scan of the live knowledge DB: for every document that went through
MinerU (non-local suffix), count HTML-table vs GFM-pipe-table evidence inside
its stored chunk text. No writes, no network.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

DB = Path(r"e:\app\python\agent\deer-flow\backend\.deer-flow\data\deerflow.db")

HTML_TABLE = re.compile(r"<table", re.I)
HTML_TR = re.compile(r"<tr[\s>]", re.I)
HTML_TD = re.compile(r"<t[dh][\s>]", re.I)
ROWSPAN = re.compile(r"rowspan", re.I)
COLSPAN = re.compile(r"colspan", re.I)
HTML_ENTITY = re.compile(r"&nbsp;|&#\d+;", re.I)
# GFM delimiter row: | --- | :---: |
GFM_DELIM = re.compile(r"^\s*\|[\s:|-]*-[\s:|-]*\|\s*$", re.M)
GFM_PIPE_ROW = re.compile(r"^\s*\|.*\|\s*$", re.M)
# LaTeX-ish table envs MinerU's pipeline model may emit
LATEX_TABULAR = re.compile(r"\\begin\{tabular\}|\\hline", re.I)

LOCAL_SUFFIXES = {".md", ".markdown", ".txt", ".csv"}


def main() -> None:
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    docs = con.execute("SELECT id, name, status, chunk_count FROM documents ORDER BY name").fetchall()
    print(f"documents: {len(docs)}\n")
    print(f"{'doc':44} {'suffix':7} {'route':7} {'chunks':>6} {'html':>5} {'gfmD':>5} {'pipe':>5} {'span':>5} {'latex':>5}")
    for d in docs:
        name = d["name"]
        suffix = Path(name).suffix.lower()
        rows = con.execute("SELECT text FROM chunks WHERE doc_id = ?", (d["id"],)).fetchall()
        blob = "\n".join(r["text"] or "" for r in rows)
        route = "local" if suffix in LOCAL_SUFFIXES else "mineru"
        if suffix in {".mp4", ".mov", ".mkv", ".avi"}:
            route = "video"
        print(
            f"{name[:44]:44} {suffix:7} {route:7} {len(rows):>6} "
            f"{len(HTML_TABLE.findall(blob)):>5} {len(GFM_DELIM.findall(blob)):>5} "
            f"{len(GFM_PIPE_ROW.findall(blob)):>5} "
            f"{len(ROWSPAN.findall(blob)) + len(COLSPAN.findall(blob)):>5} "
            f"{len(LATEX_TABULAR.findall(blob)):>5}"
        )
        if route == "mineru" and (HTML_TABLE.search(blob) or GFM_DELIM.search(blob)):
            snippet = _first_table_snippet(blob)
            print(f"    ↳ sample: {snippet}")
    con.close()


def _first_table_snippet(blob: str) -> str:
    m = HTML_TABLE.search(blob) or GFM_DELIM.search(blob)
    if not m:
        return ""
    start = max(0, m.start() - 120)
    end = min(len(blob), m.end() + 320)
    return repr(blob[start:end])


if __name__ == "__main__":
    main()
