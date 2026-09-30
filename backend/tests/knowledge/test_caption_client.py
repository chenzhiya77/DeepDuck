"""The two caption request-body builders (A-4, spec 2026-09-30 D2).

The values used to live in module constants; they now arrive as parameters. The two
negative-control tests below compare against bodies captured on 2026-09-30 (Task 0,
HEAD ``075b3b5b``) *before* the move, canonicalised as sorted-key JSON — key order is
not part of the comparison, content is. The two positive tests pin that the parameters
are what the body carries, in both dialects.
"""

from __future__ import annotations

import json

from deerflow.knowledge.caption_client import _anthropic_request, _openai_request
from deerflow.knowledge.vlm_target import VlmTarget

_PROMPT = "Describe this image."
_IMAGE = (b"\x89PNG\r\n\x1a\nfake-bytes", "image/png")

#: Task 0's capture of the pre-change OpenAI body (values then read from `_MAX_TOKENS` / `_TEMPERATURE`).
_CAPTURED_OPENAI = (
    '{"max_tokens":1024,"messages":[{"content":[{"image_url":{"url":"data:image/png;base64,iVBORw0KGgpmYWtlLWJ5dGVz"},"type":"image_url"},'
    '{"text":"Describe this image.","type":"text"}],"role":"user"}],"model":"probe-model","temperature":0.15}'
)

#: Task 0's capture of the pre-change Messages body.
_CAPTURED_ANTHROPIC = (
    '{"max_tokens":1024,"messages":[{"content":[{"source":{"data":"iVBORw0KGgpmYWtlLWJ5dGVz","media_type":"image/png","type":"base64"},"type":"image"},'
    '{"text":"Describe this image.","type":"text"}],"role":"user"}],"model":"probe-model","temperature":0.15}'
)


def _target(dialect: str) -> VlmTarget:
    return VlmTarget(model="probe-model", base_url="http://127.0.0.1:8899", api_key="sk-probe", dialect=dialect, source="model_entry")


def _canonical(body: dict) -> str:
    return json.dumps(body, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def test_openai_body_is_byte_identical_to_the_pre_change_capture():
    body, _ = _openai_request(_target("openai"), _PROMPT, [_IMAGE], max_tokens=1024, temperature=0.15)

    assert _canonical(body) == _CAPTURED_OPENAI


def test_anthropic_body_is_byte_identical_to_the_pre_change_capture():
    body, _ = _anthropic_request(_target("anthropic"), _PROMPT, [_IMAGE], max_tokens=1024, temperature=0.15)

    assert _canonical(body) == _CAPTURED_ANTHROPIC


def test_openai_body_carries_the_given_values():
    body, _ = _openai_request(_target("openai"), _PROMPT, [_IMAGE], max_tokens=2048, temperature=0.7)

    assert body["max_tokens"] == 2048
    assert body["temperature"] == 0.7


def test_anthropic_body_carries_the_given_values():
    body, _ = _anthropic_request(_target("anthropic"), _PROMPT, [_IMAGE], max_tokens=2048, temperature=0.7)

    assert body["max_tokens"] == 2048
    assert body["temperature"] == 0.7
