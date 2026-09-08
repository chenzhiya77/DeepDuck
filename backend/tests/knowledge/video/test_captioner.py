"""Shot captioner leg tests (spec 2026-09-08 §2/§3, plan Task 6).

VLM 层用 httpx.MockTransport mock（对齐现有 captioner 测试先例 test_parser.py）；
api_key 用 monkeypatch env。核心契约：api_key 缺失 → 全镜头降级空 + degraded；
单镜头 VLM 失败 → 该镜头空、计入 failed；failed/total > 30% → degraded（对齐
graph 30% 规则，spec §2）。降级非硬依赖——caption 缺失时镜头卡仍含 asr+ocr。
"""

from __future__ import annotations

import httpx

from deerflow.knowledge.video.captioner import CaptionOutcome, caption_shots


def _vlm_transport(*, fail_first: int = 0, content: str = "镜头描述") -> httpx.MockTransport:
    """前 fail_first 次调用返回 500，其余返回固定 caption（并发下失败总数确定）。"""
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        index = state["n"]
        state["n"] += 1
        if index < fail_first:
            return httpx.Response(500, text="vlm boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    return httpx.MockTransport(handler)


_FRAMES = {0: [b"\xff\xd8frame0"], 1: [b"\xff\xd8frame1"]}


async def test_caption_shots_empty_input():
    assert await caption_shots({}) == CaptionOutcome(captions={}, failed=0, degraded=False)


async def test_caption_shots_all_success(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    async with httpx.AsyncClient(transport=_vlm_transport(content="讲师讲解")) as client:
        outcome = await caption_shots(_FRAMES, client=client, model="test-vlm")
    assert outcome.captions == {0: "讲师讲解", 1: "讲师讲解"}
    assert outcome.failed == 0
    assert outcome.degraded is False


async def test_caption_shots_missing_key_degrades_all(monkeypatch):
    """api_key 缺失 → 不 outbound，全镜头空 caption + degraded（对齐现有 captioner 降级）。"""
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    outcome = await caption_shots(_FRAMES, model="test-vlm")
    assert outcome.captions == {0: "", 1: ""}
    assert outcome.failed == 2
    assert outcome.degraded is True


async def test_caption_shots_partial_failure_below_threshold(monkeypatch):
    """1/5 失败 = 20% < 30% → 不 degraded。"""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    frames = {i: [b"f"] for i in range(5)}
    async with httpx.AsyncClient(transport=_vlm_transport(fail_first=1)) as client:
        outcome = await caption_shots(frames, client=client, model="test-vlm")
    assert outcome.failed == 1
    assert outcome.degraded is False
    assert sum(1 for c in outcome.captions.values() if c) == 4  # 4 个非空


async def test_caption_shots_failure_above_threshold(monkeypatch):
    """2/5 失败 = 40% > 30% → degraded（对齐 graph 30% 规则）。"""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    frames = {i: [b"f"] for i in range(5)}
    async with httpx.AsyncClient(transport=_vlm_transport(fail_first=2)) as client:
        outcome = await caption_shots(frames, client=client, model="test-vlm")
    assert outcome.failed == 2
    assert outcome.degraded is True


async def test_caption_shots_exactly_30_percent_not_degraded(monkeypatch):
    """3/10 失败 = 30%（非 >30%）→ 不 degraded（阈值严格大于）。"""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    frames = {i: [b"f"] for i in range(10)}
    async with httpx.AsyncClient(transport=_vlm_transport(fail_first=3)) as client:
        outcome = await caption_shots(frames, client=client, model="test-vlm")
    assert outcome.failed == 3
    assert outcome.degraded is False


async def test_caption_shots_no_frames_for_shot_is_empty_not_failed(monkeypatch):
    """无帧镜头（抽帧全失败）→ 空 caption，不计 VLM failed（无输入 ≠ 调用失败）。"""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    frames = {0: [], 1: [b"f"]}
    async with httpx.AsyncClient(transport=_vlm_transport(content="描述")) as client:
        outcome = await caption_shots(frames, client=client, model="test-vlm")
    assert outcome.captions[0] == ""
    assert outcome.captions[1] == "描述"
    assert outcome.failed == 0
