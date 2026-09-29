"""ASR leg (spec 2026-09-08 §2/§3, plan Task 3).

第二条腿：把视频音轨转录为带 PTS 毫秒时间戳的口述段序列。这是**降级腿**——
整腿失败（依赖缺失/模型加载失败/解码失败）抛 ``AsrError``，worker（Task 7）
捕获后置 asr=failed 并让镜头卡口述段写「（ASR 失败）」，文档仍可达 ready
（spec §2 降级矩阵），绝不因 ASR 挂掉整篇文档。

provider 协议隔离（spec §7 asr_provider: funasr | whisper）：真实 provider
（FunASR Paraformer / whisper）是重依赖，延迟 import，缺失即降级 AsrError；
本机/CI 不装，测试用 fake provider 覆盖协议与规整契约。``normalize_transcript``
是核心纯函数：把各 provider 的原始 (start, end, text) 三元组（秒或毫秒）规整为
统一 PTS 毫秒轴的 TranscriptSegment——单位换算、取整、去空白、丢弃无效段、按
start_ms 升序（spec §3 时间轴对齐规则的上游；下游 materialize 再按镜头桶 join）。

blocking 的模型推理经 ``run_file_io`` 落线程池，不阻塞事件循环。
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from deerflow.utils.file_io import run_file_io

logger = logging.getLogger(__name__)

Unit = Literal["ms", "s"]


class AsrError(Exception):
    """ASR 整腿失败——worker 降级 asr=failed，文档仍 ready（spec §2）。"""


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    """一条口述段，落在 PTS 毫秒轴上的闭开区间 ``[start_ms, end_ms)``。"""

    start_ms: int
    end_ms: int
    text: str


class AsrProvider(Protocol):
    """ASR backend 协议：同步 blocking transcribe，返回原始 (start, end, text) 三元组。"""

    name: str
    unit: Unit

    def transcribe(self, path: str) -> list[tuple[float, float, str]]: ...


def normalize_transcript(rows: Iterable[Sequence[Any]], *, unit: Unit = "ms") -> list[TranscriptSegment]:
    """把 provider 原始 (start, end, text) 规整为标准 TranscriptSegment 序列。

    纯函数，ASR 腿的核心契约：

    - 单位换算：``unit="s"`` 时秒 → 毫秒；两者都 round 到整数毫秒；
    - 清洗：text 去首尾空白，空/纯空白文本丢弃；
    - 有效性：``start_ms < 0`` 或 ``end_ms <= start_ms``（零/负长度）的段丢弃（防御）；
    - 排序：按 ``(start_ms, end_ms)`` 升序（provider 输出可能乱序）。

    **不合并相邻段**——按镜头桶拼接是 materialize 腿（Task 7）的职责，此处只
    产出干净、有序、有效的段序列供其 join。
    """
    scale = 1000.0 if unit == "s" else 1.0
    segments: list[TranscriptSegment] = []
    for row in rows:
        try:
            start_ms = int(round(float(row[0]) * scale))
            end_ms = int(round(float(row[1]) * scale))
        except (TypeError, ValueError, IndexError):
            continue  # 畸形行防御性跳过
        text = str(row[2]).strip()
        if not text or start_ms < 0 or end_ms <= start_ms:
            continue
        segments.append(TranscriptSegment(start_ms=start_ms, end_ms=end_ms, text=text))
    segments.sort(key=lambda seg: (seg.start_ms, seg.end_ms))
    return segments


#: funasr 自带配件（spec 2026-09-28 §2 D1/D3）：VAD 3.9 MB 负责长音频切段；
#: cam++ 28 MB 在无 punc 时退到 vad_segment 模式，**顺带产出 `sentence_info`**（VAD 段粒度 + `spk`）。
_VAD_MODEL = "fsmn-vad"
_SPK_MODEL = "cam++"

#: 不吃配件的名字（spec §2 D3）：流式按 chunk 调；ModelScope 托管的 whisper 走自己的路径。
_NO_COMPANION_NAMES = frozenset({"paraformer-zh-streaming"})
_NO_COMPANION_PREFIXES = ("Whisper-",)


def _funasr_kwargs(model: str) -> dict[str, str]:
    """该模型名要带的配件（VAD + 说话人）；例外名单里返回空（spec §2 D3）。"""
    if model in _NO_COMPANION_NAMES or model.startswith(_NO_COMPANION_PREFIXES):
        return {}
    return {"vad_model": _VAD_MODEL, "spk_model": _SPK_MODEL}


class FunAsrProvider:
    """FunASR Paraformer（默认，本地 CPU 离线，spec §7）。重依赖延迟 import。"""

    name = "funasr"
    unit: Unit = "ms"  # Paraformer 时间戳为毫秒

    def __init__(self, model: str = "paraformer-zh") -> None:
        self._model = model

    def transcribe(self, path: str) -> list[tuple[float, float, str]]:
        try:
            from funasr import AutoModel  # 延迟 import：缺失即降级
        except ImportError as exc:
            raise AsrError("FunASR 未安装：视频口述转录需要 funasr（pip install funasr）；或改配置 rag.video.asr_provider=whisper 走兼容档") from exc
        try:
            model = AutoModel(model=self._model, disable_update=True, **_funasr_kwargs(self._model))
            result = model.generate(input=path, batch_size_s=300)
        except Exception as exc:  # 模型加载/解码/推理失败统一降级
            raise AsrError(f"FunASR 转录失败（{self._model}）：{exc}") from exc
        return _rows_from_funasr(result)


class WhisperProvider:
    """whisper（本地 CPU 兼容档，spec §7）。重依赖延迟 import。"""

    name = "whisper"
    unit: Unit = "s"  # whisper segment 时间戳为秒（float）

    def __init__(self, model: str = "small") -> None:
        self._model = model

    def transcribe(self, path: str) -> list[tuple[float, float, str]]:
        try:
            import whisper  # 延迟 import：缺失即降级
        except ImportError as exc:
            raise AsrError("whisper 未安装：走 whisper 档需要 openai-whisper（pip install openai-whisper）；或用默认 rag.video.asr_provider=funasr") from exc
        try:
            model = whisper.load_model(self._model)
            result = model.transcribe(path)
        except Exception as exc:
            raise AsrError(f"whisper 转录失败（{self._model}）：{exc}") from exc
        return _rows_from_whisper(result)


#: 「整段一行」的判据（spec 2026-09-28 §4.2）：只有一段、且覆盖 ≥90% 时长 ⇒ 口述只落一张卡。
_COLLAPSED_SPAN_RATIO = 0.9
_COLLAPSED_WARNING = "ASR 转录整段一行（单段覆盖全片）：口述只会落在一张镜头卡上——连续语音时 VAD 只切出一段（spec 2026-09-28 §4.2）。"


def _is_collapsed(segments: Sequence[TranscriptSegment], duration_ms: int | None) -> bool:
    """单段且跨度≈全片 ⇒ 退化；拿不到时长时不判（spec §4.2）。"""
    if not duration_ms or len(segments) != 1:
        return False
    span = segments[0].end_ms - segments[0].start_ms
    return span >= duration_ms * _COLLAPSED_SPAN_RATIO


def _rows_from_funasr(result: Any) -> list[tuple[float, float, str]]:
    """FunASR ``generate()`` 输出 → (start_ms, end_ms, text) 三元组。

    真机校准（2026-09-29，spec 2026-09-28 §2 D2）：句级分段在 ``sentence_info``
    （每项 ``{text, start, end, ...}``，毫秒；装 punc 或 cam++ 时才出现）；
    没有它时退回 ``timestamp``（逐字对）取首末（"整段一行"的信号由调用方按跨度判，见 ``_is_collapsed``）。
    """
    rows: list[tuple[float, float, str]] = []
    items = result if isinstance(result, (list, tuple)) else [result]
    for item in items:
        if not isinstance(item, dict):
            continue
        sentences = item.get("sentence_info")
        if isinstance(sentences, dict):
            sentences = [sentences]
        if isinstance(sentences, list) and sentences:
            for sent in sentences:
                if isinstance(sent, dict) and "start" in sent and "end" in sent:
                    rows.append((sent["start"], sent["end"], sent.get("text", "")))
            continue
        stamps = item.get("timestamp")
        if isinstance(stamps, list) and stamps:
            rows.append((stamps[0][0], stamps[-1][-1], item.get("text", "")))
    return rows


def _rows_from_whisper(result: Any) -> list[tuple[float, float, str]]:
    """whisper ``transcribe()`` 输出 → (start_s, end_s, text) 三元组（原文不 strip）。"""
    rows: list[tuple[float, float, str]] = []
    segments = result.get("segments") if isinstance(result, dict) else None
    for seg in segments or []:
        if isinstance(seg, dict):
            rows.append((seg.get("start", 0.0), seg.get("end", 0.0), seg.get("text", "")))
    return rows


def resolve_provider(name: str, *, model: str) -> AsrProvider:
    """按配置名路由到 provider 实例（spec §7 asr_provider）。"""
    if name == "funasr":
        return FunAsrProvider(model=model)
    if name == "whisper":
        return WhisperProvider(model=model)
    raise AsrError(f"未知 ASR provider：{name!r}（支持 funasr | whisper）")


async def transcribe_video(
    path: str,
    *,
    provider: AsrProvider | None = None,
    provider_name: str = "funasr",
    model: str = "paraformer-zh",
    duration_ms: int | None = None,
) -> list[TranscriptSegment]:
    """转录视频音轨为规整的口述段序列（第二条腿，降级腿）。

    ``provider`` 可注入（测试用 fake）；否则按 ``provider_name`` 解析真实
    provider。blocking 推理经 ``run_file_io`` 落线程池。任何失败——依赖缺失、
    模型崩溃、解码错误——都收敛为 ``AsrError`` 供 worker 降级（asr=failed），
    绝不让整篇文档因 ASR 挂掉。

    ``duration_ms``（探测腿给的时长）用来判"整段一行"：只有一段且覆盖 ≥90%
    时长时记一条 warning（spec 2026-09-28 §4.2）；不给就不判。
    """
    prov = provider or resolve_provider(provider_name, model=model)
    try:
        raw = await run_file_io(prov.transcribe, path)
    except AsrError:
        raise
    except Exception as exc:
        raise AsrError(f"ASR 转录失败（{getattr(prov, 'name', provider_name)}）：{exc}") from exc
    segments = normalize_transcript(raw, unit=getattr(prov, "unit", "ms"))
    if _is_collapsed(segments, duration_ms):
        logger.warning(_COLLAPSED_WARNING)
    return segments
