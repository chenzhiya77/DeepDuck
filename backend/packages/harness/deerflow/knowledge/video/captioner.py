"""Shot captioner (spec 2026-09-08 §2/§3, plan Task 6).

caption 腿：给每镜头的关键帧序列（≤3 帧，来自 ``frames.extract_caption_frames``）
生成一句中文场景描述，与图片配文共用 ``rag.vlm_model``（`rag.video.caption_model`
已于 2026-09-23 R18 退役，视频腿不再有自己的那一层）。prompt 双模式对齐现有图像 captioner
先例（``deerflow/knowledge/captioner.py``）：文字密集帧全转录、否则一句描述。

降级非硬依赖（spec §2）：条目无可用钥匙 → 全镜头空 caption + degraded；单镜头 VLM
失败 → 该镜头空、计入 failed；failed/total > 30% → degraded（对齐 graph 30% 规则）。
caption 缺失时镜头卡仍含 asr+ocr（三路并列，幻觉/缺失可被原文对冲，spec §9）。

VLM 目标（模型 id / endpoint / key / 方言）由 ``resolve_vlm_target`` 解析：目标必须命名一条
``models:`` 条目，四者都取自该条目（条目缺地址时按 provider 借其 SDK 自己的默认值，
openai-compatible 格例外 ⇒ 直接报配置错）。``httpx.AsyncClient`` 可注入（测试用
MockTransport）；Semaphore 按 ``worker_concurrency`` 限流并发。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import httpx

from deerflow.config.app_config import get_app_config
from deerflow.knowledge.caption_client import request_caption
from deerflow.knowledge.vlm_target import VlmTarget, resolve_vlm_target

logger = logging.getLogger(__name__)

_SHOT_CAPTION_PROMPT = (
    "这是同一段视频镜头的若干关键帧（按时间顺序）。用于视频检索索引："
    "如果画面以文字内容为主（如 PPT、文档、代码、字幕），请完整转录图中的全部文字；"
    "否则请用一两句简洁的中文描述这个镜头的主要内容（对象、场景、动作、关键文字）。"
    "只输出转录或描述文本，不要多余解释。"
)

#: caption 腿失败率降级阈值（对齐 graph 30% 规则，spec §2）。
_DEGRADE_THRESHOLD = 0.30


@dataclass(slots=True)
class CaptionOutcome:
    """一次 caption 腿的结果：每镜头 caption（失败/缺失为空串）+ 失败计数 + 降级标记。"""

    captions: dict[int, str] = field(default_factory=dict)
    failed: int = 0
    degraded: bool = False


async def _caption_one_shot(client: httpx.AsyncClient, frames: Sequence[bytes], *, target: VlmTarget) -> str:
    """多帧 → 单 caption（一个 message 含 ≤3 个图片块 + 双模式 prompt）。"""
    return await request_caption(client, target=target, prompt=_SHOT_CAPTION_PROMPT, images=[(frame, "image/jpeg") for frame in frames])


async def caption_shots(
    shot_frames: Mapping[int, Sequence[bytes]],
    *,
    client: httpx.AsyncClient | None = None,
    model: str | None = None,
) -> CaptionOutcome:
    """给每镜头帧序列生成 caption；降级非硬依赖（spec §2）。

    - api_key 缺失 → 不 outbound，全镜头空 caption + ``degraded=True``；
    - 单镜头失败（VLM 异常 / 空返回）→ 该镜头空、``failed+1``；
    - 无帧镜头 → 空 caption，**不计** failed（无输入 ≠ 调用失败）；
    - ``failed/total > 30%`` → ``degraded=True``（对齐 graph 规则，严格大于）。

    ``model`` 默认取 ``rag.vlm_model``（视频腿与图片腿同一条链，R18）；``client``
    可注入（测试 MockTransport）；Semaphore 按 ``worker_concurrency`` 限流并发。
    """
    if not shot_frames:
        return CaptionOutcome()

    cfg = get_app_config()
    if model is None:
        # No layer of its own since R18: the video leg follows the same chain as the image
        # leg (`rag.vlm_model` → the RAG default → the first model).
        model = cfg.rag.vlm_model
    target = resolve_vlm_target(cfg, model)
    api_key = target.api_key

    total = len(shot_frames)
    if not api_key:
        logger.warning("配文目标 %r 没有可用的 API key；%d 个镜头 caption 降级为空（腿 degraded）", target.model, total)
        return CaptionOutcome(captions={index: "" for index in shot_frames}, failed=total, degraded=True)

    own_client = client is None
    timeout = httpx.Timeout(cfg.rag.vlm_timeout or 180.0, connect=cfg.rag.vlm_connect_timeout or 15.0)
    http = client or httpx.AsyncClient(timeout=timeout)
    semaphore = asyncio.Semaphore(max(1, cfg.rag.worker_concurrency) * 2)
    failed = 0

    async def one(index: int, frames: Sequence[bytes]) -> tuple[int, str]:
        nonlocal failed
        if not frames:
            return index, ""  # 无帧镜头：空 caption，不计 failed
        async with semaphore:
            try:
                return index, await _caption_one_shot(http, frames, target=target)
            except Exception as exc:
                logger.warning("镜头 %d caption 失败（%s）；降级空", index, exc)
                failed += 1
                return index, ""

    try:
        results = await asyncio.gather(*(one(index, frames) for index, frames in shot_frames.items()))
    finally:
        if own_client:
            await http.aclose()

    captions = dict(results)
    degraded = total > 0 and (failed / total) > _DEGRADE_THRESHOLD
    return CaptionOutcome(captions=captions, failed=failed, degraded=degraded)
