"""Seam A: the admin models-management API (``GET/PUT /api/models/config``).

Spec 2026-09-10 §5.3–§5.5 / §7.2. The web Models surface never accepts a
free-text ``use:`` class path (a dynamic-import boundary); it submits a curated
provider id that :data:`PROVIDER_ALLOWLIST` maps to a fixed class path and the
correct endpoint key. Reads mask ``api_key`` behind a sentinel that writes
accept as "keep the stored key". Writes go only to ``models_config.json``
(atomic, lock-serialized) and are reflected by the public ``GET /api/models``
through the config hot-reload signature.
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
from app.gateway.routers import models as models_router
from deerflow.config.app_config import reset_app_config
from deerflow.config.models_config import MASKED_API_KEY


def _write_yaml_models(root: Path, models: list[dict]) -> None:
    (root / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "config_version": 1,
                "sandbox": {"use": "deerflow.sandbox.local:LocalSandboxProvider"},
                "models": models,
            }
        ),
        encoding="utf-8",
    )


def _write_models_json(root: Path, models: list[dict]) -> None:
    (root / "models_config.json").write_text(json.dumps({"models": models}), encoding="utf-8")


def _read_models_json(root: Path) -> list[dict]:
    return json.loads((root / "models_config.json").read_text(encoding="utf-8"))["models"]


@pytest.fixture
def config_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(tmp_path / "config.yaml"))
    monkeypatch.setenv("DEER_FLOW_MODELS_CONFIG_PATH", str(tmp_path / "models_config.json"))
    reset_app_config()
    yield tmp_path
    reset_app_config()


def _make_app(*, system_role: str):
    return make_authed_test_app(
        user_factory=lambda: User(
            email=f"{system_role}-models-test@example.com",
            password_hash="x",
            system_role=system_role,
            id=uuid4(),
        )
    )


def _client(*, system_role: str) -> TestClient:
    app = _make_app(system_role=system_role)
    app.include_router(models_router.router)
    return TestClient(app)


def _seed(root: Path) -> None:
    _write_yaml_models(
        root,
        [
            {
                "name": "cfg-model",
                "use": "langchain_openai:ChatOpenAI",
                "model": "gpt-4",
                "api_key": "sk-yaml-secret",
                "base_url": "https://yaml.example/v1",
            }
        ],
    )
    _write_models_json(
        root,
        [
            {
                "name": "ui-model",
                "use": "deerflow.models.patched_deepseek:PatchedChatDeepSeek",
                "model": "deepseek-chat",
                "api_key": "sk-ui-secret",
                "api_base": "https://ui.example/v1",
                "display_name": "UI DeepSeek",
            }
        ],
    )


# ── admin gate ────────────────────────────────────────────────────────────


def test_models_config_requires_admin(config_env: Path):
    _seed(config_env)
    with _client(system_role="user") as client:
        assert client.get("/api/models/config").status_code == 403
        assert client.put("/api/models/config", json={"models": []}).status_code == 403
    with _client(system_role="admin") as client:
        assert client.get("/api/models/config").status_code == 200


# ── read: masking + provider reverse lookup + source/editable ─────────────


def test_get_models_config_masks_and_reports_source(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        body = client.get("/api/models/config").json()

    by_name = {m["name"]: m for m in body["models"]}
    ui = by_name["ui-model"]
    cfg = by_name["cfg-model"]

    assert ui["api_key"] == MASKED_API_KEY
    assert cfg["api_key"] == MASKED_API_KEY
    assert ui["provider"] == "deepseek"
    assert ui["endpoint_key"] == "api_base"
    assert ui["endpoint"] == "https://ui.example/v1"
    assert ui["source"] == "ui"
    assert ui["editable"] is True
    assert cfg["provider"] == "openai-compatible"
    assert cfg["endpoint_key"] == "base_url"
    assert cfg["source"] == "config_file"
    assert cfg["editable"] is False


# ── write: allowlist + shape validation ───────────────────────────────────


def test_put_rejects_non_allowlisted_provider(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/models/config",
            json={"models": [{"provider": "acme", "name": "x", "model": "x", "api_key": "k"}]},
        )
    assert response.status_code == 422
    assert _read_models_json(config_env)[0]["name"] == "ui-model"


def test_put_rejects_free_text_use(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/models/config",
            json={"models": [{"provider": "deepseek", "name": "x", "model": "x", "api_key": "k", "use": "os:system"}]},
        )
    assert response.status_code == 422
    stored = _read_models_json(config_env)
    assert all(entry.get("use") != "os:system" for entry in stored)


# ── write: endpoint key mapping per provider ──────────────────────────────


def test_put_maps_endpoint_key_per_provider(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/models/config",
            json={
                "models": [
                    {"provider": "deepseek", "name": "ds", "model": "deepseek-chat", "api_key": "k1", "endpoint": "https://ds.example"},
                    {"provider": "openai-compatible", "name": "oa", "model": "gpt-4", "api_key": "k2", "endpoint": "https://oa.example/v1"},
                ]
            },
        )
    assert response.status_code == 200
    stored = {entry["name"]: entry for entry in _read_models_json(config_env)}
    assert stored["ds"]["use"] == "deerflow.models.patched_deepseek:PatchedChatDeepSeek"
    assert stored["ds"]["api_base"] == "https://ds.example"
    assert "base_url" not in stored["ds"]
    assert stored["oa"]["use"] == "langchain_openai:ChatOpenAI"
    assert stored["oa"]["base_url"] == "https://oa.example/v1"
    assert "api_base" not in stored["oa"]


# ── write: sentinel preserves the stored key ──────────────────────────────


def test_put_sentinel_preserves_stored_key(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/models/config",
            json={"models": [{"provider": "deepseek", "name": "ui-model", "model": "deepseek-chat", "api_key": MASKED_API_KEY}]},
        )
    assert response.status_code == 200
    stored = _read_models_json(config_env)[0]
    assert stored["api_key"] == "sk-ui-secret"

    with _client(system_role="admin") as client:
        response = client.put(
            "/api/models/config",
            json={"models": [{"provider": "deepseek", "name": "ui-model", "model": "deepseek-chat", "api_key": "sk-rotated"}]},
        )
    assert response.status_code == 200
    assert _read_models_json(config_env)[0]["api_key"] == "sk-rotated"


# ── write reflected by the public list via hot reload ─────────────────────


def test_put_then_public_models_reflect(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        assert client.put("/api/models/config", json={"models": [{"provider": "deepseek", "name": "brand-new", "model": "deepseek-chat", "api_key": "k"}]}).status_code == 200
        public = client.get("/api/models").json()
    assert "brand-new" in {m["name"] for m in public["models"]}


# ── atomic write leaves no temp file ──────────────────────────────────────


def test_put_leaves_no_temp_file(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        client.put("/api/models/config", json={"models": [{"provider": "deepseek", "name": "ui-model", "model": "deepseek-chat", "api_key": MASKED_API_KEY}]})
    leftovers = [p.name for p in config_env.iterdir() if p.name.endswith(".tmp") or p.name.startswith(".models_config.json.")]
    assert leftovers == []


# ── support bundle redacts the models file ────────────────────────────────


def test_support_bundle_redacts_models_config(config_env: Path):
    import support_bundle

    _seed(config_env)
    summary = support_bundle.collect_models_summary(config_env / "models_config.json")
    blob = json.dumps(summary)
    assert "sk-ui-secret" not in blob
    assert summary["models"][0]["api_key"] == "<redacted>"
