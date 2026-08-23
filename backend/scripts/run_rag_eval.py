"""Batch retrieval evaluation CLI (spec 2026-08-23 §6).

Runs the golden dataset through the three online retrieval impls — no gateway
needed, so it works in CI containers — writes ``report.json`` / ``report.md``,
prints the terminal summary, and maps the regression gate to the exit code:

- 0  ok (or no baseline given)
- 1  regression beyond ``--fail-threshold``
- 2  usage / IO error (bad golden file, missing baseline, unknown kb)
- 3  skipped — required API keys absent (explicit, never a fake green)

Usage (from ``backend/``):

    uv run python scripts/run_rag_eval.py \
        --kb-id <KB_ID> --golden tests/fixtures/rag_eval/golden.jsonl --out <dir> \
        [--baseline <prev report.json>] [--top-k 5] [--fail-threshold 0.03]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from deerflow.knowledge.eval.metrics import DEFAULT_FAIL_THRESHOLD

EXIT_OK = 0
EXIT_REGRESSION = 1
EXIT_ERROR = 2
EXIT_SKIPPED = 3

#: The vector path needs embedding + rerank credentials. The graph path's
#: extraction LLM key resolves through config.yaml model profiles — a missing
#: ``$VAR`` there makes ``AppConfig.from_file`` raise ValueError, which
#: ``_async_main`` maps to EXIT_SKIPPED.
REQUIRED_ENV_KEYS = ("DASHSCOPE_EMBEDDING_API_KEY", "DASHSCOPE_RERANK_API_KEY")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch retrieval evaluation against the golden dataset.")
    parser.add_argument("--golden", required=True, help="Path to the golden JSONL dataset.")
    parser.add_argument("--out", required=True, help="Output directory for report.json / report.md.")
    parser.add_argument("--kb-id", required=True, help="Knowledge base the golden questions were annotated against.")
    parser.add_argument("--baseline", default=None, help="Previous report.json for the regression diff.")
    parser.add_argument("--top-k", type=int, default=5, help="Hits per path per question (default 5).")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=DEFAULT_FAIL_THRESHOLD,
        help=f"Per-category recall drop that fails the gate (default {DEFAULT_FAIL_THRESHOLD}; initial guess — recalibrate after two weeks).",
    )
    return parser.parse_args(argv)


def missing_required_keys(environ: Mapping[str, str]) -> list[str]:
    return [key for key in REQUIRED_ENV_KEYS if not environ.get(key)]


async def _async_main(args: argparse.Namespace) -> int:
    try:
        from deerflow.config.app_config import get_app_config

        config = get_app_config()
    except ValueError as exc:  # unresolved $ENV in config.yaml → missing credential
        print(f"rag-eval skipped: {exc}")
        return EXIT_SKIPPED

    # Fail fast on bad inputs BEFORE touching the persistence engine.
    from deerflow.knowledge.eval.dataset import GoldenDatasetError, load_golden

    try:
        questions = load_golden(args.golden)
        baseline = None
        if args.baseline:
            baseline_path = Path(args.baseline)
            if not baseline_path.exists():
                raise GoldenDatasetError(f"baseline report not found: {baseline_path}")
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    except (GoldenDatasetError, json.JSONDecodeError) as exc:
        print(f"rag-eval error: {exc}", file=sys.stderr)
        return EXIT_ERROR

    from deerflow.knowledge.eval.runner import build_default_searchers, render_summary, run_evaluation, write_reports
    from deerflow.knowledge.graph.store import GraphStore
    from deerflow.knowledge.store import get_knowledge_store
    from deerflow.knowledge.vector_store import get_vector_store
    from deerflow.knowledge.wiki.store import WikiStore
    from deerflow.persistence.engine import close_engine, init_engine_from_config

    await init_engine_from_config(config.database)
    try:
        store = get_knowledge_store()
        kb = await store.get_kb(args.kb_id)
        if kb is None:
            print(f"rag-eval error: knowledge base not found: {args.kb_id}", file=sys.stderr)
            return EXIT_ERROR
        # Owner-only access gate (phase 1): the eval runs as the KB owner,
        # resolved from the store — no separate credential to manage.
        searchers = build_default_searchers(
            kb_id=args.kb_id,
            user_id=kb["owner_id"],
            store=store,
            vector_store=get_vector_store(),
            graph_store=GraphStore(store._sf),  # same construction the impls use
            wiki_store=WikiStore(store._sf),
        )
        report = await run_evaluation(
            questions,
            searchers,
            top_k=args.top_k,
            baseline=baseline,
            fail_threshold=args.fail_threshold,
            generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
        )
    finally:
        await close_engine()

    json_path, md_path = write_reports(report, args.out)
    print(render_summary(report))
    print(f"report: {json_path} · {md_path}")
    return report.exit_code


def _run(args: argparse.Namespace) -> int:
    return asyncio.run(_async_main(args))


def main(argv: list[str] | None = None, *, environ: Mapping[str, str] | None = None) -> int:
    args = parse_args(argv)
    if environ is None:
        # Production path: pick up the same .env the gateway reads (tests
        # inject ``environ`` explicitly and never touch dotenv).
        from dotenv import load_dotenv

        load_dotenv()
        environ = os.environ
    missing = missing_required_keys(environ)
    if missing:
        print(f"rag-eval skipped: missing required API keys: {', '.join(missing)} (exit {EXIT_SKIPPED} — explicit skip, not a pass)")
        return EXIT_SKIPPED
    return _run(args)


if __name__ == "__main__":
    sys.exit(main())
