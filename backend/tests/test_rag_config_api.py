"""Seam A tests for the admin RAG config API (``GET/PUT /api/rag/config``).

Spec 2026-09-10 rag functional-model config §4/§6. The settings UI reads the effective
RAG functional-model configuration (secrets masked, each field's origin reported) and
writes the whole set back to the API-writable ``rag_config.json`` only — never to
``config.yaml``. A submitted masking sentinel means "keep the stored key".
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from _router_auth_helpers import make_authed_test_app
from fastapi.testclient import TestClient

from app.gateway.auth.models import User
from app.gateway.routers import rag_config as rag_config_router
from deerflow.config.app_config import get_app_config, reset_app_config
from deerflow.config.rag_config_file import MASKED_SECRET

SANDBOX = {"use": "deerflow.sandbox.local:LocalSandboxProvider"}

YAML_RAG = {
    "qdrant_url": "http://qdrant:6333",
    "embedding_model": "yaml-embedding",
    "rerank_model": "yaml-rerank",
    "vlm_model": "yaml-vlm",
    "worker_concurrency": 4,
    "video": {"enabled": False, "asr_model": "yaml-asr"},
}


def _write_config_yaml(root: Path) -> None:
    (root / "config.yaml").write_text(
        yaml.safe_dump({"sandbox": SANDBOX, "models": [], "rag": YAML_RAG}),
        encoding="utf-8",
    )


def _write_rag_json(root: Path, payload: dict) -> None:
    (root / "rag_config.json").write_text(json.dumps(payload), encoding="utf-8")


def _read_rag_json(root: Path) -> dict:
    return json.loads((root / "rag_config.json").read_text(encoding="utf-8"))


@pytest.fixture
def config_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config_yaml = tmp_path / "config.yaml"
    models_json = tmp_path / "models_config.json"
    extensions = tmp_path / "extensions_config.json"
    models_json.write_text(json.dumps({"models": []}), encoding="utf-8")
    extensions.write_text(json.dumps({"mcpServers": {}, "skills": {}}), encoding="utf-8")
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(config_yaml))
    monkeypatch.setenv("DEER_FLOW_MODELS_CONFIG_PATH", str(models_json))
    monkeypatch.setenv("DEER_FLOW_EXTENSIONS_CONFIG_PATH", str(extensions))
    monkeypatch.setenv("DEER_FLOW_RAG_CONFIG_PATH", str(tmp_path / "rag_config.json"))
    # Keep the secret-source expectations independent of the ambient environment.
    for name in ("DASHSCOPE_EMBEDDING_API_KEY", "DASHSCOPE_RERANK_API_KEY", "DASHSCOPE_API_KEY", "MINERU_API_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    _write_config_yaml(tmp_path)
    _write_rag_json(tmp_path, {})
    reset_app_config()
    yield tmp_path
    reset_app_config()


def _client(*, system_role: str) -> TestClient:
    app = make_authed_test_app(
        user_factory=lambda: User(
            email=f"{system_role}-rag-test@example.com",
            password_hash="x",
            system_role=system_role,
            id=uuid4(),
        )
    )
    app.include_router(rag_config_router.router)
    return TestClient(app)


# ── admin gate ────────────────────────────────────────────────────────────


def test_rag_config_requires_admin(config_env: Path):
    with _client(system_role="user") as client:
        assert client.get("/api/rag/config").status_code == 403
        assert client.put("/api/rag/config", json={"embedding_model": "x"}).status_code == 403
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").status_code == 200


# ── read: effective values + masked secrets + per-field origin ────────────


def test_get_reports_effective_values_and_origins(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _write_rag_json(config_env, {"embedding_model": "ui-embedding", "embedding_api_key": "sk-embed"})
    monkeypatch.setenv("DASHSCOPE_RERANK_API_KEY", "sk-env-rerank")

    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    config = body["config"]
    assert config["embedding_model"] == "ui-embedding"  # file wins over config.yaml
    assert config["rerank_model"] == "yaml-rerank"  # untouched -> config.yaml
    assert config["video"]["asr_model"] == "yaml-asr"
    assert config["embedding_api_key"] == MASKED_SECRET
    assert config["rerank_api_key"] == ""  # env-backed, never echoed
    assert config["mineru_api_token"] == ""

    sources = body["sources"]
    assert sources["embedding_model"] == "ui"
    assert sources["rerank_model"] == "config_file"
    assert sources["video.asr_model"] == "config_file"
    assert sources["embedding_api_key"] == "ui"
    assert sources["rerank_api_key"] == "env"
    assert sources["mineru_api_token"] == "unset"


def test_get_never_returns_a_stored_secret(config_env: Path):
    _write_rag_json(config_env, {"vlm_api_key": "sk-super-secret"})

    with _client(system_role="admin") as client:
        response = client.get("/api/rag/config")

    assert "sk-super-secret" not in response.text
    assert response.json()["config"]["vlm_api_key"] == MASKED_SECRET


# ── write: validation, masking, and the file-only boundary ───────────────


def test_put_rejects_unknown_field(config_env: Path):
    _write_rag_json(config_env, {"embedding_model": "kept"})

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"embedding_modle": "typo"})

    assert response.status_code == 422
    assert _read_rag_json(config_env) == {"embedding_model": "kept"}


def test_put_rejects_invalid_video_provider(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"video": {"asr_provider": "bogus"}})

    assert response.status_code == 422
    assert _read_rag_json(config_env) == {}


def test_put_writes_only_the_rag_file(config_env: Path):
    yaml_before = (config_env / "config.yaml").read_bytes()

    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={
                "embedding_model": "ui-embedding",
                "rerank_model": "ui-rerank",
                "video": {"asr_model": "ui-asr"},
            },
        )

    assert response.status_code == 200
    stored = _read_rag_json(config_env)
    assert stored["embedding_model"] == "ui-embedding"
    assert stored["rerank_model"] == "ui-rerank"
    assert stored["video"] == {"asr_model": "ui-asr"}
    assert (config_env / "config.yaml").read_bytes() == yaml_before


def test_put_sentinel_preserves_the_stored_secret(config_env: Path):
    _write_rag_json(config_env, {"embedding_api_key": "sk-stored"})

    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={"embedding_model": "ui-embedding", "embedding_api_key": MASKED_SECRET},
        )

    assert response.status_code == 200
    stored = _read_rag_json(config_env)
    assert stored["embedding_api_key"] == "sk-stored"
    assert stored["embedding_model"] == "ui-embedding"

    with _client(system_role="admin") as client:
        client.put("/api/rag/config", json={"embedding_model": "ui-embedding", "embedding_api_key": "sk-rotated"})

    assert _read_rag_json(config_env)["embedding_api_key"] == "sk-rotated"


def test_put_omitting_a_field_clears_it(config_env: Path):
    """The whole object is replaced, so dropping a field reverts it to config.yaml."""
    _write_rag_json(config_env, {"rerank_model": "ui-rerank", "embedding_model": "ui-embedding"})

    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"embedding_model": "ui-embedding"}).status_code == 200

    stored = _read_rag_json(config_env)
    assert "rerank_model" not in stored
    assert get_app_config().rag.rerank_model == "yaml-rerank"  # back to config.yaml


# ── hot reload through the shared config singleton ────────────────────────


def test_put_takes_effect_without_a_restart(config_env: Path):
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["config"]["embedding_model"] == "yaml-embedding"
        assert client.put("/api/rag/config", json={"embedding_model": "ui-embedding"}).status_code == 200
        body = client.get("/api/rag/config").json()

    assert body["config"]["embedding_model"] == "ui-embedding"
    assert body["sources"]["embedding_model"] == "ui"
    assert get_app_config().rag.embedding_model == "ui-embedding"


# ── support bundle redacts the rag file ───────────────────────────────────


def test_support_bundle_redacts_rag_config(config_env: Path):
    import support_bundle

    _write_rag_json(
        config_env,
        {
            "embedding_model": "ui-embedding",
            "embedding_api_key": "sk-embed-secret",
            "rerank_api_key": "sk-rerank-secret",
            "vlm_api_key": "sk-vlm-secret",
            "mineru_api_token": "mineru-secret",
        },
    )

    summary = support_bundle.collect_rag_summary(config_env / "rag_config.json")
    blob = json.dumps(summary)

    for secret in ("sk-embed-secret", "sk-rerank-secret", "sk-vlm-secret", "mineru-secret"):
        assert secret not in blob
    assert summary["embedding_model"] == "ui-embedding"
    assert summary["embedding_api_key"] == "<redacted>"
    assert summary["mineru_api_token"] == "<redacted>"
    # The bundle advertises the artifact it now ships.
    names = [entry["path"] for entry in support_bundle._evidence_files(include_doctor=False, include_thread_summary=False)]
    assert "rag-summary.json" in names
