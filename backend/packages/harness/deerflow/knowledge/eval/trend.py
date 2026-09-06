"""Trend aggregation over eval_runs rows (spec 2026-08-24 §4.2 v3, plan Task 1).

Pure functions, no IO (``metrics.py`` precedent). 统一末次语义：day/week/month
均按自然周期分组，取该周期**最后一次**含该层数据的 completed 运行——两层
独立，同一数据点的两条线可来自不同运行（``layer1_run_id`` /
``layer2_run_id`` 各自记录来源）。均值聚合已废弃（v3）：每个点恒等于一次
真实运行，下钻语义统一。

窗口过滤由调用方完成——``window_cutoff`` 提供按粒度配对的 cutoff 计算
（day→``days_back`` / week→``weeks_back`` / month→``months_back``）；本模块
只负责取数集合过滤（completed + 对应层 metrics 非空 + 默认排除 ci）与周期聚合。
"""

from __future__ import annotations

import calendar
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from typing import Any, Literal, Protocol

from deerflow.knowledge.eval.persistence import ENV_CI, STATUS_COMPLETED

Granularity = Literal["day", "week", "month"]

#: day 粒度窗口上限（spec §4.2 冻结）；week/month 无冻结上限。
MAX_DAYS_BACK = 90

#: sparkline 每指标保留的 run 级近端非空值上限（spec §6.2 冻结）。
MAX_SPARKS = 10

#: 顶层 ``sparks`` 的 7 个 Layer 2 键（RAGAS 4 + 引用 3，含退役的 context_recall）。
#: ragas 四键取 ``layer2_metrics["ragas"]``，引用三键取 ``layer2_metrics["arch_specific"]``。
_SPARK_RAGAS_KEYS = ("faithfulness", "answer_relevancy", "context_precision", "context_recall")
_SPARK_ARCH_KEYS = ("citation_precision", "citation_recall", "seed_hit_rate")
SPARK_KEYS = (*_SPARK_RAGAS_KEYS, *_SPARK_ARCH_KEYS)


def window_cutoff(
    now: datetime,
    *,
    granularity: Granularity,
    days_back: int,
    weeks_back: int,
    months_back: int,
) -> datetime:
    """按粒度选**配对的**窗口参数计算 cutoff（§4.2：day→``days_back`` /
    week→``weeks_back`` / month→``months_back``）。

    month 用日历月减法并对月末钳制（如 3-31 减 6 个月 → 9-30），week 按
    7×n 天回退；``days_back`` 的 ≤90 clamp 由调用方完成，本函数不重复做。
    """

    if granularity == "month":
        month_index = now.year * 12 + (now.month - 1) - months_back
        year, zero_based_month = divmod(month_index, 12)
        month = zero_based_month + 1
        return now.replace(year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1]))
    if granularity == "week":
        return now - timedelta(weeks=weeks_back)
    return now - timedelta(days=days_back)


class EvalTrendRow(Protocol):
    """聚合所需的最小行形态——ORM ``EvalRunRow`` 与测试替身（SimpleNamespace）均满足。"""

    id: str
    status: str
    environment: str
    layer1_metrics: dict[str, Any]
    layer2_metrics: dict[str, Any]
    baseline_diff: dict[str, Any] | None
    is_baseline: bool
    created_at: datetime


def _in_read_set(row: EvalTrendRow, layer: Literal["layer1", "layer2"], *, include_ci: bool) -> bool:
    """取数集合规则（§4.2，latest 与 trend 同源）：completed + 该层 metrics 非空；ci 默认排除。"""

    if row.status != STATUS_COMPLETED:
        return False
    if not include_ci and row.environment == ENV_CI:
        return False
    metrics = row.layer1_metrics if layer == "layer1" else row.layer2_metrics
    return bool(metrics)


def _period_start(day: date, granularity: Granularity) -> date:
    """自然周期起点：day=当日；week=ISO 周一（跨年周自然归并）；month=月初一日。"""

    if granularity == "week":
        return day - timedelta(days=day.isoweekday() - 1)
    if granularity == "month":
        return day.replace(day=1)
    return day


def latest_layer_row[RowT: EvalTrendRow](rows: Sequence[RowT], layer: Literal["layer1", "layer2"]) -> RowT | None:
    """该层最近一次 completed 且 metrics 非空且非 ci 的运行（latest 端点取数规则）。"""

    candidates = [row for row in rows if _in_read_set(row, layer, include_ci=False)]
    if not candidates:
        return None
    return max(candidates, key=lambda row: (row.created_at, row.id))


def aggregate_trend_points(
    rows: Sequence[EvalTrendRow],
    granularity: Granularity,
    *,
    include_ci: bool = False,
) -> list[dict[str, Any]]:
    """eval_runs 行 → ``TrendPoint`` 列表（§4.1），按周期起点升序。

    同一周期内两层各自独立取末次运行；某层该周期无数据时该层指标与
    ``run_id`` 为 ``None``（ECharts ``connectNulls: false`` 渲染为缺口）。
    ``regression`` 透传 Layer 1 来源运行的 per-category 门禁判定（无 diff
    的运行该键为 ``None``）；``is_baseline_update`` 标记 Layer 1 来源行是
    否为 ``--mark-baseline`` 打点。

    周期点含 10 个指标键（spec §6.1，服务主图 picker）：L1 四取 ``layer1_metrics
    ["summary"]``（recall_at_k/hit_rate/mrr/path_accuracy）；L2 六中 ragas 三取
    ``layer2_metrics["ragas"]``（faithfulness/answer_relevancy/context_precision），
    引用三取 ``layer2_metrics["arch_specific"]``（citation_precision/citation_recall/
    seed_hit_rate）。退役的 ``context_recall`` 不进周期点（仅存于 ``sparks``）。
    """

    layer1_by_period: dict[date, EvalTrendRow] = {}
    layer2_by_period: dict[date, EvalTrendRow] = {}
    for row in rows:
        for layer, bucket in (("layer1", layer1_by_period), ("layer2", layer2_by_period)):
            if not _in_read_set(row, layer, include_ci=include_ci):
                continue
            period = _period_start(row.created_at.date(), granularity)
            existing = bucket.get(period)
            if existing is None or (row.created_at, row.id) >= (existing.created_at, existing.id):
                bucket[period] = row

    points: list[dict[str, Any]] = []
    for period in sorted(set(layer1_by_period) | set(layer2_by_period)):
        layer1 = layer1_by_period.get(period)
        layer2 = layer2_by_period.get(period)
        summary = (layer1.layer1_metrics.get("summary") or {}) if layer1 is not None else {}
        ragas = (layer2.layer2_metrics.get("ragas") or {}) if layer2 is not None else {}
        arch = (layer2.layer2_metrics.get("arch_specific") or {}) if layer2 is not None else {}
        diff = layer1.baseline_diff if layer1 is not None else None
        points.append(
            {
                "date": period.isoformat(),
                "recall_at_k": summary.get("recall_at_k"),
                "hit_rate": summary.get("hit_rate"),
                "mrr": summary.get("mrr"),
                "path_accuracy": summary.get("path_accuracy"),
                "faithfulness": ragas.get("faithfulness"),
                "answer_relevancy": ragas.get("answer_relevancy"),
                "context_precision": ragas.get("context_precision"),
                "citation_precision": arch.get("citation_precision"),
                "citation_recall": arch.get("citation_recall"),
                "seed_hit_rate": arch.get("seed_hit_rate"),
                "layer1_run_id": layer1.id if layer1 is not None else None,
                "layer2_run_id": layer2.id if layer2 is not None else None,
                "regression": (
                    {
                        "detected": bool(diff.get("regression_detected")),
                        "categories": list(diff.get("regressed_categories") or []),
                    }
                    if diff
                    else None
                ),
                "is_baseline_update": bool(layer1.is_baseline) if layer1 is not None else False,
            }
        )
    return points


def build_sparks(
    rows: Sequence[EvalTrendRow],
    *,
    include_ci: bool = False,
) -> dict[str, list[float]]:
    """eval_runs 行 → 顶层 ``sparks``（spec §6.2）：7 个 Layer 2 键各一条 run 级
    近 ``MAX_SPARKS`` 个非空值序列（``created_at`` 升序）。

    与 ``aggregate_trend_points`` 的周期分桶不同，本函数**不做周期聚合、不受
    granularity/时间窗口影响**——每个数据点恒等于一次真实运行的该指标值，服务
    瓦片 sparkline 的“近 10 次运行走势”语义（调用方应传入**全量**行而非窗口
    过滤后的子集）。null 值（该档未跑该指标）被跳过而非占位；某键全 null（如
    ragas 未装时的 ``context_recall``）→ 空数组。取数集合规则与 trend 同源
    （completed + layer2 metrics 非空 + 默认排除 ci）。
    """

    l2_rows = sorted(
        (row for row in rows if _in_read_set(row, "layer2", include_ci=include_ci)),
        key=lambda row: (row.created_at, row.id),
    )
    series: dict[str, list[float]] = {key: [] for key in SPARK_KEYS}
    for row in l2_rows:
        ragas = row.layer2_metrics.get("ragas") or {}
        arch = row.layer2_metrics.get("arch_specific") or {}
        for key in _SPARK_RAGAS_KEYS:
            value = ragas.get(key)
            if value is not None:
                series[key].append(value)
        for key in _SPARK_ARCH_KEYS:
            value = arch.get(key)
            if value is not None:
                series[key].append(value)
    return {key: values[-MAX_SPARKS:] for key, values in series.items()}
