"""Tests for entity normalization (spec §3.4).

Two merge mechanisms: the surface alias table (case-fold / inner-whitespace /
trailing plural ``s``) and an optional embedding-similarity merge fed by
stub name vectors. Normalized names are what get backfilled into chunk
``entities`` and used as graph node names.
"""

from __future__ import annotations

import math

from deerflow.knowledge.graph.extractor import ExtractedEntity, ExtractedRelation, ExtractionResult
from deerflow.knowledge.graph.normalizer import cluster_alias_groups, normalize_extraction


def _result(names: list[str], relations: list[tuple[str, str, str]] | None = None) -> ExtractionResult:
    return ExtractionResult(
        entities=[ExtractedEntity(name=n, type="概念", description=f"{n} 的描述") for n in names],
        relations=[ExtractedRelation(source=s, target=t, relation=r, description="") for s, t, r in (relations or [])],
    )


def test_case_alias_merges_and_rewrites_relation_endpoints():
    result = _result(["OpenAI", "openai"], [("OpenAI", "GPT", "开发")])

    merged = normalize_extraction(result)

    assert len(merged.entities) == 1
    assert merged.entities[0].name == "OpenAI"  # first-seen display name wins
    assert "openai" in merged.entities[0].description or "OpenAI" in merged.entities[0].description
    assert merged.relations[0].source == "OpenAI"


def test_inner_whitespace_and_casefold_merge():
    result = _result(["数据  库", "数据库", "  数据库  "])

    merged = normalize_extraction(result)

    assert len(merged.entities) == 1


def test_trailing_plural_s_merges():
    result = _result(["model", "models"])

    merged = normalize_extraction(result)

    assert len(merged.entities) == 1
    assert merged.entities[0].name == "model"


def test_distinct_names_stay_separate():
    result = _result(["DeerFlow", "Qdrant", "MinerU"])

    merged = normalize_extraction(result)

    assert len(merged.entities) == 3


def _unit(v: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v))
    return [x / norm for x in v]


def test_embedding_similarity_merge_with_stub_vectors():
    result = _result(["深度学习", "深度神经网络", "数据库"])
    base = _unit([1.0, 0.0, 0.0])
    near = _unit([0.999, 0.0447, 0.0])  # cos ≈ 0.999 vs base
    far = _unit([0.0, 1.0, 0.0])
    vectors = {"深度学习": base, "深度神经网络": near, "数据库": far}

    merged = normalize_extraction(result, name_vectors=vectors, similarity_threshold=0.95)

    names = sorted(e.name for e in merged.entities)
    assert names == ["数据库", "深度学习"]  # near-duplicate merged into first-seen


def test_embedding_below_threshold_keeps_separate():
    result = _result(["向量检索", "图谱检索"])
    vectors = {"向量检索": _unit([1.0, 0.0]), "图谱检索": _unit([0.8, 0.6])}  # cos = 0.8

    merged = normalize_extraction(result, name_vectors=vectors, similarity_threshold=0.95)

    assert len(merged.entities) == 2


def test_embedding_merge_rewrites_relation_endpoints():
    result = _result(["深度学习", "深度神经网络"], [("深度神经网络", "GPU", "依赖")])
    vectors = {"深度学习": _unit([1.0, 0.0]), "深度神经网络": _unit([0.999, 0.0447])}

    merged = normalize_extraction(result, name_vectors=vectors, similarity_threshold=0.95)

    assert len(merged.entities) == 1
    assert merged.relations[0].source == "深度学习"


# ── cluster_alias_groups (D3: cross-slice re-resolution building block) ──


def test_cluster_alias_groups_surface_fold():
    groups = cluster_alias_groups(["Model", "Models", "Qdrant"], None, 0.92)

    assert groups == {"Model": ["Models"]}


def test_cluster_alias_groups_embedding_merge():
    vectors = {"深度学习": _unit([1.0, 0.0]), "深度神经网络": _unit([0.999, 0.0447]), "数据库": _unit([0.0, 1.0])}

    groups = cluster_alias_groups(["深度学习", "深度神经网络", "数据库"], vectors, 0.95)

    assert groups == {"深度学习": ["深度神经网络"]}


def test_cluster_alias_groups_representative_is_first_in_input_order():
    groups = cluster_alias_groups(["b", "B"], None, 0.92)

    assert groups == {"b": ["B"]}  # first-seen display name wins


def test_cluster_alias_groups_empty_when_nothing_merges():
    assert cluster_alias_groups(["Alpha", "Beta", "Gamma"], None, 0.92) == {}
