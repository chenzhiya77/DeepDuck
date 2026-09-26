"""Drives the real save-time probe and both generic legs against the local stub.

Spec 2026-09-26 rag-endpoint-dedup §4.8: ecosystem base (/v1) and whole-endpoint forms
must both reach the same path; a doubled shape (what the old join produced) must 404.
Run: cd backend && PYTHONPATH=. uv run python ../pr-build/rag-endpoint-dedup-2026-09-26/drive.py
"""

import asyncio
import json

from app.gateway.routers.rag_config import _probe_after_save
from deerflow.config.app_config import RagConfig
from deerflow.knowledge.reranker_generic import GenericReranker

STUB = "http://127.0.0.1:8137"
out = {}


def _pending(embedding_base_url: str) -> RagConfig:
    return RagConfig(
        embedding_provider="openai-compatible",
        embedding_model="stub-embedding",
        embedding_base_url=embedding_base_url,
        embedding_sparse_source="bm25",
        rerank_provider="generic-rerank",
        rerank_model="stub-rerank",
        rerank_base_url=f"{STUB}/v1",
    )


async def main() -> None:
    # The save-time probe, unmodified: build_embedder + one real embed call.
    for name, base in (
        ("eco_base_v1", f"{STUB}/v1"),
        ("whole_endpoint", f"{STUB}/v1/embeddings"),
    ):
        out[f"probe__{name}"] = {"warning": await _probe_after_save(_pending(base))}
    # Control: the doubled shape the old join produced — the stub must refuse it.
    out["probe__control_doubled"] = {
        "warning": await _probe_after_save(_pending(f"{STUB}/v1/v1")),
    }

    # Rerank leg, direct (no probe exists for it): both forms must reach /v1/rerank // /rerank.
    for name, base, expected in (
        ("eco_base_v1", f"{STUB}/v1", "/v1/rerank"),
        ("whole_endpoint", f"{STUB}/rerank", "/rerank"),
    ):
        reranker = GenericReranker(model="stub-rerank", base_url=base, api_key="stub")
        pairs = await reranker.rerank("q", ["a"])
        out[f"rerank__{name}"] = {"pairs": pairs, "expected_path": expected}

    print(json.dumps(out, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
