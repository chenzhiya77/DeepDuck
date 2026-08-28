"""File-level tests for bottom-up question synthesis (spec 2026-08-28 §6).

合成造题核心：LLM 读编号切片 → 候选题（JSON）→ 双重守卫（①锚定编号必须
映射到真实切片，②``validate_question`` 全字段校验）→ 暂存文件整体替换。
候选题不入题库——只有 ``accept_candidate`` 经 ``question_bank.add_question``
写题库（唯一写路径纪律）。LLM 用 stub 驱动，不碰真实模型。
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from deerflow.knowledge.eval import synthesis
from deerflow.knowledge.eval.question_bank import load_questions

pytestmark = pytest.mark.asyncio

KB = "kb-synth"
DOC = "d" * 32
CHUNKS = [
    {"chunk_id": f"{DOC}#0001", "text": "String 是不可变类型。"},
    {"chunk_id": f"{DOC}#0002", "text": "StringBuffer 是可变且线程安全的。"},
    {"chunk_id": f"{DOC}#0003", "text": "StringBuilder 可变但非线程安全。"},
]

GOOD_QUESTIONS = [
    {
        "query": "String 有什么特点？",
        "category": "fact",
        "expected_paths": ["vector"],
        "chunk_refs": [1],
        "reference_answer": "String 是不可变类型。",
    },
    {
        "query": "StringBuffer 和 StringBuilder 在安全性上有什么关系？",
        "category": "relation",
        "expected_paths": ["vector", "graph"],
        "chunk_refs": [2, 3],
        "reference_answer": "前者线程安全，后者非线程安全。",
    },
]


class _StubLLM:
    def __init__(self, content: str):
        self.content = content
        self.calls: list = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        return SimpleNamespace(content=self.content)


def _factory(questions: list[dict]) -> tuple:
    llm = _StubLLM(json.dumps({"questions": questions}, ensure_ascii=False))
    return (lambda: llm), llm


async def _synthesize(tmp_path, questions, **kwargs):
    factory, llm = _factory(questions)
    staging = tmp_path / "eval_candidates.json"
    candidates, dropped = await synthesis.synthesize_for_doc(KB, doc_id=DOC, count=len(questions), chunks=CHUNKS, staging_path=staging, llm_factory=factory, **kwargs)
    return staging, candidates, dropped, llm


async def test_synthesize_writes_validated_candidates_to_staging(tmp_path) -> None:
    staging, candidates, dropped, _ = await _synthesize(tmp_path, GOOD_QUESTIONS)

    assert dropped == 0
    assert len(candidates) == 2
    # 暂存是单一 JSON 文档：元数据 + 候选列表（审核期元数据不随候选消费丢失）。
    data = json.loads(staging.read_text(encoding="utf-8"))
    assert data["doc_id"] == DOC
    assert data["kb_id"] == KB
    assert data["dropped"] == 0
    assert data["generated_at"]
    assert len(data["candidates"]) == 2
    first = candidates[0]
    assert first.candidate_id.startswith("c_") and len(first.candidate_id) == 10
    assert first.relevant_chunk_ids == (f"{DOC}#0001",)
    assert candidates[1].relevant_chunk_ids == (f"{DOC}#0002", f"{DOC}#0003")
    assert candidates[1].expected_paths == ("vector", "graph")
    ids = [c.candidate_id for c in candidates]
    assert len(set(ids)) == 2, "候选 id 互不重复"
    # 候选不落题库——暂存与题库是两个文件。
    assert not (tmp_path / "golden.jsonl").exists()


async def test_out_of_range_anchor_drops_only_that_candidate(tmp_path) -> None:
    # 守卫①：锚定编号越界 → 该候选整条丢弃，其余不受影响。
    bad = [GOOD_QUESTIONS[0], dict(GOOD_QUESTIONS[1], chunk_refs=[9])]

    staging, candidates, dropped, _ = await _synthesize(tmp_path, bad)

    assert dropped == 1
    assert [c.query for c in candidates] == [GOOD_QUESTIONS[0]["query"]]
    assert json.loads(staging.read_text(encoding="utf-8"))["dropped"] == 1


async def test_schema_violation_drops_candidate_after_guard_two(tmp_path) -> None:
    # 守卫②：锚定合法但字段违例（坏 category）→ validate_question 拦下。
    bad = [dict(GOOD_QUESTIONS[0], category="vibe")]

    staging, candidates, dropped, _ = await _synthesize(tmp_path, bad)

    assert dropped == 1
    assert candidates == []
    assert json.loads(staging.read_text(encoding="utf-8"))["candidates"] == []


async def test_invalid_llm_json_writes_empty_staging_without_raising(tmp_path) -> None:
    # LLM 输出非法 JSON → 0 候选、不抛错，暂存整体替换为空合成元数据。
    llm = _StubLLM("这不是 JSON")
    staging = tmp_path / "eval_candidates.json"

    candidates, dropped = await synthesis.synthesize_for_doc(KB, doc_id=DOC, count=3, chunks=CHUNKS, staging_path=staging, llm_factory=lambda: llm)

    assert candidates == [] and dropped == 0
    data = json.loads(staging.read_text(encoding="utf-8"))
    assert data["candidates"] == [] and data["doc_id"] == DOC


async def test_resynthesis_replaces_staging_wholesale(tmp_path) -> None:
    # 整体替换语义：审核面永远是一次合成的产物（不做增量累积）。
    staging, first, _, _ = await _synthesize(tmp_path, GOOD_QUESTIONS)
    factory, _ = _factory([GOOD_QUESTIONS[0]])

    second, dropped = await synthesis.synthesize_for_doc(KB, doc_id=DOC, count=1, chunks=CHUNKS, staging_path=staging, llm_factory=factory)

    assert dropped == 0
    data = json.loads(staging.read_text(encoding="utf-8"))
    assert len(data["candidates"]) == 1
    old_ids = {c.candidate_id for c in first}
    assert not old_ids & {row["candidate_id"] for row in data["candidates"]} or len(second) == 1


async def test_accept_moves_candidate_into_bank_with_new_server_id(tmp_path) -> None:
    staging, candidates, _, _ = await _synthesize(tmp_path, GOOD_QUESTIONS)
    bank = tmp_path / "golden.jsonl"

    question = await synthesis.accept_candidate(bank, staging, candidates[1].candidate_id)

    assert question.id.startswith("q_") and question.id != candidates[1].candidate_id
    assert question.expected_paths == ("vector", "graph")
    assert question.relevant_chunk_ids == (f"{DOC}#0002", f"{DOC}#0003")
    # 入库走 add_question 守卫——题库可被标准加载器回读。
    assert [q.id for q in await load_questions(bank)] == [question.id]
    # 暂存中该候选消失，另一条保留。
    remaining = json.loads(staging.read_text(encoding="utf-8"))["candidates"]
    assert [row["candidate_id"] for row in remaining] == [candidates[0].candidate_id]


async def test_accept_unknown_candidate_raises_key_error(tmp_path) -> None:
    staging, _, _, _ = await _synthesize(tmp_path, GOOD_QUESTIONS)

    with pytest.raises(KeyError):
        await synthesis.accept_candidate(tmp_path / "golden.jsonl", staging, "c_missing0")


async def test_reject_removes_candidate_from_staging(tmp_path) -> None:
    staging, candidates, _, _ = await _synthesize(tmp_path, GOOD_QUESTIONS)

    removed = await synthesis.reject_candidate(staging, candidates[0].candidate_id)

    assert removed == candidates[0].candidate_id
    remaining = json.loads(staging.read_text(encoding="utf-8"))["candidates"]
    assert [row["candidate_id"] for row in remaining] == [candidates[1].candidate_id]
    # 题库不受拒绝影响。
    assert not (tmp_path / "golden.jsonl").exists()


async def test_reject_unknown_candidate_raises_key_error(tmp_path) -> None:
    staging, _, _, _ = await _synthesize(tmp_path, GOOD_QUESTIONS)

    with pytest.raises(KeyError):
        await synthesis.reject_candidate(staging, "c_missing0")


async def test_load_staging_missing_file_is_empty_not_error(tmp_path) -> None:
    # 新 KB 从未合成过：读暂存不是错误，缺省元数据可读（状态端点直接消费）。
    status = await synthesis.load_staging(tmp_path / "absent.json")

    assert status["candidates"] == []
    assert status["generated_at"] is None
    assert status["doc_id"] is None
    assert status["dropped"] == 0


async def test_prompt_contract_carries_numbered_chunks_and_constraints(tmp_path) -> None:
    # prompt 契约钉死：编号切片清单 / 数量约束 / 混合题型 / 禁止照抄 / JSON 字段。
    _, _, _, llm = await _synthesize(tmp_path, GOOD_QUESTIONS)

    prompt_text = "\n".join(str(getattr(m, "content", m)) for m in llm.calls[0])
    assert "[1]" in prompt_text and f"[{len(CHUNKS)}]" in prompt_text, "切片必须编号喂入"
    assert str(len(GOOD_QUESTIONS)) in prompt_text, "数量约束进 prompt"
    assert "single-hop" in prompt_text and "multi-hop" in prompt_text
    assert "照抄" in prompt_text, "禁止照抄切片原文的约束进 prompt"
    assert "chunk_refs" in prompt_text and "expected_paths" in prompt_text


def test_in_flight_registry_begin_end_semantics() -> None:
    assert synthesis.synthesis_in_progress(KB) is False
    assert synthesis.begin_synthesis(KB) is True
    assert synthesis.synthesis_in_progress(KB) is True
    assert synthesis.begin_synthesis(KB) is False, "in-flight 中重复 begin 返回 False"
    synthesis.end_synthesis(KB)
    assert synthesis.synthesis_in_progress(KB) is False
    synthesis.end_synthesis(KB)  # drain 后再 end 不下穿为负
    assert synthesis.synthesis_in_progress(KB) is False
