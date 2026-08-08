"""Tests for the RAG knowledge-base configuration section (``rag:``)."""

import pytest

from deerflow.config.app_config import AppConfig, RagConfig

_SANDBOX = {"sandbox": {"use": "deerflow.sandbox.local:LocalSandboxProvider"}}


class TestRagConfig:
    def test_loads_defaults(self):
        config = RagConfig()

        assert config.qdrant_url == "http://localhost:6333"
        assert config.embedding_model == "qwen3.7-text-embedding"
        assert config.rerank_model == "qwen3-rerank"
        assert config.vlm_model == "Qwen/Qwen3-VL-30B-A3B-Instruct"
        assert config.worker_concurrency == 2
        assert config.extract_rate_limit_rps == 5.0

    def test_overridable_from_dict(self):
        config = RagConfig(
            **{
                "qdrant_url": "http://qdrant:6333",
                "embedding_model": "custom-embedding",
                "rerank_model": "custom-rerank",
                "vlm_model": "custom-vlm",
                "worker_concurrency": 8,
                "extract_rate_limit_rps": 1.5,
            }
        )

        assert config.qdrant_url == "http://qdrant:6333"
        assert config.embedding_model == "custom-embedding"
        assert config.rerank_model == "custom-rerank"
        assert config.vlm_model == "custom-vlm"
        assert config.worker_concurrency == 8
        assert config.extract_rate_limit_rps == 1.5

    def test_unknown_keys_tolerated(self):
        """AppConfig uses ``extra="allow"``; section models ignore unknown keys
        (pydantic default), matching SchedulerConfig and the other sections."""
        config = RagConfig(**{"qdrant_url": "http://qdrant:6333", "future_key": True})

        assert config.qdrant_url == "http://qdrant:6333"
        assert not hasattr(config, "future_key")

    def test_rejects_invalid_worker_concurrency(self):
        with pytest.raises(ValueError):
            RagConfig(worker_concurrency=0)

    def test_rejects_invalid_extract_rate_limit(self):
        with pytest.raises(ValueError):
            RagConfig(extract_rate_limit_rps=0)
        with pytest.raises(ValueError):
            RagConfig(extract_rate_limit_rps=-1)


class TestAppConfigRagSection:
    def test_rag_section_has_defaults(self):
        config = AppConfig.model_validate(_SANDBOX)

        assert config.rag.qdrant_url == "http://localhost:6333"
        assert config.rag.embedding_model == "qwen3.7-text-embedding"
        assert config.rag.rerank_model == "qwen3-rerank"
        assert config.rag.vlm_model == "Qwen/Qwen3-VL-30B-A3B-Instruct"
        assert config.rag.worker_concurrency == 2
        assert config.rag.extract_rate_limit_rps == 5.0

    def test_rag_section_overridable_from_dict(self):
        config = AppConfig.model_validate(
            {
                **_SANDBOX,
                "rag": {
                    "qdrant_url": "http://qdrant:6333",
                    "worker_concurrency": 4,
                    "extract_rate_limit_rps": 2.5,
                },
            }
        )

        assert config.rag.qdrant_url == "http://qdrant:6333"
        assert config.rag.worker_concurrency == 4
        assert config.rag.extract_rate_limit_rps == 2.5
        # Untouched fields keep their defaults.
        assert config.rag.embedding_model == "qwen3.7-text-embedding"

    def test_rag_section_tolerates_unknown_keys(self):
        config = AppConfig.model_validate(
            {
                **_SANDBOX,
                "rag": {"qdrant_url": "http://qdrant:6333", "future_key": True},
            }
        )

        assert config.rag.qdrant_url == "http://qdrant:6333"

    def test_null_rag_section_falls_back_to_defaults(self):
        """A commented-out ``rag:`` block parses as None and must not crash the
        documented ``cp config.example.yaml config.yaml`` first-run flow."""
        config = AppConfig.model_validate({**_SANDBOX, "rag": None})

        assert config.rag.qdrant_url == "http://localhost:6333"
