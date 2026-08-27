"""Contract tests for the eval-runs read endpoints (spec 2026-08-24 §4.2, plan Task 1).

GET ``/api/knowledge-bases/{kb_id}/eval-runs/latest`` — 两层各自最近一次
completed 且对应层 metrics 非空且非 ci 的运行（可来自不同运行）。
GET ``/api/knowledge-bases/{kb_id}/eval-runs/trend`` — 统一末次语义的周期
聚合 + baseline 块 + ``days_back`` clamp 回显。
GET ``/api/knowledge-bases/{kb_id}/eval-runs/{run_id}`` — 单行完整 JSON，
drawer 数据源。

测试数据走真实写入路径 ``save_eval_run``（session_factory fixture 已初始化
全局引擎），基建对齐 ``test_vector_projection_api.py``。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.gateway.auth.models import User
from app.gateway.routers import knowledge_bases
from app.gateway.services.knowledge_service import KnowledgeService
from deerflow.knowledge.eval.persistence import save_eval_run
from deerflow.knowledge.store import KnowledgeStore

pytestmark = pytest.mark.asyncio

OWNER_ID = str(UUID(int=1234567890))


def _owner() -> User:
    return User(email="owner@example.com", password_hash="x", system_role="user", id=UUID(OWNER_ID))


@pytest.fixture
def service(session_factory, tmp_path) -> KnowledgeService:
    vector_store = MagicMock()
    vector_store.chunks_collection = "kb_chunks"
    vector_store.entities_collection = "kb_entities"
    vector_store.wiki_entries_collection = "kb_wiki"
    vector_store.manual_cards_collection = "kb_cards"
    return KnowledgeService(
        store=KnowledgeStore(session_factory),
        vector_store=vector_store,
        graph_store=None,
        wiki_store=None,
        worker=None,
        data_dir=tmp_path,
    )


def _client(service: KnowledgeService, user_factory=_owner) -> TestClient:
    from _router_auth_helpers import make_authed_test_app

    app = make_authed_test_app(user_factory=user_factory)
    app.state.knowledge_service = service
    app.include_router(knowledge_bases.router)
    return TestClient(app)


def _create_kb(client: TestClient, name: str = "产品资料") -> dict:
    response = client.post("/api/knowledge-bases", json={"name": name, "description": "d"})
    assert response.status_code == 201, response.text
    return response.json()


def _l1(recall_at_k: float = 0.8, hit_rate: float = 0.9, mrr: float = 0.7) -> dict:
    return {
        "summary": {
            "recall_at_k": recall_at_k,
            "hit_rate": hit_rate,
            "mrr": mrr,
            "path_accuracy": 1.0,
            "question_count": 20,
        },
        "fact": {
            "recall_at_k": recall_at_k,
            "hit_rate": hit_rate,
            "mrr": mrr,
            "path_accuracy": 1.0,
            "question_count": 8,
        },
    }


def _l2(faithfulness: float = 0.95) -> dict:
    return {
        "ragas": {
            "faithfulness": faithfulness,
            "answer_relevancy": 0.88,
            "context_precision": 0.91,
            "context_recall": None,
        },
        "arch_specific": {"citation_precision": 0.9, "citation_recall": 0.85, "seed_hit_rate": None},
        "path_accuracy": 0.75,
        "ragas_available": True,
        "ragas_skip_reason": None,
        "has_graph_questions": False,
    }


async def _seed_run(
    kb_id: str,
    run_id: str,
    created_at: datetime,
    *,
    layer1: dict | None = None,
    layer2: dict | None = None,
    status: str = "completed",
    environment: str = "local",
    baseline_diff: dict | None = None,
    langfuse_trace_url: str | None = None,
    mark_baseline: bool = False,
) -> None:
    saved = await save_eval_run(
        run_id=run_id,
        kb_id=kb_id,
        status=status,
        created_at=created_at,
        layer1_metrics=layer1,
        layer2_metrics=layer2,
        baseline_diff=baseline_diff,
        langfuse_trace_url=langfuse_trace_url,
        environment=environment,
        mark_baseline=mark_baseline,
    )
    assert saved == run_id


# ── latest ───────────────────────────────────────────────────────────────


async def test_latest_returns_most_recent_completed_run_per_layer(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-l1-old", datetime(2026, 8, 18, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-l1-new", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))
    await _seed_run(
        kb["id"],
        "run-l2",
        datetime(2026, 8, 19, 9, 0, tzinfo=UTC),
        layer2=_l2(faithfulness=0.97),
        langfuse_trace_url="https://langfuse.example/trace/1",
    )

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/latest")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kb_id"] == kb["id"]
    # 两层独立取最近：layer1 取 08-20 的新运行，layer2 取 08-19。
    assert body["layer1"]["run_id"] == "run-l1-new"
    assert body["layer1"]["metrics"]["summary"]["recall_at_k"] == 0.85
    assert body["layer1"]["metrics"]["fact"]["question_count"] == 8
    assert body["layer1"]["created_at"].startswith("2026-08-20")
    layer2 = body["layer2"]
    assert layer2["run_id"] == "run-l2"
    assert layer2["ragas"]["faithfulness"] == 0.97
    assert layer2["arch_specific"]["citation_precision"] == 0.9
    assert layer2["ragas_available"] is True
    assert layer2["has_graph_questions"] is False
    assert layer2["langfuse_trace_url"] == "https://langfuse.example/trace/1"


async def test_latest_layer_without_any_run_is_null(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/latest").json()

    assert body["layer1"]["run_id"] == "run-l1"
    assert body["layer2"] is None


async def test_latest_never_evaluated_returns_both_layers_null(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/latest")

    assert response.status_code == 200, response.text
    assert response.json() == {"kb_id": kb["id"], "layer1": None, "layer2": None}


async def test_latest_unknown_kb_404(service) -> None:
    client = _client(service)

    response = client.get("/api/knowledge-bases/kb-missing/eval-runs/latest")

    assert response.status_code == 404


async def test_latest_excludes_ci_skipped_and_error_runs(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-local", datetime(2026, 8, 18, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-ci", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.99), environment="ci")
    await _seed_run(kb["id"], "run-skip", datetime(2026, 8, 21, 9, 0, tzinfo=UTC), layer2=_l2(), status="skipped")
    await _seed_run(kb["id"], "run-err", datetime(2026, 8, 22, 9, 0, tzinfo=UTC), layer2=_l2(), status="error")

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/latest").json()

    assert body["layer1"]["run_id"] == "run-local"
    assert body["layer2"] is None


async def test_latest_surfaces_baseline_diff_when_present(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    diff = {
        "recall_at_k_delta": -0.05,
        "regression_detected": True,
        "threshold_percent": 3.0,
        "regressed_categories": ["fact"],
    }
    await _seed_run(kb["id"], "run-diff", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(), baseline_diff=diff)

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/latest").json()

    assert body["layer1"]["baseline_diff"]["regression_detected"] is True
    assert body["layer1"]["baseline_diff"]["regressed_categories"] == ["fact"]


# ── trend ────────────────────────────────────────────────────────────────


async def test_trend_aggregates_with_last_of_period_semantics(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-early", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-late", datetime(2026, 8, 20, 18, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))
    await _seed_run(kb["id"], "run-l2", datetime(2026, 8, 21, 9, 0, tzinfo=UTC), layer2=_l2())

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?granularity=day&days_back=30")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["granularity"] == "day"
    assert body["days_back"] == 30
    assert body["has_data"] is True
    assert [p["date"] for p in body["points"]] == ["2026-08-20", "2026-08-21"]
    first, second = body["points"]
    assert first["recall_at_k"] == 0.85
    assert first["layer1_run_id"] == "run-late"
    assert first["faithfulness"] is None
    assert second["recall_at_k"] is None
    assert second["faithfulness"] == 0.95
    assert second["layer2_run_id"] == "run-l2"


async def test_trend_include_ci_opts_ci_rows_back_in(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-ci", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(), environment="ci")

    default_body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend").json()
    assert default_body["points"] == []
    assert default_body["has_data"] is False

    with_ci = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?include_ci=true").json()
    assert with_ci["has_data"] is True
    assert with_ci["points"][0]["layer1_run_id"] == "run-ci"


async def test_trend_baseline_block_reads_the_marked_row(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(
        kb["id"],
        "run-base",
        datetime(2026, 8, 15, 9, 0, tzinfo=UTC),
        layer1=_l1(recall_at_k=0.88),
        mark_baseline=True,
    )
    await _seed_run(kb["id"], "run-new", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend").json()

    assert body["baseline"]["recall_at_k"] == 0.88
    assert body["baseline"]["threshold_percent"] == pytest.approx(3.0)
    baseline_point = next(p for p in body["points"] if p["date"] == "2026-08-15")
    assert baseline_point["is_baseline_update"] is True
    other_point = next(p for p in body["points"] if p["date"] == "2026-08-20")
    assert other_point["is_baseline_update"] is False


async def test_trend_baseline_block_is_null_without_marked_row(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend").json()

    assert body["baseline"] is None


async def test_trend_invalid_granularity_422(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?granularity=hourly")

    assert response.status_code == 422


async def test_trend_days_back_clamped_to_90_and_echoed(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?days_back=300").json()

    assert body["days_back"] == 90


async def test_trend_days_back_window_filters_older_rows(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    # 落在 7 天窗口外的运行不进 points（窗口右边界是「今天」）。
    old = datetime.now(UTC) - timedelta(days=20)
    recent = datetime.now(UTC) - timedelta(days=2)
    await _seed_run(kb["id"], "run-old", old, layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-recent", recent, layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?days_back=7").json()

    assert [p["layer1_run_id"] for p in body["points"]] == ["run-recent"]


async def test_trend_week_granularity_pairs_with_weeks_back(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    old = datetime.now(UTC) - timedelta(weeks=20)
    recent = datetime.now(UTC) - timedelta(days=10)
    await _seed_run(kb["id"], "run-old", old, layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-recent", recent, layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?granularity=week").json()

    # 默认窗口 12 周：20 周前的运行出窗；响应只回显 weeks_back（spec §4.2 按粒度配对）
    assert body["weeks_back"] == 12
    assert "days_back" not in body and "months_back" not in body
    assert [p["layer1_run_id"] for p in body["points"]] == ["run-recent"]


async def test_trend_explicit_weeks_back_widens_window(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    old = datetime.now(UTC) - timedelta(weeks=20)
    recent = datetime.now(UTC) - timedelta(days=10)
    await _seed_run(kb["id"], "run-old", old, layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-recent", recent, layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?granularity=week&weeks_back=24").json()

    assert body["weeks_back"] == 24
    assert [p["layer1_run_id"] for p in body["points"]] == ["run-old", "run-recent"]


async def test_trend_month_granularity_pairs_with_months_back(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-old", datetime(2025, 1, 15, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.7))
    await _seed_run(kb["id"], "run-recent", datetime.now(UTC) - timedelta(days=10), layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?granularity=month&months_back=6").json()

    assert body["months_back"] == 6
    assert "days_back" not in body and "weeks_back" not in body
    assert [p["layer1_run_id"] for p in body["points"]] == ["run-recent"]


async def test_trend_days_back_is_ignored_for_non_day_granularity(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    await _seed_run(kb["id"], "run-40d-ago", datetime.now(UTC) - timedelta(days=40), layer1=_l1())

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend?granularity=month&days_back=7").json()

    # month 窗口由 months_back（默认 6 个月）驱动，days_back 不参与
    assert body["months_back"] == 6
    assert [p["layer1_run_id"] for p in body["points"]] == ["run-40d-ago"]


async def test_trend_empty_history_reports_has_data_false(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    body = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/trend").json()

    assert body == {
        "points": [],
        "granularity": "day",
        "days_back": 30,
        "baseline": None,
        "has_data": False,
    }


async def test_trend_unknown_kb_404(service) -> None:
    client = _client(service)

    response = client.get("/api/knowledge-bases/kb-missing/eval-runs/trend")

    assert response.status_code == 404


# ── run detail ───────────────────────────────────────────────────────────


async def test_get_eval_run_returns_full_row_json(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    diff = {
        "recall_at_k_delta": -0.02,
        "regression_detected": True,
        "threshold_percent": 3.0,
        "regressed_categories": ["fact"],
    }
    await _seed_run(
        kb["id"],
        "run-full",
        datetime(2026, 8, 20, 9, 0, tzinfo=UTC),
        layer1=_l1(),
        baseline_diff=diff,
        environment="nightly",
        mark_baseline=True,
    )

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/run-full")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["run_id"] == "run-full"
    assert body["kb_id"] == kb["id"]
    assert body["status"] == "completed"
    assert body["environment"] == "nightly"
    assert body["is_baseline"] is True
    assert body["created_at"].startswith("2026-08-20")
    assert body["layer1_metrics"]["summary"]["recall_at_k"] == 0.8
    assert body["layer2_metrics"] == {}
    assert body["baseline_diff"]["regressed_categories"] == ["fact"]


async def test_get_eval_run_cross_kb_access_404(service) -> None:
    client = _client(service)
    kb = _create_kb(client)
    other = _create_kb(client, name="另一个库")
    await _seed_run(kb["id"], "run-mine", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    response = client.get(f"/api/knowledge-bases/{other['id']}/eval-runs/run-mine")

    assert response.status_code == 404


async def test_get_eval_run_unknown_run_404(service) -> None:
    client = _client(service)
    kb = _create_kb(client)

    response = client.get(f"/api/knowledge-bases/{kb['id']}/eval-runs/run-missing")

    assert response.status_code == 404


async def test_get_eval_run_unknown_kb_404(service) -> None:
    client = _client(service)

    response = client.get("/api/knowledge-bases/kb-missing/eval-runs/run-1")

    assert response.status_code == 404


# ── POST /eval-runs trigger（spec 2026-08-27 §5，wiki 幂等同款）──────────


def _trigger_service(session_factory, tmp_path, trigger) -> KnowledgeService:
    vector_store = MagicMock()
    vector_store.chunks_collection = "kb_chunks"
    vector_store.entities_collection = "kb_entities"
    vector_store.wiki_entries_collection = "kb_wiki"
    vector_store.manual_cards_collection = "kb_cards"
    return KnowledgeService(
        store=KnowledgeStore(session_factory),
        vector_store=vector_store,
        graph_store=None,
        wiki_store=None,
        worker=None,
        data_dir=tmp_path,
        eval_trigger_fn=trigger,
    )


async def test_trigger_returns_202_enqueued_and_schedules_once(session_factory, tmp_path) -> None:
    trigger = MagicMock()
    client = _client(_trigger_service(session_factory, tmp_path, trigger))
    kb = _create_kb(client)
    # 空库会被 409 前置守卫拦下（见 test_trigger_empty_bank_maps_to_409_*），
    # enqueued 路径需要至少一题——顺带复用 Task 1 的 CRUD API 播种。
    seeded = client.post(f"/api/knowledge-bases/{kb['id']}/eval/questions", json={"query": "什么是退休年龄", "category": "fact", "expected_path": "vector"})
    assert seeded.status_code == 201, seeded.text

    response = client.post(f"/api/knowledge-bases/{kb['id']}/eval-runs")

    assert response.status_code == 202, response.text
    assert response.json() == {"status": "enqueued"}
    assert trigger.call_count == 1
    assert trigger.call_args[0][0] == kb["id"]


async def test_trigger_in_flight_returns_already_running_without_rescheduling(session_factory, tmp_path) -> None:
    from deerflow.knowledge.eval import ondemand as eval_ondemand

    trigger = MagicMock()
    client = _client(_trigger_service(session_factory, tmp_path, trigger))
    kb = _create_kb(client)
    eval_ondemand._IN_FLIGHT[kb["id"]] = 1
    try:
        response = client.post(f"/api/knowledge-bases/{kb['id']}/eval-runs")

        assert response.status_code == 202
        assert response.json() == {"status": "already_running"}
        assert trigger.call_count == 0
    finally:
        eval_ondemand._IN_FLIGHT.pop(kb["id"], None)


async def test_trigger_empty_bank_maps_to_409_and_never_schedules(session_factory, tmp_path) -> None:
    trigger = MagicMock()
    client = _client(_trigger_service(session_factory, tmp_path, trigger))
    kb = _create_kb(client)

    response = client.post(f"/api/knowledge-bases/{kb['id']}/eval-runs")

    assert response.status_code == 409, response.text
    assert trigger.call_count == 0


async def test_trigger_unknown_kb_404(session_factory, tmp_path) -> None:
    client = _client(_trigger_service(session_factory, tmp_path, MagicMock()))

    assert client.post("/api/knowledge-bases/kb-missing/eval-runs").status_code == 404
