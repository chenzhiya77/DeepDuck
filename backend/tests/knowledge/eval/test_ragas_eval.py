"""Tests for the Layer 2 end-to-end RAGAS evaluation (spec 2026-08-23 §8).

Layer 2 walks the real conversation chain (agent picks tools, writes the
answer) instead of calling retrieval impls directly. The agent run itself is
injected as ``agent_runner`` so these tests never touch an LLM, Qdrant, or the
network — the judge LLM is stubbed through the ``ainvoke`` protocol (same
pattern as the graph extractor tests), and Langfuse is a fake client.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from deerflow.knowledge.eval.dataset import GoldenQuestion
from deerflow.knowledge.eval.ragas_eval import (
    JudgeParseError,
    TraceOutcome,
    citation_precision_recall,
    compute_ragas_scores,
    extract_answer,
    extract_citation_map,
    extract_cited_numbers,
    extract_retrieval_tools,
    extract_seed_entities,
    graph_entity_hit_rate,
    parse_judge_json,
    path_hit,
    push_scores_to_langfuse,
    render_markdown,
    report_from_dict,
    report_to_dict,
    run_layer2_evaluation,
    split_answer_claims,
)


class _FakeJudgeLLM:
    """Returns canned message contents in call order (last one repeats)."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[object] = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        return SimpleNamespace(content=self.responses[min(len(self.calls) - 1, len(self.responses) - 1)])


def _question(qid: str, *, category: str = "fact", expected_path: str = "vector", entities=(), reference: str | None = "参考答案") -> GoldenQuestion:
    return GoldenQuestion(
        id=qid,
        query=f"query-{qid}",
        expected_path=expected_path,
        relevant_chunk_ids=(),
        relevant_entities=tuple(entities),
        category=category,
        reference_answer=reference,
    )


def _retrieval_exchange(tool: str, payload: dict, *, call_id: str | None = None) -> list:
    """One AIMessage(tool_call) + ToolMessage(JSON payload) pair, as LangChain emits them."""

    cid = call_id or f"call-{tool}-1"
    return [
        AIMessage(content="", tool_calls=[{"name": tool, "args": {"query": "q"}, "id": cid}]),
        ToolMessage(content=json.dumps(payload, ensure_ascii=False), tool_call_id=cid, name=tool),
    ]


def _outcome(
    qid: str,
    *,
    answer: str = "答案[1]",
    tools: tuple[str, ...] = ("hybrid_search",),
    citation_map: dict[int, str] | None = None,
    seed_entities: tuple[str, ...] = (),
    trace_id: str | None = "trace-1",
) -> TraceOutcome:
    return TraceOutcome(
        question_id=qid,
        answer=answer,
        retrieval_tools=tuple(tools),
        citation_map=dict(citation_map if citation_map is not None else {1: "证据一"}),
        seed_entities=tuple(seed_entities),
        thread_id=f"thread-{qid}",
        trace_id=trace_id,
    )


class TestParseJudgeJson:
    def test_valid_json(self):
        assert parse_judge_json('{"supported": true, "reason": "ok"}') == {"supported": True, "reason": "ok"}

    def test_code_fenced_json(self):
        assert parse_judge_json('```json\n{"supported": false, "reason": "x"}\n```')["supported"] is False

    def test_malformed_raises(self):
        with pytest.raises(JudgeParseError):
            parse_judge_json("我无法判定，这超出我的能力")

    def test_empty_raises(self):
        with pytest.raises(JudgeParseError):
            parse_judge_json("")

    def test_missing_supported_key_raises(self):
        with pytest.raises(JudgeParseError):
            parse_judge_json('{"verdict": true}')


class TestExtractors:
    def test_extract_retrieval_tools_orders_and_filters(self):
        messages = [
            HumanMessage(content="q"),
            *_retrieval_exchange("hybrid_search", {"results": [], "message": ""}),
            AIMessage(content="", tool_calls=[{"name": "bash", "args": {}, "id": "call-bash"}]),
            ToolMessage(content="ok", tool_call_id="call-bash", name="bash"),
            *_retrieval_exchange("graph_search", {"entities": [], "relations": [], "evidence": [], "trace": {}, "message": ""}),
        ]

        assert extract_retrieval_tools(messages) == ("hybrid_search", "graph_search")

    def test_extract_retrieval_tools_empty(self):
        assert extract_retrieval_tools([HumanMessage(content="q"), AIMessage(content="a")]) == ()

    def test_extract_answer_last_ai_message_with_content(self):
        messages = [
            HumanMessage(content="q"),
            AIMessage(content="第一版"),
            AIMessage(content="", tool_calls=[{"name": "hybrid_search", "args": {}, "id": "c1"}]),
            ToolMessage(content="{}", tool_call_id="c1", name="hybrid_search"),
            AIMessage(content="最终答案[1]"),
        ]

        assert extract_answer(messages) == "最终答案[1]"

    def test_extract_answer_empty_when_no_ai_content(self):
        assert extract_answer([HumanMessage(content="q")]) == ""

    def test_extract_citation_map_from_three_tool_payloads(self):
        messages = [
            *_retrieval_exchange("hybrid_search", {"results": [{"chunk_id": "d#0001", "text": "切片一", "citation_no": 1}], "message": ""}),
            *_retrieval_exchange(
                "graph_search",
                {"entities": [], "relations": [], "evidence": [{"chunk_id": "d#0002", "text": "切片二", "citation_no": 2}], "trace": {}, "message": ""},
                call_id="call-graph-1",
            ),
            *_retrieval_exchange(
                "wiki_search",
                {"entries": [{"entry_id": "e1", "title": "条目", "content": "条目正文", "citation_no": 3}], "message": ""},
                call_id="call-wiki-1",
            ),
        ]

        assert extract_citation_map(messages) == {1: "切片一", 2: "切片二", 3: "条目正文"}

    def test_extract_citation_map_accepts_dict_content(self):
        messages = [ToolMessage(content={"results": [{"text": "切片", "citation_no": 7}], "message": ""}, tool_call_id="c", name="hybrid_search")]

        assert extract_citation_map(messages) == {7: "切片"}

    def test_extract_citation_map_ignores_unparseable_and_unrelated(self):
        messages = [
            ToolMessage(content="not-json", tool_call_id="c1", name="hybrid_search"),
            ToolMessage(content='{"ok": true}', tool_call_id="c2", name="bash"),
        ]

        assert extract_citation_map(messages) == {}

    def test_extract_seed_entities_merges_across_calls(self):
        messages = [
            *_retrieval_exchange(
                "graph_search",
                {"entities": [], "relations": [], "evidence": [], "trace": {"seed_entities": ["JVM", "GC"]}, "message": ""},
            ),
            *_retrieval_exchange(
                "graph_search",
                {"entities": [], "relations": [], "evidence": [], "trace": {"seed_entities": ["GC", "堆"]}, "message": ""},
                call_id="call-graph-2",
            ),
        ]

        assert extract_seed_entities(messages) == ("JVM", "GC", "堆")

    def test_extract_cited_numbers(self):
        assert extract_cited_numbers("先引用[1]，再组合[2][3]，重复[1]。") == [1, 2, 3]
        assert extract_cited_numbers("没有引用") == []

    def test_split_answer_claims_groups_markers(self):
        claims = split_answer_claims("无标注开头。论断一[1]。论断二[2][3]。结尾无标注。")

        assert [(c, nums) for c, nums in claims] == [("论断一", [1]), ("论断二", [2, 3])]


class TestPathHit:
    def test_expected_tool_in_sequence(self):
        assert path_hit("vector", ("hybrid_search", "graph_search")) is True
        assert path_hit("graph", ("hybrid_search", "graph_search")) is True

    def test_expected_tool_absent(self):
        assert path_hit("graph", ("hybrid_search",)) is False

    def test_no_retrieval_calls_is_a_miss(self):
        assert path_hit("wiki", ()) is False


class TestGraphEntityHitRate:
    def test_hit_ratio(self):
        assert graph_entity_hit_rate(("JVM", "GC"), ("JVM", "堆")) == 0.5

    def test_no_relevant_entities_returns_none(self):
        assert graph_entity_hit_rate(("JVM",), ()) is None

    def test_no_seed_entities_with_relevant_returns_zero(self):
        assert graph_entity_hit_rate((), ("JVM",)) == 0.0


class TestCitationScore:
    async def test_full_support(self):
        judge = _FakeJudgeLLM(['{"supported": true, "reason": "ok"}'])

        score = await citation_precision_recall("论断一[1]。论断二[2]。", {1: "证据一", 2: "证据二"}, judge_llm=judge)

        assert score.precision == 1.0
        assert score.recall == 1.0
        assert score.claims_judged == 2
        assert score.unsupported == ()
        assert score.missing == ()
        assert len(judge.calls) == 2

    async def test_partial_support(self):
        judge = _FakeJudgeLLM(['{"supported": true, "reason": "ok"}', '{"supported": false, "reason": "证据未提及"}'])

        score = await citation_precision_recall("论断一[1]。论断二[2]。", {1: "证据一", 2: "证据二"}, judge_llm=judge)

        assert score.precision == 0.5
        assert score.unsupported == (2,)

    async def test_missing_number_counts_unsupported_and_never_calls_judge(self):
        judge = _FakeJudgeLLM(['{"supported": true, "reason": "ok"}'])

        score = await citation_precision_recall("幻觉引用[9]。真实引用[1]。", {1: "证据一", 2: "证据二"}, judge_llm=judge)

        assert score.missing == (9,)
        assert score.precision == 0.5  # 1 supported of (1 judged + 1 hallucinated)
        assert score.recall == 0.5  # evidence 1 cited, evidence 2 never cited
        assert len(judge.calls) == 1  # only the existing number is judged

    async def test_no_citations_and_no_evidence_returns_none_pair(self):
        score = await citation_precision_recall("没有任何引用的答案。", {}, judge_llm=_FakeJudgeLLM([]))

        assert score.precision is None
        assert score.recall is None

    async def test_citations_with_empty_map_are_all_missing(self):
        score = await citation_precision_recall("全是幻觉[1][2]。", {}, judge_llm=_FakeJudgeLLM([]))

        assert score.precision == 0.0
        assert score.missing == (1, 2)
        assert score.recall is None

    async def test_no_citations_with_evidence_gives_zero_recall(self):
        score = await citation_precision_recall("没有引用。", {1: "证据一"}, judge_llm=_FakeJudgeLLM([]))

        assert score.precision is None
        assert score.recall == 0.0

    async def test_judge_malformed_output_degrades_to_unsupported(self):
        judge = _FakeJudgeLLM(["模型失控输出"])

        score = await citation_precision_recall("论断[1]。", {1: "证据一"}, judge_llm=judge)

        assert score.precision == 0.0
        assert score.unsupported == (1,)


class TestRagasUnavailable:
    async def test_compute_ragas_scores_returns_none_when_unavailable(self, monkeypatch):
        import deerflow.knowledge.eval.ragas_eval as mod

        monkeypatch.setattr(mod, "_load_ragas", lambda: None)

        assert await compute_ragas_scores([{"question": "q"}], judge_llm=None, embeddings=None) is None


class TestCleanMetricValue:
    def test_nan_becomes_none(self):
        from deerflow.knowledge.eval.ragas_eval import _clean_metric_value

        assert _clean_metric_value(float("nan")) is None
        assert _clean_metric_value(0.85) == 0.85
        assert _clean_metric_value(0) == 0.0
        assert _clean_metric_value(True) is None  # bool is not a metric value
        assert _clean_metric_value(None) is None
        assert _clean_metric_value("0.9") is None


class _FakeLangfuseClient:
    def __init__(self) -> None:
        self.scores: list[dict] = []

    def create_score(self, **kwargs):
        self.scores.append(kwargs)


class TestRunLayer2Evaluation:
    async def test_end_to_end_stubbed(self):
        questions = [
            _question("q1", expected_path="vector"),
            _question("q2", expected_path="graph", category="relation", entities=("JVM",), reference=None),
        ]
        outcomes = {
            "q1": _outcome("q1", answer="答案一[1]。", tools=("hybrid_search",), citation_map={1: "证据一"}),
            # Wrong path: only hybrid called for a graph-expected question; no citations at all.
            "q2": _outcome("q2", answer="没有引用。", tools=("hybrid_search",), citation_map={}, seed_entities=()),
        }

        async def runner(question: GoldenQuestion) -> TraceOutcome:
            return outcomes[question.id]

        judge = _FakeJudgeLLM(['{"supported": true, "reason": "ok"}'])
        report = await run_layer2_evaluation(questions, agent_runner=runner, judge_llm=judge, kb_id="kb-1", run_id="run-1")

        assert report.ragas_available is False
        assert report.aggregate["questions"] == 2
        assert report.aggregate["failures"] == 0
        assert report.aggregate["path_accuracy"] == 0.5
        by_id = {r.question_id: r for r in report.results}
        assert by_id["q1"].path_hit is True
        assert by_id["q1"].citation is not None and by_id["q1"].citation.precision == 1.0
        assert by_id["q2"].path_hit is False
        assert by_id["q2"].citation is not None and by_id["q2"].citation.precision is None
        # q2 expects entity JVM but the (fake) graph path never ran -> 0% landing.
        assert by_id["q2"].graph_entity_hit_rate == 0.0

    async def test_agent_runner_failure_degrades_to_failure_note(self):
        questions = [_question("q1"), _question("q2")]

        async def runner(question: GoldenQuestion) -> TraceOutcome:
            if question.id == "q1":
                raise RuntimeError("agent run exploded")
            return _outcome("q2")

        report = await run_layer2_evaluation(questions, agent_runner=runner, judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']), kb_id="kb-1")

        by_id = {r.question_id: r for r in report.results}
        assert "agent run exploded" in (by_id["q1"].failure or "")
        assert by_id["q2"].failure is None
        assert report.aggregate["failures"] == 1

    async def test_ragas_scores_flow_into_results(self):
        async def runner(question: GoldenQuestion) -> TraceOutcome:
            return _outcome(question.id)

        async def ragas_evaluator(samples, *, judge_llm, embeddings):
            return [{"faithfulness": 0.9, "answer_relevancy": 0.8, "context_precision": None, "context_recall": 0.7}]

        report = await run_layer2_evaluation(
            [_question("q1")],
            agent_runner=runner,
            judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']),
            ragas_evaluator=ragas_evaluator,
            kb_id="kb-1",
        )

        assert report.ragas_available is True
        assert report.results[0].ragas["faithfulness"] == 0.9
        assert report.aggregate["ragas"]["faithfulness"] == 0.9

    def test_report_round_trip(self):
        async def _build():
            async def runner(question: GoldenQuestion) -> TraceOutcome:
                return _outcome(question.id, answer="答案[1]。")

            return await run_layer2_evaluation(
                [_question("q1")],
                agent_runner=runner,
                judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']),
                kb_id="kb-1",
                run_id="run-rt",
            )

        import asyncio

        report = asyncio.run(_build())
        restored = report_from_dict(json.loads(json.dumps(report_to_dict(report), ensure_ascii=False)))

        assert restored.run_id == "run-rt"
        assert restored.results[0].question_id == "q1"
        assert restored.results[0].citation is not None and restored.results[0].citation.precision == 1.0
        assert restored.calibration["human_sample_ratio"] is None  # 人工校准占位字段

    async def test_langfuse_push_writes_one_score_per_metric(self):
        async def runner(question: GoldenQuestion) -> TraceOutcome:
            return _outcome(question.id, answer="答案[1]。")

        report = await run_layer2_evaluation(
            [_question("q1")],
            agent_runner=runner,
            judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']),
            kb_id="kb-1",
        )
        client = _FakeLangfuseClient()

        status = push_scores_to_langfuse(report, client=client)

        assert status["pushed"] is True
        names = {s["name"] for s in client.scores}
        assert {"path_hit", "citation_precision", "citation_recall"} <= names
        assert all(s["trace_id"] == "trace-1" for s in client.scores)

    async def test_langfuse_unavailable_is_explicit_noop(self, monkeypatch):
        import deerflow.knowledge.eval.ragas_eval as mod

        monkeypatch.setattr(mod, "_default_langfuse_client", lambda: None)

        async def runner(question: GoldenQuestion) -> TraceOutcome:
            return _outcome(question.id, answer="答案[1]。")

        report = await run_layer2_evaluation(
            [_question("q1")],
            agent_runner=runner,
            judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']),
            kb_id="kb-1",
        )

        assert report.langfuse["pushed"] is False
        assert report.langfuse["skip_reason"]

    def test_render_markdown_sections(self):
        async def _build():
            async def runner(question: GoldenQuestion) -> TraceOutcome:
                return _outcome(question.id, answer="答案[1]。")

            return await run_layer2_evaluation(
                [_question("q1"), _question("q2", category="global", reference=None)],
                agent_runner=runner,
                judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']),
                kb_id="kb-1",
                run_id="run-md",
            )

        import asyncio

        md = render_markdown(asyncio.run(_build()))

        assert "人工校准" in md
        assert "ragas" in md.lower()  # skipped 状态被显式标注
        assert "Global 类" in md  # global 题单独分区
        assert "q1" in md and "q2" in md

    def test_write_reports(self, tmp_path):
        async def _build():
            async def runner(question: GoldenQuestion) -> TraceOutcome:
                return _outcome(question.id, answer="答案[1]。")

            return await run_layer2_evaluation(
                [_question("q1")],
                agent_runner=runner,
                judge_llm=_FakeJudgeLLM(['{"supported": true, "reason": "ok"}']),
                kb_id="kb-1",
            )

        import asyncio

        from deerflow.knowledge.eval.ragas_eval import write_reports

        report = asyncio.run(_build())
        json_path, md_path = write_reports(report, tmp_path)

        assert json_path.exists() and md_path.exists()
        assert json.loads(json_path.read_text(encoding="utf-8"))["run_id"] == report.run_id
