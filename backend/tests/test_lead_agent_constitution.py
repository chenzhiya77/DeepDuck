"""Task 2: the two ``create_agent`` sites publish a constitution, and the hoist
changed nothing about what ``create_agent`` receives.

The security net here is **identity**, not equality: after the hoist the same
list object must flow ``build_middlewares`` -> ``normalize_middleware_state_schemas``
-> ``create_agent``. Identity cannot be satisfied by a re-implementation that
happens to produce equal contents, so a dropped, added or reordered middleware
would break it.

Spec: docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md §6.2
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

from deerflow.agents.constitution_record import constitution_for
from deerflow.agents.lead_agent import agent as agent_module

TARGET = "deerflow.agents.lead_agent.agent"


class _Spy:
    def __init__(self, real):
        self._real = real
        self.calls: list[dict[str, Any]] = []
        self.inputs: list[Any] = []
        self.outputs: list[Any] = []

    def __call__(self, *args, **kwargs):
        self.calls.append({"args": args, "kwargs": kwargs})
        self.inputs.append(args[0] if args else None)
        result = self._real(*args, **kwargs)
        self.outputs.append(result)
        return result


def _fake_model(*_args, **_kwargs):
    return GenericFakeChatModel(messages=iter(["ok"]))


@pytest.fixture()
def spies(monkeypatch):
    """Real assembly, cheap leaves, every seam recorded."""
    from langchain.agents import create_agent as real_create_agent

    create = _Spy(real_create_agent)
    build = _Spy(agent_module.build_middlewares)
    normalize = _Spy(agent_module.normalize_middleware_state_schemas)

    monkeypatch.setattr(f"{TARGET}.create_agent", create, raising=True)
    monkeypatch.setattr(f"{TARGET}.build_middlewares", build, raising=True)
    monkeypatch.setattr(f"{TARGET}.normalize_middleware_state_schemas", normalize, raising=True)
    # The two leaves that would otherwise hit a provider or spawn MCP servers.
    monkeypatch.setattr(f"{TARGET}.create_chat_model", _fake_model, raising=True)
    monkeypatch.setattr("deerflow.tools.get_available_tools", lambda *_a, **_k: [], raising=True)

    return {"create": create, "build": build, "normalize": normalize}


def _config(**flags):
    return {"configurable": dict(flags), "context": {}}


# --------------------------------------------------------------------------- #
# hoist equivalence (the safety net for the one non-bypass change)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "flags",
    [
        {"is_plan_mode": False, "subagent_enabled": False},
        {"is_plan_mode": True, "subagent_enabled": True},
    ],
)
def test_hoist_passes_the_identical_objects_through(spies, flags):
    agent_module.make_lead_agent(_config(**flags))

    build, normalize, create = spies["build"], spies["normalize"], spies["create"]
    assert len(build.outputs) == 1, "each site builds the chain exactly once"
    assert len(normalize.outputs) == 1
    assert len(create.calls) == 1

    # Same list object all the way through: no copy, no filter, no reorder.
    assert normalize.inputs[-1] is build.outputs[-1]
    assert create.calls[-1]["kwargs"]["middleware"] is normalize.outputs[-1]


def test_bootstrap_site_hoists_the_same_way(spies):
    agent_module.make_lead_agent(_config(is_bootstrap=True))

    build, normalize, create = spies["build"], spies["normalize"], spies["create"]
    assert normalize.inputs[-1] is build.outputs[-1]
    assert create.calls[-1]["kwargs"]["middleware"] is normalize.outputs[-1]


def test_make_lead_agent_signature_is_unchanged():
    """``agent.py:644``: keep the signature compatible with LangGraph Server."""
    assert list(inspect.signature(agent_module.make_lead_agent).parameters) == ["config"]


def test_return_value_is_still_a_compiled_graph(spies):
    graph = agent_module.make_lead_agent(_config())
    assert type(graph).__name__ == "CompiledStateGraph"
    assert graph is spies["create"].outputs[-1]


# --------------------------------------------------------------------------- #
# both sites publish
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("flags", [{"is_bootstrap": False}, {"is_bootstrap": True}])
def test_both_create_agent_sites_publish_a_constitution(spies, flags):
    graph = agent_module.make_lead_agent(_config(**flags))

    record = constitution_for(graph)
    assert record is not None, "this site did not publish"
    assert record["schema_version"] == 1
    assert record["agent"]["is_bootstrap"] is flags["is_bootstrap"]
    assert record["checkpoint_mode"] in {"full", "delta"}


def test_published_record_describes_the_middlewares_handed_to_create_agent(spies):
    graph = agent_module.make_lead_agent(_config(is_plan_mode=True, subagent_enabled=True))
    record = constitution_for(graph)
    handed = spies["create"].calls[-1]["kwargs"]["middleware"]

    assert [row["name"] for row in record["middlewares"]] == [type(m).__name__ for m in handed]
    assert record["tools"]["mounted"] == []
    assert record["runtime_flags"]["is_plan_mode"] is True
    assert record["runtime_flags"]["subagent_enabled"] is True


def test_published_stage_counts_match_the_published_middleware_rows(spies):
    graph = agent_module.make_lead_agent(_config(is_plan_mode=True, subagent_enabled=True))
    record = constitution_for(graph)
    total = sum(row["members"] + row["gates"] + row["handoff_gates"] for row in record["stages"])
    assert total == len(record["middlewares"]) > 0


# --------------------------------------------------------------------------- #
# observability never blocks assembly (§7)
# --------------------------------------------------------------------------- #
def test_a_failing_record_builder_does_not_break_agent_construction(monkeypatch, spies, caplog):
    def _boom(**_kwargs):
        raise RuntimeError("record builder exploded")

    monkeypatch.setattr(f"{TARGET}.build_constitution_record", _boom, raising=True)

    graph = agent_module.make_lead_agent(_config())
    assert type(graph).__name__ == "CompiledStateGraph"
    assert constitution_for(graph) is None


# Reclaim-on-drop is pinned by ``test_constitution_registry.py``; repeating it
# here would only add inter-test flakiness.
