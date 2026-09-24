"""Serve the Task 5 fixtures to the page over CORS.

The acceptance has to feed a real file to the app's own upload endpoint, and a page on
``localhost:3000`` cannot read an arbitrary local path. So this stub publishes the fixture
directory (``E:\\app-mode\\mineru-4x\\evidence\\task5``, where ``make_acceptance_pdf.py``
writes the PDFs) on ``127.0.0.1:8791`` with ``Access-Control-Allow-Origin: *``; the page
fetches the PDF, wraps it in a ``FormData`` and POSTs it to
``/api/knowledge-bases/{kb}/documents`` with the CSRF header — the app's own route,
exercised the same way the UI exercises it.
"""

from __future__ import annotations

import http.server
from pathlib import Path

PORT = 8791
HERE = Path(r"E:\app-mode\mineru-4x\evidence\task5")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()