"""Screen-text OCR leg (spec 2026-09-08 §2/§8, plan Task 5).

第四条腿（ocr）的执行层：读镜头中帧的屏幕文字（PaddleOCR）。OCR 是**可选
增强**——单镜头失败 → 屏幕文字「（无）」（spec §2），绝不阻断镜头卡；与 ASR
（整腿降级 asr=failed）不同，OCR 每帧独立降级为空串，>30% 失败由 worker 标腿
degraded。

PaddleOCR 是重依赖（本机/CI 不装）：延迟 import，未装 / 推理失败 → 空结果
（不抛错）。清洗拼接是纯函数 ``normalize_ocr_text``；blocking 推理经
``run_file_io`` 落线程池。
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any, Protocol

from deerflow.utils.file_io import run_file_io

logger = logging.getLogger(__name__)


class OcrEngine(Protocol):
    """OCR 引擎协议：读一帧图像 bytes，返回文本行列表（失败返 ``[]``）。"""

    def recognize(self, image: bytes) -> list[str]: ...


def normalize_ocr_text(lines: Iterable[str]) -> str:
    """OCR 结果清洗拼接纯函数：逐行 strip、丢弃空行、按输入序换行拼接；空 → 空串。

    不改行序（阅读顺序由 OCR 引擎给出）；空串表示该帧无屏幕文字（spec §2「（无）」）。
    """
    cleaned = [line.strip() for line in lines]
    return "\n".join(text for text in cleaned if text)


class PaddleOcrEngine:
    """PaddleOCR 屏幕文字（重依赖延迟 import，未装 / 失败 → 空结果，不抛错）。"""

    def __init__(self) -> None:
        self._ocr: Any = None

    def recognize(self, image: bytes) -> list[str]:
        try:
            result = self._engine().ocr(image)
        except Exception as exc:  # 未装（ImportError）/ 推理失败统一降级空
            logger.warning("PaddleOCR recognize failed (%s); degrading to empty screen text", exc)
            return []
        return _lines_from_paddle(result)

    def _engine(self) -> Any:
        if self._ocr is None:
            from paddleocr import PaddleOCR  # 延迟 import：缺失即抛，被 recognize 捕获降级

            self._ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
        return self._ocr


def _lines_from_paddle(result: Any) -> list[str]:
    """PaddleOCR ``.ocr()`` 输出 → 文本行列表（真实形状待 Task 7/12 集成校准）。

    结果通常形如 ``[[[box, (text, confidence)], ...]]``（外层每页、内层每文本框）。
    对畸形/空白/非字符串条目防御性跳过。
    """
    lines: list[str] = []
    pages = result if isinstance(result, list) else [result]
    for page in pages:
        if not isinstance(page, list):
            continue
        for item in page:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            payload = item[1]
            if not isinstance(payload, (list, tuple)) or not payload:
                continue
            text = payload[0]
            if isinstance(text, str) and text.strip():
                lines.append(text)
    return lines


async def ocr_frame(image: bytes, *, engine: OcrEngine | None = None) -> str:
    """OCR 一帧屏幕文字；``engine`` 可注入（fake）；未装 / 失败 → 空串（spec §2 降级，不抛）。

    blocking 推理经 ``run_file_io`` 落线程池。engine.recognize 抛错也在此兜底降级
    （双保险，OCR 绝不阻断镜头卡）。
    """
    eng = engine or PaddleOcrEngine()

    def _blocking() -> str:
        try:
            lines = eng.recognize(image)
        except Exception as exc:  # engine 崩溃也降级空串
            logger.warning("OCR engine raised (%s); degrading to empty screen text", exc)
            return ""
        return normalize_ocr_text(lines)

    return await run_file_io(_blocking)
