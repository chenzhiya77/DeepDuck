"""Layer 2 end-to-end RAGAS evaluation CLI (spec 2026-08-23 §8).

Drives the golden dataset through the **real conversation chain** (the lead
agent picks retrieval tools and writes the answer), scores the standard RAGAS
metrics plus the three architecture-specific ones, pushes scores to Langfuse
(best-effort), and writes ``ragas-report.json`` / ``ragas-report.md``.

Report-only, never a gate — there is deliberately no failure threshold:

- 0  ok (metrics may be terrible; Layer 2 never fails on quality)
- 2  usage / IO error (bad golden file, unknown kb)
- 3  skipped — required API keys absent (explicit, never a fake green)

``ragas`` itself is an optional dependency: when it is not installed the
standard metrics are marked skipped in the report and the run still succeeds
(the architecture-specific metrics only need the judge LLM).

Usage (from ``backend/``):

    uv run python scripts/run_ragas_eval.py \
        --kb-id <KB_ID> --golden tests/fixtures/rag_eval/golden.jsonl --out <dir> \
        [--limit N] [--model <name>]
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

EXIT_OK = 0
EXIT_ERROR = 2
EXIT_SKIPPED = 3

#: Same credential contract as the Layer 1 CLI. The judge/agent LLM key
#: resolves through config.yaml model profiles — a missing ``$VAR`` there makes
#: ``AppConfig.from_file`` raise ValueError, which ``_async_main`` maps to
#: EXIT_SKIPPED.
REQUIRED_ENV_KEYS = ("DASHSCOPE_EMBEDDING_API_KEY", "DASHSCOPE_RERANK_API_KEY")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Layer 2 end-to-end RAGAS evaluation over the golden dataset (report-only).")
    parser.add_argument("--golden", required=True, help="Path to the golden JSONL dataset.")
    parser.add_argument("--out", required=True, help="Output directory for ragas-report.json / ragas-report.md.")
    parser.add_argument("--kb-id", required=True, help="Knowledge base the golden questions were annotated against.")
    parser.add_argument("--limit", type=int, default=None, help="Evaluate only the first N questions (smoke runs).")
    parser.add_argument("--model", default=None, help="Override the chat model for the agent and the judge (default: config primary model).")
    return parser.parse_args(argv)


def missing_required_keys(environ: Mapping[str, str]) -> list[str]:
    return [key for key in REQUIRED_ENV_KEYS if not environ.get(key)]


class _DashScopeLangChainEmbeddings:
    """Minimal langchain ``Embeddings`` protocol over the DashScope embedder.

    ragas calls the async methods from its own event loop; the sync methods
    exist only to satisfy the protocol surface and raise if hit.
    """

    def __init__(self, embedder) -> None:
        self._embedder = embedder

    async def aembed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        results = await self._embedder.embed(list(texts), text_type="document")
        return [r.dense for r in results]

    async def aembed_query(self, text: str) -> list[float]:
        results = await self._embedder.embed([text], text_type="query")
        return results[0].dense

    def embed_documents(self, texts):  # pragma: no cover - ragas uses the async path
        raise NotImplementedError("async only")

    def embed_query(self, text):  # pragma: no cover - ragas uses the async path
        raise NotImplementedError("async only")


def _build_ragas_evaluator(judge_llm):
    """ragas-wrapped evaluator, or ``None`` when ragas is not installed.

    The returned callable matches the ``ragas_evaluator`` protocol of
    ``run_layer2_evaluation``; ``None`` makes the report mark the standard
    metrics as explicitly skipped.
    """

    try:
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
    except ImportError:
        return None

    from deerflow.knowledge.embedder import DashScopeEmbedder
    from deerflow.knowledge.eval.ragas_eval import compute_ragas_scores

    wrapped_llm = LangchainLLMWrapper(judge_llm)
    wrapped_embeddings = LangchainEmbeddingsWrapper(_DashScopeLangChainEmbeddings(DashScopeEmbedder()))

    async def evaluator(samples, *, judge_llm, embeddings):  # protocol-aligned; wrappers are bound at build time
        return await compute_ragas_scores(samples, judge_llm=wrapped_llm, embeddings=wrapped_embeddings)

    return evaluator


async def _async_main(args: argparse.Namespace) -> int:
    try:
        from deerflow.config.app_config import get_app_config

        config = get_app_config()
    except ValueError as exc:  # unresolved $ENV in config.yaml → missing credential
        print(f"ragas-eval skipped: {exc}")
        return EXIT_SKIPPED

    # Fail fast on bad inputs BEFORE touching the persistence engine.
    from deerflow.knowledge.eval.dataset import GoldenDatasetError, load_golden

    try:
        questions = load_golden(args.golden)
    except GoldenDatasetError as exc:
        print(f"ragas-eval error: {exc}", file=sys.stderr)
        return EXIT_ERROR
    if args.limit is not None:
        questions = questions[: args.limit]

    from deerflow.knowledge.eval.ragas_eval import build_lead_agent_runner, render_markdown, run_layer2_evaluation, write_reports
    from deerflow.knowledge.store import get_knowledge_store
    from deerflow.models.factory import create_chat_model
    from deerflow.persistence.engine import close_engine, init_engine_from_config

    await init_engine_from_config(config.database)
    try:
        store = get_knowledge_store()
        kb = await store.get_kb(args.kb_id)
        if kb is None:
            print(f"ragas-eval error: knowledge base not found: {args.kb_id}", file=sys.stderr)
            return EXIT_ERROR

        # Judge: the config primary model (spec §8), overridable via --model.
        judge_llm = create_chat_model(name=args.model, app_config=config, attach_tracing=False)
        from datetime import UTC, datetime
        from uuid import uuid4

        run_id = f"ragas-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
        agent_runner = build_lead_agent_runner(kb_id=args.kb_id, user_id=kb["owner_id"], run_id=run_id, model_name=args.model)
        report = await run_layer2_evaluation(
            questions,
            agent_runner=agent_runner,
            judge_llm=judge_llm,
            ragas_evaluator=_build_ragas_evaluator(judge_llm),
            kb_id=args.kb_id,
            run_id=run_id,
        )
    finally:
        await close_engine()

    json_path, md_path = write_reports(report, Path(args.out))
    aggregate = report.aggregate
    print(render_markdown(report))
    print(f"questions={aggregate['questions']} failures={aggregate['failures']} path_accuracy={aggregate['path_accuracy']}")
    print(f"report: {json_path} · {md_path}")
    # Report-only: quality numbers never affect the exit code.
    return EXIT_OK


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
        print(f"ragas-eval skipped: missing required API keys: {', '.join(missing)} (exit {EXIT_SKIPPED} — explicit skip, not a pass)")
        return EXIT_SKIPPED
    return _run(args)


if __name__ == "__main__":
    sys.exit(main())
