"""Seam A: the admin models-management API (``GET/PUT /api/models/config``).

Spec 2026-09-10 §5.3–§5.5 / §7.2. The web Models surface never accepts a
free-text ``use:`` class path (a dynamic-import boundary); it submits a curated
provider id that :data:`PROVIDER_ALLOWLIST` maps to a fixed class path and the
correct endpoint key. Reads mask ``api_key`` behind a sentinel that writes
accept as "keep the stored key". Writes go only to ``models_config.json``
(atomic, lock-serialized) and are reflected by the public ``GET /api/models``
through the config hot-reload signature.

``POST /api/models/config/validate`` (this increment, spec §5.3.2) probes the
provider's model list with the submitted credentials so the add-model wizard can
block step 2 on a bad key/model. It is admin-gated, bounded by a short timeout,
and never persists anything.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
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


# ── validate: credential + model presence probe (spec §5.3.2) ─────────────


def _mock_upstream(
    monkeypatch: pytest.MonkeyPatch,
    *,
    status_code: int = 200,
    payload: object = None,
    text: str = "",
    error: Exception | None = None,
) -> MagicMock:
    """Patch the router's httpx client; returns the inner client for call asserts."""
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = payload
    client = MagicMock()
    client.get = AsyncMock(side_effect=error) if error is not None else AsyncMock(return_value=response)
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=client)
    monkeypatch.setattr(models_router.httpx, "AsyncClient", factory)
    return client


_VALID_BODY = {"provider": "deepseek", "endpoint": "https://ds.example", "api_key": "sk-probe-secret", "model": "deepseek-chat"}


def test_validate_requires_admin(config_env: Path):
    _seed(config_env)
    with _client(system_role="user") as client:
        response = client.post("/api/models/config/validate", json=_VALID_BODY)
    assert response.status_code == 403


def test_validate_reports_model_present(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    upstream = _mock_upstream(monkeypatch, payload={"data": [{"id": "deepseek-reasoner"}, {"id": "deepseek-chat"}]})

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json=_VALID_BODY)

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "model_present": True,
        "detail": "Model 'deepseek-chat' is available.",
    }
    assert upstream.get.await_args.args[0] == "https://ds.example/models"
    assert upstream.get.await_args.kwargs["headers"] == {"Authorization": "Bearer sk-probe-secret"}


def test_validate_reports_model_absent(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, payload={"data": [{"id": "deepseek-reasoner"}]})

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json=_VALID_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["model_present"] is False
    assert "deepseek-chat" in body["detail"]
    assert "deepseek-reasoner" in body["detail"]


def test_validate_reports_unreachable_endpoint(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, error=httpx.ConnectError("connection refused"))

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json=_VALID_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["model_present"] is False
    assert "https://ds.example/models" in body["detail"]
    assert "sk-probe-secret" not in json.dumps(body)


def test_validate_reports_rejected_credentials(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, status_code=401, text='{"error":{"message":"Invalid API key"}}')

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json=_VALID_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["model_present"] is False
    assert "401" in body["detail"]
    assert "Invalid API key" in body["detail"]
    assert "sk-probe-secret" not in json.dumps(body)


def test_validate_uses_anthropic_native_probe(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """Anthropic lists models at a versioned path and authenticates with x-api-key."""
    _seed(config_env)
    upstream = _mock_upstream(monkeypatch, payload={"data": [{"id": "claude-sonnet-4"}]})

    with _client(system_role="admin") as client:
        response = client.post(
            "/api/models/config/validate",
            json={"provider": "anthropic", "endpoint": "https://api.anthropic.com/", "api_key": "sk-ant", "model": "claude-sonnet-4"},
        )

    assert response.status_code == 200
    assert response.json()["model_present"] is True
    assert upstream.get.await_args.args[0] == "https://api.anthropic.com/v1/models"
    headers = upstream.get.await_args.kwargs["headers"]
    assert headers["x-api-key"] == "sk-ant"
    assert headers["anthropic-version"]
    assert "Authorization" not in headers


def test_validate_rejects_unknown_provider(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    upstream = _mock_upstream(monkeypatch, payload={"data": []})

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json={**_VALID_BODY, "provider": "acme"})

    assert response.status_code == 422
    assert "acme" in response.json()["detail"]
    assert upstream.get.await_count == 0


def test_validate_rejects_non_http_endpoint(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    upstream = _mock_upstream(monkeypatch, payload={"data": []})

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json={**_VALID_BODY, "endpoint": "file:///etc/passwd"})

    assert response.status_code == 422
    assert upstream.get.await_count == 0


def test_validate_does_not_persist(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, payload={"data": [{"id": "brand-new"}]})
    before = (config_env / "models_config.json").read_bytes()

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json={**_VALID_BODY, "model": "brand-new"})
        public = client.get("/api/models").json()

    assert response.status_code == 200
    assert response.json()["model_present"] is True
    assert (config_env / "models_config.json").read_bytes() == before
    assert "brand-new" not in {m["name"] for m in public["models"]}


# ── support bundle redacts the models file ────────────────────────────────


def test_support_bundle_redacts_models_config(config_env: Path):
    import support_bundle

    _seed(config_env)
    summary = support_bundle.collect_models_summary(config_env / "models_config.json")
    blob = json.dumps(summary)
    assert "sk-ui-secret" not in blob
    assert summary["models"][0]["api_key"] == "<redacted>"
