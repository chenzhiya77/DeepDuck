"""Tests for the constitution registry + the carrier canary.

Spec: docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md
- §4   WeakKeyDictionary carrier; both ``TypeError`` branches must degrade
- §4.1 verified: the compiled graph is weak-referenceable and identity-hashed
- §7   every failure mode degrades to "no snapshot", never raises
"""

from __future__ import annotations

import gc
import weakref

import pytest
from langchain.agents import create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

from deerflow.agents import constitution_record
from deerflow.agents.constitution_record import constitution_for, publish_constitution


class _Graph:
    """Stands in for a compiled graph: plain object, so weakref + hash work."""


class _NotWeakrefable:
    __slots__ = ()


class _Unhashable:
    __hash__ = None  # type: ignore[assignment]


def test_publish_then_query_roundtrip():
    graph = _Graph()
    record = {"schema_version": 1, "agent": {"name": "rag"}}
    publish_constitution(graph, record)
    assert constitution_for(graph) is record


def test_unpublished_object_has_no_record():
    assert constitution_for(_Graph()) is None


def test_two_graphs_are_distinct_keys():
    first, second = _Graph(), _Graph()
    publish_constitution(first, {"which": 1})
    publish_constitution(second, {"which": 2})
    assert constitution_for(first) == {"which": 1}
    assert constitution_for(second) == {"which": 2}


def test_not_weakrefable_graph_degrades_without_raising():
    obj = _NotWeakrefable()
    with pytest.raises(TypeError):
        weakref.ref(obj)
    publish_constitution(obj, {"schema_version": 1})  # must not raise
    assert constitution_for(obj) is None


def test_unhashable_graph_degrades_without_raising():
    obj = _Unhashable()
    # The two failure modes are independent: this one IS weak-referenceable.
    weakref.ref(obj)
    publish_constitution(obj, {"schema_version": 1})  # must not raise
    assert constitution_for(obj) is None


def test_entry_is_reclaimed_once_the_graph_goes_out_of_scope():
    graph = _Graph()
    publish_constitution(graph, {"schema_version": 1})
    assert len(constitution_record._RECORDS) == 1

    del graph
    gc.collect()
    assert len(constitution_record._RECORDS) == 0


# --------------------------------------------------------------------------- #
# carrier canary (§10): pins an UPSTREAM implementation detail, not our code
# --------------------------------------------------------------------------- #
def test_real_create_agent_graph_stays_weakrefable_and_identity_hashed():
    """If this fails, a ``langgraph``/``langchain`` upgrade broke the carrier.

    The registry swallows ``TypeError`` on purpose, so without this canary a
    future ``Pregel.__eq__`` / ``__slots__`` would silently degrade every run to
    "no snapshot". Failing here means: re-evaluate the carrier (§4) — do not
    just delete the test.
    """
    graph = create_agent(model=GenericFakeChatModel(messages=iter(["ok"])), tools=[])

    weakref.ref(graph)  # raises TypeError if the type stops supporting weakrefs
    assert type(graph).__hash__ is object.__hash__
    assert type(graph).__eq__ is object.__eq__

    other = create_agent(model=GenericFakeChatModel(messages=iter(["ok"])), tools=[])
    assert hash(graph) != hash(other)

    publish_constitution(graph, {"schema_version": 1})
    assert constitution_for(graph) == {"schema_version": 1}
    assert constitution_for(other) is None
