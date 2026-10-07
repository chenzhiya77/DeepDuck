"""Seam B tests for the API-writable ``models_config.json`` (spec 2026-09-10 §5.1/§5.2/§5.6, §7.3).

Covers: union merge of config.yaml ``models:`` with the UI-managed file (UI wins on
name collision), load-time source tagging, fallback when the file is absent/empty,
dual-file hot reload via ``get_app_config()``, crash-safe atomic write + write lock,
env-var resolution inside the UI file, and the provider-allowlist / endpoint-key /
api_key-sentinel pure helpers.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from deerflow.config.app_config import AppConfig, get_app_config, reset_app_config
from deerflow.config.model_config import CONTEXT_WINDOW_OPTIONS, ModelConfig
from deerflow.config.models_config import (
    MASKED_API_KEY,
    ModelsConfig,
    atomic_write_models_config,
    endpoint_key_for,
    merge_ui_models,
    models_config_write_lock,
    preserve_api_key,
    resolve_provider_use,
    reverse_lookup_provider,
)

SANDBOX = {"use": "deerflow.sandbox.local:LocalSandboxProvider"}


def _write_config_yaml(path: Path, models: list[dict]) -> Path:
    path.write_text(yaml.safe_dump({"sandbox": SANDBOX, "models": models}), encoding="utf-8")
    return path


def _write_models_json(path: Path, models: list[dict]) -> Path:
    path.write_text(json.dumps({"models": models}), encoding="utf-8")
    return path


def _model(name: str, **extra) -> dict:
    return {"name": name, "use": "langchain_openai:ChatOpenAI", "model": name, **extra}


@pytest.fixture
def env_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point config.yaml / extensions / models files at isolated tmp paths."""
    config_yaml = tmp_path / "config.yaml"
    extensions = tmp_path / "extensions_config.json"
    models_json = tmp_path / "models_config.json"
    extensions.write_text(json.dumps({"mcpServers": {}, "skills": {}}), encoding="utf-8")
    monkeypatch.setenv("DEER_FLOW_EXTENSIONS_CONFIG_PATH", str(extensions))
    monkeypatch.setenv("DEER_FLOW_MODELS_CONFIG_PATH", str(models_json))
    return config_yaml, models_json


# ---------------------------------------------------------------------------
# merge semantics (spec §5.2)
# ---------------------------------------------------------------------------


def test_ui_models_union_with_config_yaml(env_paths):
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("yaml-only", api_key="k1")])
    _write_models_json(models_json, [_model("ui-only", api_key="k2")])

    config = AppConfig.from_file(str(config_yaml))

    assert {m.name for m in config.models} == {"yaml-only", "ui-only"}


def test_ui_model_overrides_config_yaml_on_name_collision(env_paths):
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("shared", api_key="yaml-key", base_url="https://yaml.example/v1")])
    _write_models_json(models_json, [_model("shared", api_key="ui-key")])

    config = AppConfig.from_file(str(config_yaml))

    merged = config.get_model_config("shared")
    assert merged is not None
    assert merged.api_key == "ui-key"  # UI file wins (spec §5.2)
    # get_model_config must resolve to the UI version, not the first yaml match.
    assert config._models_by_name["shared"].api_key == "ui-key"


def test_source_tag_distinguishes_ui_from_config_file(env_paths):
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("yaml-only")])
    _write_models_json(models_json, [_model("ui-only")])

    config = AppConfig.from_file(str(config_yaml))

    assert config.is_ui_managed_model("ui-only") is True
    assert config.is_ui_managed_model("yaml-only") is False
    assert config.is_ui_managed_model("nope") is False


def test_missing_models_file_falls_back_to_config_yaml(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    monkeypatch.chdir(empty_dir)
    monkeypatch.delenv("DEER_FLOW_MODELS_CONFIG_PATH", raising=False)
    config_yaml = _write_config_yaml(tmp_path / "config.yaml", [_model("yaml-only")])
    extensions = tmp_path / "extensions_config.json"
    extensions.write_text(json.dumps({"mcpServers": {}, "skills": {}}), encoding="utf-8")
    monkeypatch.setenv("DEER_FLOW_EXTENSIONS_CONFIG_PATH", str(extensions))

    config = AppConfig.from_file(str(config_yaml))

    assert {m.name for m in config.models} == {"yaml-only"}


def test_empty_models_file_falls_back_to_config_yaml(env_paths):
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("yaml-only")])
    models_json.write_text(json.dumps({"models": []}), encoding="utf-8")

    config = AppConfig.from_file(str(config_yaml))

    assert {m.name for m in config.models} == {"yaml-only"}


def test_models_file_env_variables_resolved(env_paths, monkeypatch: pytest.MonkeyPatch):
    config_yaml, models_json = env_paths
    monkeypatch.setenv("T1_UI_API_KEY", "secret-from-env")
    _write_config_yaml(config_yaml, [])
    _write_models_json(models_json, [_model("ui-env", api_key="$T1_UI_API_KEY")])

    config = AppConfig.from_file(str(config_yaml))

    assert config.get_model_config("ui-env").api_key == "secret-from-env"


def test_models_file_unresolved_env_variable_raises(env_paths):
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [])
    _write_models_json(models_json, [_model("ui-bad", api_key="$T1_DEFINITELY_UNSET")])

    with pytest.raises(ValueError, match="T1_DEFINITELY_UNSET"):
        AppConfig.from_file(str(config_yaml))


# ---------------------------------------------------------------------------
# dual-file hot reload (spec §5.6)
# ---------------------------------------------------------------------------


def test_get_app_config_reloads_when_only_models_file_changes(env_paths):
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("yaml-only")])
    _write_models_json(models_json, [_model("ui-one")])
    reset_app_config()
    try:
        monkey_config = str(config_yaml)
        import os

        os.environ["DEER_FLOW_CONFIG_PATH"] = monkey_config
        first = get_app_config()
        assert {m.name for m in first.models} == {"yaml-only", "ui-one"}

        # Touch ONLY the models file (config.yaml mtime/signature unchanged).
        _write_models_json(models_json, [_model("ui-one"), _model("ui-two")])

        second = get_app_config()
        assert {m.name for m in second.models} == {"yaml-only", "ui-one", "ui-two"}
    finally:
        import os

        os.environ.pop("DEER_FLOW_CONFIG_PATH", None)
        reset_app_config()


# ---------------------------------------------------------------------------
# atomic write + lock (spec §5.6)
# ---------------------------------------------------------------------------


def test_atomic_write_replaces_without_temp_leftovers(tmp_path: Path):
    target = tmp_path / "models_config.json"
    target.write_text(json.dumps({"models": []}), encoding="utf-8")

    atomic_write_models_config(target, {"models": [_model("written")]})

    assert json.loads(target.read_text(encoding="utf-8")) == {"models": [_model("written")]}
    assert list(target.parent.glob(f".{target.name}.*.tmp")) == []


def test_concurrent_writes_under_lock_do_not_corrupt(tmp_path: Path):
    target = tmp_path / "models_config.json"
    payloads = [{"models": [_model(f"m{i}")]} for i in range(8)]
    errors: list[BaseException] = []

    def writer(payload: dict) -> None:
        try:
            with models_config_write_lock:
                atomic_write_models_config(target, payload)
        except BaseException as exc:  # pragma: no cover - surfaced via errors
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(p,)) for p in payloads]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    final = json.loads(target.read_text(encoding="utf-8"))  # must be valid JSON, never partial
    assert final in payloads


# ---------------------------------------------------------------------------
# provider allowlist / endpoint key / sentinel (spec §5.3, §5.4)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("provider", "expected_use"),
    [
        ("openai-compatible", "deerflow.models.reasoning_replay:ReasoningReplayChatOpenAI"),
        ("anthropic", "langchain_anthropic:ChatAnthropic"),
        ("deepseek", "deerflow.models.patched_deepseek:PatchedChatDeepSeek"),
    ],
)
def test_resolve_provider_use_allowlist(provider, expected_use):
    assert resolve_provider_use(provider) == expected_use


def test_resolve_provider_use_rejects_unknown():
    assert resolve_provider_use("evil-provider") is None
    assert resolve_provider_use("os:system") is None


@pytest.mark.parametrize(
    ("provider", "expected_key"),
    [
        ("openai-compatible", "base_url"),
        ("anthropic", "base_url"),
        ("deepseek", "api_base"),
    ],
)
def test_endpoint_key_per_provider(provider, expected_key):
    assert endpoint_key_for(provider) == expected_key


@pytest.mark.parametrize(
    ("use", "expected_provider"),
    [
        ("deerflow.models.reasoning_replay:ReasoningReplayChatOpenAI", "openai-compatible"),
        ("langchain_openai:ChatOpenAI", "openai-compatible"),
        ("langchain_anthropic:ChatAnthropic", "anthropic"),
        ("deerflow.models.patched_deepseek:PatchedChatDeepSeek", "deepseek"),
        ("some.custom:Class", None),
    ],
)
def test_reverse_lookup_provider(use, expected_provider):
    assert reverse_lookup_provider(use) == expected_provider


def test_from_file_normalizes_the_legacy_openai_class(env_paths, caplog):
    """A stored ``langchain_openai:ChatOpenAI`` entry upgrades in memory on load."""
    _config_yaml, models_json = env_paths
    _write_models_json(models_json, [_model("legacy-oa", api_key="k1")])

    with caplog.at_level(logging.INFO, logger="deerflow.config.models_config"):
        config = ModelsConfig.from_file()

    assert config.models[0].use == "deerflow.models.reasoning_replay:ReasoningReplayChatOpenAI"
    assert "legacy-oa" in caplog.text


def test_from_file_leaves_unknown_classes_untouched(env_paths):
    _config_yaml, models_json = env_paths
    _write_models_json(models_json, [{"name": "custom", "use": "some.custom:Class", "model": "custom"}])

    config = ModelsConfig.from_file()

    assert config.models[0].use == "some.custom:Class"


def test_merge_ui_models_never_normalizes_config_yaml_entries():
    """Only the UI file is normalized; hand-written ``config.yaml`` entries pass through."""
    merged = merge_ui_models(
        [{"name": "yaml-legacy", "use": "langchain_openai:ChatOpenAI", "model": "yaml-legacy"}],
        ModelsConfig(models=[]),
    )

    assert merged[0]["use"] == "langchain_openai:ChatOpenAI"


def test_preserve_api_key_sentinel_keeps_stored():
    assert preserve_api_key(MASKED_API_KEY, "real-key") == "real-key"
    assert preserve_api_key("new-key", "real-key") == "new-key"
    assert preserve_api_key("", "real-key") == ""


def test_models_config_from_file_validates_shape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    models_json = tmp_path / "models_config.json"
    _write_models_json(models_json, [{"name": "missing-use-and-model"}])
    monkeypatch.setenv("DEER_FLOW_MODELS_CONFIG_PATH", str(models_json))

    with pytest.raises(ValueError):
        ModelsConfig.from_file()


# ---------------------------------------------------------------------------
# structured capability fields (spec 2026-09-10 model-capability-config)
#
# Seam B pins the config-load contract for the new per-model capability fields:
#   * supported_context_windows  — non-empty, de-duplicated, ascending subset of
#     CONTEXT_WINDOW_OPTIONS; context_window (the default) must be a member.
#   * supported_reasoning_efforts — non-empty, de-duplicated, enum-ordered subset
#     of minimal/low/medium/high; reasoning_effort (the default) must be a member.
#   * every field optional, so legacy config.yaml / models_config.json keep loading.
# ---------------------------------------------------------------------------


def _cap_model(**overrides) -> ModelConfig:
    """Build a ``ModelConfig`` directly (no file round-trip) for capability validation."""
    return ModelConfig(name="cap", use="langchain_openai:ChatOpenAI", model="cap", **overrides)


def test_context_window_options_is_the_fixed_enum():
    assert CONTEXT_WINDOW_OPTIONS == [200_000, 400_000, 1_000_000]


def test_supported_context_windows_accepts_ascending_subset():
    model = _cap_model(supported_context_windows=[200_000, 1_000_000])
    assert model.supported_context_windows == [200_000, 1_000_000]


@pytest.mark.parametrize(
    ("windows", "match"),
    [
        ([128_000], "outside"),  # element not in CONTEXT_WINDOW_OPTIONS
        ([200_000, 200_000], "duplicate"),  # de-dup required
        ([400_000, 200_000], "ascending"),  # must be ascending
        ([], "non-empty"),  # empty list not allowed when set
    ],
)
def test_supported_context_windows_rejects_invalid(windows, match):
    with pytest.raises(ValidationError, match=match):
        _cap_model(supported_context_windows=windows)


def test_context_window_default_must_be_in_supported_subset():
    with pytest.raises(ValidationError, match="context_window"):
        _cap_model(supported_context_windows=[200_000, 400_000], context_window=1_000_000)


def test_context_window_default_in_subset_is_accepted():
    model = _cap_model(supported_context_windows=[200_000, 400_000], context_window=400_000)
    assert model.context_window == 400_000


def test_supported_reasoning_efforts_accepts_ordered_subset():
    model = _cap_model(supported_reasoning_efforts=["low", "high"])
    assert model.supported_reasoning_efforts == ["low", "high"]


@pytest.mark.parametrize(
    ("efforts", "match"),
    [
        (["turbo"], "supported_reasoning_efforts"),  # outside the 4-level enum
        (["low", "low"], "duplicate"),  # de-dup required
        (["high", "low"], "order"),  # must follow minimal<low<medium<high
        ([], "non-empty"),  # empty list not allowed when set
    ],
)
def test_supported_reasoning_efforts_rejects_invalid(efforts, match):
    with pytest.raises(ValidationError, match=match):
        _cap_model(supported_reasoning_efforts=efforts)


def test_reasoning_effort_default_must_be_in_supported_subset():
    with pytest.raises(ValidationError, match="reasoning_effort"):
        _cap_model(supported_reasoning_efforts=["low", "high"], reasoning_effort="minimal")


def test_reasoning_effort_default_in_subset_is_accepted():
    model = _cap_model(supported_reasoning_efforts=["minimal", "high"], reasoning_effort="high")
    assert model.reasoning_effort == "high"


def test_legacy_config_without_capability_fields_still_loads(env_paths):
    """Backward compat: a config.yaml / models_config.json predating the capability
    fields loads unchanged, and the new fields default to ``None`` ("subset not
    declared") rather than being treated as corrupt."""
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("legacy", context_window=262_144)])
    _write_models_json(models_json, [_model("legacy-ui")])

    config = AppConfig.from_file(str(config_yaml))

    merged = config.get_model_config("legacy")
    assert merged is not None
    assert merged.context_window == 262_144
    assert merged.supported_context_windows is None
    assert merged.supported_reasoning_efforts is None
    assert merged.reasoning_effort is None


# ---------------------------------------------------------------------------
# hidden_in_chat + pinned-order name sets (spec 2026-10-08 models-list-grouping)
# ---------------------------------------------------------------------------


def test_hidden_in_chat_parses_from_file(env_paths):
    """The top-level ``hidden_in_chat`` list survives load (a bare ``{"models": ...}``
    validation dict would silently drop it: written but never read back)."""
    _config_yaml, models_json = env_paths
    models_json.write_text(json.dumps({"models": [_model("ui-only")], "hidden_in_chat": ["ui-only", "yaml-only"]}), encoding="utf-8")

    config = ModelsConfig.from_file()

    assert config.hidden_in_chat == ["ui-only", "yaml-only"]


def test_hidden_in_chat_absent_means_nothing_hidden(env_paths):
    _config_yaml, models_json = env_paths
    _write_models_json(models_json, [_model("ui-only")])

    config = ModelsConfig.from_file()

    assert config.hidden_in_chat == []


def test_load_records_yaml_names_and_hidden_names(env_paths):
    """``AppConfig`` carries the two name sets the API derives its display fields from:
    ``yaml_model_names`` pins merged order (any name declared under config.yaml
    ``models:``), ``hidden_in_chat_names`` is the chat-picker display filter."""
    config_yaml, models_json = env_paths
    _write_config_yaml(config_yaml, [_model("yaml-only"), _model("shared", api_key="yaml-key")])
    models_json.write_text(
        json.dumps({"models": [_model("shared", api_key="ui-key"), _model("ui-only")], "hidden_in_chat": ["ui-only"]}),
        encoding="utf-8",
    )

    config = AppConfig.from_file(str(config_yaml))

    assert config.yaml_model_names == {"yaml-only", "shared"}
    assert config.hidden_in_chat_names == {"ui-only"}
