"""Tests for deerflow.models.reasoning_replay.ReasoningReplayChatOpenAI.

Covers spec §4 acceptance 1 / 2 / 3 / 3b / 5 / 10 / 11: capture on both paths,
same-name replay driven by the recorded wire name, byte-equality against a plain
``ChatOpenAI`` when nothing was captured, the legacy ``chat_template_kwargs``
normalization reused from the vLLM provider, the responses-API no-op leg, the
display-only ``reasoning_details`` variant, and tool-call signature replay.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langchain_openai import ChatOpenAI

from deerflow.models.reasoning_replay import ReasoningReplayChatOpenAI

WIRE_NAMES = ("reasoning_content", "reasoning", "reasoning_text")


def _make_model(**kwargs: Any) -> ReasoningReplayChatOpenAI:
    return ReasoningReplayChatOpenAI(
        model="test-model",
        api_key="dummy",
        base_url="http://localhost:8000/v1",
        **kwargs,
    )


def _plain_model(**kwargs: Any) -> ChatOpenAI:
    return ChatOpenAI(
        model="test-model",
        api_key="dummy",
        base_url="http://localhost:8000/v1",
        **kwargs,
    )


def _dump(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, default=str)


def _stream_chunk(delta: dict) -> dict:
    return {
        "id": "chatcmpl-test",
        "model": "test-model",
        "choices": [{"delta": {"role": "assistant", "content": "", **delta}, "finish_reason": None}],
    }


def _chat_result_response(message: dict) -> dict:
    return {
        "id": "chatcmpl-test",
        "model": "test-model",
        "choices": [{"message": {"role": "assistant", "content": "ok", **message}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


# ---------------------------------------------------------------------------
# 1. Capture on both paths
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("wire_name", WIRE_NAMES)
def test_streaming_capture_keeps_original_name_and_records_it(wire_name: str):
    model = _make_model()

    chunk = model._convert_chunk_to_generation_chunk(_stream_chunk({wire_name: "step-1"}), AIMessageChunk, {})

    assert chunk is not None
    additional_kwargs = chunk.message.additional_kwargs
    assert additional_kwargs[wire_name] == "step-1"
    assert additional_kwargs["reasoning_content"] == "step-1"
    assert additional_kwargs["_wire_reasoning_field"] == wire_name


@pytest.mark.parametrize("wire_name", WIRE_NAMES)
def test_non_streaming_capture_keeps_original_name_and_records_it(wire_name: str):
    model = _make_model()

    result = model._create_chat_result(_chat_result_response({wire_name: "step-1"}))

    additional_kwargs = result.generations[0].message.additional_kwargs
    assert additional_kwargs[wire_name] == "step-1"
    assert additional_kwargs["reasoning_content"] == "step-1"
    assert additional_kwargs["_wire_reasoning_field"] == wire_name


def test_empty_string_is_captured_but_never_recorded_as_the_wire_name():
    model = _make_model()

    chunk = model._convert_chunk_to_generation_chunk(_stream_chunk({"reasoning_content": ""}), AIMessageChunk, {})

    assert chunk is not None
    additional_kwargs = chunk.message.additional_kwargs
    assert additional_kwargs["reasoning_content"] == ""
    assert "_wire_reasoning_field" not in additional_kwargs


def test_recorded_wire_name_survives_chunk_merge_and_still_replays():
    """The bookkeeping key merges by concatenation, so replay resolves repeats."""
    model = _make_model()
    first = model._convert_chunk_to_generation_chunk(_stream_chunk({"reasoning": "a"}), AIMessageChunk, {})
    second = model._convert_chunk_to_generation_chunk(_stream_chunk({"reasoning": "b"}), AIMessageChunk, {})

    assert first is not None and second is not None
    merged = first.message + second.message

    assert merged.additional_kwargs["_wire_reasoning_field"] == "reasoningreasoning"
    assert merged.additional_kwargs["reasoning_content"] == "ab"

    payload = model._get_request_payload([merged, HumanMessage(content="continue")])

    assert payload["messages"][0]["reasoning"] == "ab"
    assert "reasoning_content" not in payload["messages"][0]


def test_first_non_empty_wire_name_wins_when_two_names_coexist():
    model = _make_model()

    chunk = model._convert_chunk_to_generation_chunk(
        _stream_chunk({"reasoning_content": "kept", "reasoning": "duplicate"}),
        AIMessageChunk,
        {},
    )

    assert chunk is not None
    assert chunk.message.additional_kwargs["_wire_reasoning_field"] == "reasoning_content"
    assert chunk.message.additional_kwargs["reasoning_content"] == "kept"


# ---------------------------------------------------------------------------
# 2. Same-name replay (D8 甲)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("wire_name", WIRE_NAMES)
def test_replay_echoes_the_recorded_wire_name_only(wire_name: str):
    model = _make_model()
    original = AIMessage(
        content="",
        additional_kwargs={wire_name: "thinking-1", "reasoning_content": "thinking-1", "_wire_reasoning_field": wire_name},
    )

    payload = model._get_request_payload([original, HumanMessage(content="continue")])
    payload_message = payload["messages"][0]

    assert payload_message[wire_name] == "thinking-1"
    if wire_name != "reasoning_content":
        assert "reasoning_content" not in payload_message


def test_replay_ignores_a_display_alias_without_a_recorded_name():
    """A derived display key alone never goes back out."""
    model = _make_model()
    original = AIMessage(content="", additional_kwargs={"reasoning_content": "display only"})

    payload = model._get_request_payload([original, HumanMessage(content="continue")])

    assert "reasoning_content" not in payload["messages"][0]
    assert "reasoning" not in payload["messages"][0]


def test_replay_prefers_the_recorded_name_when_both_wire_names_are_present():
    """Both names non-empty (chutes.ai shape): only the recorded one goes out."""
    model = _make_model()
    original = AIMessage(
        content="",
        additional_kwargs={"reasoning_content": "kept", "reasoning": "kept", "_wire_reasoning_field": "reasoning_content"},
    )

    payload = model._get_request_payload([original, HumanMessage(content="continue")])
    payload_message = payload["messages"][0]

    assert payload_message["reasoning_content"] == "kept"
    assert "reasoning" not in payload_message


def test_replay_follows_the_recorded_name_on_a_multi_turn_history():
    model = _make_model()
    history = [
        AIMessage(content="", additional_kwargs={"reasoning": "first", "_wire_reasoning_field": "reasoning"}),
        HumanMessage(content="again"),
        AIMessage(
            content="",
            additional_kwargs={"reasoning_text": "second", "reasoning_content": "second", "_wire_reasoning_field": "reasoning_text"},
        ),
        HumanMessage(content="once more"),
    ]

    payload = model._get_request_payload(history)

    assert payload["messages"][0]["reasoning"] == "first"
    assert payload["messages"][2]["reasoning_text"] == "second"


# ---------------------------------------------------------------------------
# 3 / 3b. Nothing captured ⇒ byte-identical; legacy kwargs normalization
# ---------------------------------------------------------------------------


def test_no_captured_field_is_byte_identical_to_plain_chatopenai():
    messages = [AIMessage(content="plain answer", id="a1"), HumanMessage(content="again")]

    assert _dump(_make_model()._get_request_payload(messages)) == _dump(_plain_model()._get_request_payload(messages))


def test_legacy_chat_template_kwargs_is_normalized_like_the_vllm_provider():
    model = _make_model(extra_body={"chat_template_kwargs": {"thinking": False}})

    payload = model._get_request_payload([HumanMessage(content="hi")])

    assert payload["extra_body"]["chat_template_kwargs"] == {"enable_thinking": False}


def test_explicit_enable_thinking_is_not_overwritten_by_the_legacy_value():
    model = _make_model(extra_body={"chat_template_kwargs": {"enable_thinking": True, "thinking": True}})

    payload = model._get_request_payload([HumanMessage(content="hi")])

    assert payload["extra_body"]["chat_template_kwargs"] == {"enable_thinking": True}


def test_modern_spelling_and_missing_key_leave_the_payload_untouched():
    modern = _make_model(extra_body={"chat_template_kwargs": {"enable_thinking": True}})

    assert _dump(modern._get_request_payload([HumanMessage(content="hi")])) == _dump(_plain_model(extra_body={"chat_template_kwargs": {"enable_thinking": True}})._get_request_payload([HumanMessage(content="hi")]))


# ---------------------------------------------------------------------------
# 5. responses leg stays untouched
# ---------------------------------------------------------------------------


def test_responses_leg_is_byte_identical_and_never_calls_the_capture_hooks():
    messages = [HumanMessage(content="hi")]

    with (
        patch.object(ReasoningReplayChatOpenAI, "_create_chat_result", side_effect=AssertionError("must not be called")) as result_hook,
        patch.object(ReasoningReplayChatOpenAI, "_convert_chunk_to_generation_chunk", side_effect=AssertionError("must not be called")) as chunk_hook,
    ):
        payload = _make_model(use_responses_api=True)._get_request_payload(messages)
        plain_payload = _plain_model(use_responses_api=True)._get_request_payload(messages)

    assert "messages" not in payload
    assert _dump(payload) == _dump(plain_payload)
    result_hook.assert_not_called()
    chunk_hook.assert_not_called()


# ---------------------------------------------------------------------------
# 10. reasoning_details is display-only
# ---------------------------------------------------------------------------


def test_reasoning_details_becomes_display_text_and_is_never_replayed():
    model = _make_model()
    result = model._create_chat_result(
        _chat_result_response(
            {
                "reasoning_details": [
                    {"type": "reasoning.text", "text": "part-1"},
                    {"type": "reasoning.text", "text": "part-2"},
                ]
            }
        )
    )
    message = result.generations[0].message

    assert message.additional_kwargs["reasoning_content"] == "part-1\n\npart-2"
    assert "_wire_reasoning_field" not in message.additional_kwargs

    payload = model._get_request_payload([message, HumanMessage(content="continue")])
    assert "reasoning_details" not in payload["messages"][0]
    assert "reasoning_content" not in payload["messages"][0]


# ---------------------------------------------------------------------------
# 11. tool-call level signature replay
# ---------------------------------------------------------------------------


def test_tool_call_signature_is_replayed_next_to_the_reasoning_fields():
    model = _make_model()
    original = AIMessage(
        content="",
        tool_calls=[{"name": "bash", "args": {"cmd": "pwd"}, "id": "call_1", "type": "tool_call"}],
        additional_kwargs={
            "reasoning_content": "needed a tool",
            "_wire_reasoning_field": "reasoning_content",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "bash", "arguments": '{"cmd":"pwd"}'},
                    "thought_signature": "SIG_A==",
                }
            ],
        },
    )

    payload = model._get_request_payload([original, HumanMessage(content="continue")])
    payload_message = payload["messages"][0]

    assert payload_message["reasoning_content"] == "needed a tool"
    assert payload_message["tool_calls"][0]["thought_signature"] == "SIG_A=="
