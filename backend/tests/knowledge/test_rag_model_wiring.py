"""What the RAG role entries do with the resolver (spec 2026-09-23 default model D3/D6).

Task 1 pinned the resolver in isolation. This module pins the wiring around it: the
extraction role through both of its consumers (the ingestion path and the retrieval-time
``graph_search`` tool, R12), the eval judge through its three levels plus the CLI's explicit
argument, and the snapshot rule — one config object both resolves the name and builds the
model, so a check can never judge a different target than the one that gets constructed.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from deerflow.config.app_config import AppConfig, RagConfig
from deerflow.config.model_config import ModelConfig
from deerflow.config.sandbox_config import SandboxConfig
from deerflow.knowledge.embedder import RagConfigurationError
from deerflow.knowledge.eval.factory import build_judge_llm
from deerflow.knowledge.graph.extractor import get_extract_llm

SANDBOX = SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider")
GRAPH_SEARCH_SOURCE = Path(__file__).resolve().parents[2] / "packages" / "harness" / "deerflow" / "tools" / "builtins" / "graph_search_tool.py"


def _model(name: str, *, vision: bool = False) -> ModelConfig:
    """``model=`` is distinct from ``name`` so a built client identifies its entry."""
    return ModelConfig(
        name=name,
        display_name=name,
        description=None,
        use="langchain_openai:ChatOpenAI",
        model=f"{name}-wire",
        api_key="test-key",
        supports_thinking=False,
        supports_vision=vision,
    )


def _config(*names: str, default_model: str | None = None, extract_model: str | None = None, judge_model: str | None = None) -> AppConfig:
    return AppConfig(
        models=[_model(name) for name in names],
        sandbox=SANDBOX,
        rag=RagConfig(default_model=default_model, extract_model=extract_model, judge_model=judge_model),
    )


@pytest.fixture
def factory_spy(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str | None, object]]:
    """Record what the RAG entries hand to the real factory, without building a client."""
    seen: list[tuple[str | None, object]] = []

    def _fake(name=None, *, app_config=None, **_kwargs):
        seen.append((name, app_config))
        return SimpleNamespace(name=name)

    monkeypatch.setattr("deerflow.models.factory.create_chat_model", _fake)
    return seen


# ── extraction role (ingestion + retrieval) ──────────────────────────────


@pytest.mark.parametrize(
    ("extract_model", "default_model", "expected"),
    [
        ("extract-entry", "B", "extract-entry"),  # the role declaration wins
        (None, "B", "B"),  # ... then the RAG default
        (None, None, "A"),  # ... then the first configured model
        ("ghost", "B", "ghost"),  # an explicit wrong name is NOT replaced
    ],
)
def test_extraction_priority(factory_spy, extract_model, default_model, expected):
    config = _config("A", "B", default_model=default_model, extract_model=extract_model)

    get_extract_llm(config)

    assert factory_spy[-1][0] == expected


def test_extraction_passes_the_same_config_snapshot_it_resolved_from(factory_spy):
    """One snapshot: the name is resolved against the object the factory then receives."""
    config = _config("A", "B", default_model="B")

    get_extract_llm(config)

    assert factory_spy[-1] == ("B", config)


def test_extraction_refuses_when_there_is_no_model_at_all(factory_spy):
    """A None target must not reach the factory, which would index ``models[0]``."""
    config = _config()

    with pytest.raises(RagConfigurationError):
        get_extract_llm(config)

    assert factory_spy == []


def test_an_explicit_wrong_name_still_reaches_the_factory(factory_spy):
    """The not-found error is the factory's to raise (and Task 9's to refuse earlier)."""
    config = _config("A", extract_model="ghost", default_model="B")

    get_extract_llm(config)

    assert factory_spy[-1][0] == "ghost"  # never silently replaced by B


def test_extraction_reads_the_process_config_when_none_is_given(monkeypatch: pytest.MonkeyPatch, factory_spy):
    """The parameter is optional on purpose: omitting it still means the process config,
    which is what keeps ``graph_search``'s unchanged call site working (R12)."""
    from deerflow.config import app_config as app_config_module

    config = _config("A", "B", default_model="B")
    monkeypatch.setattr(app_config_module, "get_app_config", lambda: config)

    get_extract_llm()

    assert factory_spy[-1] == ("B", config)


def test_resolution_is_per_call_and_never_repoints_a_built_model(factory_spy):
    """No cross-task cache: each build reads the configuration of its moment.

    A snapshot swap must not reach back into an already-built role — the extraction leg
    builds once per ingest, so a model that was handed out stays what it was.
    """
    first = get_extract_llm(_config("A", "B", default_model="A"))
    second = get_extract_llm(_config("A", "B", default_model="B"))

    assert (first.name, second.name) == ("A", "B")
    assert first is not second


# ── the retrieval-time consumer (R12) ────────────────────────────────────


async def test_graph_search_query_extraction_goes_through_get_extract_llm(monkeypatch: pytest.MonkeyPatch):
    """``graph_search`` builds its query-entity model from the *extract* role.

    Driven through the core implementation with the retrieval IO stubbed, so the only thing
    under test is which llm the query-entity step reaches for. It must come from
    ``get_extract_llm()`` — the tool takes no config of its own (R12).
    """
    from deerflow.tools.builtins import graph_search_tool

    calls: list[tuple] = []
    sentinel = RuntimeError("reached the query-entity extraction")

    def _recording_llm(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(ainvoke=_raise(sentinel))

    monkeypatch.setattr(graph_search_tool, "get_extract_llm", _recording_llm)
    monkeypatch.setattr(graph_search_tool, "resolve_kb_scope", lambda runtime: ("kb-1", "user-1"))

    async def _allowed(*_args, **_kwargs):
        return True

    monkeypatch.setattr(graph_search_tool, "can_access", _allowed)

    with pytest.raises(RuntimeError) as excinfo:
        await graph_search_tool._graph_search_impl("q", SimpleNamespace(), store=SimpleNamespace(_sf=object()))

    assert excinfo.value is sentinel
    # Called with no arguments at all: the tool does not inject a config snapshot, so the
    # role follows whatever the process config says (which is the point of the R12 pin).
    assert calls == [((), {})]


def test_graph_search_tool_source_is_untouched():
    """R12's other half: the second consumer works through the optional parameter alone."""
    source = GRAPH_SEARCH_SOURCE.read_text(encoding="utf-8")

    assert "llm = llm or get_extract_llm()" in source
    # If this file ever grows a RAG-default lookup of its own, this pins where it went.
    assert "default_model" not in source


# ── eval judge ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("explicit", "judge_model", "default_model", "expected"),
    [
        ("D", "C", "B", "D"),  # the CLI argument / explicit call wins outright
        (None, "C", "B", "C"),  # ... then the role declaration
        (None, None, "B", "B"),  # ... then the RAG default
        (None, None, None, "A"),  # ... then the first configured model
    ],
)
def test_judge_priority(factory_spy, explicit, judge_model, default_model, expected):
    config = _config("A", "B", default_model=default_model, judge_model=judge_model)

    build_judge_llm(explicit, config=config)

    assert factory_spy[-1][0] == expected


def test_judge_passes_the_same_config_snapshot_it_resolved_from(factory_spy):
    config = _config("A", "B", default_model="B")

    build_judge_llm(None, config=config)

    assert factory_spy[-1] == ("B", config)


def test_judge_refuses_when_there_is_no_model_at_all(factory_spy):
    config = _config()

    with pytest.raises(RagConfigurationError):
        build_judge_llm(None, config=config)

    assert factory_spy == []


def test_judge_does_not_let_the_rag_default_override_an_explicit_name(factory_spy):
    config = _config("A", "B", default_model="B")

    build_judge_llm("A", config=config)

    assert factory_spy[-1][0] == "A"


def test_dashscope_prefix_still_takes_its_own_branch(monkeypatch: pytest.MonkeyPatch):
    """Pinned, not endorsed: the direct branch survives until Task 7 retires it.

    When Task 7 removes it this test goes red on purpose, which is how that reversal stays
    visible instead of being folded into an unrelated diff.
    """
    monkeypatch.setenv("DASHSCOPE_JUDGE_API_KEY", "test-judge-key")
    config = _config("A", default_model="B")

    client = build_judge_llm("dashscope:qwen3.8-max", config=config)

    assert client.model_name == "qwen3.8-max"
    assert "dashscope.aliyuncs.com" in str(client.openai_api_base)


# ── the two nameless RAG-internal points stay out of this (R20) ──────────


@pytest.mark.parametrize("call", ["wiki", "synthesis"])
def test_nameless_rag_points_never_see_the_rag_default(factory_spy, call: str):
    """Neither passes a name, so both keep resolving to the first model (R20).

    They are *not* wired to the RAG default this period; these assertions are what makes
    spec D6's "other RAG calls keep their own behaviour" checkable rather than assumed.
    """
    if call == "wiki":
        from deerflow.knowledge.wiki.generator import _default_llm

        _default_llm()
    else:
        from deerflow.knowledge.eval.synthesis import _default_llm_factory

        _default_llm_factory()

    name, app_config = factory_spy[-1]
    assert name is None, "a nameless point must not start naming a model"
    assert app_config is None, "a nameless point must not start taking a snapshot"


def _raise(exc: BaseException):
    async def _ainvoke(*_args, **_kwargs):
        raise exc

    return _ainvoke
