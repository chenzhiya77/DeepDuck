"""Bottom-up question synthesis for the eval question bank (spec 2026-08-28 §6).

Generates candidate questions from a document's chunks instead of from
retrieval results — bottom-up synthesis cures the survivorship bias of
anchoring only what the system already recalls (the question source is the
corpus, not the retrieval output).

Flow: numbered chunks → one LLM call → JSON candidates → two guards →
staging file → human review (accept/reject) → only ``accept_candidate``
writes the bank, through ``question_bank.add_question`` (the single write
path — no second route into the golden file).

Guards (order is contractual, never swap):

1. **Anchor mapping** — every ``chunk_refs`` entry must be a 1-based index
   of a real chunk of the document; a hallucinated anchor drops the whole
   candidate.
2. **Schema validation** — the candidate (with a server ``c_`` id injected)
   must pass ``dataset.validate_question``, the same guard as manual creation.

Dropped candidates are counted, never surfaced as errors: fewer questions
beat dirty questions. The staging file is a single JSON document (not JSONL)
so metadata (doc_id / generated_at / dropped) survives after the last
candidate is reviewed; every synthesis replaces it wholesale — the review
surface is always exactly one synthesis run's output.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from langchain_core.messages import HumanMessage, SystemMessage

from deerflow.knowledge.eval.dataset import GoldenDatasetError, GoldenQuestion, validate_question
from deerflow.knowledge.eval.question_bank import add_question

logger = logging.getLogger(__name__)

#: In-flight synthesis runs per KB (single-process asyncio counter, same
#: pattern as ``ondemand._IN_FLIGHT``) — feeds trigger idempotency and the
#: status endpoint's ``in_progress`` flag.
_SYNTH_IN_FLIGHT: dict[str, int] = {}

#: Per-staging-file locks for read-modify-write serialization (accept/reject
#: mutate the staging document; single-process scope, same boundary as the
#: question bank locks).
_LOCKS: dict[str, asyncio.Lock] = {}


@dataclass(frozen=True)
class SynthesisCandidate:
    """One staged candidate — a full question payload plus staging metadata."""

    candidate_id: str
    query: str
    category: str
    expected_paths: tuple[str, ...]
    relevant_chunk_ids: tuple[str, ...]
    relevant_entities: tuple[str, ...]
    reference_answer: str | None
    doc_id: str
    generated_at: str


def synthesis_in_progress(kb_id: str) -> bool:
    """True while any synthesis run for the KB is active."""
    return _SYNTH_IN_FLIGHT.get(kb_id, 0) > 0


def begin_synthesis(kb_id: str) -> bool:
    """Mark a run in flight; False when one already is (idempotent trigger)."""
    if _SYNTH_IN_FLIGHT.get(kb_id, 0) > 0:
        return False
    _SYNTH_IN_FLIGHT[kb_id] = _SYNTH_IN_FLIGHT.get(kb_id, 0) + 1
    return True


def end_synthesis(kb_id: str) -> None:
    """Drain the counter (call from ``finally``); never goes negative."""
    _SYNTH_IN_FLIGHT[kb_id] = max(0, _SYNTH_IN_FLIGHT.get(kb_id, 0) - 1)


def new_candidate_id() -> str:
    """Staging-scope id: ``c_`` + 8 hex chars (bank ids stay ``q_``)."""
    return f"c_{uuid4().hex[:8]}"


def _lock(path: Path) -> asyncio.Lock:
    return _LOCKS.setdefault(str(path), asyncio.Lock())


def _default_llm_factory():
    """Synthesis uses the main model (first configured), wiki-generator precedent."""
    from deerflow.models.factory import create_chat_model

    return create_chat_model()


_SYSTEM_PROMPT = """你是知识库评测题库的出题员，基于给定文档的编号切片出评测题。

要求：
- single-hop 题（fact / relation 类）：答案锚定 1–3 个切片；
- multi-hop 题（concept 类）：答案需跨段落综合，锚定分布在不同位置的多个切片；
- query 禁止照抄切片原文，必须用自己的话提问；
- category 只能取 fact / relation / concept / global；
- expected_paths 从 vector / graph / wiki 中选（可多选，数组形式）；
- chunk_refs 是答案依据的切片编号列表（1 开始）。

只输出 JSON，不要其他文字：
{"questions": [{"query": "...", "category": "...", "expected_paths": ["..."], "chunk_refs": [1, 2], "reference_answer": "..."}]}"""


def _build_messages(doc_id: str, count: int, chunks: list[dict[str, Any]]) -> list:
    numbered = "\n".join(f"[{index}] {chunk.get('text', '')}" for index, chunk in enumerate(chunks, start=1))
    user = f"文档 {doc_id} 共 {len(chunks)} 个切片：\n{numbered}\n\n请生成 {count} 道题（single-hop 与 multi-hop 混合）。"
    return [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=user)]


def _parse_llm_json(content: str) -> list[dict[str, Any]]:
    """Extract the questions list; any parse problem yields [] (dropped=0)."""
    text = content.strip()
    # LLMs frequently wrap JSON in code fences despite instructions.
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        payload = json.loads(text.strip())
    except json.JSONDecodeError:
        logger.warning("synthesis: LLM output is not valid JSON; producing zero candidates")
        return []
    questions = payload.get("questions") if isinstance(payload, dict) else None
    return questions if isinstance(questions, list) else []


def _guard_candidate(raw: dict[str, Any], *, chunks: list[dict[str, Any]], candidate_id: str, doc_id: str, generated_at: str) -> SynthesisCandidate | None:
    """Apply guard 1 (anchor mapping) then guard 2 (schema); None = drop."""
    refs = raw.get("chunk_refs")
    if not isinstance(refs, list) or not refs:
        return None
    try:
        indexes = [int(ref) for ref in refs]
    except (TypeError, ValueError):
        return None
    if any(index < 1 or index > len(chunks) for index in indexes):
        return None  # 幻觉锚定：编号指向不存在的切片 → 整条丢弃
    chunk_ids = tuple(chunks[index - 1]["chunk_id"] for index in indexes)

    question_raw: dict[str, Any] = {
        "id": candidate_id,
        "query": raw.get("query"),
        "category": raw.get("category"),
        "expected_paths": raw.get("expected_paths"),
        "relevant_chunk_ids": list(chunk_ids),
        "relevant_entities": list(raw.get("relevant_entities") or []),
        "reference_answer": raw.get("reference_answer"),
    }
    try:
        question = validate_question(question_raw)
    except GoldenDatasetError as exc:
        logger.info("synthesis candidate %s dropped by schema guard: %s", candidate_id, exc)
        return None

    return SynthesisCandidate(
        candidate_id=candidate_id,
        query=question.query,
        category=question.category,
        expected_paths=question.expected_paths,
        relevant_chunk_ids=question.relevant_chunk_ids,
        relevant_entities=question.relevant_entities,
        reference_answer=question.reference_answer,
        doc_id=doc_id,
        generated_at=generated_at,
    )


def _write_staging(path: Path, *, kb_id: str, doc_id: str, generated_at: str, dropped: int, candidates: list[SynthesisCandidate]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "kb_id": kb_id,
        "doc_id": doc_id,
        "generated_at": generated_at,
        "dropped": dropped,
        "candidates": [asdict(candidate) for candidate in candidates],
    }
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with tmp.open("w", encoding="utf-8", newline="\n") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


async def load_staging(path: str | Path) -> dict[str, Any]:
    """Read the staging document; a missing file is an empty staging."""
    path = Path(path)
    if not path.exists():
        return {"kb_id": None, "doc_id": None, "generated_at": None, "dropped": 0, "candidates": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("candidates", [])
    data.setdefault("dropped", 0)
    return data


async def synthesize_for_doc(
    kb_id: str,
    *,
    doc_id: str,
    count: int,
    chunks: list[dict[str, Any]],
    staging_path: str | Path,
    llm_factory: Any = None,
    generated_at: str | None = None,
) -> tuple[list[SynthesisCandidate], int]:
    """Generate candidates for one document and replace the staging file.

    Returns ``(candidates, dropped)``. Never raises on bad LLM output — an
    unparsable response yields an empty staging (runtime exceptions from the
    LLM call itself propagate; the service layer owns that fallback).
    """
    if generated_at is None:
        generated_at = datetime.now(UTC).isoformat(timespec="seconds")
    factory = llm_factory or _default_llm_factory
    llm = factory()
    response = await llm.ainvoke(_build_messages(doc_id, count, chunks))

    candidates: list[SynthesisCandidate] = []
    used_ids: set[str] = set()
    raw_questions = _parse_llm_json(response.content)
    for raw in raw_questions:
        if not isinstance(raw, dict):
            continue
        candidate_id = new_candidate_id()
        while candidate_id in used_ids:
            candidate_id = new_candidate_id()
        candidate = _guard_candidate(raw, chunks=chunks, candidate_id=candidate_id, doc_id=doc_id, generated_at=generated_at)
        if candidate is None:
            continue
        used_ids.add(candidate_id)
        candidates.append(candidate)
    dropped = max(0, len(raw_questions) - len(candidates))

    staging_path = Path(staging_path)
    async with _lock(staging_path):
        _write_staging(staging_path, kb_id=kb_id, doc_id=doc_id, generated_at=generated_at, dropped=dropped, candidates=candidates)
    return candidates, dropped


async def accept_candidate(bank_path: str | Path, staging_path: str | Path, candidate_id: str) -> GoldenQuestion:
    """Move one staged candidate into the bank (the only write route).

    The bank write goes through ``question_bank.add_question`` — server id
    regeneration and schema guard included. KeyError when the candidate is
    unknown (already reviewed, or never existed).
    """
    staging_path = Path(staging_path)
    async with _lock(staging_path):
        data = await load_staging(staging_path)
        rows = data["candidates"]
        row = next((item for item in rows if item.get("candidate_id") == candidate_id), None)
        if row is None:
            raise KeyError(candidate_id)

        question = await add_question(
            bank_path,
            query=row["query"],
            category=row["category"],
            expected_paths=row["expected_paths"],
            relevant_chunk_ids=row.get("relevant_chunk_ids") or [],
            relevant_entities=row.get("relevant_entities") or [],
            reference_answer=row.get("reference_answer"),
        )
        _write_staging(
            staging_path,
            kb_id=data.get("kb_id"),
            doc_id=data.get("doc_id"),
            generated_at=data.get("generated_at"),
            dropped=data.get("dropped", 0),
            candidates=[_row_to_candidate(item) for item in rows if item.get("candidate_id") != candidate_id],
        )
        return question


async def reject_candidate(staging_path: str | Path, candidate_id: str) -> str:
    """Drop one staged candidate without touching the bank; KeyError when unknown."""
    staging_path = Path(staging_path)
    async with _lock(staging_path):
        data = await load_staging(staging_path)
        rows = data["candidates"]
        if not any(item.get("candidate_id") == candidate_id for item in rows):
            raise KeyError(candidate_id)
        _write_staging(
            staging_path,
            kb_id=data.get("kb_id"),
            doc_id=data.get("doc_id"),
            generated_at=data.get("generated_at"),
            dropped=data.get("dropped", 0),
            candidates=[_row_to_candidate(item) for item in rows if item.get("candidate_id") != candidate_id],
        )
        return candidate_id


def _row_to_candidate(row: dict[str, Any]) -> SynthesisCandidate:
    return SynthesisCandidate(
        candidate_id=row["candidate_id"],
        query=row["query"],
        category=row["category"],
        expected_paths=tuple(row.get("expected_paths") or ()),
        relevant_chunk_ids=tuple(row.get("relevant_chunk_ids") or ()),
        relevant_entities=tuple(row.get("relevant_entities") or ()),
        reference_answer=row.get("reference_answer"),
        doc_id=row.get("doc_id", ""),
        generated_at=row.get("generated_at", ""),
    )
