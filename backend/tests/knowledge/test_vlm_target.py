"""Caption VLM resolution: a `models:` entry reference is the single source.

The caption legs are raw OpenAI-compatible calls, so they need a (wire model, endpoint,
key) triple. Naming a configured `models:` entry must be enough — that is what lets the
settings UI offer a plain model picker with no endpoint/key boxes. A value that names no
entry keeps the legacy fallback (`rag.vlm_base_url` plus the rag file key or the env var),
so a deployment that only ever set `rag.vlm_model` in config.yaml keeps captioning.
"""

from __future__ import annotations

import httpx
import pytest

from deerflow.config.app_config import AppConfig

SANDBOX = {"use": "deerflow.sandbox.local:LocalSandboxProvider"}

#: A configured vision model whose entry carries everything the caption call needs.
VL_ENTRY = {
    "name": "vl-entry",
    "use": "langchain_openai:ChatOpenAI",
    "model": "qwen3.7-flash",
    "base_url": "https://dashscope.example/compatible-mode/v1",
    "api_key": "sk-entry",
    "supports_vision": True,
}


def _config(models: list[dict] | None = None, rag: dict | None = None) -> AppConfig:
    return AppConfig.model_validate({"sandbox": SANDBOX, "models": models or [], "rag": rag or {}})


# ── resolution ────────────────────────────────────────────────────────────


def test_entry_reference_supplies_model_endpoint_and_key():
    from deerflow.knowledge.vlm_target import resolve_vlm_target

    config = _config([VL_ENTRY])

    target = resolve_vlm_target(config, "vl-entry")

    assert target.model == "qwen3.7-flash"  # provider-side id from the entry
    assert target.base_url == "https://dashscope.example/compatible-mode/v1"
    assert target.api_key == "sk-entry"
    assert target.source == "model_entry"


def test_entry_without_endpoint_keeps_the_configured_caption_endpoint():
    """An entry that declares no endpoint means its client default — for captioning that
    is the configured DashScope VLM endpoint, not whatever the entry's class defaults to."""
    from deerflow.knowledge.vlm_target import resolve_vlm_target

    entry = {key: value for key, value in VL_ENTRY.items() if key != "base_url"}
    config = _config([entry], {"vlm_base_url": "https://caption.example/v1"})

    target = resolve_vlm_target(config, "vl-entry")

    assert target.base_url == "https://caption.example/v1"
    assert target.source == "model_entry"


def test_entry_without_key_falls_back_to_the_file_then_the_environment(monkeypatch):
    from deerflow.knowledge.vlm_target import resolve_vlm_target

    entry = {key: value for key, value in VL_ENTRY.items() if key != "api_key"}
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-env")

    assert resolve_vlm_target(_config([entry], {"vlm_api_key": "sk-file"}), "vl-entry").api_key == "sk-file"
    assert resolve_vlm_target(_config([entry]), "vl-entry").api_key == "sk-env"

    monkeypatch.delenv("DASHSCOPE_API_KEY")
    assert resolve_vlm_target(_config([entry]), "vl-entry").api_key is None


def test_value_naming_no_entry_keeps_the_legacy_bare_id_path(monkeypatch):
    from deerflow.knowledge.vlm_target import resolve_vlm_target

    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-env")
    config = _config([VL_ENTRY], {"vlm_base_url": "https://legacy.example/v1"})

    target = resolve_vlm_target(config, "qwen3.7-flash-not-an-entry")

    assert target.model == "qwen3.7-flash-not-an-entry"
    assert target.base_url == "https://legacy.example/v1"
    assert target.api_key == "sk-env"
    assert target.source == "legacy"


def test_defaults_to_the_configured_vlm_model():
    from deerflow.knowledge.vlm_target import resolve_vlm_target

    config = _config([VL_ENTRY])

    target = resolve_vlm_target(config, None)

    # rag.vlm_model's own default names no entry, so this is the legacy path.
    assert target.model == config.rag.vlm_model
    assert target.source == "legacy"


# ── the two caption legs actually use it ──────────────────────────────────


def _recording_transport(recorded: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "一张架构图"}}]})

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_image_caption_posts_to_the_selected_entry(monkeypatch):
    from deerflow.knowledge import captioner as captioner_module
    from deerflow.knowledge.captioner import caption_images
    from deerflow.knowledge.parser import ParsedImage

    monkeypatch.setattr(captioner_module, "get_app_config", lambda: _config([VL_ENTRY]))
    recorded: list[httpx.Request] = []

    captions = await caption_images(
        [ParsedImage(ref="images/p1.jpg", content=b"jpeg", media_type="image/jpeg")],
        client=httpx.AsyncClient(transport=_recording_transport(recorded)),
        model="vl-entry",
    )

    assert captions == {"images/p1.jpg": "一张架构图"}
    request = recorded[0]
    assert str(request.url) == "https://dashscope.example/compatible-mode/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer sk-entry"


@pytest.mark.asyncio
async def test_shot_caption_posts_to_the_selected_entry(monkeypatch):
    from deerflow.knowledge.video import captioner as video_captioner_module
    from deerflow.knowledge.video.captioner import caption_shots

    monkeypatch.setattr(video_captioner_module, "get_app_config", lambda: _config([VL_ENTRY]))
    recorded: list[httpx.Request] = []

    outcome = await caption_shots({0: [b"frame"]}, client=httpx.AsyncClient(transport=_recording_transport(recorded)), model="vl-entry")

    assert outcome.captions == {0: "一张架构图"}
    request = recorded[0]
    assert str(request.url) == "https://dashscope.example/compatible-mode/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer sk-entry"
