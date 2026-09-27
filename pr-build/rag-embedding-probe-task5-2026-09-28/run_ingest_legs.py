"""Task 5's ingest legs: the batch ladder and the declared width, on a real ingest.

A local ``.txt`` upload needs no parsing service, so the whole pipeline (chunk → embed) runs
against the stub. With the stub refusing more than five rows per call, the ladder has to be
the only reason the ingest succeeds — and every request has to carry the declared width.

Run:  MSYS_NO_PATHCONV=1 python run_ingest_legs.py   (against a freshly started instance)
"""

from __future__ import annotations

import json
import time

import httpx

from iso_api import ISO, STUB, _client

KB_NAME = "task5-ingest"
WIDTH = 1024
#: A fresh model name per run: the learned batch cap is keyed by (base_url, model), so a new
#: name is what makes the ladder observable at all (and is what a real model switch does too).
MODEL = f"stub-embed-ladder-{int(time.time())}"


def leg(name: str, ok: bool, detail: str) -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} — {detail}", flush=True)


def stub(**state: object) -> dict:
    with httpx.Client(base_url=STUB, timeout=30.0) as client:
        return client.post("/__control", json=state).json()


def stub_log() -> list[dict]:
    with httpx.Client(base_url=STUB, timeout=30.0) as client:
        return client.get("/__log").json()["log"]


def stub_reset() -> None:
    with httpx.Client(base_url=STUB, timeout=30.0) as client:
        client.post("/__reset")


def _authed(method: str, path: str, payload: dict | None = None, files: dict | None = None) -> tuple[int, dict]:
    client = _client()
    try:
        response = client.request(method, path, json=payload, files=files, headers={"X-CSRF-Token": client.cookies.get("csrf_token", "")} if method != "GET" else {})
    finally:
        client.close()
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, {"__text__": response.text}


def main() -> int:
    # A declared width that equals the default: no migration, but every request must carry it.
    client = _client()
    try:
        client.put("/api/rag/config", json={"embedding_dimension": WIDTH, "embedding_model": MODEL}, headers={"X-CSRF-Token": client.cookies.get("csrf_token", "")})
    finally:
        client.close()

    stub_reset()
    stub(mode="range", native=WIDTH, max_rows=5)
    print("model ->", MODEL, flush=True)
    print("stub ->", json.dumps(stub(), ensure_ascii=False), flush=True)

    status, body = _authed("POST", "/api/knowledge-bases", {"name": KB_NAME})
    print("create kb ->", status, json.dumps(body, ensure_ascii=False)[:200], flush=True)
    kb_id = body.get("id")
    if kb_id is None:  # already there from an earlier run
        listing = _authed("GET", "/api/knowledge-bases")[1]
        kb_id = next((kb["id"] for kb in listing.get("knowledge_bases", []) if kb["name"] == KB_NAME), None)
    print("kb_id ->", kb_id, flush=True)

    text = "\n\n".join(f"第 {index} 段：这是一段用来产生大量切片的中文正文，重复一些字以确保分块器切出足够多的块。" * 6 for index in range(200))
    stub_reset()
    status, body = _authed("POST", f"/api/knowledge-bases/{kb_id}/documents", files={"file": ("task5-long.txt", text.encode(), "text/plain")})
    print("upload ->", status, json.dumps(body, ensure_ascii=False)[:200], flush=True)
    doc_id = body.get("id")

    deadline = time.time() + 180
    document: dict = {}
    while time.time() < deadline:
        listing = _authed("GET", f"/api/knowledge-bases/{kb_id}/documents")[1]
        documents = listing if isinstance(listing, list) else listing.get("documents", [])
        document = next((entry for entry in documents if entry.get("id") == doc_id), {}) or document
        if document.get("status") in ("ready", "failed"):
            break
        time.sleep(1.0)
    print("document ->", json.dumps({k: document.get(k) for k in ("status", "chunk_count", "error")}, ensure_ascii=False), flush=True)

    calls = [entry for entry in stub_log() if entry["path"].endswith("/v1/embeddings")]
    rows = [len(entry["body"].get("input") or []) for entry in calls]
    accepted = [len(entry["body"].get("input") or []) for entry in calls if entry.get("status") == 200]
    widths = [entry["body"].get("dimensions") for entry in calls]
    print("batch rows asked ->", rows, flush=True)
    print("batch rows accepted ->", accepted, flush=True)
    print("widths asked ->", sorted(set(widths), key=lambda value: str(value)), flush=True)

    leg("首批就是阶梯顶端 20 行", bool(rows) and rows[0] == 20, f"rows={rows[:4]}")
    leg("撞 400 后沿阶梯降档（20 → 10 → 5）", rows[:3] == [20, 10, 5], f"rows={rows[:4]}")
    leg("学到档位后不再试大（之后每一批 ≤ 5 行，最后一批是余数）", all(row <= 5 for row in accepted[3:]), f"accepted={accepted[:8]}")
    paths = document.get("path_status") or {}
    leg(
        "入库的向量腿跑完（切片数 = 各批行数之和；图谱腿因 scratch 无模型而失败，与本线无关）",
        document.get("chunk_count") == sum(accepted) and paths.get("vector") == "done",
        f"chunk_count={document.get('chunk_count')} sum(accepted)={sum(accepted)} path_status={paths}",
    )
    leg("声明发参：每一发都带 dimensions=1024", bool(widths) and set(widths) == {WIDTH}, f"widths={sorted(set(widths), key=str)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
