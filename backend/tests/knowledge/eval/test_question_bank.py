"""File-level tests for the per-KB golden question bank (spec 2026-08-27 §4.1/§4.2).

题库文件是运行期数据（``data/knowledge/<kb_id>/golden.jsonl``），不是 git
fixture。写路径必须复用 ``dataset.validate_question``（脏题静默污染指标是
题库的第一风险），存量内容脏时读写都显式报错指明行号（不静默跳过），
落盘走 tmp + 原子 replace，per-KB ``asyncio.Lock`` 串行化读改写。
"""

from __future__ import annotations

import asyncio
import json

import pytest

from deerflow.knowledge.eval.dataset import GoldenDatasetError, load_golden
from deerflow.knowledge.eval.question_bank import (
    QuestionBankCorrupted,
    QuestionBankInvalidQuestion,
    add_question,
    delete_question,
    load_questions,
)

pytestmark = pytest.mark.asyncio


def _valid_fields(query: str = "什么是退休年龄", category: str = "fact") -> dict:
    return {
        "query": query,
        "category": category,
        "expected_paths": ("vector",),
        "relevant_chunk_ids": [],
        "relevant_entities": [],
        "reference_answer": None,
    }


async def test_load_missing_file_returns_empty(tmp_path) -> None:
    # 新 KB 的题库文件不存在是常态（不是错误）——空列表开箱即用。
    assert await load_questions(tmp_path / "golden.jsonl") == []


async def test_add_generates_server_side_id_and_roundtrips_through_load_golden(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"

    question = await add_question(path, **_valid_fields())

    assert question.id.startswith("q_")
    assert question.query == "什么是退休年龄"
    # 文件可被守卫加载器原样回读——UI 写入与 CLI 加载同一 schema。
    assert [q.id for q in load_golden(path)] == [question.id]
    assert (await load_questions(path))[0].reference_answer is None


async def test_add_ids_are_unique_across_calls(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"

    first = await add_question(path, **_valid_fields(query="问题一"))
    second = await add_question(path, **_valid_fields(query="问题二"))

    assert first.id != second.id
    assert len(await load_questions(path)) == 2


@pytest.mark.parametrize(
    ("override", "bad_key"),
    [
        ({"category": "vibe"}, "category"),
        ({"expected_paths": ("teleport",)}, "expected_paths"),
        ({"expected_paths": ()}, "expected_paths"),
        ({"relevant_chunk_ids": ["not-a-chunk-id"]}, "relevant_chunk_ids"),
        ({"reference_answer": "   "}, "reference_answer"),
    ],
)
async def test_add_validates_the_new_question(tmp_path, override: dict, bad_key: str) -> None:
    fields = _valid_fields() | override

    with pytest.raises(QuestionBankInvalidQuestion) as exc_info:
        await add_question(tmp_path / "golden.jsonl", **fields)

    assert isinstance(exc_info.value, GoldenDatasetError)
    assert bad_key in str(exc_info.value)


async def test_delete_removes_the_row(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"
    question = await add_question(path, **_valid_fields())
    await add_question(path, **_valid_fields(query="留存的问题"))

    removed = await delete_question(path, question.id)

    assert removed == question.id
    remaining = await load_questions(path)
    assert [q.query for q in remaining] == ["留存的问题"]


async def test_delete_unknown_id_raises_key_error(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"
    await add_question(path, **_valid_fields())

    with pytest.raises(KeyError):
        await delete_question(path, "q_missing")


def _write_dirty_file(path, dirty_line: str, lineno: int) -> None:
    good = '{"id": "q_ok00001", "query": "有效问题", "expected_path": "vector", "relevant_chunk_ids": [], "relevant_entities": [], "category": "fact"}'
    lines = [good] * (lineno - 1) + [dirty_line]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def test_load_dirty_file_raises_with_line_number(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"
    _write_dirty_file(path, json.dumps({"id": "q_x", "category": "fact"}), lineno=2)

    with pytest.raises(GoldenDatasetError, match=r"golden\.jsonl:2"):
        await load_questions(path)


async def test_write_on_dirty_existing_content_reports_corruption_not_input_error(tmp_path) -> None:
    # 存量内容非法与新增字段非法是两类错误：前者 500（运维修文件）、后者 422（调用方改入参）。
    path = tmp_path / "golden.jsonl"
    _write_dirty_file(path, "{broken json", lineno=3)

    with pytest.raises(QuestionBankCorrupted):
        await add_question(path, **_valid_fields())


async def test_add_leaves_no_tmp_residue(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"

    await add_question(path, **_valid_fields())

    assert [p.name for p in tmp_path.iterdir()] == ["golden.jsonl"]


async def test_concurrent_adds_serialize_per_file(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"

    await asyncio.gather(
        add_question(path, **_valid_fields(query="并发一")),
        add_question(path, **_valid_fields(query="并发二")),
    )

    assert {q.query for q in await load_questions(path)} == {"并发一", "并发二"}


# ── expected_paths 多路写路径（spec 2026-08-28 §3）───────────────────────


async def test_add_writes_expected_paths_new_format(tmp_path) -> None:
    path = tmp_path / "golden.jsonl"

    await add_question(path, **_valid_fields() | {"expected_paths": ("vector", "graph")})

    raw = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    assert raw["expected_paths"] == ["vector", "graph"]
    assert "expected_path" not in raw  # 新写入一律新格式，不留 legacy 键
    assert (await load_questions(path))[0].expected_paths == ("vector", "graph")


async def test_add_upgrades_legacy_file_wholesale_to_new_format(tmp_path) -> None:
    # `asdict` 重写语义：向含单值行的文件追加后，整文件升级为新格式（§9）。
    path = tmp_path / "golden.jsonl"
    legacy = json.dumps(
        {"id": "q_legacy01", "query": "存量题", "expected_path": "wiki", "relevant_chunk_ids": [], "relevant_entities": [], "category": "concept"},
        ensure_ascii=False,
    )
    path.write_text(legacy + "\n", encoding="utf-8")

    await add_question(path, **_valid_fields(query="新题"))

    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [row.get("expected_paths") for row in rows] == [["wiki"], ["vector"]]
    assert all("expected_path" not in row for row in rows)
    questions = await load_questions(path)
    assert [q.expected_paths for q in questions] == [("wiki",), ("vector",)]
