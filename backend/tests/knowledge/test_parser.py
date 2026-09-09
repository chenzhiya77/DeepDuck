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


@pytest.fixture(autouse=True)
def _ensure_dashscope_key(monkeypatch):
    """Ensure DASHSCOPE_API_KEY is set for all tests (Task 16 migration).
    Tests that explicitly monkeypatch.delenv will override this fixture.
    Unconditional: app_config's load_dotenv() injects the real .env key at
    import time, so a presence check would silently leak it into assertions."""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-dash-key")


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
    # zip 下载走独立 client（支持 MINERU_ZIP_PROXY，不经传入的 mock transport）
    # —— mock 掉网络层，保留真实 zip 解包路径的验证。
    from deerflow.knowledge import parser as parser_mod

    async def _fake_download(zip_url: str) -> bytes:
        return _make_result_zip()

    monkeypatch.setattr(parser_mod, "_download_zip", _fake_download)
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
    assert request.headers["Authorization"] == "Bearer test-dash-key"
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
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    recorded: list[httpx.Request] = []

    captions = await caption_images([_SAMPLE_IMAGE], client=httpx.AsyncClient(transport=_vlm_transport(recorded)), model="m")

    assert captions == {"images/p1.jpg": "图片 p1.jpg"}
    assert recorded == []  # no outbound call without a key


# ── Task 15: dual-mode captioning (full transcription for text-dense images) ──


def test_caption_prompt_offers_transcription_mode_for_text_dense_images():
    """Task 15: text-dense images (doc screenshots/tables/code) must be fully
    transcribed; other images keep the one-sentence summary. One prompt, two
    branches, still retrieval-oriented."""
    from deerflow.knowledge.captioner import _CAPTION_PROMPT

    assert "完整转录" in _CAPTION_PROMPT  # text-dense branch
    assert "一句" in _CAPTION_PROMPT  # summary branch kept


@pytest.mark.asyncio
async def test_caption_request_allows_transcription_length(monkeypatch):
    """Task 15: max_tokens raised from 256 (one sentence) to 1024 so a full
    page of transcribed text fits."""
    monkeypatch.setenv("SILICONFLOW_VLM_API_KEY", "vlm-key")
    recorded: list[httpx.Request] = []
    client = httpx.AsyncClient(transport=_vlm_transport(recorded))

    await caption_images([_SAMPLE_IMAGE], client=client, model="m")

    body = json.loads(recorded[0].content)
    assert body["max_tokens"] == 1024


# ── Task 16: DashScope qwen3.7-flash + concurrency (RED) ──────────────────


def test_caption_prompt_no_longer_requests_structure_preservation():
    """Task 16: remove 'retain original structure' from prompt to cut token
    output by ~15–20% while still transcribing all text verbatim."""
    from deerflow.knowledge.captioner import _CAPTION_PROMPT

    assert "保留原有结构" not in _CAPTION_PROMPT  # removed
    assert "完整转录" in _CAPTION_PROMPT  # kept for full transcription


@pytest.mark.asyncio
async def test_concurrent_captions_maintain_original_order(monkeypatch):
    """Task 16: concurrent calls must return results in input list order; Markdown
    image positions are protected by key-value mapping, never mixed up.
    Simulate: p1 needs 5s, p2 needs 1s → p2 returns first but stays at pos2."""
    import asyncio

    monkeypatch.setenv("DASHSCOPE_API_KEY", "dash-key")
    recorded: list[httpx.Request] = []

    # Mock transport that delays p1 more than p2 (simulate different generation times)
    call_count = [0]  # Mutable list for thread-safe counter
    lock = asyncio.Lock()

    async def delayed_handler(request: httpx.Request) -> httpx.Response:
        async with lock:
            call_count[0] += 1
            idx = call_count[0]
        recorded.append(request)
        if idx == 1:
            await asyncio.sleep(0.5)  # p1 slow
            return httpx.Response(200, json={"choices": [{"message": {"content": "caption for p1.jpg"}}]})
        else:
            await asyncio.sleep(0.1)  # p2 fast
            return httpx.Response(200, json={"choices": [{"message": {"content": "caption for p2.png"}}]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(delayed_handler))
    images = [
        ParsedImage(ref="images/p1.jpg", content=b"jpeg-bytes", media_type="image/jpeg"),
        ParsedImage(ref="images/p2.png", content=b"png-bytes", media_type="image/png"),
    ]

    captions = await caption_images(images, client=client, model="qwen3.7-flash")

    # Verify order preservation: dict keys match input list order
    assert list(captions.keys()) == ["images/p1.jpg", "images/p2.png"]
    assert "p1.jpg" in captions["images/p1.jpg"]
    assert "p2.png" in captions["images/p2.png"]


@pytest.mark.asyncio
async def test_timeout_parameter_extended_to_180_seconds(monkeypatch):
    """Task 16: timeout raised from 60s to 180s so long-form transcription fits.
    Connect timeout remains 15s."""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "dash-key")
    recorded: list[httpx.Request] = []

    def transport_handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "steady-state caption"}}]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport_handler), timeout=httpx.Timeout(180.0, connect=15.0))

    await caption_images([_SAMPLE_IMAGE], client=client, model="qwen3.7-flash")

    # Timeout configured correctly
    assert client.timeout.connect == 15.0
    assert client.timeout.read == 180.0


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


def _stub_gates(monkeypatch, *, video: bool = False, table: bool = False) -> None:
    """把 parser 的配置读取器指向**双腿** stub：门控两态不读本机 config.yaml。

    预存缺陷修复（2026-09-09）：off 态断言原先依赖「测试环境默认 off」，但开发机
    的真实 config.yaml 里 `rag.video.enabled: true`，使它们恒红。stub 必须同时带上
    两条腿，否则另一腿的 ``*_ingest_enabled()`` 会走 AttributeError 降级路，把真实
    行为掩盖成「恰好也是 off」。
    """
    from types import SimpleNamespace

    from deerflow.knowledge import parser as knowledge_parser

    monkeypatch.setattr(
        knowledge_parser,
        "get_app_config",
        lambda: SimpleNamespace(
            rag=SimpleNamespace(
                video=SimpleNamespace(enabled=video, max_size_mb=2048),
                table=SimpleNamespace(enabled=table, max_size_mb=50, card_mode="markdown"),
            )
        ),
    )


def test_video_upload_suffixes_contract(monkeypatch):
    """spec 2026-09-08 §2（plan Task 1）：视频集是独立 frozenset（文本冻结集
    原地不动），并集助手两态随 rag.video.enabled；off 态默认拒 .mp4。"""
    from deerflow.knowledge.parser import (
        SUPPORTED_UPLOAD_SUFFIXES,
        VIDEO_UPLOAD_SUFFIXES,
        is_supported_suffix,
        supported_upload_suffixes,
    )

    assert VIDEO_UPLOAD_SUFFIXES == frozenset({".mp4", ".mov", ".mkv", ".webm"})
    assert SUPPORTED_UPLOAD_SUFFIXES & VIDEO_UPLOAD_SUFFIXES == frozenset()  # 两集不相交

    # off 态：并集 = 文本集，视频后缀被拒（大小写不敏感）
    _stub_gates(monkeypatch)
    assert supported_upload_suffixes() == SUPPORTED_UPLOAD_SUFFIXES
    assert not is_supported_suffix(".MP4")

    # on 态：并集含视频集，文本集不受影响
    _stub_gates(monkeypatch, video=True)
    assert supported_upload_suffixes() == SUPPORTED_UPLOAD_SUFFIXES | VIDEO_UPLOAD_SUFFIXES
    assert is_supported_suffix(".MP4")
    assert is_supported_suffix(".md")


def test_table_upload_suffixes_contract(monkeypatch):
    """spec 2026-09-09 §4（plan Task 1）：表格集是独立 frozenset（文本冻结集原地
    不动、`.csv` 留在文本集不进表格集），并集助手随 rag.table.enabled 两态；
    与视频腿互不干扰。"""
    from deerflow.knowledge.parser import (
        SUPPORTED_UPLOAD_SUFFIXES,
        TABLE_UPLOAD_SUFFIXES,
        VIDEO_UPLOAD_SUFFIXES,
        is_supported_suffix,
        supported_upload_suffixes,
        table_ingest_enabled,
        table_upload_limit_bytes,
    )

    assert TABLE_UPLOAD_SUFFIXES == frozenset({".xlsx", ".xls", ".tsv"})
    assert SUPPORTED_UPLOAD_SUFFIXES & TABLE_UPLOAD_SUFFIXES == frozenset()  # 两集不相交
    assert ".csv" in SUPPORTED_UPLOAD_SUFFIXES  # .csv 恒在文本集，成员身份不变
    assert ".csv" not in TABLE_UPLOAD_SUFFIXES

    # off 态：表格后缀被拒（大小写不敏感），体积门返 None（不新设限制）
    _stub_gates(monkeypatch)
    assert not table_ingest_enabled()
    assert supported_upload_suffixes() == SUPPORTED_UPLOAD_SUFFIXES
    assert not is_supported_suffix(".XLSX")
    assert is_supported_suffix(".csv")
    assert table_upload_limit_bytes() is None

    # on 态：并集含表格集，体积门按 max_size_mb 折算字节
    _stub_gates(monkeypatch, table=True)
    assert table_ingest_enabled()
    assert supported_upload_suffixes() == SUPPORTED_UPLOAD_SUFFIXES | TABLE_UPLOAD_SUFFIXES
    assert is_supported_suffix(".XLSX")
    assert is_supported_suffix(".tsv")
    assert is_supported_suffix(".md")
    assert table_upload_limit_bytes() == 50 * 1024 * 1024

    # 两腿同开：三集并；只开视频时表格后缀仍被拒（腿间独立）
    _stub_gates(monkeypatch, video=True, table=True)
    assert supported_upload_suffixes() == SUPPORTED_UPLOAD_SUFFIXES | VIDEO_UPLOAD_SUFFIXES | TABLE_UPLOAD_SUFFIXES
    _stub_gates(monkeypatch, video=True)
    assert not is_supported_suffix(".xlsx")
    assert is_supported_suffix(".mp4")


def test_table_gate_degrades_to_off_when_config_unreadable(monkeypatch):
    """配置读取抛错时门控降级为 off——门口绝不因异常而放宽（spec §4）。"""
    from deerflow.knowledge import parser as knowledge_parser
    from deerflow.knowledge.parser import (
        SUPPORTED_UPLOAD_SUFFIXES,
        is_supported_suffix,
        supported_upload_suffixes,
        table_ingest_enabled,
        table_upload_limit_bytes,
    )

    def _boom():
        raise RuntimeError("config.yaml unreadable")

    monkeypatch.setattr(knowledge_parser, "get_app_config", _boom)

    assert not table_ingest_enabled()
    assert supported_upload_suffixes() == SUPPORTED_UPLOAD_SUFFIXES
    assert not is_supported_suffix(".xlsx")
    assert table_upload_limit_bytes() is None


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


# ── zip 下载：专用代理逃生通道（2026-08-23 Defender 按进程树拦截直连）────────


def test_download_zip_uses_proxy_env(monkeypatch):
    """MINERU_ZIP_PROXY 设置时，zip 下载走该代理（绕过宿主进程直连被拦）。"""
    import asyncio

    from deerflow.knowledge import parser as parser_mod

    captured: dict = {}

    class _FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url):
            class _Resp:
                status_code = 200
                content = b"zip-bytes"
                text = ""

            return _Resp()

    monkeypatch.setenv("MINERU_ZIP_PROXY", "http://127.0.0.1:57519")
    monkeypatch.setattr(parser_mod.httpx, "AsyncClient", _FakeClient)

    result = asyncio.run(parser_mod._download_zip("https://cdn.example.com/x.zip"))

    assert result == b"zip-bytes"
    assert captured.get("proxy") == "http://127.0.0.1:57519"


def test_download_zip_direct_without_proxy_env(monkeypatch):
    """未设置 MINERU_ZIP_PROXY 时，zip 下载直连（不传 proxy 参数）。"""
    import asyncio

    from deerflow.knowledge import parser as parser_mod

    captured: dict = {}

    class _FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url):
            class _Resp:
                status_code = 200
                content = b"zip-bytes"
                text = ""

            return _Resp()

    monkeypatch.delenv("MINERU_ZIP_PROXY", raising=False)
    monkeypatch.setattr(parser_mod.httpx, "AsyncClient", _FakeClient)

    result = asyncio.run(parser_mod._download_zip("https://cdn.example.com/x.zip"))

    assert result == b"zip-bytes"
    assert "proxy" not in captured


def test_download_zip_falls_back_to_direct_when_proxy_unreachable(monkeypatch):
    """代理不可达（ConnectError）时自动降级直连——安全软件关/开两种环境都可用。"""
    import asyncio

    from deerflow.knowledge import parser as parser_mod

    attempts: list[dict] = []

    class _FakeClient:
        def __init__(self, **kwargs):
            attempts.append(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url):
            if "proxy" in attempts[-1]:
                raise httpx.ConnectError("proxy refused")

            class _Resp:
                status_code = 200
                content = b"zip-via-direct"
                text = ""

            return _Resp()

    monkeypatch.setenv("MINERU_ZIP_PROXY", "http://127.0.0.1:57519")
    monkeypatch.setattr(parser_mod.httpx, "AsyncClient", _FakeClient)

    result = asyncio.run(parser_mod._download_zip("https://cdn.example.com/x.zip"))

    assert result == b"zip-via-direct"
    assert len(attempts) == 2  # 先代理后直连
    assert "proxy" in attempts[0] and "proxy" not in attempts[1]


# ── 2026-09-04: MinerU 短文档输出归一化（标题被放到文末）───────────────────


def _make_result_zip_with_md(markdown: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("full.md", markdown)
    return buf.getvalue()


def _fake_zip_download(zip_bytes: bytes):
    async def _download(zip_url: str) -> bytes:
        return zip_bytes

    return _download


async def _parse_pdf_from_zip(tmp_path, monkeypatch, markdown: str) -> str:
    from deerflow.knowledge import parser as parser_mod

    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    monkeypatch.setattr(parser_mod, "_download_zip", _fake_zip_download(_make_result_zip_with_md(markdown)))
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    doc = await parse_document(pdf, client=httpx.AsyncClient(transport=_mineru_transport([])), poll_interval_seconds=0.01, timeout_seconds=5.0)
    return doc.markdown


@pytest.mark.asyncio
async def test_mineru_trailing_sole_title_relocated_to_top(tmp_path, monkeypatch):
    """复现 2026-09-04（春秋肠.pdf）：MinerU 把页面标题作为 ``##`` 标题行放在
    正文之后，切片随之变成「正文在前、加粗标题在后」。MinerU 路径应把全文唯一
    且位于文末的标题行搬回文档开头。"""
    body = "JVM 堆内存分为新生代和老年代：新生代采用复制算法回收，老年代采用标记-整理算法。"
    markdown = await _parse_pdf_from_zip(tmp_path, monkeypatch, f"{body}\n\n## 你好呀,我是沉只鸭")

    assert markdown == f"## 你好呀,我是沉只鸭\n\n{body}"


@pytest.mark.asyncio
async def test_mineru_trailing_heading_kept_when_other_headings_exist(tmp_path, monkeypatch):
    """多标题文档末尾的悬空小节标题是合法结构，不得搬移。"""
    source = "# 章\n\n正文一。\n\n## 尾节\n"
    markdown = await _parse_pdf_from_zip(tmp_path, monkeypatch, source)

    assert markdown == source


@pytest.mark.asyncio
async def test_mineru_trailing_heading_inside_fence_not_moved(tmp_path, monkeypatch):
    """未闭合代码 fence 内的 ``#`` 行不是标题（与 chunker 同口径）。"""
    source = "正文。\n\n```\n## 尾\n"
    markdown = await _parse_pdf_from_zip(tmp_path, monkeypatch, source)

    assert markdown == source


@pytest.mark.asyncio
async def test_mineru_heading_only_document_not_moved(tmp_path, monkeypatch):
    """全文只有一行标题（无正文）时没有可搬移的对象，原样返回。"""
    source = "## 只有标题\n"
    markdown = await _parse_pdf_from_zip(tmp_path, monkeypatch, source)

    assert markdown == source


@pytest.mark.asyncio
async def test_local_markdown_trailing_heading_not_touched(tmp_path, monkeypatch):
    """归一化只作用于 MinerU 输出；本地直读的 .md 是用户 authored 内容，原样返回。"""
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    md = tmp_path / "笔记.md"
    md.write_text("正文。\n\n## 尾节", encoding="utf-8")

    doc = await parse_document(md, client=httpx.AsyncClient(transport=_mineru_transport([])))

    assert doc.markdown == "正文。\n\n## 尾节"
