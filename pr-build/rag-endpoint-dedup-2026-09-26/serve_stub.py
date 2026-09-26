"""One-off local stub for the rag-endpoint-dedup real-HTTP legs (spec 2026-09-26).

Serves the OpenAI shape at 1024 dims on /v1/embeddings plus a Jina-shape /v1/rerank,
and appends every request path to requests.log so the caller can assert the joined URL.
Stdlib only; run: uv run python serve_stub.py (from backend/), then delete after use.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG_PATH = "requests.log"
DIM = 1024
PORT = 8137


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 (http.server API)
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(self.path + "\n")
        if self.path == "/v1/embeddings":
            body = {
                "data": [{"embedding": [0.001] * DIM, "index": 0, "object": "embedding"}],
                "model": "stub-embedding",
                "object": "list",
                "usage": {"prompt_tokens": 1, "total_tokens": 1},
            }
        elif self.path in ("/v1/rerank", "/rerank"):
            body = {"results": [{"index": 0, "relevance_score": 0.9, "document": {"text": "a"}}]}
        else:
            self.send_response(404)
            self.send_header("content-length", "0")
            self.end_headers()
            return
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # keep stdout clean
        pass


if __name__ == "__main__":
    print(f"stub listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
