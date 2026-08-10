"""Tests for graph evidence selection (spec 2026-08-10 D1).

Pure-function coverage of the candidate pipeline: collect (dedupe across
edge/node channels) → per-source caps → two-phase selection (hop0 guarantee
with round-robin payout → pure-score competition) → truncation. No Qdrant,
no database — the graph structure only defines the pool; semantics decides
who gets in and in what order.
"""

from __future__ import annotations

import networkx as nx

from deerflow.knowledge.graph.retrieval import (
    Candidate,
    apply_source_caps,
    collect_candidates,
    select_evidence,
)


def _graph() -> nx.DiGraph:
    graph = nx.DiGraph()
    graph.add_node("A", source_chunk_ids=["c2", "c3"])
    graph.add_node("B", source_chunk_ids=["c4"])
    graph.add_node("C", source_chunk_ids=["c9"])
    graph.add_edge("A", "B", source_chunk_ids=["c1", "c2"])
    graph.add_edge("A", "C", source_chunk_ids=["c8"])
    return graph


def _candidate(chunk_id: str, *, entities=(), edges=(), hop: int = 0) -> Candidate:
    return Candidate(chunk_id=chunk_id, entity_sources=set(entities), edge_sources=set(edges), hop=hop)


class TestCollectCandidates:
    def test_dedupes_across_edge_and_node_channels(self):
        candidates = collect_candidates(_graph(), {"A": 0, "B": 1})

        assert set(candidates) == {"c1", "c2", "c3", "c4"}
        c2 = candidates["c2"]
        assert c2.entity_sources == {"A"}
        assert c2.edge_sources == {("A", "B")}
        assert c2.hop == 0  # min over sources

    def test_edge_hop_is_min_endpoint_hop(self):
        candidates = collect_candidates(_graph(), {"A": 0, "B": 1})

        assert candidates["c1"].hop == 0  # edge A→B: min(0, 1)
        assert candidates["c4"].hop == 1  # node B

    def test_skips_edges_leaving_the_seen_subgraph(self):
        candidates = collect_candidates(_graph(), {"A": 0})

        assert "c8" not in candidates  # edge A→C: C outside seen
        assert set(candidates) == {"c2", "c3"}  # edge A→B also excluded (B outside)


class TestApplySourceCaps:
    def test_keeps_top_scored_per_entity(self):
        candidates = {f"c{i}": _candidate(f"c{i}", entities=["E"]) for i in range(5)}
        scores = {"c0": 0.9, "c1": 0.8, "c2": 0.7, "c3": 0.6, "c4": 0.5}

        apply_source_caps(candidates, scores, per_entity_cap=3, per_edge_cap=2)

        assert set(candidates) == {"c0", "c1", "c2"}

    def test_keeps_top_scored_per_edge(self):
        edge = ("A", "B")
        candidates = {f"c{i}": _candidate(f"c{i}", edges=[edge]) for i in range(4)}
        scores = {"c0": 0.4, "c1": 0.9, "c2": 0.3, "c3": 0.8}

        apply_source_caps(candidates, scores, per_entity_cap=3, per_edge_cap=2)

        assert set(candidates) == {"c1", "c3"}

    def test_chunk_survives_via_another_source(self):
        candidates = {
            "best": _candidate("best", entities=["E"]),
            "shared": _candidate("shared", entities=["E"], edges=[("A", "B")]),
        }
        scores = {"best": 0.9, "shared": 0.1}

        apply_source_caps(candidates, scores, per_entity_cap=1, per_edge_cap=2)

        assert candidates["shared"].entity_sources == set()  # capped out of E
        assert candidates["shared"].edge_sources == {("A", "B")}  # kept alive by the edge


class TestSelectEvidenceGuarantee:
    def test_guarantee_takes_entity_top_scored(self):
        candidates = {
            "low": _candidate("low", entities=["E1"]),
            "mid": _candidate("mid", entities=["E1"]),
            "high": _candidate("high", entities=["E1"]),
        }
        scores = {"low": 0.3, "mid": 0.5, "high": 0.9}

        selected = select_evidence(candidates, scores, {"E1": 0.9}, ["E1"], guarantee=2, limit=8)

        assert selected == ["high", "mid", "low"]  # guarantee top-2, then competition

    def test_round_robin_payout_on_overflow(self):
        """5 hop0 entities × guarantee 2 > budget 8: every entity gets ≥1,
        higher entity scores earn their second slice first — never a waterfall
        that leaves tail entities with zero."""
        entities = ["E1", "E2", "E3", "E4", "E5"]
        entity_scores = {"E1": 0.95, "E2": 0.9, "E3": 0.85, "E4": 0.8, "E5": 0.75}
        candidates = {}
        scores = {}
        for i, entity in enumerate(entities):
            for j, tag in enumerate(("a", "b")):
                cid = f"{entity}-{tag}"
                candidates[cid] = _candidate(cid, entities=[entity])
                scores[cid] = 0.9 - 0.01 * i - 0.05 * j

        selected = select_evidence(candidates, scores, entity_scores, entities, guarantee=2, limit=8)

        assert selected == ["E1-a", "E2-a", "E3-a", "E4-a", "E5-a", "E1-b", "E2-b", "E3-b"]

    def test_undersupplied_entity_yields_budget(self):
        candidates = {
            "E1-only": _candidate("E1-only", entities=["E1"]),
            "E2-a": _candidate("E2-a", entities=["E2"]),
            "E2-b": _candidate("E2-b", entities=["E2"]),
            "free": _candidate("free", entities=["N1"], hop=1),
        }
        scores = {"E1-only": 0.9, "E2-a": 0.8, "E2-b": 0.7, "free": 0.6}

        selected = select_evidence(candidates, scores, {"E1": 0.95, "E2": 0.9}, ["E1", "E2"], guarantee=2, limit=8)

        assert selected == ["E1-only", "E2-a", "E2-b", "free"]

    def test_overlapping_chunk_serves_both_entities(self):
        candidates = {
            "shared": _candidate("shared", entities=["E1", "E2"]),
            "E2-next": _candidate("E2-next", entities=["E2"]),
        }
        scores = {"shared": 0.9, "E2-next": 0.5}

        selected = select_evidence(candidates, scores, {"E1": 0.95, "E2": 0.9}, ["E1", "E2"], guarantee=2, limit=8)

        assert selected == ["shared", "E2-next"]  # E2's turn: shared taken → next one

    def test_entity_fully_covered_by_overlap_contributes_nothing(self):
        candidates = {"shared": _candidate("shared", entities=["E1", "E2"])}
        scores = {"shared": 0.9}

        selected = select_evidence(candidates, scores, {"E1": 0.95, "E2": 0.9}, ["E1", "E2"], guarantee=2, limit=8)

        assert selected == ["shared"]

    def test_hop0_edge_chunks_compete_but_are_not_guaranteed(self):
        edge = ("E1", "E2")
        candidates = {
            "edge-chunk": _candidate("edge-chunk", edges=[edge], hop=0),
            "E1-low": _candidate("E1-low", entities=["E1"]),
            "E1-mid": _candidate("E1-mid", entities=["E1"]),
        }
        scores = {"edge-chunk": 0.99, "E1-low": 0.1, "E1-mid": 0.2}

        selected = select_evidence(candidates, scores, {"E1": 0.95, "E2": 0.9}, ["E1", "E2"], guarantee=2, limit=8)

        # Guarantee phase draws only from entity sources; the edge chunk waits
        # for the competition phase and surfaces first there via its high score.
        assert selected == ["E1-mid", "E1-low", "edge-chunk"]


class TestSelectEvidenceCompetition:
    def test_hop1_high_score_beats_hop0_leftover_by_default(self):
        candidates = {
            "E1-a": _candidate("E1-a", entities=["E1"]),
            "E1-b": _candidate("E1-b", entities=["E1"]),
            "E1-c": _candidate("E1-c", entities=["E1"]),
            "N1-x": _candidate("N1-x", entities=["N1"], hop=1),
        }
        scores = {"E1-a": 0.9, "E1-b": 0.8, "E1-c": 0.3, "N1-x": 0.95}

        selected = select_evidence(candidates, scores, {"E1": 0.9}, ["E1"], guarantee=2, limit=8)

        assert selected == ["E1-a", "E1-b", "N1-x", "E1-c"]

    def test_tie_breaks_by_hop_then_chunk_id(self):
        candidates = {
            "b-hop1": _candidate("b-hop1", entities=["N"], hop=1),
            "a-hop1": _candidate("a-hop1", entities=["N"], hop=1),
            "z-hop0": _candidate("z-hop0", entities=["E"], hop=0),
        }
        scores = {"b-hop1": 0.5, "a-hop1": 0.5, "z-hop0": 0.5}

        selected = select_evidence(candidates, scores, {"E": 0.9}, ["E"], guarantee=0, limit=8)

        assert selected == ["z-hop0", "a-hop1", "b-hop1"]

    def test_hop_penalty_shifts_order_when_enabled(self):
        candidates = {
            "hop0": _candidate("hop0", entities=["E"], hop=0),
            "hop1": _candidate("hop1", entities=["N"], hop=1),
        }
        scores = {"hop0": 0.7, "hop1": 0.75}

        default_order = select_evidence(candidates, scores, {"E": 0.9}, ["E"], guarantee=0, limit=8)
        penalized = select_evidence(candidates, scores, {"E": 0.9}, ["E"], guarantee=0, limit=8, hop_penalty=0.2)

        assert default_order == ["hop1", "hop0"]
        assert penalized == ["hop0", "hop1"]  # 0.75 − 0.2 < 0.7

    def test_truncates_at_limit(self):
        candidates = {f"c{i:02d}": _candidate(f"c{i:02d}", entities=["N"], hop=1) for i in range(20)}
        scores = {f"c{i:02d}": 1.0 - 0.01 * i for i in range(20)}

        selected = select_evidence(candidates, scores, {}, [], guarantee=0, limit=8)

        assert selected == [f"c{i:02d}" for i in range(8)]
