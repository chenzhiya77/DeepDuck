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


# ── validate: complete-path endpoint advisory (soft, never blocks) ─────────


def test_validate_warns_when_the_endpoint_is_a_method_path(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """A base-URL field holding `.../chat/completions` is a common paste; say so."""
    _seed(config_env)
    _mock_upstream(monkeypatch, payload={"data": [{"id": "deepseek-chat"}]})

    with _client(system_role="admin") as client:
        response = client.post(
            "/api/models/config/validate",
            json={**_VALID_BODY, "endpoint": "https://ds.example/v1/chat/completions"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True  # soft: the probe result is unchanged
    assert "/chat/completions" in body["warning"]
    assert "base URL" in body["warning"]


def test_validate_warns_on_the_anthropic_messages_path(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, payload={"data": [{"id": "claude-sonnet-4"}]})

    with _client(system_role="admin") as client:
        response = client.post(
            "/api/models/config/validate",
            json={"provider": "anthropic", "endpoint": "https://api.anthropic.com/v1/messages", "api_key": "sk-ant", "model": "claude-sonnet-4"},
        )

    assert response.status_code == 200
    assert "/messages" in response.json()["warning"]


def test_validate_warns_about_a_model_list_paste_even_though_the_probe_tolerates_it(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The probe strips a trailing `/models`, but storing that value still breaks runtime."""
    _seed(config_env)
    upstream = _mock_upstream(monkeypatch, payload={"data": [{"id": "deepseek-chat"}]})

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json={**_VALID_BODY, "endpoint": "https://ds.example/v1/models"})

    body = response.json()
    assert upstream.get.await_args.args[0] == "https://ds.example/v1/models"  # tolerated, no duplication
    assert body["ok"] is True
    assert "/models" in body["warning"]


def test_validate_warning_survives_a_failed_probe(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The advice matters most when the probe just failed."""
    _seed(config_env)
    _mock_upstream(monkeypatch, error=httpx.ConnectError("connection refused"))

    with _client(system_role="admin") as client:
        response = client.post(
            "/api/models/config/validate",
            json={**_VALID_BODY, "endpoint": "https://ds.example/v1/chat/completions"},
        )

    body = response.json()
    assert body["ok"] is False
    assert "base URL" in body["warning"]


def test_validate_has_no_warning_for_a_base_url(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, payload={"data": [{"id": "deepseek-chat"}]})

    with _client(system_role="admin") as client:
        response = client.post("/api/models/config/validate", json={**_VALID_BODY, "endpoint": "https://ds.example/v1"})

    assert "warning" not in response.json()  # absent, not null — the wire stays additive


def test_validate_warning_ignores_a_query_string(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    _seed(config_env)
    _mock_upstream(monkeypatch, error=httpx.ConnectError("connection refused"))

    with _client(system_role="admin") as client:
        response = client.post(
            "/api/models/config/validate",
            json={**_VALID_BODY, "endpoint": "https://ds.example/v1/chat/completions?api-version=2024-10-21"},
        )

    assert "base URL" in response.json()["warning"]


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


# ── write: capability subsets/defaults (plan Task 3', seam A 补口) ────────


_CAPABILITY_MODEL = {
    "provider": "openai-compatible",
    "name": "cap-model",
    "model": "gpt-5",
    "api_key": "k",
    "supports_reasoning_effort": True,
    "supported_context_windows": [200_000, 400_000],
    "context_window": 400_000,
    "supported_reasoning_efforts": ["low", "medium", "high"],
    "reasoning_effort": "medium",
}


def test_put_persists_and_get_round_trips_capability_fields(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        assert client.put("/api/models/config", json={"models": [_CAPABILITY_MODEL]}).status_code == 200
        body = client.get("/api/models/config").json()

    stored = {entry["name"]: entry for entry in _read_models_json(config_env)}["cap-model"]
    assert stored["supported_context_windows"] == [200_000, 400_000]
    assert stored["context_window"] == 400_000
    assert stored["supported_reasoning_efforts"] == ["low", "medium", "high"]
    assert stored["reasoning_effort"] == "medium"

    read = {m["name"]: m for m in body["models"]}["cap-model"]
    assert read["supported_context_windows"] == [200_000, 400_000]
    assert read["supported_reasoning_efforts"] == ["low", "medium", "high"]
    assert read["reasoning_effort"] == "medium"


def test_put_omits_capability_fields_when_not_declared(config_env: Path):
    _seed(config_env)
    with _client(system_role="admin") as client:
        assert client.put("/api/models/config", json={"models": [{"provider": "deepseek", "name": "plain", "model": "deepseek-chat", "api_key": "k"}]}).status_code == 200
    stored = {entry["name"]: entry for entry in _read_models_json(config_env)}["plain"]
    for key in ("supported_context_windows", "supported_reasoning_efforts", "reasoning_effort"):
        assert key not in stored


@pytest.mark.parametrize(
    "override, expected",
    [
        ({"context_window": 1_000_000}, "must be one of supported_context_windows"),
        ({"supported_context_windows": [400_000, 200_000]}, "ascending order"),
        ({"supported_context_windows": [200_000, 200_000]}, "duplicates"),
        ({"supported_context_windows": []}, "must be non-empty"),
        ({"supported_context_windows": [123]}, "outside CONTEXT_WINDOW_OPTIONS"),
        ({"supported_reasoning_efforts": ["high", "low"]}, "minimal<low<medium<high"),
        ({"reasoning_effort": "minimal"}, "must be one of supported_reasoning_efforts"),
    ],
)
def test_put_rejects_invalid_capability_combinations(config_env: Path, override: dict, expected: str):
    """An illegal combination must fail here: it would otherwise brick config loading."""
    _seed(config_env)
    before = (config_env / "models_config.json").read_bytes()

    with _client(system_role="admin") as client:
        response = client.put("/api/models/config", json={"models": [{**_CAPABILITY_MODEL, **override}]})

    assert response.status_code == 422
    assert expected in response.json()["detail"]
    assert (config_env / "models_config.json").read_bytes() == before


def test_public_models_expose_effort_capabilities(config_env: Path):
    """The chat UI reads the model's effort subset/defaults from the public list."""
    _seed(config_env)
    with _client(system_role="admin") as client:
        assert client.put("/api/models/config", json={"models": [_CAPABILITY_MODEL]}).status_code == 200
        public = client.get("/api/models").json()

    entry = {model["name"]: model for model in public["models"]}["cap-model"]
    assert entry["supported_reasoning_efforts"] == ["low", "medium", "high"]
    assert entry["reasoning_effort"] == "medium"


# ── support bundle redacts the models file ────────────────────────────────


def test_support_bundle_redacts_models_config(config_env: Path):
    import support_bundle

    _seed(config_env)
    summary = support_bundle.collect_models_summary(config_env / "models_config.json")
    blob = json.dumps(summary)
    assert "sk-ui-secret" not in blob
    assert summary["models"][0]["api_key"] == "<redacted>"
