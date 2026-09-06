"""``aggregate_trend_points`` pure-function tests (spec 2026-08-24 §4.2 v3, plan Task 1).

统一末次语义：day/week/month 均按自然周期分组，取该周期**最后一次**含该
层数据的 completed 运行（两层独立，可来自不同运行）；skipped/error 行与
``environment='ci'`` 行（默认）不进取数集合；``regression`` 透传来源运行
的 per-category 门禁判定。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from deerflow.knowledge.eval.trend import aggregate_trend_points, build_sparks, window_cutoff


def _l1(recall_at_k: float = 0.8, hit_rate: float = 0.9, mrr: float = 0.7) -> dict:
    return {
        "summary": {
            "recall_at_k": recall_at_k,
            "hit_rate": hit_rate,
            "mrr": mrr,
            "path_accuracy": 1.0,
            "question_count": 20,
        }
    }


def _l2(faithfulness: float = 0.95, answer_relevancy: float = 0.88, context_precision: float = 0.91) -> dict:
    return {
        "ragas": {
            "faithfulness": faithfulness,
            "answer_relevancy": answer_relevancy,
            "context_precision": context_precision,
            "context_recall": None,
        },
        "arch_specific": {"citation_precision": 0.9, "citation_recall": 0.85, "seed_hit_rate": None},
        "ragas_available": True,
        "has_graph_questions": False,
    }


def _row(
    run_id: str,
    created_at: datetime,
    *,
    layer1: dict | None = None,
    layer2: dict | None = None,
    status: str = "completed",
    environment: str = "local",
    baseline_diff: dict | None = None,
    is_baseline: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=run_id,
        status=status,
        environment=environment,
        layer1_metrics=layer1 if layer1 is not None else {},
        layer2_metrics=layer2 if layer2 is not None else {},
        baseline_diff=baseline_diff,
        is_baseline=is_baseline,
        created_at=created_at,
    )


# ── 末次语义（三粒度统一） ──────────────────────────────────────────────


def test_day_granularity_takes_last_run_of_the_day() -> None:
    early = _row("run-early", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.70))
    late = _row("run-late", datetime(2026, 8, 20, 18, 30, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))

    points = aggregate_trend_points([early, late], "day")

    assert len(points) == 1
    assert points[0]["date"] == "2026-08-20"
    assert points[0]["recall_at_k"] == 0.85
    assert points[0]["layer1_run_id"] == "run-late"


def test_last_run_wins_regardless_of_input_order() -> None:
    late = _row("run-late", datetime(2026, 8, 20, 18, 30, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))
    early = _row("run-early", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.70))

    points = aggregate_trend_points([late, early], "day")

    assert len(points) == 1
    assert points[0]["layer1_run_id"] == "run-late"


def test_week_granularity_groups_by_iso_week_starting_monday() -> None:
    # 2026-08-17 是周一；08-19（周三）与 08-21（周五）同周，取周五末次。
    wednesday = _row("run-wed", datetime(2026, 8, 19, 10, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.70))
    friday = _row("run-fri", datetime(2026, 8, 21, 10, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))
    previous_week = _row("run-prev", datetime(2026, 8, 12, 10, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.60))

    points = aggregate_trend_points([wednesday, friday, previous_week], "week")

    assert [p["date"] for p in points] == ["2026-08-10", "2026-08-17"]
    assert points[1]["recall_at_k"] == 0.85
    assert points[1]["layer1_run_id"] == "run-fri"


def test_week_groups_across_year_boundary() -> None:
    # 2026-12-31（周四）与 2027-01-01（周五）同属 ISO 周（周一 = 2026-12-28）。
    new_years_eve = _row("run-1231", datetime(2026, 12, 31, 10, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.70))
    new_years_day = _row("run-0101", datetime(2027, 1, 1, 10, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))

    points = aggregate_trend_points([new_years_eve, new_years_day], "week")

    assert len(points) == 1
    assert points[0]["date"] == "2026-12-28"
    assert points[0]["layer1_run_id"] == "run-0101"


def test_month_granularity_groups_by_calendar_month() -> None:
    august = _row("run-aug", datetime(2026, 8, 31, 23, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.70))
    september = _row("run-sep", datetime(2026, 9, 1, 1, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.85))

    points = aggregate_trend_points([august, september], "month")

    assert [p["date"] for p in points] == ["2026-08-01", "2026-09-01"]
    assert points[0]["layer1_run_id"] == "run-aug"
    assert points[1]["layer1_run_id"] == "run-sep"


# ── 两层独立取数 ────────────────────────────────────────────────────────


def test_layers_pick_from_independent_runs_in_same_period() -> None:
    layer1_run = _row("run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.80))
    layer2_run = _row("run-l2", datetime(2026, 8, 20, 21, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.97))

    points = aggregate_trend_points([layer1_run, layer2_run], "day")

    assert len(points) == 1
    point = points[0]
    assert point["recall_at_k"] == 0.80
    assert point["hit_rate"] == 0.9
    assert point["mrr"] == 0.7
    assert point["faithfulness"] == 0.97
    assert point["answer_relevancy"] == 0.88
    assert point["context_precision"] == 0.91
    assert point["layer1_run_id"] == "run-l1"
    assert point["layer2_run_id"] == "run-l2"


def test_layer_without_data_in_period_is_null() -> None:
    layer1_only = _row("run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    points = aggregate_trend_points([layer1_only], "day")

    assert len(points) == 1
    point = points[0]
    assert point["recall_at_k"] is not None
    assert point["faithfulness"] is None
    assert point["answer_relevancy"] is None
    assert point["context_precision"] is None
    assert point["layer2_run_id"] is None
    assert point["layer1_run_id"] == "run-l1"


# ── 周期点 10 键（spec §6.1：补 path_accuracy + 引用三，服务 picker） ──────

_TREND_METRIC_KEYS = {
    "recall_at_k",
    "hit_rate",
    "mrr",
    "path_accuracy",
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "citation_precision",
    "citation_recall",
    "seed_hit_rate",
}


def test_period_point_exposes_ten_metric_keys() -> None:
    layer1_run = _row("run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())
    layer2_run = _row("run-l2", datetime(2026, 8, 20, 21, 0, tzinfo=UTC), layer2=_l2())

    point = aggregate_trend_points([layer1_run, layer2_run], "day")[0]

    assert len(_TREND_METRIC_KEYS) == 10
    assert _TREND_METRIC_KEYS <= set(point)
    # 取值口径：path_accuracy 来自 L1 summary；引用三来自 L2 arch_specific
    assert point["path_accuracy"] == 1.0
    assert point["citation_precision"] == 0.9
    assert point["citation_recall"] == 0.85
    assert point["seed_hit_rate"] is None


def test_new_picker_keys_null_when_source_layer_absent() -> None:
    # 仅 L1：path_accuracy 有值，引用三 null（缺层仍 null）
    l1_point = aggregate_trend_points([_row("run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())], "day")[0]
    assert l1_point["path_accuracy"] == 1.0
    assert l1_point["citation_precision"] is None
    assert l1_point["citation_recall"] is None
    assert l1_point["seed_hit_rate"] is None

    # 仅 L2：path_accuracy null，引用三有值
    l2_point = aggregate_trend_points([_row("run-l2", datetime(2026, 8, 21, 9, 0, tzinfo=UTC), layer2=_l2())], "day")[0]
    assert l2_point["path_accuracy"] is None
    assert l2_point["citation_precision"] == 0.9
    assert l2_point["citation_recall"] == 0.85
    assert l2_point["seed_hit_rate"] is None


# ── 取数集合过滤 ────────────────────────────────────────────────────────


def test_ci_rows_excluded_by_default_and_included_on_demand() -> None:
    local_run = _row("run-local", datetime(2026, 8, 19, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.70))
    ci_run = _row("run-ci", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(recall_at_k=0.99), environment="ci")

    default_points = aggregate_trend_points([local_run, ci_run], "day")
    assert [p["date"] for p in default_points] == ["2026-08-19"]

    with_ci = aggregate_trend_points([local_run, ci_run], "day", include_ci=True)
    assert [p["date"] for p in with_ci] == ["2026-08-19", "2026-08-20"]
    assert with_ci[1]["layer1_run_id"] == "run-ci"


def test_skipped_and_error_rows_never_enter_the_read_set() -> None:
    skipped = _row("run-skip", datetime(2026, 8, 19, 9, 0, tzinfo=UTC), layer1=_l1(), status="skipped")
    error = _row("run-err", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2(), status="error")

    assert aggregate_trend_points([skipped, error], "day") == []


def test_empty_metrics_layer_does_not_count_as_data() -> None:
    # status=completed 但该层 metrics == {}（另一层 CLI 写入的行）不算该层数据。
    layer2_run = _row("run-l2", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2())

    points = aggregate_trend_points([layer2_run], "day")

    assert len(points) == 1
    assert points[0]["recall_at_k"] is None
    assert points[0]["layer1_run_id"] is None
    assert points[0]["faithfulness"] == 0.95


# ── regression / baseline 透传 ──────────────────────────────────────────


def test_regression_passthrough_from_source_run_baseline_diff() -> None:
    diff = {
        "recall_at_k_delta": -0.05,
        "regression_detected": True,
        "threshold_percent": 3.0,
        "regressed_categories": ["fact"],
    }
    run = _row("run-reg", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(), baseline_diff=diff)

    points = aggregate_trend_points([run], "day")

    assert points[0]["regression"] == {"detected": True, "categories": ["fact"]}


def test_regression_is_null_when_source_run_has_no_diff() -> None:
    run = _row("run-plain", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    points = aggregate_trend_points([run], "day")

    assert points[0]["regression"] is None


def test_is_baseline_update_flag_follows_the_layer1_source_row() -> None:
    marked = _row("run-base", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1(), is_baseline=True)
    plain = _row("run-plain", datetime(2026, 8, 21, 9, 0, tzinfo=UTC), layer1=_l1())

    points = aggregate_trend_points([marked, plain], "day")

    assert [p["is_baseline_update"] for p in points] == [True, False]


def test_is_baseline_update_false_when_period_has_no_layer1() -> None:
    layer2_only = _row("run-l2", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2())

    points = aggregate_trend_points([layer2_only], "day")

    assert points[0]["is_baseline_update"] is False


def test_empty_input_returns_empty_points() -> None:
    assert aggregate_trend_points([], "day") == []
    assert aggregate_trend_points([], "week") == []
    assert aggregate_trend_points([], "month") == []


# ── window_cutoff：窗口参数按粒度配对（spec §4.2 v3） ─────────────────────


def test_window_cutoff_day_pairs_with_days_back() -> None:
    cutoff = window_cutoff(datetime(2026, 8, 25, 12, 0, tzinfo=UTC), granularity="day", days_back=30, weeks_back=12, months_back=6)

    assert cutoff == datetime(2026, 7, 26, 12, 0, tzinfo=UTC)


def test_window_cutoff_week_pairs_with_weeks_back() -> None:
    cutoff = window_cutoff(datetime(2026, 8, 25, 12, 0, tzinfo=UTC), granularity="week", days_back=30, weeks_back=12, months_back=6)

    assert cutoff == datetime(2026, 6, 2, 12, 0, tzinfo=UTC)


def test_window_cutoff_month_calendar_subtraction_with_month_end_clamp() -> None:
    # 3-31 减 6 个月 → 9-30（9 月无 31 日，钳到月末）
    assert window_cutoff(datetime(2026, 3, 31, 12, 0, tzinfo=UTC), granularity="month", days_back=30, weeks_back=12, months_back=6) == datetime(2025, 9, 30, 12, 0, tzinfo=UTC)
    # 闰日钳制：2024-02-29 减 12 个月 → 2023-02-28
    assert window_cutoff(datetime(2024, 2, 29, 12, 0, tzinfo=UTC), granularity="month", days_back=30, weeks_back=12, months_back=12) == datetime(2023, 2, 28, 12, 0, tzinfo=UTC)
    # 普通日期按时分秒原样对齐
    assert window_cutoff(datetime(2026, 5, 15, 8, 30, tzinfo=UTC), granularity="month", days_back=30, weeks_back=12, months_back=3) == datetime(2026, 2, 15, 8, 30, tzinfo=UTC)


# ── build_sparks：run 级近 10 非空值（spec §6.2，粒度无关，服务瓦片 sparkline） ──

_SPARK_KEYS = {
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
    "citation_precision",
    "citation_recall",
    "seed_hit_rate",
}


def test_sparks_returns_all_seven_l2_keys() -> None:
    sparks = build_sparks([_row("run-l2", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2())])

    assert set(sparks) == _SPARK_KEYS


def test_sparks_empty_input_returns_seven_empty_arrays() -> None:
    sparks = build_sparks([])

    assert set(sparks) == _SPARK_KEYS
    assert all(values == [] for values in sparks.values())


def test_sparks_maps_ragas_and_arch_specific_sources() -> None:
    layer2 = {
        "ragas": {"faithfulness": 0.9, "answer_relevancy": 0.8, "context_precision": 0.7, "context_recall": 0.6},
        "arch_specific": {"citation_precision": 0.5, "citation_recall": 0.4, "seed_hit_rate": 0.3},
    }

    sparks = build_sparks([_row("run-full", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=layer2)])

    assert sparks["faithfulness"] == [0.9]
    assert sparks["answer_relevancy"] == [0.8]
    assert sparks["context_precision"] == [0.7]
    assert sparks["context_recall"] == [0.6]
    assert sparks["citation_precision"] == [0.5]
    assert sparks["citation_recall"] == [0.4]
    assert sparks["seed_hit_rate"] == [0.3]


def test_sparks_all_null_key_yields_empty_array() -> None:
    # 默认 _l2：context_recall（ragas 未装）与 seed_hit_rate（无实体标注）恒 null → 空数组
    sparks = build_sparks([_row("run-l2", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2())])

    assert sparks["context_recall"] == []
    assert sparks["seed_hit_rate"] == []
    assert sparks["faithfulness"] == [0.95]


def test_sparks_sorts_by_created_at_ascending_regardless_of_input_order() -> None:
    early = _row("run-1", datetime(2026, 8, 18, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.80))
    late = _row("run-2", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.90))

    sparks = build_sparks([late, early])

    assert sparks["faithfulness"] == [0.80, 0.90]


def test_sparks_skips_null_runs_without_placeholder() -> None:
    r1 = _row("run-1", datetime(2026, 8, 18, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.70))
    r2 = _row("run-2", datetime(2026, 8, 19, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=None))
    r3 = _row("run-3", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.90))

    sparks = build_sparks([r1, r2, r3])

    # run-2 的 null 被跳过（非占位），数组长度 = 非空 run 数 = 2
    assert sparks["faithfulness"] == [0.70, 0.90]


def test_sparks_length_matches_available_runs_when_under_ten() -> None:
    runs = [_row(f"run-{i}", datetime(2026, 8, 10 + i, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.50 + i * 0.01)) for i in range(5)]

    sparks = build_sparks(runs)

    assert len(sparks["faithfulness"]) == 5


def test_sparks_caps_at_ten_most_recent_non_null_values() -> None:
    runs = [_row(f"run-{i:02d}", datetime(2026, 7, 1, 9, 0, tzinfo=UTC) + timedelta(days=i), layer2=_l2(faithfulness=float(i))) for i in range(15)]

    sparks = build_sparks(runs)

    # 15 个非空 run → 仅保留近 10（升序，丢弃最旧 5 个）
    assert sparks["faithfulness"] == [float(i) for i in range(5, 15)]


def test_sparks_ignores_period_boundaries_single_series_across_months() -> None:
    # 跨 3 个月的 run 进同一条序列（不按周期分桶 → 与 granularity 解耦）
    runs = [
        _row("run-jul", datetime(2026, 7, 15, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.70)),
        _row("run-aug", datetime(2026, 8, 15, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.80)),
        _row("run-sep", datetime(2026, 9, 15, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.90)),
    ]

    sparks = build_sparks(runs)

    assert sparks["faithfulness"] == [0.70, 0.80, 0.90]


def test_sparks_ignores_rows_without_layer2_data() -> None:
    l1_only = _row("run-l1", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer1=_l1())

    sparks = build_sparks([l1_only])

    assert sparks["faithfulness"] == []


def test_sparks_excludes_ci_by_default_and_includes_on_demand() -> None:
    local = _row("run-local", datetime(2026, 8, 19, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.70))
    ci = _row("run-ci", datetime(2026, 8, 20, 9, 0, tzinfo=UTC), layer2=_l2(faithfulness=0.99), environment="ci")

    assert build_sparks([local, ci])["faithfulness"] == [0.70]
    assert build_sparks([local, ci], include_ci=True)["faithfulness"] == [0.70, 0.99]
