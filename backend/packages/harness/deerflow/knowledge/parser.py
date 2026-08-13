"""MinerU official API (v4) client for document parsing.

Local-file flow (精准解析 API):

1. ``POST /api/v4/file-urls/batch`` — apply for an OSS upload URL.
2. ``PUT <file_url>`` — bare-binary upload (no Content-Type, per MinerU docs);
   the service auto-submits the parse task once the file lands.
3. Poll ``GET /api/v4/extract-results/batch/{batch_id}`` until the file's
   state is ``done`` (grab ``full_zip_url``) or ``failed``.
4. Download the result zip and unpack ``full.md`` + ``images/*``.

Markdown/text inputs short-circuit: ``.md``/``.markdown``/``.txt``/``.csv``
files are already parse output (or plain text), so they are read locally
without any MinerU call. The API token always comes from the
``MINERU_API_TOKEN`` env var — never from the caller.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

MINERU_BASE_URL = "https://mineru.net"
_TOKEN_ENV_VAR = "MINERU_API_TOKEN"
#: MinerU business codes (response body ``code``) for token problems.
_AUTH_CODES = {"A0202", "A0211"}
#: Poll states that mean "keep waiting".
_PENDING_STATES = frozenset({"waiting-file", "pending", "running", "converting"})

#: Upload allowlist (spec §6, frozen): local-read text formats + MinerU-parsed
#: document/image formats. Lowercase, dot-prefixed.
SUPPORTED_UPLOAD_SUFFIXES: frozenset[str] = frozenset(
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

#: Suffixes read locally as text — they never hit MinerU.
_LOCAL_READ_SUFFIXES: frozenset[str] = frozenset({".md", ".markdown", ".txt", ".csv"})

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
}


def is_supported_suffix(suffix: str) -> bool:
    """Case-insensitive upload-allowlist membership (dot-prefixed suffix)."""
    return suffix.lower() in SUPPORTED_UPLOAD_SUFFIXES


def is_local_suffix(suffix: str) -> bool:
    """Case-insensitive check for local-read (no MinerU) suffixes."""
    return suffix.lower() in _LOCAL_READ_SUFFIXES


def _read_local_text(path: Path) -> str:
    """Read a local text file: UTF-8 strict, then GBK fallback (legacy
    Windows encodings), else an explicit ``ValueError``. Newlines are
    normalized to ``\n`` (mirrors ``Path.read_text`` universal-newlines)."""
    raw = path.read_bytes()
    text: str | None = None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        pass
    if text is None:
        try:
            text = raw.decode("gbk")
        except UnicodeDecodeError as exc:
            raise ValueError(f"cannot decode {path.name}: not valid UTF-8 or GBK") from exc
    return text.replace("\r\n", "\n").replace("\r", "\n")


class MineruError(Exception):
    """MinerU parse failure: business error code or HTTP error."""

    def __init__(self, message: str, *, code: str | int | None = None, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class MineruAuthError(MineruError):
    """Token missing/invalid/expired (A0202/A0211 or env var unset)."""


class MineruParseFailedError(MineruError):
    """The document itself failed to parse (state=failed, err_msg set)."""


class MineruTimeoutError(MineruError):
    """Polling exceeded the configured timeout."""


@dataclass(slots=True)
class ParsedImage:
    """One image unpacked from the result zip; ``ref`` matches the markdown."""

    ref: str
    content: bytes
    media_type: str


@dataclass(slots=True)
class ParsedDocument:
    markdown: str
    images: list[ParsedImage] = field(default_factory=list)


_TOKEN_ENV_HINT = f"{_TOKEN_ENV_VAR} is not set; add it to .env (see .env.example)"


def _read_token() -> str:
    token = os.environ.get(_TOKEN_ENV_VAR)
    if not token:
        raise MineruAuthError(_TOKEN_ENV_HINT)
    return token


def _check_envelope(payload: dict) -> dict:
    """Unwrap the MinerU envelope; raise on non-zero business codes."""
    code = payload.get("code", 0)
    if code == 0:
        return payload.get("data") or {}
    msg = payload.get("msg") or f"MinerU error {code}"
    if str(code) in _AUTH_CODES:
        raise MineruAuthError(msg, code=code)
    raise MineruError(msg, code=code)


def _check_http(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise MineruError(f"MinerU HTTP {response.status_code}: {response.text[:200]}", status=response.status_code)


async def _apply_upload_url(client: httpx.AsyncClient, *, file_name: str, data_id: str, model_version: str, token: str) -> tuple[str, str]:
    response = await client.post(
        f"{MINERU_BASE_URL}/api/v4/file-urls/batch",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"files": [{"name": file_name, "data_id": data_id}], "model_version": model_version, "language": "ch"},
    )
    _check_http(response)
    data = _check_envelope(response.json())
    file_urls = data.get("file_urls") or []
    if not data.get("batch_id") or not file_urls:
        raise MineruError(f"MinerU returned no batch_id/file_urls: {data!r}")
    return data["batch_id"], file_urls[0]


async def _upload_file(client: httpx.AsyncClient, upload_url: str, content: bytes) -> None:
    # Bare binary PUT: MinerU explicitly requires no Content-Type header.
    response = await client.put(upload_url, content=content)
    if response.status_code not in (200, 201):
        raise MineruError(f"MinerU upload HTTP {response.status_code}", status=response.status_code)


async def _poll_result(client: httpx.AsyncClient, *, batch_id: str, file_name: str, token: str, poll_interval_seconds: float, timeout_seconds: float) -> str:
    deadline = time.monotonic() + timeout_seconds
    url = f"{MINERU_BASE_URL}/api/v4/extract-results/batch/{batch_id}"
    while True:
        response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        _check_http(response)
        data = _check_envelope(response.json())
        results = data.get("extract_result") or []
        entry = next((r for r in results if r.get("file_name") == file_name), results[0] if results else None)
        state = (entry or {}).get("state", "")
        if state == "done":
            zip_url = (entry or {}).get("full_zip_url")
            if not zip_url:
                raise MineruError(f"MinerU task done but full_zip_url missing: {entry!r}")
            return zip_url
        if state == "failed":
            raise MineruParseFailedError((entry or {}).get("err_msg") or "MinerU parse failed")
        if state not in _PENDING_STATES:
            logger.warning("Unknown MinerU poll state %r; continuing to poll", state)
        if time.monotonic() >= deadline:
            raise MineruTimeoutError(f"MinerU parse timed out after {timeout_seconds:.0f}s (batch {batch_id})")
        await asyncio.sleep(poll_interval_seconds)


def _unpack_zip(zip_bytes: bytes) -> ParsedDocument:
    markdown: str | None = None
    images: list[ParsedImage] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        md_name = next((n for n in names if n.endswith("full.md")), None) or next((n for n in names if n.endswith(".md")), None)
        if md_name is None:
            raise MineruError("MinerU result zip contains no markdown file")
        markdown = zf.read(md_name).decode("utf-8")
        for name in names:
            path = Path(name)
            if path.parts and path.parts[0] == "images" and path.suffix.lower() in _MEDIA_TYPES:
                images.append(ParsedImage(ref=name, content=zf.read(name), media_type=_MEDIA_TYPES[path.suffix.lower()]))
    return ParsedDocument(markdown=markdown, images=images)


async def parse_document(
    file_path: str | Path,
    *,
    client: httpx.AsyncClient | None = None,
    model_version: str = "vlm",
    poll_interval_seconds: float = 5.0,
    timeout_seconds: float = 1800.0,
) -> ParsedDocument:
    """Parse a local document via the MinerU v4 API.

    ``.md``/``.markdown``/``.txt``/``.csv`` files are read locally (UTF-8
    strict with GBK fallback) and never hit the network. The token comes from
    the ``MINERU_API_TOKEN`` env var. Image references in the returned markdown
    point at ``ParsedImage.ref`` entries (relative zip paths).
    """
    path = Path(file_path)
    if is_local_suffix(path.suffix):
        return ParsedDocument(markdown=_read_local_text(path), images=[])

    token = _read_token()
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0))
    try:
        batch_id, upload_url = await _apply_upload_url(http, file_name=path.name, data_id=path.stem, model_version=model_version, token=token)
        await _upload_file(http, upload_url, path.read_bytes())
        zip_url = await _poll_result(
            http,
            batch_id=batch_id,
            file_name=path.name,
            token=token,
            poll_interval_seconds=poll_interval_seconds,
            timeout_seconds=timeout_seconds,
        )
        zip_response = await http.get(zip_url)
        _check_http(zip_response)
        return _unpack_zip(zip_response.content)
    finally:
        if own_client:
            await http.aclose()
