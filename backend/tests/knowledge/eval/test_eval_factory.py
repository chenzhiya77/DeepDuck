"""Factory tests for the shared judge/ragas builders (spec 2026-09-01 B 方案 Task 1).

``deerflow.knowledge.eval.factory`` 是 ``scripts/run_ragas_eval.py`` 与
gateway 按需完整评测共用的构建层：judge LLM（config 模型或 ``dashscope:``
直连）与 ragas 评估器（未安装 → None 显式跳过）。契约与 CLI 原实现逐条
对齐（见 test_ragas_eval_cli.py），此处钉工厂模块自身的公共口径。
"""

from __future__ import annotations

import sys

import pytest

from deerflow.knowledge.eval import factory


class TestBuildJudgeLlm:
    def test_dashscope_prefix_builds_openai_compatible_client(self, monkeypatch):
        monkeypatch.setenv("DASHSCOPE_JUDGE_API_KEY", "judge-key")

        llm = factory.build_judge_llm("dashscope:qwen3.8-max", config=object())

        assert llm.model_name == "qwen3.8-max"
        assert "dashscope.aliyuncs.com" in str(llm.openai_api_base)
        assert llm.openai_api_key.get_secret_value() == "judge-key"

    def test_dashscope_prefix_falls_back_to_dashscope_api_key(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_JUDGE_API_KEY", raising=False)
        monkeypatch.setenv("DASHSCOPE_API_KEY", "shared-key")

        llm = factory.build_judge_llm("dashscope:qwen3.8-max", config=object())

        assert llm.openai_api_key.get_secret_value() == "shared-key"

    def test_dashscope_prefix_without_key_raises(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_JUDGE_API_KEY", raising=False)
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)

        with pytest.raises(factory.JudgeKeyMissingError):
            factory.build_judge_llm("dashscope:qwen3.8-max", config=object())

    def test_config_model_name_delegates_to_factory(self, monkeypatch):
        import deerflow.models.factory as models_factory

        seen = {}

        def _create(name=None, **kwargs):
            seen["name"] = name
            return object()

        monkeypatch.setattr(models_factory, "create_chat_model", _create)

        factory.build_judge_llm("qwen3.7-flash", config=object())
        assert seen["name"] == "qwen3.7-flash"

    def test_default_none_uses_primary_model(self, monkeypatch):
        import deerflow.models.factory as models_factory

        seen = {}
        monkeypatch.setattr(models_factory, "create_chat_model", lambda name=None, **kwargs: seen.setdefault("name", name) or object())

        factory.build_judge_llm(None, config=object())
        assert seen["name"] is None


class TestBuildRagasEvaluator:
    def test_returns_none_when_ragas_not_installed(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "ragas", None)
        monkeypatch.setitem(sys.modules, "ragas.llms", None)
        monkeypatch.setitem(sys.modules, "ragas.embeddings", None)

        assert factory.build_ragas_evaluator(judge_llm=object()) is None

    def test_wraps_judge_with_bypass_n(self, monkeypatch):
        """DashScope judges reject ``n>1``，wrapper 必须开 ``bypass_n``（CLI 同款契约）。"""

        captured: dict = {}

        class FakeWrapper:
            def __init__(self, llm, **kwargs):
                captured["bypass_n"] = kwargs.get("bypass_n")

        class FakeEmbeddingsWrapper:
            def __init__(self, embeddings):
                pass

        fake_ragas_llms = type(sys)("ragas.llms")
        fake_ragas_llms.LangchainLLMWrapper = FakeWrapper
        fake_ragas_embed = type(sys)("ragas.embeddings")
        fake_ragas_embed.LangchainEmbeddingsWrapper = FakeEmbeddingsWrapper
        monkeypatch.setitem(sys.modules, "ragas.llms", fake_ragas_llms)
        monkeypatch.setitem(sys.modules, "ragas.embeddings", fake_ragas_embed)
        monkeypatch.setattr(factory, "DashScopeLangChainEmbeddings", lambda *a, **kw: object())

        evaluator = factory.build_ragas_evaluator(judge_llm=object())
        assert evaluator is not None
        assert captured["bypass_n"] is True

    @pytest.mark.asyncio
    async def test_evaluator_forwards_on_progress(self, monkeypatch):
        """spec 2026-09-06 §9：evaluator 协议新增 ``on_progress``，必须透传给 compute_ragas_scores。"""

        import deerflow.knowledge.eval.ragas_eval as ragas_module

        captured: dict = {}

        class FakeWrapper:
            def __init__(self, llm, **kwargs):
                pass

        fake_ragas_llms = type(sys)("ragas.llms")
        fake_ragas_llms.LangchainLLMWrapper = FakeWrapper
        fake_ragas_embed = type(sys)("ragas.embeddings")
        fake_ragas_embed.LangchainEmbeddingsWrapper = FakeWrapper
        monkeypatch.setitem(sys.modules, "ragas.llms", fake_ragas_llms)
        monkeypatch.setitem(sys.modules, "ragas.embeddings", fake_ragas_embed)
        monkeypatch.setattr(factory, "DashScopeLangChainEmbeddings", lambda *a, **kw: object())

        async def fake_compute(samples, *, judge_llm, embeddings, on_progress=None):
            captured["on_progress"] = on_progress
            return []

        monkeypatch.setattr(ragas_module, "compute_ragas_scores", fake_compute)

        def callback(done: int, total: int) -> None:
            return None

        evaluator = factory.build_ragas_evaluator(judge_llm=object())
        assert evaluator is not None

        await evaluator([{"question_id": "q1"}], judge_llm=None, embeddings=None, on_progress=callback)

        assert captured["on_progress"] is callback
