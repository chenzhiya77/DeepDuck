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
from deerflow.knowledge.providers import provider_ids

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
    for name in (
        "DASHSCOPE_EMBEDDING_API_KEY",
        "DASHSCOPE_RERANK_API_KEY",
        "DASHSCOPE_API_KEY",
        "MINERU_API_TOKEN",
        "RAG_EMBEDDING_API_KEY",
        "RAG_RERANK_API_KEY",
        "RAG_SPARSE_API_KEY",
    ):
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


# ── eval judge (a model reference, never a secret) ────────────────────────


def test_judge_model_round_trips_as_a_regular_field(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"judge_model": "judge-entry"})

    assert response.status_code == 200
    assert _read_rag_json(config_env) == {"judge_model": "judge-entry"}
    body = response.json()
    assert body["config"]["judge_model"] == "judge-entry"
    assert body["sources"]["judge_model"] == "ui"

    with _client(system_role="admin") as client:
        read = client.get("/api/rag/config").json()

    assert read["config"]["judge_model"] == "judge-entry"
    assert read["sources"]["judge_model"] == "ui"


def test_judge_model_falls_back_to_config_yaml(config_env: Path):
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    assert body["config"]["judge_model"] is None
    assert body["sources"]["judge_model"] == "config_file"


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
            "sparse_api_key": "sk-sparse-secret",
        },
    )

    summary = support_bundle.collect_rag_summary(config_env / "rag_config.json")
    blob = json.dumps(summary)

    for secret in ("sk-embed-secret", "sk-rerank-secret", "sk-vlm-secret", "mineru-secret", "sk-sparse-secret"):
        assert secret not in blob
    assert summary["embedding_model"] == "ui-embedding"
    assert summary["embedding_api_key"] == "<redacted>"
    assert summary["mineru_api_token"] == "<redacted>"
    # The sparse key is covered by the same key-name pattern, so it needs no special case.
    assert summary["sparse_api_key"] == "<redacted>"
    # The bundle advertises the artifact it now ships.
    names = [entry["path"] for entry in support_bundle._evidence_files(include_doctor=False, include_thread_summary=False)]
    assert "rag-summary.json" in names


# ── provider dimension (spec 2026-09-14 rag model provider adaptation §4.1) ──


def test_get_reports_the_provider_fields_with_their_origins(config_env: Path):
    """The new fields ride the same generic path as every other non-secret field."""
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    assert body["config"]["embedding_provider"] == "dashscope"
    assert body["config"]["rerank_provider"] == "dashscope"
    assert body["config"]["parse_provider"] == "mineru-cloud"
    assert body["config"]["embedding_sparse_source"] == "provider"
    assert body["sources"]["embedding_provider"] == "config_file"
    assert body["sources"]["parse_base_url"] == "config_file"


def test_put_round_trips_the_provider_fields_and_marks_them_ui(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={
                "embedding_provider": "openai-compatible",
                "embedding_base_url": "http://localhost:8080/v1",
                "embedding_sparse_source": "bm25",
                "rerank_provider": "generic-rerank",
                "rerank_base_url": "http://localhost:8000",
                "parse_provider": "mineru-local",
                "parse_base_url": "http://localhost:30000",
                "parse_backend": "hybrid",
            },
        )
        assert response.status_code == 200
        body = response.json()

    assert body["config"]["embedding_provider"] == "openai-compatible"
    assert body["config"]["parse_backend"] == "hybrid"
    assert body["sources"]["parse_provider"] == "ui"
    stored = _read_rag_json(config_env)
    assert stored["parse_base_url"] == "http://localhost:30000"
    assert stored["embedding_sparse_source"] == "bm25"


def test_put_rejects_a_provider_outside_the_allowlist(config_env: Path):
    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"embedding_provider": "some-vendor"}).status_code == 422


def test_put_rejects_the_pipeline_backend(config_env: Path):
    """D2 supports the http-client deployment shape; `pipeline` has no such variant."""
    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"parse_backend": "pipeline"}).status_code == 422


def test_sparse_api_key_is_treated_as_a_secret(config_env: Path):
    """Left out of ``_SECRET_FIELDS`` this key would come back in plaintext."""
    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"sparse_api_key": "sk-sparse"}).status_code == 200
        body = client.get("/api/rag/config").json()

    assert body["config"]["sparse_api_key"] == MASKED_SECRET
    assert body["sources"]["sparse_api_key"] == "ui"
    assert "sk-sparse" not in json.dumps(body)

    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"sparse_api_key": MASKED_SECRET}).status_code == 200
    assert _read_rag_json(config_env)["sparse_api_key"] == "sk-sparse"


def test_embedding_secret_env_source_follows_the_selected_provider(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The reported fallback must be the variable the *selected* provider reads."""
    monkeypatch.setenv("DASHSCOPE_EMBEDDING_API_KEY", "env-dashscope")
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["sources"]["embedding_api_key"] == "env"
        switched = client.put("/api/rag/config", json={"embedding_provider": "openai-compatible"}).json()
        # The switch re-points the fallback in the same response, not only after a reload.
        assert switched["sources"]["embedding_api_key"] == "unset"
        assert client.get("/api/rag/config").json()["sources"]["embedding_api_key"] == "unset"
        monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "env-generic")
        assert client.get("/api/rag/config").json()["sources"]["embedding_api_key"] == "env"


def test_rerank_secret_env_source_follows_the_provider(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DASHSCOPE_RERANK_API_KEY", "env-dashscope")
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["sources"]["rerank_api_key"] == "env"
        client.put("/api/rag/config", json={"rerank_provider": "generic-rerank"})
        assert client.get("/api/rag/config").json()["sources"]["rerank_api_key"] == "unset"
        monkeypatch.setenv("RAG_RERANK_API_KEY", "env-generic")
        assert client.get("/api/rag/config").json()["sources"]["rerank_api_key"] == "env"


def test_local_mineru_has_no_secret_fallback(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The local MinerU service ships without auth, so its token has no env source."""
    monkeypatch.setenv("MINERU_API_TOKEN", "tok")
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["sources"]["mineru_api_token"] == "env"
        client.put("/api/rag/config", json={"parse_provider": "mineru-local"})
        assert client.get("/api/rag/config").json()["sources"]["mineru_api_token"] == "unset"


def test_sparse_secret_env_source_uses_the_generic_name(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RAG_SPARSE_API_KEY", "env-sparse")
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["sources"]["sparse_api_key"] == "env"


# ── embedding provider capabilities (spec 2026-09-16 §3 D1) ──────────────────
#
# The capability block is what lets the settings UI refuse a combination that cannot work
# (a dense-only provider asked to supply the sparse half) before it is ever saved. The
# golden below was captured from the *pre-change* endpoints (see `_precondition` in it), so
# "pure addition" is measured against real bytes rather than a hand-written expectation.

_GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "rag_config" / "response_golden.json").read_text(encoding="utf-8"))
_CAPABILITY_FIELD = "embedding_providers"


def _assert_pure_addition(body: dict, golden: dict) -> None:
    """The response may only have *gained* the capability field; nothing else may move.

    Two ordered assertions on purpose: a shape change names the offending key, a value
    change shows the field-by-field diff.
    """
    assert set(body) == set(golden) | {_CAPABILITY_FIELD}
    assert {key: value for key, value in body.items() if key != _CAPABILITY_FIELD} == golden


def test_get_returns_the_embedding_provider_capabilities(config_env: Path):
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    # The list mirrors the curated allowlist in its own order — never a second copy of it.
    assert [entry["provider_id"] for entry in body[_CAPABILITY_FIELD]] == list(provider_ids("embedding"))
    assert {entry["provider_id"]: entry["emits_sparse"] for entry in body[_CAPABILITY_FIELD]} == {
        "dashscope": True,
        "openai-compatible": False,
    }


def test_get_response_only_gained_the_capability_field(config_env: Path):
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    _assert_pure_addition(body, _GOLDEN["get"])


def test_put_response_only_gained_the_capability_field(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json=_GOLDEN["put"]["payload"])

    assert response.status_code == 200
    _assert_pure_addition(response.json(), _GOLDEN["put"]["response"])
