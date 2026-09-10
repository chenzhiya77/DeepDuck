"""Seam B tests for the API-writable ``rag_config.json`` (spec 2026-09-10 rag functional-model config).

Covers: field-level override of config.yaml's ``rag:`` block (file wins), deep merge of
the nested ``video`` block, fallback when the file is absent/empty, loud failure on a
malformed file, crash-safe atomic write, hot reload through ``get_app_config()`` when
only the rag file changes, the key sentinel, and the ``file > env`` secret resolution
the ingestion clients rely on.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from deerflow.config.app_config import AppConfig, get_app_config, reset_app_config
from deerflow.config.rag_config_file import (
    MASKED_SECRET,
    RagConfigFile,
    atomic_write_rag_config,
    merge_rag_config,
    preserve_secret,
)

SANDBOX = {"use": "deerflow.sandbox.local:LocalSandboxProvider"}

YAML_RAG = {
    "qdrant_url": "http://qdrant:6333",
    "embedding_model": "yaml-embedding",
    "rerank_model": "yaml-rerank",
    "vlm_model": "yaml-vlm",
    "extract_model": "yaml-extract",
    "worker_concurrency": 4,
    "video": {"enabled": True, "max_size_mb": 512, "asr_model": "yaml-asr"},
}


def _write_config_yaml(path: Path, rag: dict | None = None) -> Path:
    path.write_text(
        yaml.safe_dump({"sandbox": SANDBOX, "models": [], "rag": rag if rag is not None else dict(YAML_RAG)}),
        encoding="utf-8",
    )
    return path


def _write_rag_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


@pytest.fixture
def env_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point config.yaml / models / rag files at isolated tmp paths."""
    config_yaml = tmp_path / "config.yaml"
    extensions = tmp_path / "extensions_config.json"
    models_json = tmp_path / "models_config.json"
    rag_json = tmp_path / "rag_config.json"
    extensions.write_text(json.dumps({"mcpServers": {}, "skills": {}}), encoding="utf-8")
    # An empty but present models file keeps the repo-root models_config.json out of
    # the test (an explicit env var is an operator assertion, and the real root file
    # would otherwise be merged into every expectation here).
    models_json.write_text(json.dumps({"models": []}), encoding="utf-8")
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(config_yaml))
    monkeypatch.setenv("DEER_FLOW_EXTENSIONS_CONFIG_PATH", str(extensions))
    monkeypatch.setenv("DEER_FLOW_MODELS_CONFIG_PATH", str(models_json))
    monkeypatch.setenv("DEER_FLOW_RAG_CONFIG_PATH", str(rag_json))
    reset_app_config()
    yield config_yaml, rag_json
    reset_app_config()


# ── merge semantics ───────────────────────────────────────────────────────


def test_file_overrides_only_the_fields_it_declares(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(
        rag_json,
        {"embedding_model": "ui-embedding", "embedding_api_key": "sk-embed", "extract_model": "ui-extract"},
    )

    rag = get_app_config().rag

    assert rag.embedding_model == "ui-embedding"
    assert rag.embedding_api_key == "sk-embed"
    assert rag.extract_model == "ui-extract"
    # Untouched fields keep the config.yaml values.
    assert rag.rerank_model == "yaml-rerank"
    assert rag.worker_concurrency == 4


def test_video_block_deep_merges(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {"video": {"asr_model": "ui-asr", "caption_model": "ui-caption"}})

    video = get_app_config().rag.video

    assert video.asr_model == "ui-asr"
    assert video.caption_model == "ui-caption"
    # The operator's graph/ingestion switches survive.
    assert video.enabled is True
    assert video.max_size_mb == 512


def test_env_asserted_path_must_exist(env_paths):
    """A set ``DEER_FLOW_RAG_CONFIG_PATH`` is an operator assertion (mirrors models_config)."""
    config_yaml, _rag_json = env_paths
    _write_config_yaml(config_yaml)

    with pytest.raises(FileNotFoundError, match="DEER_FLOW_RAG_CONFIG_PATH"):
        get_app_config()


def test_no_file_configured_keeps_config_yaml_values(env_paths, monkeypatch: pytest.MonkeyPatch):
    """Search mode: no rag file anywhere means config.yaml stands on its own."""
    config_yaml, _rag_json = env_paths
    _write_config_yaml(config_yaml)
    monkeypatch.setattr(RagConfigFile, "resolve_config_path", classmethod(lambda cls, config_path=None: None))
    reset_app_config()

    rag = get_app_config().rag

    assert rag.embedding_model == "yaml-embedding"
    assert rag.rerank_model == "yaml-rerank"
    assert rag.embedding_api_key is None


def test_empty_file_is_a_no_op(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {})

    rag = get_app_config().rag

    assert rag.embedding_model == "yaml-embedding"
    assert rag.vlm_model == "yaml-vlm"


def test_malformed_json_raises(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    rag_json.write_text("{not json", encoding="utf-8")

    with pytest.raises(ValueError, match="not valid JSON"):
        get_app_config()


def test_unknown_field_is_rejected(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {"embedding_modle": "typo"})

    with pytest.raises(ValueError):
        RagConfigFile.from_file()


def test_merge_is_pure_and_yaml_input_untouched():
    yaml_rag = {"embedding_model": "yaml", "video": {"enabled": True}}
    ui = RagConfigFile.model_validate({"embedding_model": "ui", "video": {"asr_model": "ui-asr"}})

    merged = merge_rag_config(yaml_rag, ui)

    assert merged["embedding_model"] == "ui"
    assert merged["video"] == {"enabled": True, "asr_model": "ui-asr"}
    assert yaml_rag == {"embedding_model": "yaml", "video": {"enabled": True}}


# ── hot reload ────────────────────────────────────────────────────────────


def test_changing_only_the_rag_file_reloads_app_config(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {"rerank_model": "first"})
    assert get_app_config().rag.rerank_model == "first"

    _write_rag_json(rag_json, {"rerank_model": "second"})

    assert get_app_config().rag.rerank_model == "second"


# ── atomic write + sentinel ───────────────────────────────────────────────


def test_atomic_write_leaves_no_temp_file(tmp_path: Path):
    target = tmp_path / "rag_config.json"

    atomic_write_rag_config(target, {"embedding_model": "x"})

    assert json.loads(target.read_text(encoding="utf-8")) == {"embedding_model": "x"}
    leftovers = [p.name for p in tmp_path.iterdir() if p.name != target.name]
    assert leftovers == []


def test_preserve_secret_honors_the_sentinel():
    assert preserve_secret(MASKED_SECRET, "sk-stored") == "sk-stored"
    assert preserve_secret("sk-new", "sk-stored") == "sk-new"


# ── secret resolution for the ingestion clients ───────────────────────────


def test_config_secret_wins_over_env(env_paths, monkeypatch: pytest.MonkeyPatch):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {"embedding_api_key": "sk-file", "rerank_api_key": "sk-rerank-file"})
    monkeypatch.setenv("DASHSCOPE_EMBEDDING_API_KEY", "sk-env")
    monkeypatch.setenv("DASHSCOPE_RERANK_API_KEY", "sk-env")

    from deerflow.knowledge.embedder import DashScopeEmbedder
    from deerflow.knowledge.reranker import DashScopeReranker

    assert DashScopeEmbedder()._read_api_key() == "sk-file"
    assert DashScopeReranker()._read_api_key() == "sk-rerank-file"


def test_env_still_used_when_the_file_declares_no_secret(env_paths, monkeypatch: pytest.MonkeyPatch):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {"embedding_model": "ui-embedding"})
    monkeypatch.setenv("DASHSCOPE_EMBEDDING_API_KEY", "sk-env")

    from deerflow.knowledge.embedder import DashScopeEmbedder

    assert DashScopeEmbedder()._read_api_key() == "sk-env"


def test_explicit_constructor_key_beats_the_file(env_paths):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {"embedding_api_key": "sk-file"})

    from deerflow.knowledge.embedder import DashScopeEmbedder

    assert DashScopeEmbedder(api_key="sk-arg")._read_api_key() == "sk-arg"


def test_missing_secret_raises_with_the_env_hint(env_paths, monkeypatch: pytest.MonkeyPatch):
    config_yaml, rag_json = env_paths
    _write_config_yaml(config_yaml)
    _write_rag_json(rag_json, {})
    monkeypatch.delenv("DASHSCOPE_EMBEDDING_API_KEY", raising=False)

    from deerflow.knowledge.embedder import DashScopeEmbedder, EmbedderAuthError

    with pytest.raises(EmbedderAuthError, match="DASHSCOPE_EMBEDDING_API_KEY"):
        DashScopeEmbedder()._read_api_key()


def test_app_config_can_be_built_without_a_rag_file(env_paths, monkeypatch: pytest.MonkeyPatch):
    """A deployment that only uses config.yaml keeps loading unchanged."""
    config_yaml, _rag_json = env_paths
    _write_config_yaml(config_yaml)
    monkeypatch.setattr(RagConfigFile, "resolve_config_path", classmethod(lambda cls, config_path=None: None))

    config = AppConfig.from_file(str(config_yaml))

    assert config.rag.embedding_model == "yaml-embedding"
