"""Task 4: the worker hands the factory's published snapshot to the journal.

Spec: docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md §6.4

Three degradation paths must stay silent — a custom factory that publishes
nothing, a run with no event store, and (covered in Task 2) a factory whose
snapshot build raised. Observability must never change what a run returns.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from deerflow.agents.constitution_record import publish_constitution
from deerflow.runtime.events.store.memory import MemoryRunEventStore
from deerflow.runtime.runs.manager import RunManager
from deerflow.runtime.runs.schemas import RunStatus
from deerflow.runtime.runs.worker import RunContext, run_agent

RECORD = {
    "schema_version": 1,
    "stages": [{"key": "intake", "loop": False, "members": 2, "gates": 0, "handoff_gates": 0}],
    "middlewares": [{"name": "ThreadDataMiddleware"}],
}


def _make_bridge():
    return SimpleNamespace(publish=AsyncMock(), publish_end=AsyncMock(), cleanup=AsyncMock())


class _Agent:
    """Fires one root chain start, like the real graph does per astream."""

    def __init__(self, *, observed_at_stream: dict | None = None):
        self._observed = observed_at_stream

    async def astream(self, graph_input, config=None, stream_mode=None, subgraphs=False):
        # Absent when the run has no event store — the wiring path must be skipped
        # there, so this stub must tolerate the same shape as production.
        journal = (config.get("context") or {}).get("__run_journal")
        if self._observed is not None:
            self._observed["journal_present"] = journal is not None
            self._observed["constitution"] = None if journal is None else journal._constitution
        if journal is not None:
            journal.on_chain_start({"name": "root"}, {}, run_id=uuid4(), parent_run_id=None, tags=["lead_agent"], metadata={})
        yield {"messages": []}


async def _run(*, event_store, factory) -> tuple[RunManager, object]:
    run_manager = RunManager()
    record = await run_manager.create("thread-1")
    await run_agent(
        _make_bridge(),
        run_manager,
        record,
        ctx=RunContext(checkpointer=None, event_store=event_store),
        agent_factory=factory,
        graph_input={},
        config={},
    )
    await asyncio.sleep(0)
    return run_manager, record


async def _run_start_events(store, run_id: str) -> list[dict]:
    return await store.list_events("thread-1", run_id, event_types=["run.start"])


@pytest.mark.anyio
async def test_worker_attaches_the_snapshot_the_factory_published():
    store = MemoryRunEventStore()

    def factory(*, config):
        agent = _Agent()
        publish_constitution(agent, RECORD)
        return agent

    run_manager, record = await _run(event_store=store, factory=factory)

    events = await _run_start_events(store, record.run_id)
    assert len(events) == 1
    assert events[0]["content"]["constitution"] is RECORD
    assert (await run_manager.get(record.run_id)).status == RunStatus.success


@pytest.mark.anyio
async def test_wiring_happens_before_the_graph_streams():
    observed: dict = {}

    def factory(*, config):
        agent = _Agent(observed_at_stream=observed)
        publish_constitution(agent, RECORD)
        return agent

    await _run(event_store=MemoryRunEventStore(), factory=factory)

    assert observed["journal_present"] is True
    assert observed["constitution"] is RECORD, "the journal must already hold it when astream starts"


@pytest.mark.anyio
async def test_a_factory_that_publishes_nothing_leaves_run_start_untouched():
    store = MemoryRunEventStore()

    run_manager, record = await _run(event_store=store, factory=lambda *, config: _Agent())

    events = await _run_start_events(store, record.run_id)
    assert len(events) == 1
    assert events[0]["content"] == {"chain": "root"}, "no snapshot means no extra field"
    assert (await run_manager.get(record.run_id)).status == RunStatus.success


@pytest.mark.anyio
async def test_real_factory_snapshot_reaches_run_start(monkeypatch):
    """End to end: assemble -> publish -> worker bridge -> run.start payload."""
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    from deerflow.agents.constitution_record import STAGE_OF_MIDDLEWARE
    from deerflow.agents.lead_agent.agent import make_lead_agent

    monkeypatch.setattr(
        "deerflow.agents.lead_agent.agent.create_chat_model",
        lambda *_a, **_k: GenericFakeChatModel(messages=iter(["ok"])),
        raising=True,
    )
    monkeypatch.setattr("deerflow.tools.get_available_tools", lambda *_a, **_k: [], raising=True)

    store = MemoryRunEventStore()
    run_manager = RunManager()
    record = await run_manager.create("thread-1")
    await run_agent(
        _make_bridge(),
        run_manager,
        record,
        ctx=RunContext(checkpointer=None, event_store=store),
        agent_factory=make_lead_agent,
        graph_input={"messages": []},
        config={"configurable": {"agent_name": None}, "context": {}},
    )
    await asyncio.sleep(0)

    events = await _run_start_events(store, record.run_id)
    constitution = next(e for e in events if "constitution" in e["content"])["content"]["constitution"]
    names = [row["name"] for row in constitution["middlewares"]]
    assert names, "the real factory must report a non-empty chain"
    assert set(names) <= set(STAGE_OF_MIDDLEWARE), "every mounted class must be in the stage table"
    assert {"ThreadDataMiddleware", "ClarificationMiddleware"} <= set(names)
    assert sum(row["members"] + row["gates"] + row["handoff_gates"] for row in constitution["stages"]) == len(names)


@pytest.mark.anyio
async def test_a_run_without_an_event_store_is_skipped_entirely():
    def factory(*, config):
        agent = _Agent()
        publish_constitution(agent, RECORD)
        return agent

    run_manager, record = await _run(event_store=None, factory=factory)

    assert (await run_manager.get(record.run_id)).status == RunStatus.success
