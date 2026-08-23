"""Tests for the Layer 2 ragas-eval CLI shell (spec 2026-08-23 §8).

Same contract family as the Layer 1 CLI: argument parsing, the missing-key
explicit skip (exit 3, never a fake green), the early error guards — plus the
Layer-2-only rules: quality numbers NEVER affect the exit code, and a missing
ragas install degrades to an evaluator-None skip instead of an error.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

CLI_PATH = Path(__file__).resolve().parents[3] / "scripts" / "run_ragas_eval.py"


def _load_cli():
    spec = importlib.util.spec_from_file_location("run_ragas_eval", CLI_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cli = _load_cli()

KEYS = {"DASHSCOPE_EMBEDDING_API_KEY": "k1", "DASHSCOPE_RERANK_API_KEY": "k2"}


def _args(*extra: str) -> list[str]:
    return ["--golden", "g.jsonl", "--out", "out", "--kb-id", "kb1", *extra]


class TestParseArgs:
    def test_required_args(self):
        with pytest.raises(SystemExit):
            cli.parse_args(["--out", "out", "--kb-id", "kb1"])  # missing --golden
        with pytest.raises(SystemExit):
            cli.parse_args(["--golden", "g"])  # missing --out / --kb-id

    def test_defaults(self):
        args = cli.parse_args(_args())

        assert args.limit is None
        assert args.agent_model is None
        assert args.judge_model is None

    def test_explicit_values(self):
        args = cli.parse_args(_args("--limit", "3", "--agent-model", "deepseek-v4-flash", "--judge-model", "dashscope:qwen3.8-max"))

        assert args.limit == 3
        assert args.agent_model == "deepseek-v4-flash"
        assert args.judge_model == "dashscope:qwen3.8-max"


class TestMissingRequiredKeys:
    def test_both_missing(self):
        assert cli.missing_required_keys({}) == list(cli.REQUIRED_ENV_KEYS)

    def test_all_present(self):
        assert cli.missing_required_keys(KEYS) == []


class TestSkipBehavior:
    def test_main_skips_without_keys(self, tmp_path, capsys):
        out = tmp_path / "out"
        code = cli.main(["--golden", "g.jsonl", "--out", str(out), "--kb-id", "kb1"], environ={})

        assert code == 3  # EXIT_SKIPPED
        assert code != 0  # 不伪绿
        captured = capsys.readouterr()
        assert "skipped" in captured.out
        assert not out.exists()  # 无副作用


class TestAsyncMainGuards:
    def test_config_value_error_maps_to_skipped(self, monkeypatch, capsys):
        import deerflow.config.app_config as app_config_module

        def _raise():
            raise ValueError("Environment variable DEEPSEEK_API_KEY not found for config value $DEEPSEEK_API_KEY")

        monkeypatch.setattr(app_config_module, "get_app_config", _raise)

        assert cli._run(cli.parse_args(_args())) == 3
        assert "skipped" in capsys.readouterr().out

    def test_golden_load_error_maps_to_error(self, monkeypatch, tmp_path):
        import deerflow.config.app_config as app_config_module

        monkeypatch.setattr(app_config_module, "get_app_config", lambda: object())
        args = cli.parse_args(["--golden", str(tmp_path / "absent.jsonl"), "--out", str(tmp_path / "out"), "--kb-id", "kb1"])

        assert cli._run(args) == 2  # EXIT_ERROR，且未触达引擎初始化


class TestJudgeModelSelection:
    def test_dashscope_prefix_builds_openai_compatible_client(self, monkeypatch):
        monkeypatch.setenv("DASHSCOPE_JUDGE_API_KEY", "judge-key")

        llm = cli._build_judge_llm("dashscope:qwen3.8-max", config=object())

        assert llm.model_name == "qwen3.8-max"
        assert "dashscope.aliyuncs.com" in str(llm.openai_api_base)
        assert llm.openai_api_key.get_secret_value() == "judge-key"

    def test_dashscope_prefix_falls_back_to_dashscope_api_key(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_JUDGE_API_KEY", raising=False)
        monkeypatch.setenv("DASHSCOPE_API_KEY", "shared-key")

        llm = cli._build_judge_llm("dashscope:qwen3.8-max", config=object())

        assert llm.openai_api_key.get_secret_value() == "shared-key"

    def test_dashscope_prefix_without_key_raises(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_JUDGE_API_KEY", raising=False)
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)

        with pytest.raises(cli.JudgeKeyMissingError):
            cli._build_judge_llm("dashscope:qwen3.8-max", config=object())

    def test_config_model_name_delegates_to_factory(self, monkeypatch):
        import deerflow.models.factory as factory

        seen = {}

        def _create(name=None, **kwargs):
            seen["name"] = name
            return object()

        monkeypatch.setattr(factory, "create_chat_model", _create)

        cli._build_judge_llm("qwen3.7-flash", config=object())
        assert seen["name"] == "qwen3.7-flash"

    def test_default_none_uses_primary_model(self, monkeypatch):
        import deerflow.models.factory as factory

        seen = {}
        monkeypatch.setattr(factory, "create_chat_model", lambda name=None, **kwargs: seen.setdefault("name", name) or object())

        cli._build_judge_llm(None, config=object())
        assert seen["name"] is None

    def test_missing_judge_key_maps_to_skipped_before_engine(self, monkeypatch, tmp_path):
        import deerflow.config.app_config as app_config_module

        monkeypatch.setattr(app_config_module, "get_app_config", lambda: object())
        monkeypatch.delenv("DASHSCOPE_JUDGE_API_KEY", raising=False)
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
        golden = tmp_path / "golden.jsonl"
        golden.write_text(
            json.dumps({"id": "q1", "query": "q", "expected_path": "vector", "relevant_chunk_ids": [], "relevant_entities": [], "category": "fact"}, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        args = cli.parse_args(["--golden", str(golden), "--out", str(tmp_path / "out"), "--kb-id", "kb1", "--judge-model", "dashscope:qwen3.8-max"])

        assert cli._run(args) == 3  # EXIT_SKIPPED，且未触达引擎初始化


class TestRagasEvaluatorAssembly:
    def test_returns_none_when_ragas_not_installed(self, monkeypatch):
        # sys.modules entry None makes any ``import ragas`` raise ImportError.
        monkeypatch.setitem(sys.modules, "ragas", None)
        monkeypatch.setitem(sys.modules, "ragas.llms", None)
        monkeypatch.setitem(sys.modules, "ragas.embeddings", None)

        assert cli._build_ragas_evaluator(judge_llm=object()) is None
