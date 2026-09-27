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

import httpx
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

#: Captured before any fixture patches it, so a test that needs its own transport can build on
#: the real class instead of chaining onto whatever stub ran first.
_REAL_ASYNC_CLIENT = httpx.AsyncClient

YAML_RAG = {
    "qdrant_url": "http://qdrant:6333",
    "embedding_model": "yaml-embedding",
    "rerank_model": "yaml-rerank",
    "vlm_model": "yaml-vlm",
    "worker_concurrency": 4,
    "video": {"enabled": False, "asr_model": "yaml-asr"},
}

#: The model names this file's payloads declare, as ``config.yaml`` entries. They have to
#: exist: since spec 2026-09-23 D10.1 a save refuses a declared name that is not a configured
#: entry (the not-found mapping below), and the legacy fixtures declared names into an empty
#: model list. They are YAML entries on purpose -- the strict missing-key/address rule covers
#: UI-managed entries only, so an operator's own file stays out of it.
YAML_MODELS = [
    {"name": name, "use": "langchain_openai:ChatOpenAI", "model": "gpt-test", "api_key": "test-key", "base_url": "https://yaml.example/v1"}
    for name in ("B", "default-entry", "rag-default", "ui-default", "yaml-default", "judge-entry", "yaml-vlm")
]


def _write_config_yaml(root: Path, rag: dict | None = None) -> None:
    (root / "config.yaml").write_text(
        yaml.safe_dump({"sandbox": SANDBOX, "models": YAML_MODELS, "rag": rag or YAML_RAG}),
        encoding="utf-8",
    )


def _seed_ui_model(root: Path, *, name: str, api_key: str | None = "sk-ui", base_url: str | None = "https://ui.example/v1") -> None:
    """One UI-managed (models_config.json) entry, complete by default.

    Omitting a value is how a case builds the incomplete target the save-time rule refuses.
    """
    entry: dict = {"name": name, "use": "langchain_openai:ChatOpenAI", "model": "gpt-test"}
    if api_key is not None:
        entry["api_key"] = api_key
    if base_url is not None:
        entry["base_url"] = base_url
    (root / "models_config.json").write_text(json.dumps({"models": [entry]}), encoding="utf-8")


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


_ENDPOINT_FIXTURE = {
    "embedding_base_url": "http://localhost:8080/v1",
    "rerank_base_url": "http://localhost:8000",
}


class _EndpointSeededClient(TestClient):
    """Both endpoints are required (spec 2026-09-25 rag-endpoint-unlock D1/D3).

    Cases that do not care about them get both seeded; a case about the empty state passes a
    key explicitly (an explicit ``""`` wins here and then fails the save on purpose).
    """

    def put(self, url, json=None, **kwargs):
        if url == "/api/rag/config" and isinstance(json, dict):
            json = {**_ENDPOINT_FIXTURE, **json}
        return super().put(url, json=json, **kwargs)


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
    return _EndpointSeededClient(app)


@pytest.fixture(autouse=True)
def _no_outbound_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep this file's saves off the network.

    A PUT that changes an embedding setting now makes one real call (spec 2026-09-17 save-time
    probe), so without a stub these tests would dial whatever address the payload names — the
    golden payload points at ``localhost:8080``. The stub answers a shape both families can read
    (OpenAI's ``data``, DashScope's ``output.embeddings``) at 1024 dimensions, with a sparse half
    so ``sparse_source='provider'`` is satisfied too.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [{"index": 0, "embedding": [0.0] * 1024}],
                "output": {"embeddings": [{"text_index": 0, "embedding": [0.0] * 1024, "sparse_embedding": [{"index": 7, "value": 0.5}]}]},
            },
        )

    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_async_client(transport=httpx.MockTransport(handler)))


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
    _write_rag_json(config_env, {"embedding_api_key": "sk-super-secret"})

    with _client(system_role="admin") as client:
        response = client.get("/api/rag/config")

    assert "sk-super-secret" not in response.text
    assert response.json()["config"]["embedding_api_key"] == MASKED_SECRET


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
    assert _read_rag_json(config_env) == {
        **_ENDPOINT_FIXTURE,
        "judge_model": "judge-entry",
    }
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


# ── the RAG default model (spec 2026-09-23 default model D2) ──────────────
#
# A plain field on the existing whole-object PUT: naming it writes a UI override,
# omitting it withdraws one, and the response reports which of the two happened.


def test_rag_default_model_round_trips_and_reports_its_source(config_env: Path):
    with _client(system_role="admin") as client:
        initial = client.get("/api/rag/config").json()
        assert initial["config"]["default_model"] is None
        assert initial["sources"]["default_model"] == "config_file"

        put = client.put("/api/rag/config", json={"default_model": "default-entry"})
        assert put.status_code == 200
        assert _read_rag_json(config_env) == {**_ENDPOINT_FIXTURE, "default_model": "default-entry"}
        assert put.json()["config"]["default_model"] == "default-entry"
        assert put.json()["sources"]["default_model"] == "ui"

        read = client.get("/api/rag/config").json()

    assert read["config"]["default_model"] == "default-entry"
    assert read["sources"]["default_model"] == "ui"


def test_rag_default_model_falls_back_to_config_yaml(config_env: Path):
    _write_config_yaml(config_env, {**YAML_RAG, "default_model": "yaml-default"})

    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    assert body["config"]["default_model"] == "yaml-default"
    assert body["sources"]["default_model"] == "config_file"


@pytest.mark.parametrize("blank", ["", "   "])
def test_blank_rag_default_withdraws_the_ui_override(config_env: Path, blank: str):
    """Blank is "undeclared", never a name: it must reach neither the file nor `sources`.

    ``""`` already survives ``_prune_empty()``; the whitespace spelling is the one that needs
    the field validator, because without it the string is written to disk and reported as a
    UI override that the operator never made.
    """
    _write_config_yaml(config_env, {**YAML_RAG, "default_model": "yaml-default"})

    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"default_model": "ui-default"}).status_code == 200
        assert _read_rag_json(config_env)["default_model"] == "ui-default"

        response = client.put("/api/rag/config", json={"default_model": blank})

    assert response.status_code == 200
    assert "default_model" not in _read_rag_json(config_env)
    # Withdrawn, not forced to None: config.yaml's own value is what takes over again.
    # Asserted on a fresh read, not on the PUT response's `config`: that snapshot is the
    # pre-write one for any field the payload omits (pre-existing; the settings UI refetches).
    assert get_app_config().rag.default_model == "yaml-default"
    # `sources` *is* computed from what was written, so it is already right in that response.
    assert response.json()["sources"]["default_model"] == "config_file"


def _seed_two_models(root: Path) -> None:
    (root / "models_config.json").write_text(
        json.dumps(
            {
                "models": [
                    {"name": "A", "use": "langchain_openai:ChatOpenAI", "model": "gpt-test", "api_key": "test-key", "base_url": "https://ui.example/v1"},
                    {"name": "B", "use": "langchain_openai:ChatOpenAI", "model": "gpt-test", "api_key": "test-key", "base_url": "https://ui.example/v1"},
                ]
            }
        ),
        encoding="utf-8",
    )


def test_the_saved_default_reaches_the_extraction_role(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The join of the two earlier tasks: what the admin saves is what the role builds with.

    Task 1 pinned the resolver and Task 2 the wiring; neither went through the API. This one
    does the whole path — PUT, file, config reload, the extraction entry — and the factory is
    spied so no client is constructed.
    """
    from deerflow.knowledge.graph.extractor import get_extract_llm

    _seed_two_models(config_env)
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        "deerflow.models.factory.create_chat_model",
        lambda name=None, **kwargs: seen.setdefault("name", name) or object(),
    )

    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"default_model": "B"}).status_code == 200

    get_extract_llm()

    assert seen["name"] == "B"


def test_saving_the_rag_default_touches_no_other_configuration_file(config_env: Path):
    """The save writes `rag_config.json` and nothing else, byte for byte."""
    names = ("config.yaml", "models_config.json", "extensions_config.json")
    before = {name: (config_env / name).read_bytes() for name in names}

    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"default_model": "rag-default"}).status_code == 200

    assert {name: (config_env / name).read_bytes() for name in names} == before


# ── the save-time target check (spec 2026-09-23 D10.1) ────────────────────
# A save judges the targets the payload (plus config.yaml) declares: a UI-managed entry in
# the protocol grid must carry its own key -- and an address, in the one cell whose SDK has
# no default to borrow -- while a name that is not a configured entry is the not-found error.
# What the system would pick itself is never a refusal reason, so an empty declaration or a
# non-UI entry stays out of it.


def test_save_refuses_a_ui_target_without_a_key(config_env: Path):
    _seed_ui_model(config_env, name="ui-bare", api_key=None)

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"judge_model": "ui-bare"})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail.startswith("提交后的配置仍不可用：")
    assert "ui-bare" in detail and "api_key" in detail
    assert _read_rag_json(config_env) == {}  # a refused write leaves the file alone


def test_save_refuses_an_openai_compatible_target_without_an_address(config_env: Path):
    _seed_ui_model(config_env, name="ui-noaddr", base_url=None)

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"vlm_model": "ui-noaddr"})

    assert response.status_code == 400
    assert "base_url" in response.json()["detail"]


def test_save_accepts_a_complete_ui_target(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The positive control: the rule is not refusing the grid, only incomplete entries."""
    _seed_ui_model(config_env, name="ui-complete")

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"extract_model": "ui-complete"})

    assert response.status_code == 200
    assert _read_rag_json(config_env)["extract_model"] == "ui-complete"


def test_save_does_not_judge_the_fallback_target(config_env: Path):
    """`models[0]` standing in for a blank role is the system's own pick (D3): never a refusal.

    The seeded UI entry is incomplete on purpose -- if the check leaked onto a fallback the
    save would be refused here.
    """
    _seed_ui_model(config_env, name="ui-incomplete", api_key=None)

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"embedding_model": "ui-embedding"})

    assert response.status_code == 200


@pytest.mark.parametrize("field", ["default_model", "extract_model", "judge_model", "vlm_model"])
def test_save_maps_a_wrong_role_name_to_400(config_env: Path, field: str):
    """Every declared role, the default included: a name with no entry is a usage error."""
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={field: "ghost-entry"})

    assert response.status_code == 400
    assert response.json()["detail"] == "提交后的配置仍不可用：Model ghost-entry not found in config"
    assert _read_rag_json(config_env) == {}


def test_save_refuses_a_declared_target_when_there_are_no_models_at_all(config_env: Path):
    """A model list with nothing in it cannot contain the declared name either."""
    (config_env / "models_config.json").write_text(json.dumps({"models": []}), encoding="utf-8")
    (config_env / "config.yaml").write_text(yaml.safe_dump({"sandbox": SANDBOX, "models": [], "rag": YAML_RAG}), encoding="utf-8")

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"judge_model": "any-entry"})

    assert response.status_code == 400
    assert response.json()["detail"] == "提交后的配置仍不可用：Model any-entry not found in config"


def test_save_maps_the_retired_prefix_to_the_same_400(config_env: Path):
    """A `dashscope:` name is an ordinary name now (spec D9): no entry, no save."""
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"judge_model": "dashscope:qwen3.8-max"})

    assert response.status_code == 400
    assert response.json()["detail"] == "提交后的配置仍不可用：Model dashscope:qwen3.8-max not found in config"


def test_save_refuses_a_stale_default_at_the_moment_it_is_declared(config_env: Path):
    """The save *is* the declaration, so an unknown name is a usage error here for all four
    fields — the default included. D3's warning-and-fall-back is the runtime path, where a
    default that used to be valid can go stale after a model is removed (pinned in
    `test_model_target.py` and the resolver's own tests)."""
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"default_model": "gone-model"})

    assert response.status_code == 400
    assert response.json()["detail"] == "提交后的配置仍不可用：Model gone-model not found in config"
    assert _read_rag_json(config_env) == {}


def test_the_not_found_sentence_is_written_once():
    """R6: the RAG side owns one copy of the factory's sentence; the router carries none."""
    from pathlib import Path as _Path

    from deerflow.knowledge import model_target as model_target_module

    router_source = _Path(rag_config_router.__file__).read_text(encoding="utf-8")
    target_source = _Path(model_target_module.__file__).read_text(encoding="utf-8")

    assert "not found in config" not in router_source  # only the wording helper says it
    assert "model_not_found_message(" in router_source
    assert target_source.count('_NOT_FOUND_SUFFIX = " not found in config"') == 1


def test_the_not_found_sentence_equals_the_factorys_own(config_env: Path):
    """The value pin: the real factory's message must equal the RAG helper's output, word for word."""
    from deerflow.config.app_config import AppConfig
    from deerflow.config.app_config import RagConfig as _RagConfig
    from deerflow.config.sandbox_config import SandboxConfig
    from deerflow.knowledge.model_target import model_not_found_message
    from deerflow.models.factory import create_chat_model

    config = AppConfig(models=[], sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"), rag=_RagConfig())
    with pytest.raises(ValueError) as excinfo:
        create_chat_model(name="ghost", app_config=config)

    assert str(excinfo.value) == model_not_found_message("ghost")


def test_put_rejects_the_retired_top_level_vlm_fields(config_env: Path):
    """The two top-level VLM keys are gone from the file contract (spec 2026-09-23 D10.3):
    a payload that still carries them is refused by the same ``extra="forbid"`` that guards
    every typo — not silently stripped."""
    for field in ("vlm_base_url", "vlm_api_key"):
        with _client(system_role="admin") as client:
            response = client.put("/api/rag/config", json={field: "leftover"})

        assert response.status_code == 422, field
    assert _read_rag_json(config_env) == {}


def test_put_rejects_the_retired_nested_caption_field(config_env: Path):
    """The nested key is a different rejection path: ``RagVideoFileConfig`` forbids extras."""
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"video": {"caption_model": "leftover"}})

    assert response.status_code == 422
    assert _read_rag_json(config_env) == {}


def test_put_accepts_the_remaining_video_fields_after_the_retirement(config_env: Path):
    """The positive control: the video block still takes what it owns."""
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"video": {"asr_provider": "whisper", "asr_model": "small"}})

    assert response.status_code == 200
    assert _read_rag_json(config_env)["video"] == {"asr_provider": "whisper", "asr_model": "small"}


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
                "parse_tier": "flash",
            },
        )
        assert response.status_code == 200
        body = response.json()

    assert body["config"]["embedding_provider"] == "openai-compatible"
    assert body["config"]["parse_tier"] == "flash"
    assert body["sources"]["parse_provider"] == "ui"
    stored = _read_rag_json(config_env)
    assert stored["parse_base_url"] == "http://localhost:30000"
    assert stored["embedding_sparse_source"] == "bm25"


def test_put_rejects_a_provider_outside_the_allowlist(config_env: Path):
    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"embedding_provider": "some-vendor"}).status_code == 422


def test_put_rejects_the_retired_backend_key(config_env: Path):
    """`parse_backend` 已退役：载荷里带它 ⇒ 422（extra_forbidden），而不是被静默忽略。"""
    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json={"parse_backend": "hybrid"}).status_code == 422
        assert client.put("/api/rag/config", json={"parse_tier": "vlm"}).status_code == 422


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
        # A switch to a dense-only provider has to be *usable* to be savable now: it needs an
        # address, and the sparse half has to come from somewhere else in the same write —
        # `embedding_sparse_source` defaults to 'provider' (spec 2026-09-16 §3 D3).
        switched = client.put(
            "/api/rag/config",
            json={
                "embedding_provider": "openai-compatible",
                "embedding_base_url": "http://localhost:8080/v1",
                "embedding_sparse_source": "bm25",
            },
        ).json()
        # The switch re-points the fallback in the same response, not only after a reload.
        assert switched["sources"]["embedding_api_key"] == "unset"
        assert client.get("/api/rag/config").json()["sources"]["embedding_api_key"] == "unset"
        monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "env-generic")
        assert client.get("/api/rag/config").json()["sources"]["embedding_api_key"] == "env"


def test_rerank_secret_env_source_follows_the_provider(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DASHSCOPE_RERANK_API_KEY", "env-dashscope")
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["sources"]["rerank_api_key"] == "env"
        # The address rides along because the write has to be *savable* now: `generic-rerank`
        # without one is refused at save time (spec 2026-09-17 alignment §3 D2).
        client.put("/api/rag/config", json={"rerank_provider": "generic-rerank", "rerank_base_url": "http://localhost:8000"})
        assert client.get("/api/rag/config").json()["sources"]["rerank_api_key"] == "unset"
        monkeypatch.setenv("RAG_RERANK_API_KEY", "env-generic")
        assert client.get("/api/rag/config").json()["sources"]["rerank_api_key"] == "env"


def test_local_mineru_has_no_secret_fallback(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The local MinerU service ships without auth, so its token has no env source."""
    monkeypatch.setenv("MINERU_API_TOKEN", "tok")
    with _client(system_role="admin") as client:
        assert client.get("/api/rag/config").json()["sources"]["mineru_api_token"] == "env"
        # Same reason as the rerank one above: `mineru-local` needs its address to be savable.
        client.put("/api/rag/config", json={"parse_provider": "mineru-local", "parse_base_url": "http://localhost:30000"})
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
#: The rerank leg's own capability block (spec 2026-09-17 alignment §3 D3): the address row is
#: locked by *row capability* there too, so the frontend must stop naming the provider.
_RERANK_CAPABILITY_FIELD = "rerank_providers"
#: The save-time probe's verdict rides every response, GET included — always present, ``null``
#: when there is nothing to say (spec 2026-09-17 save-time probe §3 D3). Registered here rather
#: than subtracted ad hoc so the "pure addition" guards keep their teeth.
_WARNING_FIELD = "warning"
_ADDED_FIELDS = {_CAPABILITY_FIELD, _RERANK_CAPABILITY_FIELD, _WARNING_FIELD}


def _assert_pure_addition(body: dict, golden: dict) -> None:
    """The response may only have *gained* the registered fields; nothing else may move.

    Two ordered assertions on purpose: a shape change names the offending key, a value
    change shows the field-by-field diff.
    """
    assert set(body) == set(golden) | _ADDED_FIELDS
    assert {key: value for key, value in body.items() if key not in _ADDED_FIELDS} == golden


def test_get_returns_the_embedding_provider_capabilities(config_env: Path):
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    # The list mirrors the curated allowlist in its own order — never a second copy of it.
    assert [entry["provider_id"] for entry in body[_CAPABILITY_FIELD]] == list(provider_ids("embedding"))
    # Up to 2026-09-17 the two extra keys travel with the row: the address field is locked by
    # *capability* (this provider fixes its own endpoint) instead of by a hardcoded provider id.
    assert {entry["provider_id"]: (entry["emits_sparse"], entry["has_fixed_endpoint"], entry["default_endpoint"]) for entry in body[_CAPABILITY_FIELD]} == {
        "dashscope": (True, True, "https://dashscope.aliyuncs.com"),
        "openai-compatible": (False, False, None),
        "volcengine-ark": (True, True, "https://ark.cn-beijing.volces.com"),
    }


def test_get_returns_the_rerank_provider_capabilities(config_env: Path):
    """The rerank row needs the same *row capability* answer the embedding one gets (§3 D3).

    Its entry has no ``emits_sparse`` — the rerank leg has no "which half" question — so the two
    blocks are deliberately different shapes rather than one generic list.
    """
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    assert [entry["provider_id"] for entry in body[_RERANK_CAPABILITY_FIELD]] == list(provider_ids("rerank"))
    assert {entry["provider_id"]: (entry["has_fixed_endpoint"], entry["default_endpoint"]) for entry in body[_RERANK_CAPABILITY_FIELD]} == {
        "dashscope": (True, "https://dashscope.aliyuncs.com"),
        "generic-rerank": (False, None),
        "tei-rerank": (False, None),
    }
    assert all("emits_sparse" not in entry for entry in body[_RERANK_CAPABILITY_FIELD])


def test_the_rerank_default_endpoint_is_the_clients_own_constant():
    """Anti-drift: the allowlist literal and the client's constant must not move apart.

    Same rule the embedding rows follow — the literal lives in the import-light allowlist module,
    so a test keeps the two equal instead (spec 2026-09-17 alignment §3 D3).
    """
    from deerflow.knowledge.providers import resolve_provider
    from deerflow.knowledge.reranker import DASHSCOPE_RERANK_BASE_URL

    assert resolve_provider("rerank", "dashscope").default_endpoint == DASHSCOPE_RERANK_BASE_URL


def test_get_response_only_gained_the_capability_field(config_env: Path):
    with _client(system_role="admin") as client:
        body = client.get("/api/rag/config").json()

    _assert_pure_addition(body, _GOLDEN["get"])


def test_put_response_only_gained_the_capability_field(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json=_GOLDEN["put"]["payload"])

    assert response.status_code == 200
    _assert_pure_addition(response.json(), _GOLDEN["put"]["response"])


# ── save-time validation of the configuration about to be persisted ──────────
#
# Spec 2026-09-16 §3 D3. The PUT refuses a write whose *result* cannot build an embedder, so
# the admin learns while editing instead of on the next ingest. The judgement is the pipeline's
# own construction (`build_embedder`) against the merge the write will actually produce:
# ``config.yaml``'s `rag:` block overlaid with the file being persisted.

#: A dense-only provider asked to supply the sparse half — legal JSON, unusable configuration.
_UNUSABLE = {
    "embedding_provider": "openai-compatible",
    "embedding_base_url": "http://localhost:8080/v1",
    "embedding_sparse_source": "provider",
}


def test_put_rejects_a_configuration_that_cannot_build_an_embedder(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json=_UNUSABLE)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail.startswith("提交后的配置仍不可用：")
    assert "openai-compatible" in detail
    assert "独立稀疏服务" in detail and "本地 BM25" in detail


def test_a_rejected_put_writes_nothing(config_env: Path):
    _write_rag_json(config_env, {"embedding_model": "kept"})

    with _client(system_role="admin") as client:
        assert client.put("/api/rag/config", json=_UNUSABLE).status_code == 400

    assert _read_rag_json(config_env) == {"embedding_model": "kept"}


def test_put_accepts_the_same_write_once_the_sparse_source_is_legal(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={**_UNUSABLE, "embedding_sparse_source": "bm25"})

    assert response.status_code == 200
    assert _read_rag_json(config_env)["embedding_sparse_source"] == "bm25"


def test_put_validates_against_config_yaml_not_the_payload_alone(config_env: Path):
    """The payload omits the provider, so validating it alone would let the section default
    (``dashscope``) stand in and pass. The configuration that will actually be read after this
    write is ``config.yaml``'s dense-only provider, which cannot supply the sparse half."""
    _write_config_yaml(
        config_env,
        {**YAML_RAG, "embedding_provider": "openai-compatible", "embedding_base_url": "http://yaml-embed"},
    )
    reset_app_config()

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"embedding_sparse_source": "provider"})

    assert response.status_code == 400
    assert "openai-compatible" in response.json()["detail"]


def test_put_accepts_clearing_a_field_only_the_previous_file_declared(config_env: Path):
    """The mirror image: a field the *replaced* file declared must not be judged at its old
    value. ``512`` loads (only the build refuses it), so a check based on the live ``config.rag``
    — which still carries that file — would keep seeing 512 and reject a write that is fine."""
    _write_rag_json(config_env, {"embedding_dimension": 512})
    reset_app_config()

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"embedding_model": "ui-embedding"})

    assert response.status_code == 200
    assert "embedding_dimension" not in _read_rag_json(config_env)


def _answer_with(monkeypatch: pytest.MonkeyPatch, *, dims: int, recorded: list[httpx.Request]) -> None:
    """Override the file's autouse stub with one that answers a specific dense width.

    Built on ``_REAL_ASYNC_CLIENT``: the autouse fixture has already replaced ``httpx.AsyncClient``,
    so capturing it here would chain onto that patch and silently re-answer at 1024 dimensions.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        return httpx.Response(
            200,
            json={"output": {"embeddings": [{"text_index": 0, "embedding": [0.0] * dims, "sparse_embedding": [{"index": 7, "value": 0.5}]}]}},
        )

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)))


def test_put_judges_a_declared_width_against_the_declaration_not_1024(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """选 1536 ⇒ 保存期探针按 1536 判（spec 2026-09-26 §4 验收 4）：模型真能给到这个宽度就该放行。

    "放行" 必须靠那一发真调用证明：``warning=null`` 说明探针拿到了答案（"没能验证"也会 200）。
    """
    _write_rag_json(config_env, {"embedding_api_key": "sk-probe"})
    reset_app_config()
    recorded: list[httpx.Request] = []
    _answer_with(monkeypatch, dims=1536, recorded=recorded)

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"embedding_dimension": 1536})

    assert response.status_code == 200, response.text
    assert response.json()[_WARNING_FIELD] is None
    assert json.loads(recorded[0].content)["parameters"]["dimension"] == 1536, "问的就是所选的那个宽度"
    assert _read_rag_json(config_env)["embedding_dimension"] == 1536


def test_put_refuses_a_declared_width_the_model_does_not_return(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """被忽略/被拒的那一半：实测不是所选值 ⇒ 400，且文案里两种宽度都在（用户要知道谁对不上谁）。"""
    _write_rag_json(config_env, {"embedding_api_key": "sk-probe"})
    reset_app_config()
    _answer_with(monkeypatch, dims=1024, recorded=[])

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"embedding_dimension": 1536})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "1024" in detail and "1536" in detail
    assert "返回" in detail, "判的是那一发实测回来的宽度，不是声明与默认不符"
    assert _read_rag_json(config_env).get("embedding_dimension") is None, "被拒的写不能落盘"


# ── the same check now covers the other two legs (spec 2026-09-17 alignment §3 D2) ──────────
#
# Building the embedder only ever answered for the embedding half: a rerank provider that needs
# an address, or a local parser without one, saved happily and blew up on the next retrieval or
# ingest. Both constructions are offline, so covering them costs no network call — which is the
# counterexample below.


def test_put_refuses_a_rerank_without_its_address(config_env: Path):
    target = config_env / "rag_config.json"
    target.write_text(json.dumps({"rerank_model": "kept"}), encoding="utf-8")
    before = target.read_bytes()

    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={"rerank_provider": "generic-rerank", "rerank_base_url": ""},
        )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail.startswith("提交后的配置仍不可用：")
    assert "rerank_base_url" in detail
    assert target.read_bytes() == before


def test_put_refuses_a_tei_rerank_without_its_address(config_env: Path):
    """The TEI row ships no address either (spec 2026-09-24 §4.3 D3 甲).

    Same refusal as the generic row, and it has to be the same one: the save-time construction
    check builds whatever the payload selects, so a new provider that skipped that check would
    save happily and only blow up on the next retrieval.
    """
    target = config_env / "rag_config.json"
    target.write_text(json.dumps({"rerank_model": "kept"}), encoding="utf-8")
    before = target.read_bytes()

    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={"rerank_provider": "tei-rerank", "rerank_base_url": ""},
        )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail.startswith("提交后的配置仍不可用：")
    assert "rerank_base_url" in detail
    assert target.read_bytes() == before


def test_put_refuses_a_local_parser_without_its_address(config_env: Path):
    target = config_env / "rag_config.json"
    target.write_text(json.dumps({"rerank_model": "kept"}), encoding="utf-8")
    before = target.read_bytes()

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"parse_provider": "mineru-local"})

    assert response.status_code == 400
    assert "parse_base_url" in response.json()["detail"]
    assert target.read_bytes() == before


def test_a_complete_configuration_saves_without_touching_the_network(config_env: Path, monkeypatch: pytest.MonkeyPatch):
    """The three-leg check must not become a fourth network hop (spec 2026-09-17 alignment §2 D2).

    Every construction is offline, so *any* outbound attempt here is a defect — the stub fails
    the test instead of answering, which also means the autouse stub of this module is replaced.
    """

    def _explode(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"the save-time check went out to the network: {request.url}")

    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_async_client(transport=httpx.MockTransport(_explode)))

    with _client(system_role="admin") as client:
        response = client.put("/api/rag/config", json={"rerank_model": "ui-rerank"})

    assert response.status_code == 200
    assert _read_rag_json(config_env)["rerank_model"] == "ui-rerank"


def test_put_requires_the_embedding_endpoint(config_env: Path):
    # Spec 2026-09-25 rag-endpoint-unlock D1/D3: with no silent vendor fallback, a save that
    # would leave the embedding endpoint empty is refused with a readable reason.
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={"rerank_base_url": "http://localhost:8000", "embedding_base_url": ""},
        )

    assert response.status_code == 400
    assert "embedding_base_url" in response.json()["detail"]


def test_put_requires_the_rerank_endpoint(config_env: Path):
    with _client(system_role="admin") as client:
        response = client.put(
            "/api/rag/config",
            json={"embedding_base_url": "http://localhost:8080/v1", "rerank_base_url": ""},
        )

    assert response.status_code == 400
    assert "rerank_base_url" in response.json()["detail"]
