"""Task 3: the run-start event carries the constitution, exactly once per run.

Spec: docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md §6.3

The load-bearing facts here:
- ``set_constitution`` is a pure assignment (no IO) — ``run_inline = True`` makes
  that a CI gate for the callback path, and this file pins the assignment itself.
- With nothing set, ``run.start`` is byte-identical to before this feature.
- One run emits **two** ``run.start`` events (user turn + one goal continuation,
  measured in Task 0 Step 2); only the first carries the snapshot, and the test
  pins that count so a change in the emission shape cannot go unnoticed.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from deerflow.runtime.events.store.memory import MemoryRunEventStore
from deerflow.runtime.journal import RunJournal

RECORD = {
    "schema_version": 1,
    "stages": [{"key": "intake", "loop": False, "members": 2, "gates": 0, "handoff_gates": 0}],
    "middlewares": [{"name": "ThreadDataMiddleware"}],
}


def _journal(store: MemoryRunEventStore) -> RunJournal:
    return RunJournal("run-1", "thread-1", store, flush_threshold=100)


def _root_start(journal: RunJournal, chain: str = "root", **metadata) -> None:
    journal.on_chain_start(
        {"name": chain},
        {},
        run_id=uuid4(),
        parent_run_id=None,
        tags=["lead_agent"],
        metadata=metadata or {"langgraph_step": 1},
    )


# --------------------------------------------------------------------------- #
# set_constitution is a pure assignment
# --------------------------------------------------------------------------- #
def test_set_constitution_is_a_pure_assignment_with_no_io():
    journal = _journal(MemoryRunEventStore())
    buffer_before = len(journal._buffer)

    journal.set_constitution(RECORD)

    assert journal._constitution is RECORD
    assert len(journal._buffer) == buffer_before, "setting a record must not emit anything"


def test_journal_keeps_its_run_inline_contract():
    """Callbacks must stay in-memory only; the CI gate reads this class flag."""
    assert RunJournal.run_inline is True


# --------------------------------------------------------------------------- #
# run.start payload
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_run_start_carries_the_constitution_when_set():
    store = MemoryRunEventStore()
    journal = _journal(store)
    journal.set_constitution(RECORD)

    _root_start(journal)
    await journal.flush()

    events = await store.list_events("thread-1", "run-1", event_types=["run.start"])
    assert len(events) == 1
    content = events[0]["content"]
    assert content["constitution"] == RECORD
    # Existing fields are untouched.
    assert content["chain"] == "root"
    assert events[0]["metadata"]["caller"] == "lead_agent"
    assert events[0]["metadata"]["langgraph_step"] == 1


@pytest.mark.anyio
async def test_run_start_is_unchanged_when_nothing_was_set():
    store = MemoryRunEventStore()
    journal = _journal(store)

    _root_start(journal)
    await journal.flush()

    event = (await store.list_events("thread-1", "run-1", event_types=["run.start"]))[0]
    assert event["content"] == {"chain": "root"}, "unset must stay byte-identical to today"
    assert "constitution" not in event["content"]


@pytest.mark.anyio
async def test_only_the_first_root_start_carries_the_constitution():
    """A run emits one run.start per astream (user turn + each continuation)."""
    store = MemoryRunEventStore()
    journal = _journal(store)
    journal.set_constitution(RECORD)

    _root_start(journal, "root")  # user turn
    _root_start(journal, "root")  # one goal continuation
    await journal.flush()

    events = await store.list_events("thread-1", "run-1", event_types=["run.start"])
    assert len(events) == 2, "Task 0 Step 2 measured 2 emissions for a 1-continuation run"
    carrying = [event for event in events if "constitution" in event["content"]]
    assert len(carrying) == 1
    assert carrying[0]["seq"] == min(event["seq"] for event in events)
    for event in events:
        assert event["content"]["chain"] == "root"


@pytest.mark.anyio
async def test_nested_chain_starts_never_emit_or_carry_it():
    store = MemoryRunEventStore()
    journal = _journal(store)
    journal.set_constitution(RECORD)

    _root_start(journal)
    journal.on_chain_start(
        {"name": "model"},
        {},
        run_id=uuid4(),
        parent_run_id=uuid4(),
        tags=["lead_agent"],
    )
    await journal.flush()

    events = await store.list_events("thread-1", "run-1", event_types=["run.start"])
    assert len(events) == 1


@pytest.mark.anyio
async def test_constitution_is_reread_per_journal_not_shared():
    """Two runs on the same thread must not leak each other's snapshot."""
    store = MemoryRunEventStore()
    first = RunJournal("run-a", "thread-1", store, flush_threshold=100)
    second = RunJournal("run-b", "thread-1", store, flush_threshold=100)
    other = {"schema_version": 1, "stages": [], "middlewares": [], "which": "b"}

    first.set_constitution(RECORD)
    second.set_constitution(other)
    _root_start(first, "a")
    _root_start(second, "b")
    await first.flush()
    await second.flush()

    events_a = await store.list_events("thread-1", "run-a", event_types=["run.start"])
    events_b = await store.list_events("thread-1", "run-b", event_types=["run.start"])
    assert events_a[0]["content"]["constitution"] == RECORD
    assert events_b[0]["content"]["constitution"] == other
