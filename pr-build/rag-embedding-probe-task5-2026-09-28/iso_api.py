"""Drive the isolated Task 5 instance over its API: one command per acceptance leg.

The instance is fully separate from the operator's stack (its own scratch config root, its own
Qdrant on 6334, the stub model server on 8899), so these legs read and write nothing that is
anyone's real data. Usage:

    python iso_api.py GET  /api/rag/config
    python iso_api.py PUT  /api/rag/config '{"embedding_dimension": 1536}'
    python iso_api.py POST /api/rag/config/probe-dimensions '{"embedding_provider": ...}'
    python iso_api.py STUB POST /__control '{"mode": "range", "native": 1024}'
    python iso_api.py STUB GET  /__log

Prints ``<status>\\n<body>`` so a caller can assert on either half.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

import httpx

BASE = os.environ.get("T5_BASE", "http://127.0.0.1:8099")
STUB = os.environ.get("T5_STUB", "http://127.0.0.1:8899")
ISO = pathlib.Path(os.environ.get("T5_ISO", "E:/app/python/agent/_t5_iso"))
ADMIN = "t5-admin@example.com"


def _client() -> httpx.Client:
    client = httpx.Client(base_url=BASE, timeout=60.0)
    password = (ISO / "admin_password.txt").read_text(encoding="utf-8").strip()
    response = client.post("/api/v1/auth/login/local", data={"username": ADMIN, "password": password})
    response.raise_for_status()
    return client


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 2

    if argv[0] == "STUB":
        method, path, *rest = argv[1:]
        with httpx.Client(base_url=STUB, timeout=60.0) as client:
            response = client.request(method, path, content=rest[0] if rest else None)
    else:
        method, path, *rest = argv
        client = _client()
        try:
            headers = {"X-CSRF-Token": client.cookies.get("csrf_token", "")}
            response = client.request(method, path, content=rest[0] if rest else None, headers=headers)
        finally:
            client.close()

    body = response.text
    try:
        body = json.dumps(json.loads(body), ensure_ascii=False)
    except ValueError:
        pass
    print(response.status_code)
    print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
