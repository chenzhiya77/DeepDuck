"""On-demand Layer 1 evaluation runner triggered from the gateway (spec 2026-08-27 §5).

Mirrors the CLI orchestration in ``scripts/run_rag_eval.py`` (load golden →
searchers → ``run_evaluation`` → report mapping → ``save_eval_run``) but runs
in-process: the gateway already initialized the persistence engine and store
singletons, so there is no engine lifecycle here and no CLI subprocess.

Contracts frozen by the spec:

- **Layer 1 only** — judge-backed Layer 2 stays on nightly/CLI paths.
- **Idempotent trigger** — a per-KB module-level ``_IN_FLIGHT`` counter (same
  single-process pattern as wiki ``generator._IN_FLIGHT``); the decrement sits
  in ``finally`` so a crashed run never wedges future triggers.
- **Auto baseline diff** — every run diffs against the KB's marked baseline
  row when present (CLI ``--baseline auto`` semantics), so regression badges
  work identically for UI-triggered runs.
- **Best-effort error rows** — any runtime failure logs and persists an
  ``error`` row instead of propagating out of the fire-and-forget task;
  an empty/missing question bank is different: it raises
  :class:`EvalQuestionBankEmpty` *before* scheduling meaningfully starts and
  persists nothing.

The default searcher construction resolves the KB owner through the store
(exactly like the CLI); tests inject ``searchers`` directly to exercise the
orchestration without real retrieval impls.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from deerflow.knowledge.eval.persistence import (
    ENV_LOCAL,
    baseline_diff_from_report,
    baseline_report_from_metrics,
    generate_run_id,
    get_baseline_run,
    layer1_metrics_from_report,
    save_eval_run,
)
from deerflow.knowledge.eval.question_bank import load_questions
from deerflow.knowledge.eval.runner import SearchFn, build_default_searchers, report_to_dict, run_evaluation

logger = logging.getLogger(__name__)

#: In-flight runs per KB (single-process asyncio counter) — feeds both the
#: trigger idempotency check and the history endpoint's ``in_flight`` flag.
_IN_FLIGHT: dict[str, int] = {}


class EvalQuestionBankEmpty(RuntimeError):
    """The KB's golden bank is missing or has zero questions."""


def eval_run_in_progress(kb_id: str) -> bool:
    """True while any on-demand run for the KB is active."""
    return _IN_FLIGHT.get(kb_id, 0) > 0


async def run_layer1_for_kb(
    kb_id: str,
    *,
    golden_path: str | Path,
    top_k: int = 5,
    searchers: Mapping[str, SearchFn] | None = None,
    generated_at: str | None = None,
) -> str:
    """Run one deterministic evaluation pass for the KB; returns the run_id.

    Never raises after the empty-bank guard: runtime failures are swallowed
    into an ``error`` eval_runs row (the fire-and-forget task must be safe).
    """

    run_id = generate_run_id()
    if generated_at is None:
        generated_at = datetime.now(UTC).isoformat(timespec="seconds")

    questions = await load_questions(golden_path)
    if not questions:
        raise EvalQuestionBankEmpty(f"eval question bank is empty: {golden_path}")

    _IN_FLIGHT[kb_id] = _IN_FLIGHT.get(kb_id, 0) + 1
    try:
        effective_searchers = searchers if searchers is not None else await _build_default_searchers(kb_id)
        baseline_report = None
        baseline_row = await get_baseline_run(kb_id)
        if baseline_row is not None and baseline_row.layer1_metrics:
            baseline_report = baseline_report_from_metrics(baseline_row.layer1_metrics)

        report = await run_evaluation(questions, effective_searchers, top_k=top_k, baseline=baseline_report, generated_at=generated_at)
        payload = report_to_dict(report)
        await save_eval_run(
            run_id=run_id,
            kb_id=kb_id,
            status="completed",
            created_at=datetime.fromisoformat(generated_at),
            completed_at=datetime.now(UTC),
            layer1_metrics=layer1_metrics_from_report(payload),
            baseline_diff=baseline_diff_from_report(payload),
            environment=ENV_LOCAL,
        )
        return run_id
    except Exception:
        logger.exception("on-demand eval run %s failed for kb %s", run_id, kb_id)
        await _save_error_row(run_id=run_id, kb_id=kb_id, created_at=datetime.fromisoformat(generated_at))
        return run_id
    finally:
        remaining = _IN_FLIGHT.get(kb_id, 0) - 1
        if remaining > 0:
            _IN_FLIGHT[kb_id] = remaining
        else:
            _IN_FLIGHT.pop(kb_id, None)


async def _save_error_row(*, run_id: str, kb_id: str, created_at: datetime) -> None:
    """Best-effort error-row persistence — never raises (best-effort 同 CLI)."""

    try:
        await save_eval_run(
            run_id=run_id,
            kb_id=kb_id,
            status="error",
            created_at=created_at,
            completed_at=datetime.now(UTC),
            environment=ENV_LOCAL,
        )
    except Exception:
        logger.exception("failed to persist error row %s for kb %s", run_id, kb_id)


async def _build_default_searchers(kb_id: str) -> dict[str, SearchFn]:
    """Production searcher wiring: same construction as the CLI's."""

    from deerflow.knowledge.graph.store import GraphStore
    from deerflow.knowledge.store import get_knowledge_store
    from deerflow.knowledge.vector_store import get_vector_store
    from deerflow.knowledge.wiki.store import WikiStore

    store = get_knowledge_store()
    kb = await store.get_kb(kb_id)
    if kb is None:
        raise LookupError(f"knowledge base not found: {kb_id}")
    return build_default_searchers(
        kb_id=kb_id,
        user_id=kb["owner_id"],
        store=store,
        vector_store=get_vector_store(),
        graph_store=GraphStore(store._sf),  # same construction the impls use
        wiki_store=WikiStore(store._sf),
    )
