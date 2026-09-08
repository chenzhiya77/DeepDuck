"""Screen-text OCR leg tests (spec 2026-09-08 §2/§8, plan Task 5).

PaddleOCR 是重依赖（本机/CI 不装），故清洗拼接纯函数、engine 协议、降级用
fake engine 全覆盖。真实 PaddleOCR 缺失时必须降级为空结果（不抛错）——OCR 是
可选增强，单镜头失败 → 屏幕文字「（无）」（spec §2），绝不阻断镜头卡。
"""

from __future__ import annotations

from deerflow.knowledge.video.ocr import PaddleOcrEngine, _lines_from_paddle, normalize_ocr_text, ocr_frame

# ── normalize_ocr_text 纯函数 ────────────────────────────────────────────


def test_normalize_ocr_text_strips_and_joins():
    assert normalize_ocr_text(["  你好 ", "", "   ", "世界"]) == "你好\n世界"


def test_normalize_ocr_text_empty_input_is_empty_string():
    assert normalize_ocr_text([]) == ""
    assert normalize_ocr_text(["", "   ", "\t"]) == ""


def test_normalize_ocr_text_preserves_order():
    assert normalize_ocr_text(["第三行", "第一行", "第二行"]) == "第三行\n第一行\n第二行"  # 不改序，按输入


# ── ocr_frame：fake engine 编排 ──────────────────────────────────────────


class _FakeEngine:
    def __init__(self, lines=None, exc=None):
        self._lines = lines or []
        self._exc = exc
        self.seen: list[bytes] = []

    def recognize(self, image: bytes) -> list[str]:
        self.seen.append(image)
        if self._exc is not None:
            raise self._exc
        return self._lines


async def test_ocr_frame_uses_injected_engine():
    engine = _FakeEngine(lines=["标题", "正文"])
    assert await ocr_frame(b"imgbytes", engine=engine) == "标题\n正文"
    assert engine.seen == [b"imgbytes"]  # 帧 bytes 透传给 engine


async def test_ocr_frame_engine_crash_degrades_to_empty():
    """engine 抛错 → 空串降级，不向上抛（OCR 是可选增强，不阻断镜头卡）。"""
    engine = _FakeEngine(exc=RuntimeError("ocr 炸了"))
    assert await ocr_frame(b"img", engine=engine) == ""


# ── 真实 PaddleOCR 依赖缺失 → 降级（本机 paddleocr 未装）──────────────────


def test_paddle_engine_missing_dep_returns_empty_list():
    """PaddleOCR 未装 → recognize 返回 []（延迟 import 失败不抛错）。"""
    assert PaddleOcrEngine().recognize(b"img") == []


async def test_ocr_frame_default_engine_degrades_when_missing():
    """默认 engine（PaddleOcrEngine）在本机未装时 → 空串。"""
    assert await ocr_frame(b"img") == ""


# ── 真实 PaddleOCR 输出解析（白盒，钉死格式转换契约；真实形状待 Task 7 集成校准）──


def test_lines_from_paddle_extracts_nested_text():
    result = [[["box", ("你好", 0.98)], ["box", ("世界", 0.95)]]]
    assert _lines_from_paddle(result) == ["你好", "世界"]


def test_lines_from_paddle_skips_malformed_entries():
    result = [[["box", ("有效", 0.9)], "malformed", ["box", ("  ", 0.5)], ["box", (999, 0.1)]]]
    assert _lines_from_paddle(result) == ["有效"]  # 跳过畸形/空白/非字符串
