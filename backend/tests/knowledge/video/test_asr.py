"""ASR leg contract tests (spec 2026-09-08 §2/§3, plan Task 3).

真实 provider（FunASR/whisper）是重依赖 + 需 ffmpeg 解码音频：本机/CI 不装，
故规整纯函数、provider 协议路由、异常降级用 fake provider 全覆盖。真实
provider 在依赖缺失时必须降级为 AsrError（整腿失败，worker 捕获后 asr=failed
但文档仍 ready，spec §2），本测试直接依赖「本机 funasr/whisper 未装」这一事实
钉死降级路径。

时间戳合并纯函数 normalize_transcript 是 ASR 腿的核心契约：把各 provider 的
原始 (start, end, text) 三元组（秒或毫秒）规整为统一的 PTS 毫秒轴
TranscriptSegment 序列——单位换算、取整、去空白、丢弃无效段、按 start_ms
升序（spec §3 时间轴对齐规则的上游）。
"""

from __future__ import annotations

import sys
import types

import pytest

from deerflow.knowledge.video.asr import (
    AsrError,
    FunAsrProvider,
    TranscriptSegment,
    WhisperProvider,
    _rows_from_funasr,
    _rows_from_whisper,
    normalize_transcript,
    resolve_provider,
    transcribe_video,
)

# ── normalize_transcript 纯函数 ──────────────────────────────────────────


def test_normalize_converts_seconds_to_integer_ms():
    segs = normalize_transcript([(0.0, 2.5, "你好"), (2.5, 5.123, "世界")], unit="s")
    assert segs == [TranscriptSegment(0, 2500, "你好"), TranscriptSegment(2500, 5123, "世界")]


def test_normalize_ms_unit_passes_through():
    segs = normalize_transcript([(0, 1500, "开场")], unit="ms")
    assert segs == [TranscriptSegment(0, 1500, "开场")]


def test_normalize_sorts_by_start_and_strips_text():
    segs = normalize_transcript([(5000, 6000, "  后段  "), (0, 1000, "前段")], unit="ms")
    assert [(seg.start_ms, seg.text) for seg in segs] == [(0, "前段"), (5000, "后段")]


def test_normalize_drops_empty_zero_negative_and_invalid():
    segs = normalize_transcript(
        [
            (0, 1000, "   "),  # 空白文本 → 丢
            (1000, 1000, "零长度"),  # end == start → 丢
            (2000, 1500, "负长度"),  # end < start → 丢
            (-500, 500, "负起点"),  # start < 0 → 丢
            (3000, 4000, "保留"),  # 合法
        ],
        unit="ms",
    )
    assert segs == [TranscriptSegment(3000, 4000, "保留")]


def test_normalize_empty_input_is_empty_list():
    assert normalize_transcript([], unit="ms") == []


# ── provider 工厂路由 ────────────────────────────────────────────────────


def test_resolve_provider_routes_by_name():
    assert isinstance(resolve_provider("funasr", model="paraformer-zh"), FunAsrProvider)
    assert isinstance(resolve_provider("whisper", model="small"), WhisperProvider)


def test_resolve_provider_unknown_name_raises_asrerror():
    with pytest.raises(AsrError):
        resolve_provider("nonexistent-provider", model="x")


# ── transcribe_video 编排（fake provider 注入）───────────────────────────


class _FakeProvider:
    """协议对齐：name / unit / transcribe(path) -> 原始三元组序列。"""

    def __init__(self, rows, *, unit="s", name="fake", exc=None):
        self._rows = rows
        self.unit = unit
        self.name = name
        self._exc = exc
        self.seen_paths: list[str] = []

    def transcribe(self, path: str):
        self.seen_paths.append(path)
        if self._exc is not None:
            raise self._exc
        return self._rows


async def test_transcribe_video_uses_injected_provider_and_unit(tmp_path):
    fake = _FakeProvider([(0.0, 2.5, "你好"), (2.5, 4.0, "世界")], unit="s")
    target = tmp_path / "clip.mp4"
    target.write_bytes(b"placeholder")

    segs = await transcribe_video(str(target), provider=fake)

    assert segs == [TranscriptSegment(0, 2500, "你好"), TranscriptSegment(2500, 4000, "世界")]
    assert fake.seen_paths == [str(target)]  # path 透传给 provider


async def test_transcribe_video_wraps_provider_crash_as_asrerror(tmp_path):
    fake = _FakeProvider([], exc=RuntimeError("模型加载炸了"))
    with pytest.raises(AsrError) as excinfo:
        await transcribe_video(str(tmp_path / "clip.mp4"), provider=fake)
    assert "模型加载炸了" in str(excinfo.value)  # 原始错误进降级信息


async def test_transcribe_video_propagates_asrerror_unchanged(tmp_path):
    fake = _FakeProvider([], exc=AsrError("已经是 AsrError"))
    with pytest.raises(AsrError) as excinfo:
        await transcribe_video(str(tmp_path / "clip.mp4"), provider=fake)
    assert str(excinfo.value) == "已经是 AsrError"  # 不二次包裹


# ── 真实 provider 依赖缺失 → 降级 AsrError（本机 funasr/whisper 未装）─────


async def test_real_funasr_provider_degrades_to_asrerror(tmp_path):
    with pytest.raises(AsrError):
        await transcribe_video(str(tmp_path / "clip.mp4"), provider_name="funasr", model="paraformer-zh")


async def test_real_whisper_provider_degrades_to_asrerror(tmp_path):
    with pytest.raises(AsrError):
        await transcribe_video(str(tmp_path / "clip.mp4"), provider_name="whisper", model="small")


# ── 真实 provider 输出解析（白盒，钉死格式转换契约；真实形状待 Task 7 集成校准）──


def test_rows_from_funasr_prefers_sentence_segments():
    result = [{"text": "你好世界", "sentence": [{"start": 0, "end": 1200, "text": "你好"}, {"start": 1200, "end": 2500, "text": "世界"}]}]
    assert _rows_from_funasr(result) == [(0, 1200, "你好"), (1200, 2500, "世界")]


def test_rows_from_funasr_falls_back_to_utterance_timestamp():
    result = [{"text": "你好", "timestamp": [[0, 600], [600, 1200]]}]
    assert _rows_from_funasr(result) == [(0, 1200, "你好")]  # 首字 start → 末字 end


def test_rows_from_whisper_extracts_start_end_text():
    result = {"segments": [{"start": 0.0, "end": 2.5, "text": " hello "}, {"start": 2.5, "end": 4.0, "text": "world"}]}
    assert _rows_from_whisper(result) == [(0.0, 2.5, " hello "), (2.5, 4.0, "world")]  # 原文不 strip，规整在 normalize


# ── 调用侧带 VAD（spec 2026-09-28 §2 D1/D3）─────────────────────────────


def _install_fake_funasr(monkeypatch, calls: list[dict]) -> None:
    """把 `funasr.AutoModel` 换成记录构造参数的桩：不真加载模型，秒级返回。"""
    module = types.ModuleType("funasr")

    class _FakeAutoModel:
        def __init__(self, **kwargs):
            calls.append(kwargs)

        def generate(self, **kwargs):  # noqa: ARG002 - 桩只关心构造参数
            return [{"text": "你好", "timestamp": [[0, 600], [600, 1200]]}]

    module.AutoModel = _FakeAutoModel
    monkeypatch.setitem(sys.modules, "funasr", module)


def test_funasr_provider_asks_for_vad_and_never_for_punc(monkeypatch):
    calls: list[dict] = []
    _install_fake_funasr(monkeypatch, calls)

    rows = FunAsrProvider(model="paraformer-zh").transcribe("clip.mp4")

    assert calls[0]["model"] == "paraformer-zh"
    assert calls[0]["disable_update"] is True
    assert calls[0]["vad_model"] == "fsmn-vad"
    assert "punc_model" not in calls[0]  # D1 只补 VAD，不许加码
    assert rows == [(0, 1200, "你好")]  # 带 VAD 不影响取数路径


@pytest.mark.parametrize("model", ["paraformer-zh-streaming", "Whisper-large-v3"])
def test_funasr_provider_skips_vad_for_the_exception_list(monkeypatch, model):
    calls: list[dict] = []
    _install_fake_funasr(monkeypatch, calls)

    FunAsrProvider(model=model).transcribe("clip.mp4")

    assert "vad_model" not in calls[0]  # 流式按 chunk 调；托管 whisper 走自己的路径
