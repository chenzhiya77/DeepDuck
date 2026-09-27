"""Task 5's acceptance legs, run against the isolated instance (see `iso_api.py`).

Every leg asserts on the server's own answer and prints the raw exchange, so the transcript
is the evidence rather than a claim. The instance is isolated: its own scratch config root,
its own Qdrant (6334), the stub model server (8899) — the operator's stack, data and config
are never touched.

Run:  MSYS_NO_PATHCONV=1 python run_legs.py   (against a freshly started instance — the
last leg teaches the process that this endpoint refuses the parameter, on purpose)
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable

import httpx

from iso_api import BASE, ISO, STUB, _client

#: The candidate under test: the generic leg, pointed at the configured (stub) endpoint by
#: omitting `embedding_base_url`, so a leg never has to know the address twice.
GENERIC = {"embedding_provider": "openai-compatible", "embedding_model": "stub-embed"}
QDRANT = "http://127.0.0.1:6334"

RESULTS: list[tuple[str, bool, str]] = []


def leg(name: str, ok: bool, detail: str) -> None:
    RESULTS.append((name, ok, detail))
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


def qdrant_collections() -> list[str]:
    with httpx.Client(base_url=QDRANT, timeout=30.0) as client:
        payload = client.get("/collections").json()
    return sorted(entry["name"] for entry in payload["result"]["collections"])


def drop_collection(name: str) -> None:
    with httpx.Client(base_url=QDRANT, timeout=30.0) as client:
        client.delete(f"/collections/{name}")


def establish_baseline() -> None:
    """Back to "no declaration, default width" — the legs must be re-runnable.

    The scratch file is the only thing that moves: the runtime hot-reloads it, so once the
    API reports no declared width, any suffixed generation is a leftover of an earlier run
    and is dropped. Nothing outside the isolated root is touched.
    """
    (ISO / "rag_config.json").write_text("{}", encoding="utf-8")
    wait_until(lambda: get_config().get("config", {}).get("embedding_dimension") is None, timeout=30)
    for name in qdrant_collections():
        if "_" in name and name.rsplit("_", 1)[-1].isdigit():
            drop_collection(name)
    print("baseline ->", json.dumps(get_config().get("config", {}).get("embedding_dimension"), ensure_ascii=False), qdrant_collections(), flush=True)


def _authed(method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    client = _client()
    try:
        response = client.request(method, path, json=payload, headers={"X-CSRF-Token": client.cookies.get("csrf_token", "")})
    finally:
        client.close()
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, {"__text__": response.text}


def probe_dimensions(payload: dict) -> tuple[int, dict]:
    return _authed("POST", "/api/rag/config/probe-dimensions", payload)


def probe_connectivity(payload: dict) -> tuple[int, dict]:
    return _authed("POST", "/api/rag/config/probe-connectivity", payload)


def put_config(payload: dict) -> tuple[int, dict]:
    return _authed("PUT", "/api/rag/config", payload)


def get_config() -> dict:
    return _authed("GET", "/api/rag/config")[1]


def get_migration() -> dict | None:
    return _authed("GET", "/api/rag/config/migration")[1]


def wait_until(predicate: Callable[[], bool], *, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.5)
    return False


def main() -> int:
    establish_baseline()

    # ── 1. the three types ────────────────────────────────────────────────
    stub_reset()
    stub(mode="tiered", native=1024, allowed=[256, 512, 1024])
    status, body = probe_dimensions(GENERIC)
    print("probe(tiered) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("① 档位型", status == 200 and body["type"] == "tiered" and body["values"] == [256, 512, 1024] and body["native"] == 1024, f"values={body.get('values')} native={body.get('native')}")

    stub(mode="range", native=1024)
    status, body = probe_dimensions(GENERIC)
    print("probe(range) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("② 范围型", status == 200 and body["type"] == "range" and body["native"] == 1024, f"type={body.get('type')} native={body.get('native')} values={body.get('values')}")

    stub(mode="fixed", native=768)
    status, body = probe_dimensions(GENERIC)
    print("probe(fixed) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("③ 固定型", status == 200 and body["type"] == "fixed" and body["native"] == 768 and body["values"] == [768], f"type={body.get('type')} values={body.get('values')}")

    # ── 2. the corners the rules cover ────────────────────────────────────
    stub(mode="tiered", native=1024, allowed=[])
    status, body = probe_dimensions(GENERIC)
    print("probe(0-tier) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("0 档回退", status == 200 and body["type"] == "tiered" and body["values"] == [] and body["native"] == 1024, f"values={body.get('values')} native={body.get('native')}")

    stub(mode="tiered", native=640, allowed=[256, 640])
    status, body = probe_dimensions(GENERIC)
    print("probe(native outside table) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("原生补验（640 ∉ 表 ⇒ 通过后并入）", status == 200 and 640 in body["values"], f"values={body.get('values')}")

    stub(mode="clamp", native=1024)
    status, body = probe_dimensions(GENERIC)
    print("probe(clamped 1536) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("钳位（200 但宽度≠所求 ⇒ 不列）", status == 200 and 1536 not in body["values"], f"values={body.get('values')}")

    stub_reset()
    stub(mode="range", native=1024)
    probe_dimensions(GENERIC)
    asked = [entry["body"].get("dimensions") for entry in stub_log() if entry["path"].endswith("/v1/embeddings")]
    leg("② 上界验证（恒发一发 dimensions=<原生>）", 1024 in asked, f"asked={asked}")

    # ── 3. connectivity, four states ──────────────────────────────────────
    embedding_leg = {"leg": "embedding", "provider": "openai-compatible", "model": "stub-embed"}
    stub(mode="tiered", native=1024, allowed=[256, 512, 1024])
    status, body = probe_connectivity({**embedding_leg, "embedding_dimension": 1024})
    print("connectivity(ok) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("连通 = ok", status == 200 and body["status"] == "ok" and body.get("measured_dimension") == 1024, json.dumps(body, ensure_ascii=False))

    stub(mode="clamp", native=1024)
    status, body = probe_connectivity({**embedding_leg, "embedding_dimension": 1536})
    print("connectivity(dimension_unavailable) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("连通 = dimension_unavailable（橙的第二种原因）", status == 200 and body["status"] == "dimension_unavailable", json.dumps(body, ensure_ascii=False))

    stub(mode="refuse")
    status, body = probe_connectivity({**embedding_leg, "embedding_dimension": 1024})
    print("connectivity(refused) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("连通 = refused（凭据被拒）", status == 200 and body["status"] == "refused", json.dumps(body, ensure_ascii=False))

    status, body = probe_connectivity({**embedding_leg, "base_url": "http://127.0.0.1:9/v1", "embedding_dimension": 1024})
    print("connectivity(unreachable) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("连通 = unreachable（连不上）", status == 200 and body["status"] == "unreachable", json.dumps(body, ensure_ascii=False))

    stub(mode="tiered")
    status, body = probe_connectivity({"leg": "rerank", "provider": "generic-rerank", "model": "stub-rerank", "base_url": STUB})
    print("connectivity(rerank ok) ->", status, json.dumps(body, ensure_ascii=False), flush=True)
    leg("重排腿一发连通", status == 200 and body["status"] == "ok", json.dumps(body, ensure_ascii=False))

    # ── 4. the field round-trip (width unchanged ⇒ no migration) ──────────
    before_state = json.dumps(get_migration(), ensure_ascii=False)
    status, body = put_config({"embedding_dimension": 1024})
    print("PUT dimension=1024 ->", status, json.dumps(body.get("migration"), ensure_ascii=False), flush=True)
    leg(
        "同值保存不触发迁移（前后结论一致，宽度仍是 1024）",
        status == 200 and (body.get("migration") or {}).get("state") != "running" and json.dumps(get_migration(), ensure_ascii=False) == before_state and body["config"]["embedding_dimension"] == 1024,
        f"before={before_state} after={json.dumps(get_migration(), ensure_ascii=False)}",
    )

    status, body = put_config({"rerank_model": "stub-rerank-v2", "embedding_dimension": 1024})
    leg("无关编辑不抹掉维度（整对象提交时它原样回来）", status == 200 and body["config"]["embedding_dimension"] == 1024, f"dimension={body.get('config', {}).get('embedding_dimension')}")

    # ── 5. the width migration, end to end (D5-2 / D5-6 / D5-7) ───────────
    stub(mode="range", native=2048)
    print("collections before ->", qdrant_collections(), flush=True)
    status, body = put_config({"embedding_dimension": 1000})
    print("PUT free value 1000 ->", status, json.dumps(body.get("migration"), ensure_ascii=False), flush=True)
    leg("自由值（表外，模型能给 ⇒ 放行 + 启动迁移）", status == 200 and (body.get("migration") or {}).get("state") == "running", json.dumps(body.get("migration"), ensure_ascii=False))

    settled = wait_until(lambda: (get_migration() or {}).get("state") != "running", timeout=180)
    state_after = get_migration() or {}
    collections_after = qdrant_collections()
    stored = json.loads((ISO / "rag_config.json").read_text(encoding="utf-8"))
    print("migration settled ->", json.dumps(state_after, ensure_ascii=False), flush=True)
    print("collections after ->", collections_after, flush=True)
    leg(
        "迁移端到端（建新代 → 完成才翻 → 删旧代）",
        settled and state_after.get("state") == "succeeded" and stored.get("embedding_dimension") == 1000 and "kb_chunks_1000" in collections_after and "kb_chunks" not in collections_after,
        f"state={state_after.get('state')} stored={stored.get('embedding_dimension')} collections={collections_after}",
    )

    stub(mode="range", native=1024)
    status, body = put_config({"embedding_dimension": None})
    print("PUT clear the declaration ->", status, json.dumps(body.get("migration"), ensure_ascii=False), flush=True)
    wait_until(lambda: (get_migration() or {}).get("state") != "running", timeout=180)
    back = qdrant_collections()
    stored = json.loads((ISO / "rag_config.json").read_text(encoding="utf-8"))
    leg("反向迁移（回到默认宽度 ⇒ 无后缀名）", "kb_chunks" in back and "kb_chunks_1000" not in back and "embedding_dimension" not in stored, f"collections={back} stored={stored.get('embedding_dimension')}")

    # ── 6. the control group: no declaration ⇒ the request has no key ────
    stub_reset()
    put_config({"embedding_model": "stub-embed-2"})
    bodies = [entry["body"] for entry in stub_log() if entry["path"].endswith("/v1/embeddings")]
    leg("对照组（不声明 ⇒ 请求体无 dimensions，逐字节如旧）", bool(bodies) and all("dimensions" not in body for body in bodies), f"keys={sorted(bodies[-1].keys()) if bodies else []}")

    # ── 7. a refused value, and the endpoint that gets remembered ─────────
    # Last on purpose: a single-row 400 carrying `dimensions` makes the runtime drop the
    # parameter for this endpoint process-locally (the D2 甲a heal), so the legs above must
    # run before this one.
    stub_reset()
    stub(mode="tiered", native=1024, allowed=[256, 512, 1024])
    status, body = put_config({"embedding_dimension": 999})
    text = json.dumps(body, ensure_ascii=False)
    print("PUT free value 999 (refused by the model) ->", status, text[:220], flush=True)
    leg("自由值（模型给不了 ⇒ 400 + 可执行文案）", status == 400 and "999" in text and "维度" in text, text[:160])

    stub_reset()
    put_config({"embedding_model": "stub-embed-3"})
    bodies = [entry["body"] for entry in stub_log() if entry["path"].endswith("/v1/embeddings")]
    print("requests after the refusal ->", json.dumps([sorted(body.keys()) for body in bodies], ensure_ascii=False), flush=True)
    leg("被判「不吃参数」的端点之后不再白带 dimensions（D2 甲a 自愈）", bool(bodies) and all("dimensions" not in body for body in bodies), f"keys={sorted(bodies[-1].keys()) if bodies else []}")

    print("\n==== summary ====", flush=True)
    failed = [name for name, ok, _ in RESULTS if not ok]
    for name, ok, _ in RESULTS:
        print(f"{'PASS' if ok else 'FAIL'}  {name}", flush=True)
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} legs passed", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
