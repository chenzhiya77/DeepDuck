"""Shared fixtures for knowledge-base (RAG) tests."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

QDRANT_TEST_URL = os.environ.get("QDRANT_TEST_URL", "http://127.0.0.1:6333")


def _qdrant_available() -> bool:
    """Probe the Qdrant service with a short-timeout sync client.

    Mirrors the ``_redis_available`` pattern in tests/test_stream_bridge.py:
    runs at collection time so the integration suite degrades to skips when
    the service is not running.
    """
    try:
        from qdrant_client import QdrantClient
    except ImportError:
        return False
    try:
        client = QdrantClient(QDRANT_TEST_URL, timeout=1.0)
        try:
            client.get_collections()
        finally:
            client.close()
        return True
    except Exception:
        return False


requires_qdrant = pytest.mark.skipif(not _qdrant_available(), reason=f"Qdrant not reachable at {QDRANT_TEST_URL}")


@pytest_asyncio.fixture
async def session_factory(tmp_path) -> AsyncIterator:
    """Bootstrap a throwaway SQLite database at alembic head per test."""
    from deerflow.config.database_config import DatabaseConfig
    from deerflow.persistence.engine import close_engine, get_session_factory, init_engine_from_config

    await init_engine_from_config(DatabaseConfig(backend="sqlite", sqlite_dir=str(tmp_path)))
    try:
        sf = get_session_factory()
        assert sf is not None
        yield sf
    finally:
        await close_engine()
