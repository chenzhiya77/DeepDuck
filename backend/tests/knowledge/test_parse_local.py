"""Tests for the local MinerU parse provider (spec 2026-09-14 §4.4 / §8.1).

The local service contract is pinned from upstream source (``mineru/cli/fast_api.py``,
``mineru/cli/api_request.py``, ``mineru/cli/backend_options.py``):

- request: multipart ``POST /tasks`` — ``files`` plus ``Form`` fields; ``lang_list`` is a
  repeated field and ``backend`` speaks the ``vlm-engine`` / ``vlm-http-client`` family
  (short names are rejected with 400);
- 202 payload: ``{task_id, status: "pending", file_names: [<normalized stem>], error,
  status_url, result_url}``;
- status: ``GET /tasks/{id}`` → ``pending`` / ``processing`` / ``completed`` / ``failed``;
- result: ``GET /tasks/{id}/result`` → ``{backend, version, results: {<stem>: {md_content,
  images: {<basename>: "data:<mime>;base64,<payload>"}}}}`` with ``response_format_zip=false``.

The service ships without auth (spec §8.2), so no request here carries a token. The
document→``failed`` half of "service unavailable" is pinned separately by
``test_worker.py::test_parse_failure_marks_failed_with_error``.
"""

from __future__ import annotations

import base64
import re

import httpx
import pytest

from deerflow.knowledge import parser as parser_mod
from deerflow.knowledge.parse_local import MineruLocalParseProvider
from deerflow.knowledge.parser import (
    MineruError,
    MineruParseFailedError,
    MineruTimeoutError,
    parse_document,
)

BASE_URL = "http://127.0.0.1:9999"
TASK_ID = "t-1"
STEM = "手册"

#: MinerU 风格产物：正文 + 图片链接 + HTML 表（v4+vlm 的形状）+ 文末唯一标题。
_RAW_MD = "正文第一段。\n\n![](images/p1.png)\n\n<table><tr><th>列A</th><th>列B</th></tr><tr><td>1</td><td>2</td></tr></table>\n\n结尾正文。\n\n## 页面标题"
_PNG_URI = "data:image/png;base64," + base64.b64encode(b"png-bytes").decode()


def _multipart_parts(request: httpx.Request) -> dict[str, tuple[str | None, bytes]]:
    """Decode a multipart/form-data body into ``name → (filename | None, value bytes)``."""
    boundary = request.headers["content-type"].split("boundary=", 1)[1].encode()
    parts: dict[str, tuple[str | None, bytes]] = {}
    for chunk in request.content.split(b"--" + boundary)[1:]:
        if chunk.startswith(b"\r\n"):
            chunk = chunk[2:]
        if chunk.startswith(b"--"):
            continue  # closing delimiter
        head, _, value = chunk.partition(b"\r\n\r\n")
        value = value[:-2] if value.endswith(b"\r\n") else value
        name = re.search(rb'name="([^"]+)"', head)
        if name is None:
            continue
        filename = re.search(rb'filename="([^"]*)"', head)
        parts[name.group(1).decode()] = (filename.group(1).decode() if filename else None, value)
    return parts


def _status_payload(status: str, *, error: str | None = None) -> dict:
    return {
        "task_id": TASK_ID,
        "status": status,
        "backend": "hybrid-http-client",
        "file_names": [STEM],
        "created_at": "2026-09-15T00:00:00Z",
        "started_at": None,
        "completed_at": None,
        "error": error,
        "status_url": f"{BASE_URL}/tasks/{TASK_ID}",
        "result_url": f"{BASE_URL}/tasks/{TASK_ID}/result",
    }


def _result_payload(*, key: str = STEM, md: str | None = _RAW_MD, images: dict | None = None) -> dict:
    entry: dict = {"images": {"p1.png": _PNG_URI} if images is None else images}
    if md is not None:
        entry["md_content"] = md
    return {"backend": "hybrid-http-client", "version": "2.9.0", "results": {key: entry}}


def _transport(recorded: list[httpx.Request], *, statuses: tuple[str, ...], result: dict | None = None, error: str | None = None, submit_error: Exception | None = None) -> httpx.MockTransport:
    polls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        if request.method == "POST" and request.url.path == "/tasks":
            if submit_error is not None:
                raise submit_error
            return httpx.Response(202, json=_status_payload("pending"))
        if request.method == "GET" and request.url.path == f"/tasks/{TASK_ID}":
            status = statuses[min(polls["n"], len(statuses) - 1)]
            polls["n"] += 1
            return httpx.Response(200, json=_status_payload(status, error=error if status == "failed" else None))
        if request.method == "GET" and request.url.path == f"/tasks/{TASK_ID}/result":
            return httpx.Response(200, json=result if result is not None else _result_payload())
        return httpx.Response(404, json={"unexpected": f"{request.method} {request.url.path}"})

    return httpx.MockTransport(handler)


def _provider(client: httpx.AsyncClient, **kwargs) -> MineruLocalParseProvider:
    kwargs.setdefault("poll_interval_seconds", 0.01)
    kwargs.setdefault("timeout_seconds", 5.0)
    return MineruLocalParseProvider(base_url=BASE_URL, client=client, **kwargs)


def _stub_config(monkeypatch, **rag_updates) -> None:
    """Point ``parse_document``'s dispatch at a stubbed ``rag`` block."""
    real = parser_mod.get_app_config()
    stub = real.model_copy(update={"rag": real.rag.model_copy(update=rag_updates)})
    monkeypatch.setattr(parser_mod, "get_app_config", lambda: stub)


@pytest.mark.asyncio
async def test_local_parse_pins_multipart_shape_and_reuses_normalization(tmp_path):
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    async with httpx.AsyncClient(transport=_transport(recorded, statuses=("processing", "completed"))) as client:
        doc = await _provider(client).parse(pdf)

    submit = next(r for r in recorded if r.method == "POST")
    assert str(submit.url) == f"{BASE_URL}/tasks"
    assert submit.headers["content-type"].startswith("multipart/form-data; boundary="), "必须是 multipart 表单，不是 JSON"
    parts = _multipart_parts(submit)
    assert parts["files"] == ("手册.pdf", b"%PDF-1.4 fake"), "按原名上传——服务端用它派生结果键"
    assert parts["return_md"][1] == b"true"
    assert parts["return_images"][1] == b"true", "图片要显式索取（服务端默认 false）"
    assert parts["lang_list"][1] == b"ch"
    assert "backend" not in parts, "未配置后端时不下发，由服务端自己决定（D4-B）"
    assert "Authorization" not in submit.headers, "本地服务无鉴权（spec §8.2）"

    assert [r.url.path for r in recorded if r.method == "GET"] == [f"/tasks/{TASK_ID}", f"/tasks/{TASK_ID}", f"/tasks/{TASK_ID}/result"]

    assert doc.markdown.startswith("## 页面标题"), "文末唯一标题要搬回开头（与云端同一步骤）"
    assert "<table>" not in doc.markdown and "| 列A | 列B |" in doc.markdown, "HTML 表要归一成 GFM"
    assert len(doc.images) == 1
    assert "![](images/p1.png)" in doc.markdown, "markdown 的图片链接形态是 ref 的来源"
    assert doc.images[0].ref == "images/p1.png", "ref 必须与 markdown 里的链接逐字一致（captioner/落盘都按它匹配）"
    assert doc.images[0].content == b"png-bytes"
    assert doc.images[0].media_type == "image/png"


@pytest.mark.asyncio
@pytest.mark.parametrize(("configured", "expected"), [("vlm", "vlm-http-client"), ("hybrid", "hybrid-http-client")])
async def test_local_parse_maps_parse_backend_to_the_http_client_family(tmp_path, configured, expected):
    """D2-A 的支持面只有 `-http-client` 族：短名 `vlm` / `hybrid` 必须补后缀再下发。"""
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    async with httpx.AsyncClient(transport=_transport(recorded, statuses=("completed",))) as client:
        await _provider(client, backend=configured).parse(pdf)

    parts = _multipart_parts(next(r for r in recorded if r.method == "POST"))
    assert parts["backend"][1].decode() == expected


@pytest.mark.asyncio
async def test_local_parse_task_failure_raises_parse_failed(tmp_path):
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    transport = _transport(recorded, statuses=("processing", "failed"), error="文档已加密，无法解析")

    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(MineruParseFailedError, match="文档已加密"):
            await _provider(client).parse(pdf)

    assert not any(r.url.path.endswith("/result") for r in recorded), "失败任务不再取结果"


@pytest.mark.asyncio
async def test_local_parse_timeout_raises(tmp_path):
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    async with httpx.AsyncClient(transport=_transport(recorded, statuses=("processing",))) as client:
        with pytest.raises(MineruTimeoutError):
            await _provider(client, timeout_seconds=0.05).parse(pdf)


@pytest.mark.asyncio
async def test_local_parse_service_unavailable_raises_mineru_error(tmp_path):
    """连不上本地服务要抛 MineruError（worker 侧 `except Exception` 据此落 failed）。"""
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    transport = _transport(recorded, statuses=("completed",), submit_error=httpx.ConnectError("connection refused"))

    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(MineruError) as excinfo:
            await _provider(client).parse(pdf)

    assert not isinstance(excinfo.value, MineruParseFailedError), "服务不可用不是「文档解析失败」"
    assert BASE_URL in str(excinfo.value), "错误里要带上服务地址，便于就地排查"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("result", "match"),
    [
        (_result_payload(key="另一个文件"), "另一个文件"),
        (_result_payload(md=None), "md_content"),
        (_result_payload(images={"p1.png": "not-a-data-uri"}), "p1.png"),
    ],
)
async def test_local_parse_malformed_result_fails_loud(tmp_path, result, match):
    """结果形状不合预期就地报错（消息带实际键/文件名），不静默丢内容。"""
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")

    async with httpx.AsyncClient(transport=_transport(recorded, statuses=("completed",), result=result)) as client:
        with pytest.raises(MineruError, match=match):
            await _provider(client).parse(pdf)


@pytest.mark.asyncio
async def test_parse_document_dispatches_on_parse_provider(tmp_path, monkeypatch):
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    _stub_config(monkeypatch, parse_provider="mineru-local", parse_base_url=BASE_URL)

    async with httpx.AsyncClient(transport=_transport(recorded, statuses=("completed",))) as client:
        doc = await parse_document(pdf, client=client, poll_interval_seconds=0.01, timeout_seconds=5.0)

    assert recorded[0].url.host == "127.0.0.1" and recorded[0].url.port == 9999, "本地 provider 要打到配置的地址"
    assert doc.markdown.startswith("## 页面标题")


@pytest.mark.asyncio
async def test_parse_document_local_without_base_url_fails_loud(tmp_path, monkeypatch):
    recorded: list[httpx.Request] = []
    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    _stub_config(monkeypatch, parse_provider="mineru-local", parse_base_url=None)

    with pytest.raises(ValueError, match="parse_base_url"):
        await parse_document(pdf, client=httpx.AsyncClient(transport=_transport(recorded, statuses=("completed",))))


@pytest.mark.asyncio
async def test_parse_document_defaults_to_the_cloud_provider(tmp_path, monkeypatch):
    """老配置（未设 provider）必须仍走云端 —— 默认行为零变化。"""
    monkeypatch.setenv("MINERU_API_TOKEN", "test-token")
    recorded: list[httpx.Request] = []
    _stub_config(monkeypatch, parse_provider="mineru-cloud")

    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        return httpx.Response(404, json={"msg": "nope"})

    pdf = tmp_path / "手册.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(MineruError, match="404"):
            await parse_document(pdf, client=client)

    assert recorded[0].url.host == "mineru.net"
