"""Caption VLM resolution: a `models:` entry reference is the single source.

The caption legs are raw HTTP calls, so they need a (wire model, endpoint, key) triple and
the protocol to speak. Naming a configured `models:` entry must be enough — that is what
lets the settings UI offer a plain model picker with no endpoint/key boxes, and the entry's
`use:` class decides the dialect (spec 2026-09-18). A value that names no entry keeps the
legacy fallback (`rag.vlm_base_url` plus the rag file key or the env var), so a deployment
that only ever set `rag.vlm_model` in config.yaml keeps captioning.
"""

from __future__ import annotations

import base64
import json

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

#: The same triple, a different protocol: the entry's `use:` says Messages, not chat.
ANTHROPIC_ENTRY = {
    "name": "claude-entry",
    "use": "langchain_anthropic:ChatAnthropic",
    "model": "claude-x",
    "base_url": "https://anthropic.example",
    "api_key": "sk-anthropic",
    "supports_vision": True,
}

#: A deployment's own class: not on the provider allowlist, so the dialect cannot be read
#: off `use:` — and an unrecognized class is not evidence of a third shape.
CUSTOM_ENTRY = {
    "name": "custom-entry",
    "use": "mycompany.vlm:MyVlmClient",
    "model": "my-vlm",
    "base_url": "https://custom.example/v1",
    "api_key": "sk-custom",
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


# ── dialect dispatch (spec 2026-09-18) ────────────────────────────────────


def _anthropic_transport(recorded: list[httpx.Request], *, content: list[dict] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        return httpx.Response(200, json={"content": [{"type": "text", "text": "一张架构图"}] if content is None else content})

    return httpx.MockTransport(handler)


def test_dialect_is_read_off_the_entrys_use_class():
    from deerflow.knowledge.vlm_target import resolve_vlm_target

    assert resolve_vlm_target(_config([ANTHROPIC_ENTRY]), "claude-entry").dialect == "anthropic"
    assert resolve_vlm_target(_config([VL_ENTRY]), "vl-entry").dialect == "openai"
    # An unrecognized class path is not evidence of a third shape — keep OpenAI.
    assert resolve_vlm_target(_config([CUSTOM_ENTRY]), "custom-entry").dialect == "openai"
    # A value naming no entry keeps the legacy path, which has always been OpenAI-shaped.
    assert resolve_vlm_target(_config([VL_ENTRY]), "no-such-entry").dialect == "openai"


@pytest.mark.asyncio
async def test_anthropic_image_caption_speaks_the_messages_protocol(monkeypatch):
    from deerflow.knowledge import captioner as captioner_module
    from deerflow.knowledge.captioner import caption_images
    from deerflow.knowledge.parser import ParsedImage

    monkeypatch.setattr(captioner_module, "get_app_config", lambda: _config([ANTHROPIC_ENTRY]))
    recorded: list[httpx.Request] = []

    captions = await caption_images(
        [ParsedImage(ref="images/p1.jpg", content=b"jpeg", media_type="image/jpeg")],
        client=httpx.AsyncClient(transport=_anthropic_transport(recorded)),
        model="claude-entry",
    )

    assert captions == {"images/p1.jpg": "一张架构图"}
    request = recorded[0]
    assert str(request.url) == "https://anthropic.example/v1/messages"
    assert request.headers["X-Api-Key"] == "sk-anthropic"
    assert request.headers["anthropic-version"] == "2023-06-01"
    assert "Authorization" not in request.headers
    body = json.loads(request.content)
    assert body["model"] == "claude-x"
    assert body["max_tokens"] > 0
    content = body["messages"][0]["content"]
    assert content[0] == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": base64.b64encode(b"jpeg").decode("ascii"),
        },
    }
    assert content[-1]["type"] == "text"


@pytest.mark.asyncio
async def test_anthropic_shot_caption_puts_every_frame_before_the_text(monkeypatch):
    from deerflow.knowledge.video import captioner as video_captioner_module
    from deerflow.knowledge.video.captioner import caption_shots

    monkeypatch.setattr(video_captioner_module, "get_app_config", lambda: _config([ANTHROPIC_ENTRY]))
    recorded: list[httpx.Request] = []

    outcome = await caption_shots(
        {0: [b"f1", b"f2", b"f3"]},
        client=httpx.AsyncClient(transport=_anthropic_transport(recorded)),
        model="claude-entry",
    )

    assert outcome.captions == {0: "一张架构图"}
    assert len(recorded) == 1  # one shot, one call — framing never multiplies requests
    body = json.loads(recorded[0].content)
    content = body["messages"][0]["content"]
    assert [block["type"] for block in content] == ["image", "image", "image", "text"]
    assert [block["source"]["media_type"] for block in content[:3]] == ["image/jpeg"] * 3


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("declared", "expected"),
    [
        ("https://api.anthropic.com", "https://api.anthropic.com/v1/messages"),
        ("https://api.anthropic.com/", "https://api.anthropic.com/v1/messages"),
        ("https://api.anthropic.com/v1", "https://api.anthropic.com/v1/v1/messages"),
        ("https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/v1/messages"),
    ],
)
async def test_anthropic_endpoint_join_mirrors_the_chat_leg(monkeypatch, declared, expected):
    """Same entry, same URL on both legs — including the spelling that doubles.

    The chat leg hands the entry's ``base_url`` straight to the SDK, which joins by raw
    path concatenation (`anthropic/_base_client.py:482`), so a trailing `/v1` yields
    `/v1/v1/messages`. We reproduce that byte for byte instead of "helpfully" stripping
    `/v1`: stripping would make an entry the graph extractor cannot reach work for
    captioning, which is the asymmetry this line exists to remove.
    """
    from deerflow.knowledge import captioner as captioner_module
    from deerflow.knowledge.captioner import caption_images
    from deerflow.knowledge.parser import ParsedImage

    entry = {**ANTHROPIC_ENTRY, "base_url": declared}
    monkeypatch.setattr(captioner_module, "get_app_config", lambda: _config([entry]))
    recorded: list[httpx.Request] = []

    await caption_images(
        [ParsedImage(ref="images/p1.jpg", content=b"jpeg", media_type="image/jpeg")],
        client=httpx.AsyncClient(transport=_anthropic_transport(recorded)),
        model="claude-entry",
    )

    assert str(recorded[0].url) == expected


@pytest.mark.asyncio
async def test_anthropic_reply_keeps_the_text_blocks_and_ignores_the_rest(monkeypatch):
    from deerflow.knowledge import captioner as captioner_module
    from deerflow.knowledge.captioner import caption_images
    from deerflow.knowledge.parser import ParsedImage

    monkeypatch.setattr(captioner_module, "get_app_config", lambda: _config([ANTHROPIC_ENTRY]))
    recorded: list[httpx.Request] = []

    captions = await caption_images(
        [ParsedImage(ref="images/p1.jpg", content=b"jpeg", media_type="image/jpeg")],
        client=httpx.AsyncClient(
            transport=_anthropic_transport(
                recorded,
                content=[{"type": "thinking", "thinking": "..."}, {"type": "text", "text": "X"}],
            )
        ),
        model="claude-entry",
    )

    assert captions == {"images/p1.jpg": "X"}


@pytest.mark.asyncio
async def test_unrecognized_entry_still_posts_the_openai_shape(monkeypatch):
    from deerflow.knowledge import captioner as captioner_module
    from deerflow.knowledge.captioner import caption_images
    from deerflow.knowledge.parser import ParsedImage

    monkeypatch.setattr(captioner_module, "get_app_config", lambda: _config([CUSTOM_ENTRY]))
    recorded: list[httpx.Request] = []

    captions = await caption_images(
        [ParsedImage(ref="images/p1.jpg", content=b"jpeg", media_type="image/jpeg")],
        client=httpx.AsyncClient(transport=_recording_transport(recorded)),
        model="custom-entry",
    )

    assert captions == {"images/p1.jpg": "一张架构图"}
    request = recorded[0]
    assert str(request.url) == "https://custom.example/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer sk-custom"
