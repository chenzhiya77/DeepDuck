"""Unit tests for the RAG model-target resolver (spec 2026-09-23 default model D3).

The resolver is the one seam the RAG roles share: a caller picks its own role declaration
first (``rag.extract_model`` / ``rag.judge_model`` / ``rag.vlm_model``), hands it in as
``name``, and the helper answers only the "nothing declared, so what then" half — the RAG
default, else the first configured model. It is deliberately pure: no Qdrant, no SDK
construction, no network, no reading of the live global config unless the caller passes one.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from deerflow.knowledge.model_target import resolve_rag_model_name


def _config(*names: str, default_model: str | None = None):
    """A duck-typed AppConfig stand-in: the resolver only reads these two shapes."""
    return SimpleNamespace(
        models=[SimpleNamespace(name=name) for name in names],
        rag=SimpleNamespace(default_model=default_model),
    )


def test_explicit_role_name_is_returned_as_is():
    config = _config("A", "B", default_model="B")

    assert resolve_rag_model_name(config, "A") == "A"


def test_explicit_role_name_is_not_replaced_even_when_it_names_no_entry():
    """An explicit wrong name must reach the factory, which raises the not-found error.

    Substituting the RAG default here would silently swallow a typo the operator asked for.
    """
    config = _config("A", default_model="A")

    assert resolve_rag_model_name(config, "ghost") == "ghost"


def test_blank_role_name_falls_through_to_the_rag_default():
    """Blank means undeclared (D2), so it must not be treated as a name."""
    config = _config("A", "B", default_model="B")

    assert resolve_rag_model_name(config, "   ") == "B"


def test_rag_default_wins_over_the_first_model():
    config = _config("A", "B", default_model="B")

    assert resolve_rag_model_name(config) == "B"


def test_no_default_falls_back_to_the_first_configured_model():
    config = _config("A", "B")

    assert resolve_rag_model_name(config) == "A"


def test_a_stale_default_falls_back_to_the_first_model_and_is_named(caplog: pytest.LogCaptureFixture):
    """Only the RAG default itself may be silently superseded -- and never silently."""
    config = _config("A", "B", default_model="ghost")

    with caplog.at_level(logging.WARNING, logger="deerflow.knowledge.model_target"):
        assert resolve_rag_model_name(config) == "A"

    assert "ghost" in caplog.text


def test_no_models_at_all_returns_none_for_the_caller_to_report():
    """The resolver never invents a target: the RAG entry point turns this into an error."""
    assert resolve_rag_model_name(_config()) is None


def test_explicit_rag_snapshot_beats_the_live_config():
    """``rag=`` carries the save-time pending block, which has not been written yet."""
    config = _config("A", "B", default_model="A")
    pending = SimpleNamespace(default_model="B")

    assert resolve_rag_model_name(config, rag=pending) == "B"
    # The live config is left alone.
    assert config.rag.default_model == "A"


def test_pending_rag_snapshot_may_be_a_mapping():
    """The save path merges ``config.yaml`` with the payload into a plain dict (D2/D3)."""
    config = _config("A", "B", default_model="A")

    assert resolve_rag_model_name(config, rag={"default_model": "B"}) == "B"
    assert resolve_rag_model_name(config, rag={"default_model": None}) == "A"
    assert resolve_rag_model_name(config, rag={}) == "A"


def test_resolver_never_constructs_a_model(monkeypatch: pytest.MonkeyPatch):
    """Purity pin: resolving a name must not build an SDK client or touch the network."""
    import deerflow.models.factory as factory_module

    def _explode(*args, **kwargs):
        raise AssertionError("the resolver must not construct a model")

    monkeypatch.setattr(factory_module, "create_chat_model", _explode)

    assert resolve_rag_model_name(_config("A", default_model="A")) == "A"
