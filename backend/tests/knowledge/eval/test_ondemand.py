"""Orchestration tests for the on-demand Layer 1 eval runner (spec 2026-08-27 §5).

``run_layer1_for_kb`` 复刻 CLI ``run_rag_eval.py`` 的编排链（load golden →
searchers → run_evaluation → 报告映射 → save_eval_run），但复用调用进程已
初始化的引擎与 store：测试直接注入 stub searchers，不经任何真实检索 impl，
也不触发默认 searcher 构建（那需要真实 KB 行与向量库）。

契约：
- completed 落一行 ``environment="local"``、layer2 为 ``{}``、created_at =
  显式传入的 generated_at（单一时钟）；
- 自动 diff 标记 baseline（无标记行则 baseline_diff 为 null）；
- 运行期异常兜底落 error 行且不上抛（fire-and-forget 安全，复刻 CLI
  best-effort 持久化语义）；空题库是「不该开始」而非「运行失败」——直接
  抛 ``EvalQuestionBankEmpty``、不落行；
- in-flight 注册表复刻 wiki ``_IN_FLIGHT``：运行中可观测、finally 必减。
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

import pytest

from deerflow.knowledge.eval import ondemand
from deerflow.knowledge.eval.persistence import generate_run_id, save_eval_run
from deerflow.knowledge.eval.question_bank import add_question
from deerflow.knowledge.store import KnowledgeStore

pytestmark = pytest.mark.asyncio

KB = "kb-under-test"
CHUNK_A = "a" * 32 + "#0001"
GENERATED_AT = "2026-08-27T10:00:00+00:00"


@pytest.fixture
def store(session_factory):
    return KnowledgeStore(session_factory)


@pytest.fixture(autouse=True)
def _clean_in_flight():
    yield
    ondemand._IN_FLIGHT.pop(KB, None)


def _stub_searchers(hit_chunk: str | None = CHUNK_A) -> dict:
    from deerflow.knowledge.eval.runner import ScoredHit

    async def vector_fn(query: str, top_k: int):
        return () if hit_chunk is None else (ScoredHit(chunk_id=hit_chunk, score=0.93),)

    async def empty_fn(query: str, top_k: int):
        return ()

    return {"vector": vector_fn, "graph": empty_fn, "wiki": empty_fn}


async def _seed_question(path, query: str = "什么是退休年龄") -> None:
    await add_question(path, query=query, category="fact", expected_path="vector", relevant_chunk_ids=[CHUNK_A])


def test_generate_run_id_format_matches_cli_contract() -> None:
    # rag-<UTC 秒>-<hex8>，提升到 eval 包后 CLI 与按需运行共用。
    assert re.fullmatch(r"rag-\d{8}T\d{6}Z-[0-9a-f]{8}", generate_run_id())


async def test_completed_run_persists_local_layer1_row(tmp_path, store) -> None:
    golden = tmp_path / "golden.jsonl"
    await _seed_question(golden)

    run_id = await ondemand.run_layer1_for_kb(KB, golden_path=golden, searchers=_stub_searchers(), generated_at=GENERATED_AT)

    assert run_id.startswith("rag-")
    rows = await store.list_eval_runs(KB)
    assert len(rows) == 1
    row = rows[0]
    assert row.id == run_id
    assert row.status == "completed"
    assert row.layer2_metrics == {}
    assert row.layer1_metrics["summary"]["question_count"] == 1
    assert row.layer1_metrics["summary"]["recall_at_k"] == 1.0  # 锚定 chunk 命中
    assert row.environment == "local"
    # SQLite 往返返回 naive datetime（本项目 eval_runs 既定口径），按壁钟对齐。
    assert row.created_at == datetime.fromisoformat(GENERATED_AT).replace(tzinfo=None)
    assert row.completed_at >= row.created_at
    assert row.baseline_diff is None
    # drain 后注册表必须归零（finally 保证）。
    assert not ondemand.eval_run_in_progress(KB)


async def test_auto_diff_against_marked_baseline(tmp_path, store) -> None:
    golden = tmp_path / "golden.jsonl"
    await _seed_question(golden)
    baseline_metrics = {
        "summary": {"recall_at_k": 1.0, "hit_rate": None, "mrr": None, "path_accuracy": None, "question_count": 1},
    }
    await save_eval_run(
        run_id="run-base",
        kb_id=KB,
        status="completed",
        created_at=datetime.now(UTC),
        layer1_metrics=baseline_metrics,
        mark_baseline=True,
    )

    await ondemand.run_layer1_for_kb(KB, golden_path=golden, searchers=_stub_searchers(), generated_at=GENERATED_AT)

    rows = [row for row in await store.list_eval_runs(KB) if row.id != "run-base"]
    assert len(rows) == 1
    diff = rows[0].baseline_diff
    assert diff is not None
    assert diff["regression_detected"] is False


async def test_no_baseline_means_null_diff(tmp_path, store) -> None:
    golden = tmp_path / "golden.jsonl"
    await _seed_question(golden)

    await ondemand.run_layer1_for_kb(KB, golden_path=golden, searchers=_stub_searchers(), generated_at=GENERATED_AT)

    rows = await store.list_eval_runs(KB)
    assert rows[0].baseline_diff is None


async def test_runtime_exception_falls_back_to_error_row_without_raising(tmp_path, store, monkeypatch) -> None:
    golden = tmp_path / "golden.jsonl"
    await _seed_question(golden)

    def _boom(report):
        raise RuntimeError("mapping blew up")

    # 打在本模块的绑定上：编排期映射崩溃属于「运行期异常」，须兜底为 error 行。
    monkeypatch.setattr(ondemand, "layer1_metrics_from_report", _boom)

    run_id = await ondemand.run_layer1_for_kb(KB, golden_path=golden, searchers=_stub_searchers(), generated_at=GENERATED_AT)

    rows = await store.list_eval_runs(KB)
    assert len(rows) == 1
    row = rows[0]
    assert row.id == run_id
    assert row.status == "error"
    assert row.layer1_metrics == {}


async def test_missing_bank_raises_and_persists_nothing(tmp_path, store) -> None:
    with pytest.raises(ondemand.EvalQuestionBankEmpty):
        await ondemand.run_layer1_for_kb(KB, golden_path=tmp_path / "absent.jsonl", searchers=_stub_searchers(), generated_at=GENERATED_AT)

    assert await store.list_eval_runs(KB) == []


async def test_blank_line_only_bank_counts_as_empty(tmp_path, store) -> None:
    golden = tmp_path / "golden.jsonl"
    golden.write_text("\n\n", encoding="utf-8")

    with pytest.raises(ondemand.EvalQuestionBankEmpty):
        await ondemand.run_layer1_for_kb(KB, golden_path=golden, searchers=_stub_searchers(), generated_at=GENERATED_AT)

    assert await store.list_eval_runs(KB) == []
