import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from skill_loader import FakeResp, load  # noqa: E402

img = load("image-generation")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ["GEMINI_API_KEY", "MINIMAX_API_KEY", "IMAGE_GENERATION_PROVIDER",
              "MINIMAX_API_HOST", "MINIMAX_IMAGE_MODEL",
              "DASHSCOPE_API_KEY", "DASHSCOPE_API_HOST", "QWEN_IMAGE_MODEL"]:
        monkeypatch.delenv(k, raising=False)


def test_resolve_prefers_gemini(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    assert img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", True) == "gemini"


def test_resolve_falls_back_to_minimax(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    assert img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", False) == "minimax"


def test_resolve_override_wins(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("IMAGE_GENERATION_PROVIDER", "MiniMax")
    assert img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", True) == "minimax"


def test_resolve_errors_when_none(monkeypatch):
    with pytest.raises(ValueError):
        img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", False)


def test_minimax_builds_payload_and_writes(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    raw = b"PNGBYTES"
    captured = {}

    def fake_post(url, headers=None, json=None, **kw):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return FakeResp({"data": {"image_base64": [base64.b64encode(raw).decode()]},
                         "base_resp": {"status_code": 0, "status_msg": "success"}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    out = tmp_path / "o.jpg"
    prompt_file = tmp_path / "p.json"
    prompt_file.write_text("a red apple", encoding="utf-8")
    msg = img.generate_image(str(prompt_file), [], str(out), "16:9")

    assert out.read_bytes() == raw
    assert captured["url"].endswith("/v1/image_generation")
    assert captured["headers"]["Authorization"] == "Bearer m"
    assert captured["json"]["model"] == "image-01"
    assert captured["json"]["response_format"] == "base64"
    assert captured["json"]["aspect_ratio"] == "16:9"
    assert captured["json"]["n"] == 1
    assert captured["json"]["prompt_optimizer"] is True
    assert "Successfully generated image" in msg


def test_minimax_reference_image_as_data_url(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    captured = {}

    def fake_post(url, headers=None, json=None, **kw):
        captured["json"] = json
        return FakeResp({"data": {"image_base64": [base64.b64encode(b"x").decode()]},
                         "base_resp": {"status_code": 0}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    ref = tmp_path / "ref.jpg"
    ref.write_bytes(b"\xff\xd8refbytes")
    prompt_file = tmp_path / "p.json"
    prompt_file.write_text("scene", encoding="utf-8")
    img.generate_image(str(prompt_file), [str(ref)], str(tmp_path / "o.jpg"), "1:1")

    subj = captured["json"]["subject_reference"]
    assert subj[0]["type"] == "character"
    assert subj[0]["image_file"].startswith("data:image/jpeg;base64,")
    import base64 as _b64
    encoded = subj[0]["image_file"].split(",", 1)[1]
    assert _b64.b64decode(encoded) == b"\xff\xd8refbytes"


def test_minimax_raises_on_base_resp_error(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")

    def fake_post(url, headers=None, json=None, **kw):
        return FakeResp({"base_resp": {"status_code": 1004, "status_msg": "auth failed"}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    prompt_file = tmp_path / "p.json"
    prompt_file.write_text("x", encoding="utf-8")
    with pytest.raises(Exception) as e:
        img.generate_image(str(prompt_file), [], str(tmp_path / "o.jpg"), "1:1")
    assert "1004" in str(e.value)


def test_minimax_extracts_json_prompt_field(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    captured = {}

    def fake_post(url, headers=None, json=None, **kw):
        captured["json"] = json
        return FakeResp({"data": {"image_base64": [base64.b64encode(b"x").decode()]},
                         "base_resp": {"status_code": 0}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    prompt_file = tmp_path / "p.json"
    prompt_file.write_text(
        '{"prompt": "a red barn at dawn", "style": "watercolor", '
        '"composition": "rule of thirds", "negative_prompt": "blurry"}',
        encoding="utf-8",
    )
    img.generate_image(str(prompt_file), [], str(tmp_path / "o.jpg"), "16:9")

    # Only the JSON `prompt` field reaches MiniMax — no other fields, no JSON syntax.
    assert captured["json"]["prompt"] == "a red barn at dawn"
    assert captured["json"]["prompt_optimizer"] is True


def test_minimax_plaintext_prompt_passes_through(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    captured = {}

    def fake_post(url, headers=None, json=None, **kw):
        captured["json"] = json
        return FakeResp({"data": {"image_base64": [base64.b64encode(b"x").decode()]},
                         "base_resp": {"status_code": 0}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    prompt_file = tmp_path / "p.txt"
    prompt_file.write_text("a red apple on a table", encoding="utf-8")
    img.generate_image(str(prompt_file), [], str(tmp_path / "o.jpg"), "1:1")

    assert captured["json"]["prompt"] == "a red apple on a table"


def test_minimax_rejects_overlong_prompt_without_calling_api(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")

    def fake_post(url, headers=None, json=None, **kw):  # pragma: no cover
        raise AssertionError("must not call the API when the prompt is over the limit")

    monkeypatch.setattr(img.requests, "post", fake_post)
    prompt_file = tmp_path / "p.json"
    prompt_file.write_text('{"prompt": "' + "x" * 1600 + '"}', encoding="utf-8")
    out = tmp_path / "o.jpg"
    msg = img.generate_image(str(prompt_file), [], str(out), "16:9")

    assert "1500" in msg
    assert "character" in msg.lower()
    assert not out.exists()


def test_minimax_creates_nested_output_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")

    def fake_post(url, headers=None, json=None, **kw):
        return FakeResp({"data": {"image_base64": [base64.b64encode(b"img").decode()]},
                         "base_resp": {"status_code": 0}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    prompt_file = tmp_path / "p.txt"
    prompt_file.write_text("a cat", encoding="utf-8")
    out = tmp_path / "nested" / "dir" / "o.jpg"
    img.generate_image(str(prompt_file), [], str(out), "1:1")

    assert out.read_bytes() == b"img"


def test_unknown_provider_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_GENERATION_PROVIDER", "openai")
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    pf = tmp_path / "p.json"
    pf.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        img.generate_image(str(pf), [], str(tmp_path / "o.jpg"), "1:1")


def test_guess_mime_by_extension():
    assert img._guess_mime("/a/b.png") == "image/png"
    assert img._guess_mime("/a/b.webp") == "image/webp"
    assert img._guess_mime("/a/b.jpg") == "image/jpeg"
    assert img._guess_mime("/a/b.unknown") == "image/jpeg"


def _write_png(path: Path) -> Path:
    from PIL import Image

    Image.new("RGB", (8, 8), (200, 30, 40)).save(path, "PNG")
    return path


def _qwen_fake(monkeypatch, captured, raw=b"QWENBYTES"):
    def fake_post(url, headers=None, json=None, **kw):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["kw"] = kw
        return FakeResp({"output": {"choices": [{"finish_reason": "stop",
                                                 "message": {"role": "assistant",
                                                             "content": [{"image": "https://oss.example/x.png"}]}}]}})

    def fake_get(url, **kw):
        captured["get_url"] = url
        captured["get_kw"] = kw
        return FakeResp(content=raw)

    monkeypatch.setattr(img.requests, "post", fake_post)
    monkeypatch.setattr(img.requests, "get", fake_get)


def test_resolve_falls_back_to_qwen(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    assert img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", False) == "qwen"


def test_resolve_minimax_still_before_qwen(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "m")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    assert img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", False) == "minimax"


def test_resolve_gemini_still_before_qwen(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    assert img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", True) == "gemini"


def test_resolve_no_creds_message_mentions_qwen(monkeypatch):
    with pytest.raises(ValueError) as e:
        img._resolve_provider("IMAGE_GENERATION_PROVIDER", "gemini", False)
    assert "DASHSCOPE_API_KEY" in str(e.value)


def test_qwen_missing_key_returns_message(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_GENERATION_PROVIDER", "qwen")
    pf = tmp_path / "p.json"
    pf.write_text("x", encoding="utf-8")
    msg = img.generate_image(str(pf), [], str(tmp_path / "o.jpg"), "1:1")
    assert msg == "DASHSCOPE_API_KEY is not set"


def test_qwen_builds_payload_and_downloads(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    captured = {}
    _qwen_fake(monkeypatch, captured)
    pf = tmp_path / "p.json"
    pf.write_text("a red apple", encoding="utf-8")
    out = tmp_path / "o.png"
    msg = img.generate_image(str(pf), [], str(out), "16:9")

    assert captured["url"].endswith("/api/v1/services/aigc/multimodal-generation/generation")
    assert captured["headers"]["Authorization"] == "Bearer d"
    assert captured["kw"]["timeout"] == 120
    body = captured["json"]
    assert body["model"] == "qwen-image-3.0"
    message = body["input"]["messages"][0]
    assert message["role"] == "user"
    assert message["content"] == [{"text": "a red apple"}]
    params = body["parameters"]
    assert params["size"] == "1664*928"
    assert params["prompt_extend"] is False
    assert params["watermark"] is False
    assert params["n"] == 1
    assert captured["get_url"] == "https://oss.example/x.png"
    assert captured["get_kw"]["timeout"] == 120
    assert out.read_bytes() == b"QWENBYTES"
    assert "Successfully generated image" in msg


def test_qwen_size_mapping_passthrough_and_bounds(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    sizes = []

    def fake_post(url, headers=None, json=None, **kw):
        sizes.append(json["parameters"]["size"])
        return FakeResp({"output": {"choices": [{"message": {"content": [{"image": "https://oss.example/x.png"}]}}]}})

    monkeypatch.setattr(img.requests, "post", fake_post)
    monkeypatch.setattr(img.requests, "get", lambda url, **kw: FakeResp(content=b"x"))
    pf = tmp_path / "p.json"
    pf.write_text("x", encoding="utf-8")
    for aspect in ["1:1", "9:16", "800*600", "9999*10"]:
        img.generate_image(str(pf), [], str(tmp_path / "o.png"), aspect)
    assert sizes == ["1024*1024", "928*1664", "800*600", "1024*1024"]


def test_qwen_negative_prompt_mapped(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    captured = {}
    _qwen_fake(monkeypatch, captured)
    pf = tmp_path / "p.json"
    pf.write_text('{"prompt": "a red barn at dawn", "style": "watercolor", '
                  '"negative_prompt": "blurry"}', encoding="utf-8")
    img.generate_image(str(pf), [], str(tmp_path / "o.png"), "1:1")
    assert captured["json"]["input"]["messages"][0]["content"] == [{"text": "a red barn at dawn"}]
    assert captured["json"]["parameters"]["negative_prompt"] == "blurry"


def test_qwen_reference_images_as_data_urls(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    captured = {}
    _qwen_fake(monkeypatch, captured)
    ref = _write_png(tmp_path / "ref.png")
    pf = tmp_path / "p.json"
    pf.write_text("scene", encoding="utf-8")
    img.generate_image(str(pf), [str(ref)], str(tmp_path / "o.png"), "1:1")
    content = captured["json"]["input"]["messages"][0]["content"]
    assert content[0]["image"].startswith("data:image/png;base64,")
    assert content[-1] == {"text": "scene"}


def test_qwen_skips_invalid_refs(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")
    captured = {}
    _qwen_fake(monkeypatch, captured)
    good = _write_png(tmp_path / "good.png")
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not an image")
    pf = tmp_path / "p.json"
    pf.write_text("scene", encoding="utf-8")
    img.generate_image(str(pf), [str(good), str(bad)], str(tmp_path / "o.png"), "1:1")
    content = captured["json"]["input"]["messages"][0]["content"]
    assert len([c for c in content if "image" in c]) == 1


def test_qwen_rejects_more_than_three_refs_without_calling_api(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "d")

    def fake_post(url, headers=None, json=None, **kw):  # pragma: no cover
        raise AssertionError("must not call the API when refs exceed the cap")

    monkeypatch.setattr(img.requests, "post", fake_post)
    refs = [str(_write_png(tmp_path / f"r{i}.png")) for i in range(4)]
    pf = tmp_path / "p.json"
    pf.write_text("scene", encoding="utf-8")
    out = tmp_path / "o.png"
    msg = img.generate_image(str(pf), refs, str(out), "1:1")
    assert "3" in msg
    assert not out.exists()


def test_unknown_provider_message_lists_all_providers(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_GENERATION_PROVIDER", "openai")
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    pf = tmp_path / "p.json"
    pf.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError) as e:
        img.generate_image(str(pf), [], str(tmp_path / "o.jpg"), "1:1")
    for name in ["gemini", "minimax", "qwen"]:
        assert name in str(e.value)


def test_gemini_post_has_timeout(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    captured = {}

    def fake_post(url, headers=None, json=None, **kw):
        captured["kw"] = kw
        return FakeResp({"candidates": [{"content": {"parts": [
            {"inlineData": {"data": base64.b64encode(b"g").decode()}}]}}]})

    monkeypatch.setattr(img.requests, "post", fake_post)
    pf = tmp_path / "p.json"
    pf.write_text("x", encoding="utf-8")
    img.generate_image(str(pf), [], str(tmp_path / "o.jpg"), "1:1")
    assert captured["kw"]["timeout"] == 120


def test_gemini_inline_mime_follows_extension(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    captured = {}

    def fake_post(url, headers=None, json=None, **kw):
        captured["json"] = json
        return FakeResp({"candidates": [{"content": {"parts": [
            {"inlineData": {"data": base64.b64encode(b"g").decode()}}]}}]})

    monkeypatch.setattr(img.requests, "post", fake_post)
    ref = _write_png(tmp_path / "ref.png")
    pf = tmp_path / "p.json"
    pf.write_text("x", encoding="utf-8")
    img.generate_image(str(pf), [str(ref)], str(tmp_path / "o.jpg"), "1:1")
    parts = captured["json"]["contents"][0]["parts"]
    assert parts[0]["inlineData"]["mimeType"] == "image/png"
