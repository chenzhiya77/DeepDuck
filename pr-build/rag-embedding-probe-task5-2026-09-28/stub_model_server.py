"""Task 5's local stub: one process answering the embedding and rerank legs, on demand.

The acceptance legs need endpoints whose *behaviour* the test chooses — a tiered model, a
range model, one that ignores the parameter, one whose 200 lies about the width, a refusal,
a hang — and they need to see exactly what was sent. Two control endpoints do that:
``POST /__control`` sets the behaviour, ``GET /__log`` hands back every request seen.

Nothing here leaves the machine: it binds 127.0.0.1 and answers from a table. Run:

    python pr-build/rag-embedding-probe-task5-2026-09-28/stub_model_server.py --port 8899
"""

from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

#: What the stub answers with, changeable at runtime through ``POST /__control``.
STATE: dict[str, Any] = {
    "mode": "tiered",
    "native": 1024,
    "allowed": [256, 512, 768, 1024],
    "model": "stub-embed",
    "rerank_status": 200,
    #: Rows per call the endpoint accepts, like the real `batch size is invalid` refusals.
    "max_rows": None,
}
LOG: list[dict[str, Any]] = []


def _dense(width: int) -> list[float]:
    return [0.1] * width


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args: Any) -> None:  # keep the console readable
        pass

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            parsed = json.loads(raw.decode() or "{}")
        except ValueError:
            parsed = {"__unparsed__": raw.decode(errors="replace")}
        return parsed if isinstance(parsed, dict) else {"__body__": parsed}

    def _record(self, path: str, body: dict[str, Any], status: int = 200) -> None:
        LOG.append(
            {
                "path": path,
                "body": body,
                "status": status,
                "authorization": "Bearer " in (self.headers.get("Authorization") or ""),
                "at": time.time(),
            }
        )

    def do_GET(self) -> None:  # noqa: N802 - http.server's spelling
        if self.path == "/__log":
            self._json(200, {"log": LOG})
            return
        if self.path == "/__control":
            self._json(200, STATE)
            return
        self._json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        body = self._read_body()
        if self.path == "/__control":
            STATE.update({key: value for key, value in body.items() if key in STATE})
            self._json(200, STATE)
            return
        if self.path == "/__reset":
            LOG.clear()
            self._json(200, {"log": "cleared"})
            return

        mode = STATE["mode"]
        if mode == "hang":
            time.sleep(30)

        if self.path.endswith("/v1/embeddings"):
            self._record(self.path, body, status=200)
            self._answer_embeddings(body, mode)
            return
        if self.path.endswith("/rerank"):
            self._record(self.path, body)
            if STATE["rerank_status"] != 200:
                self._json(STATE["rerank_status"], {"detail": "refused"})
                return
            documents = body.get("documents") or []
            self._json(200, {"results": [{"index": index, "relevance_score": 0.5} for index in range(len(documents))]})
            return
        self._json(404, {"detail": "not found"})

    def _answer_embeddings(self, body: dict[str, Any], mode: str) -> None:
        if mode == "refuse":
            self._json(401, {"error": {"message": "invalid api key"}})
            return
        native = int(STATE["native"])
        asked = body.get("dimensions")
        inputs = body.get("input") or []

        if STATE["max_rows"] is not None and len(inputs) > int(STATE["max_rows"]):
            LOG[-1]["status"] = 400
            self._json(400, {"error": {"message": "batch size is invalid"}})
            return

        if mode == "fixed":
            width = native
        elif mode == "clamp":
            width = native if (asked is not None and int(asked) > native) else int(asked or native)
        elif asked is None:
            width = native
        elif mode == "tiered":
            if int(asked) not in STATE["allowed"]:
                LOG[-1]["status"] = 400
                self._json(400, {"error": {"message": f"dimension {asked} is not supported"}})
                return
            width = int(asked)
        else:  # range
            if int(asked) > native:
                self._json(400, {"error": {"message": f"dimension {asked} exceeds the native width"}})
                return
            width = int(asked)

        self._json(200, {"data": [{"index": index, "embedding": _dense(width)} for index in range(len(inputs) or 1)]})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8899)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"stub listening on 127.0.0.1:{args.port} (mode={STATE['mode']}, native={STATE['native']})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
