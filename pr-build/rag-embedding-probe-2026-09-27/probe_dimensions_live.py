"""Live dimension probe against DashScope's native embedding API (no repo code in the path).

Raw HTTP only, key from the repo's gitignored .env files (never printed). Purpose: establish
that a 200 can lie — `qwen3.7-text-embedding-flash` accepts dimension 1536/2048/2560 and still
returns 1024 — so the probe design judges "passed" as `200 AND returned width == requested`.

Rerun from the repo root:
    backend/.venv/Scripts/python.exe pr-build/rag-embedding-probe-2026-09-27/probe_dimensions_live.py
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
URL = "https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding"
FLASH = "qwen3.7-text-embedding-flash"
CONTROLS = ("qwen3.7-text-embedding", "text-embedding-v4")

for env_file in (REPO / ".env", REPO / "backend" / ".env"):
    if not env_file.exists():
        continue
    for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ[name.strip()] = value.strip().strip('"').strip("'")

key = os.environ["DASHSCOPE_EMBEDDING_API_KEY"]
print(f"key loaded: {bool(key)} (value never printed)")


def call(model: str, dimension: int | None) -> tuple[int | str, str]:
    params: dict[str, object] = {"output_type": "dense", "text_type": "document"}
    if dimension is not None:
        params["dimension"] = dimension
    body = {"model": model, "input": {"texts": ["probe"]}, "parameters": params}
    try:
        response = httpx.post(
            URL, headers={"Authorization": f"Bearer {key}"}, json=body, timeout=30.0
        )
    except Exception as exc:  # noqa: BLE001 - transport failures are part of the record
        return "TRANSPORT", str(exc)[:120]
    if response.status_code != 200:
        try:
            payload = response.json()
            message = str(payload.get("message") or payload)
        except Exception:  # noqa: BLE001
            message = response.text
        return response.status_code, " ".join(message.split())[:150]
    embeddings = (response.json().get("output") or {}).get("embeddings") or [{}]
    width = len(embeddings[0].get("embedding") or [])
    return response.status_code, f"width={width}"


def row(model: str, dimension: int | None) -> None:
    label = "no-param" if dimension is None else str(dimension)
    status, note = call(model, dimension)
    print(f"{model:28s} dimension={label:>8s}  status={str(status):>9s}  {note}")


print("\n== target model (what the probe must classify) ==")
for dim in (None, 128, 256, 333, 512, 768, 1024, 1536, 2048, 2560, 3072):
    row(FLASH, dim)

print("\n== control: same key, same endpoint, other models ==")
for model in CONTROLS:
    for dim in (1536, 2048):
        row(model, dim)
