"""Tests for the MinerU parse client and the VLM captioner.

HTTP layer is mocked with ``httpx.MockTransport``; the MinerU token must come
from the ``MINERU_API_TOKEN`` env var (never from the caller), and the VLM key
from ``SILICONFLOW_VLM_API_KEY``.
"""

from __future__ import annotations

import io
import json
import zipfile

import httpx
import pytest

from deerflow.knowledge.captioner import apply_captions, caption_images
from deerflow.knowledge.parser import (
    MineruAuthError,
    MineruError,
    MineruParseFailedError,
    MineruTimeoutError,
    ParsedImage,
    parse_document,
)


def _make_result_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("full.md", "# 解析结果\n\n正文第一段。\n\n![](images/p1.jpg)\n\n正文第二段。")
        zf.writestr("images/p1.jpg", b"\xff\xd8\xff\xe0jpeg-bytes")
        zf.writestr("content_list.json", "{}")
    return buf.getvalue()


def _mineru_transport(recorded: list[httpx.Request], *, poll_states: list[dict] | None = None) -> httpx.MockTransport:
    """Happy-path MinerU v4 mock: apply upload URL → PUT → poll → zip."""
    states = poll_states or [
        {"state": "running", "extract_progress": {"extracted_pages": 1, "total_pages": 2}},
        {"state": "done", "full_zip_url": "https://cdn.example.com/result.zip"},
    ]
    poll_calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        if request.method == "POST" and request.url.path == "/api/v4/file-urls/batch":
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"batch_id": "batch-1", "file_urls": ["https://oss.example.com/upload-1"]}})
        if request.method == "PUT" and request.url.host == "oss.example.com":
            return httpx.Response(200)
        if request.method == "GET" and request.url.path == "/api/v4/extract-results/batch/batch-1":
            state = states[min(poll_calls["n"], len(states) - 1)]
            poll_calls["n"] += 1
            return httpx.Response(200, json={"code": 0, "msg": "ok", "data": {"batch_id": "batch-1", "extract_result": [{"file_name": "手册.pdf", **state}]}})
        if request.method == "GET" and request.url.host == "cdn.example.com":
            return httpx.Response(200, content=_make_result_zip())
        return httpx.Response(404, json={"unexpected": f"{request.method} {request.url}"})

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_parse_pdf_full_flow(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    recorded: list[httpx.Request] = []
    client = httpx.AsyncClient(transport=_mineru_transport(recorded))
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    doc = await parse_document(pdf, client=client, poll_interval_seconds=0.01, timeout_seconds=5.0)

    assert "# 解析结果" in doc.markdown
    assert "正文第一段" in doc.markdown
    assert len(doc.images) == 1
    assert doc.images[0].ref == "images/p1.jpg"
    assert doc.images[0].content == b"\xff\xd8\xff\xe0jpeg-bytes"
    assert doc.images[0].media_type == "image/jpeg"

    # Request contract: Bearer auth, batch apply carries the file name, the
    # OSS upload is a bare-binary PUT (no Content-Type, per MinerU docs).
    apply_req = next(r for r in recorded if r.url.path == "/api/v4/file-urls/batch")
    assert apply_req.headers["Authorization"] == "Bearer test-token"
    assert json.loads(apply_req.content)["files"][0]["name"] == "手册.pdf"
    put_req = next(r for r in recorded if r.method == "PUT")
    assert put_req.headers.get("Content-Type") is None
    assert put_req.content == b"%PDF-1.4 fake"


@pytest.mark.asyncio
async def test_parse_markdown_file_short_circuits_mineru(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    recorded: list[httpx.Request] = []
    client = httpx.AsyncClient(transport=_mineru_transport(recorded))
    md = tmp_path / "笔记.md"
    md.write_text("# 直接可用\n\n无需解析。", encoding="utf-8")

    doc = await parse_document(md, client=client)

    assert doc.markdown == "# 直接可用\n\n无需解析。"
    assert doc.images == []
    assert recorded == []  # no HTTP call at all


@pytest.mark.asyncio
async def test_token_read_from_env_never_from_caller(tmp_path, monkeypatch):
    monkeypatch.delenv("MINERU_API_TOKEN", raising=False)
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF")

    with pytest.raises(MineruAuthError, match="MINERU_API_TOKEN"):
        await parse_document(pdf, client=httpx.AsyncClient(transport=_mineru_transport([])))


@pytest.mark.asyncio
async def test_auth_error_code_mapping(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "bad-token")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": "A0202", "msg": "Token 错误"})

    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF")
    with pytest.raises(MineruAuthError):
        await parse_document(pdf, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


@pytest.mark.asyncio
async def test_http_error_mapping(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream unavailable")

    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF")
    with pytest.raises(MineruError, match="503"):
        await parse_document(pdf, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


@pytest.mark.asyncio
async def test_business_error_code_mapping(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": -10001, "msg": "服务异常"})

    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF")
    with pytest.raises(MineruError, match="服务异常"):
        await parse_document(pdf, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


@pytest.mark.asyncio
async def test_failed_state_maps_to_parse_failed(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    recorded: list[httpx.Request] = []
    transport = _mineru_transport(recorded, poll_states=[{"state": "failed", "err_msg": "文件格式不支持"}])
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF")

    with pytest.raises(MineruParseFailedError, match="文件格式不支持"):
        await parse_document(pdf, client=httpx.AsyncClient(transport=transport), poll_interval_seconds=0.01, timeout_seconds=5.0)


@pytest.mark.asyncio
async def test_poll_timeout(tmp_path, monkeypatch):
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    recorded: list[httpx.Request] = []
    transport = _mineru_transport(recorded, poll_states=[{"state": "running"}])
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF")

    with pytest.raises(MineruTimeoutError):
        await parse_document(pdf, client=httpx.AsyncClient(transport=transport), poll_interval_seconds=0.01, timeout_seconds=0.05)


# ── VLM captioner ──────────────────────────────────────────────────────────

_SAMPLE_IMAGE = ParsedImage(ref="images/p1.jpg", content=b"\xff\xd8\xff\xe0jpeg-bytes", media_type="image/jpeg")


def _vlm_transport(recorded: list[httpx.Request], *, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        if status != 200:
            return httpx.Response(status, text="vlm boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": "系统架构示意图"}}]})

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_caption_images_calls_vlm_with_base64(monkeypatch):
    monkeypatch.setenv("SILICONFLOW_VLM_API_KEY", "vlm-key")
    recorded: list[httpx.Request] = []
    client = httpx.AsyncClient(transport=_vlm_transport(recorded))

    captions = await caption_images([_SAMPLE_IMAGE], client=client, model="Qwen/Qwen3-VL-30B-A3B-Instruct")

    assert captions == {"images/p1.jpg": "系统架构示意图"}
    request = recorded[0]
    assert request.headers["Authorization"] == "Bearer vlm-key"
    body = json.loads(request.content)
    assert body["model"] == "Qwen/Qwen3-VL-30B-A3B-Instruct"
    content = body["messages"][0]["content"]
    image_part = next(part for part in content if part["type"] == "image_url")
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_apply_captions_merges_back_into_markdown():
    md = "# 标题\n\n前文 ![](images/p1.jpg) 后文\n\n![旧alt](images/p2.png)\n"
    merged = apply_captions(md, {"images/p1.jpg": "系统架构示意图", "images/p2.png": "部署流程图"})
    assert "![系统架构示意图](images/p1.jpg)" in merged
    assert "![部署流程图](images/p2.png)" in merged
    assert "旧alt" not in merged


@pytest.mark.asyncio
async def test_vlm_failure_degrades_to_filename_placeholder(monkeypatch):
    monkeypatch.setenv("SILICONFLOW_VLM_API_KEY", "vlm-key")
    recorded: list[httpx.Request] = []
    client = httpx.AsyncClient(transport=_vlm_transport(recorded, status=500))

    captions = await caption_images([_SAMPLE_IMAGE], client=client, model="m")

    assert captions == {"images/p1.jpg": "图片 p1.jpg"}


@pytest.mark.asyncio
async def test_missing_vlm_key_degrades_all_images(monkeypatch):
    monkeypatch.delenv("SILICONFLOW_VLM_API_KEY", raising=False)
    recorded: list[httpx.Request] = []

    captions = await caption_images([_SAMPLE_IMAGE], client=httpx.AsyncClient(transport=_vlm_transport(recorded)), model="m")

    assert captions == {"images/p1.jpg": "图片 p1.jpg"}
    assert recorded == []  # no outbound call without a key


# ── Task 6: local-read extension (.txt/.csv) + upload allowlist ────────────


def test_supported_upload_suffixes_contract():
    """spec §6 frozen set; helpers are case-insensitive, suffixes carry the dot."""
    from deerflow.knowledge.parser import SUPPORTED_UPLOAD_SUFFIXES, is_local_suffix, is_supported_suffix

    assert SUPPORTED_UPLOAD_SUFFIXES == frozenset(
        {
            ".md",
            ".markdown",
            ".txt",
            ".csv",
            ".pdf",
            ".doc",
            ".docx",
            ".ppt",
            ".pptx",
            ".png",
            ".jpg",
            ".jpeg",
        }
    )
    assert is_supported_suffix(".TXT")  # case-insensitive
    assert not is_supported_suffix(".exe")
    assert not is_supported_suffix("")
    for suffix in (".md", ".markdown", ".txt", ".csv"):
        assert is_local_suffix(suffix), suffix
    assert not is_local_suffix(".pdf")


@pytest.mark.asyncio
async def test_parse_txt_utf8_short_circuits_mineru(tmp_path, monkeypatch):
    # No token at all — local read must not touch the network or the env var.
    monkeypatch.delenv("MINERU_API_TOKEN", raising=False)
    recorded: list[httpx.Request] = []
    client = httpx.AsyncClient(transport=_mineru_transport(recorded))
    txt = tmp_path / "笔记.txt"
    txt.write_text("第一行\n第二行", encoding="utf-8")

    doc = await parse_document(txt, client=client)

    assert doc.markdown == "第一行\n第二行"
    assert doc.images == []
    assert recorded == []


@pytest.mark.asyncio
async def test_parse_txt_gbk_fallback(tmp_path):
    txt = tmp_path / "国标.txt"
    txt.write_bytes("中文标题\n正文第二行".encode("gbk"))

    doc = await parse_document(txt, client=httpx.AsyncClient(transport=_mineru_transport([])))

    assert doc.markdown == "中文标题\n正文第二行"


@pytest.mark.asyncio
async def test_parse_csv_local_read_gbk(tmp_path):
    """CSV is read verbatim (no table-structure understanding, spec §6)."""
    csv = tmp_path / "数据.csv"
    csv.write_bytes("名称,数量\n苹果,3".encode("gbk"))

    doc = await parse_document(csv, client=httpx.AsyncClient(transport=_mineru_transport([])))

    assert "苹果,3" in doc.markdown


@pytest.mark.asyncio
async def test_parse_local_read_undecodable_raises_value_error(tmp_path):
    bad = tmp_path / "坏编码.txt"
    bad.write_bytes(b"\xff\xff\xfe\xfd")  # neither UTF-8 nor GBK

    with pytest.raises(ValueError, match="坏编码.txt"):
        await parse_document(bad, client=httpx.AsyncClient(transport=_mineru_transport([])))
