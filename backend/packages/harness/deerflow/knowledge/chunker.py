"""Structure-aware markdown chunker (spec §3.2).

Strategy: structure first, size as the backstop —

1. Split on H1/H2 heading boundaries (a ``#`` inside a code fence never
   splits); every block carries its ``heading_path``.
2. Blocks over ``MAX_CHUNK_TOKENS`` are subdivided by paragraph (greedy
   packing); a single paragraph that still overflows is hard-split by token.
3. Blocks under ``MIN_CHUNK_TOKENS`` merge into the previous sibling, but only
   when the merged block stays within the cap — this keeps an oversized
   block's short tail (e.g. a trailing code fence) from re-inflating it.

Target size is 512±256 tokens. Token counting uses tiktoken cl100k_base,
matching the rest of the harness (memory budgeting etc.).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import tiktoken

MAX_CHUNK_TOKENS = 1024
MIN_CHUNK_TOKENS = 100

_HEADING_RE = re.compile(r"^(#{1,2})\s+(\S.*)$")
_FENCE_RE = re.compile(r"^\s*```")

_encoding: tiktoken.Encoding | None = None


def _enc() -> tiktoken.Encoding:
    global _encoding
    if _encoding is None:
        _encoding = tiktoken.get_encoding("cl100k_base")
    return _encoding


def count_tokens(text: str) -> int:
    """cl100k_base token count — the single counting source for chunk sizes."""
    return len(_enc().encode(text))


@dataclass(slots=True)
class Chunk:
    """One chunk per spec §3.2. ``kb_id``/``entities`` are filled downstream:
    ``kb_id`` by the indexing pipeline, ``entities`` by the graph backfill."""

    chunk_id: str
    doc_id: str
    text: str
    heading_path: list[str]
    chunk_index: int
    token_count: int
    kb_id: str = ""
    page: int | None = None  # full.md carries no page markers in Phase 1
    entities: list[str] = field(default_factory=list)


def _split_by_headings(markdown: str) -> list[tuple[list[str], str]]:
    """Split into (heading_path, text) blocks on H1/H2 boundaries."""
    blocks: list[tuple[list[str], str]] = []
    path: list[str] = []
    buf: list[str] = []
    in_fence = False

    def flush() -> None:
        text = "\n".join(buf).strip()
        if text:
            blocks.append((list(path), text))

    for line in markdown.splitlines():
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            buf.append(line)
            continue
        match = None if in_fence else _HEADING_RE.match(line)
        if match:
            flush()
            level = len(match.group(1))
            title = match.group(2).strip()
            path = [title] if level == 1 else path[:1] + [title]
            buf = [line]
        else:
            buf.append(line)
    flush()
    return blocks


def _hard_split_tokens(text: str, max_tokens: int) -> list[str]:
    """Last-resort split for a single paragraph that exceeds the cap."""
    ids = _enc().encode(text)
    return [_enc().decode(ids[i : i + max_tokens]) for i in range(0, len(ids), max_tokens)]


def _pack_paragraphs(text: str, max_tokens: int) -> list[str]:
    """Greedy-pack blank-line-separated paragraphs under the token cap."""
    paragraphs = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    packs: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if count_tokens(candidate) <= max_tokens:
            current = candidate
            continue
        if current:
            packs.append(current)
        if count_tokens(paragraph) > max_tokens:
            packs.extend(_hard_split_tokens(paragraph, max_tokens))
            current = ""
        else:
            current = paragraph
    if current:
        packs.append(current)
    return packs


def _subdivide_oversized(blocks: list[tuple[list[str], str]], max_tokens: int) -> list[tuple[list[str], str]]:
    result: list[tuple[list[str], str]] = []
    for path, text in blocks:
        if count_tokens(text) <= max_tokens:
            result.append((path, text))
            continue
        for pack in _pack_paragraphs(text, max_tokens):
            result.append((path, pack))
    return result


def _merge_small_blocks(blocks: list[tuple[list[str], str]], min_tokens: int, max_tokens: int) -> list[tuple[list[str], str]]:
    """Merge a <min_tokens block into the previous sibling.

    Skipped when the merge would exceed *max_tokens* — otherwise the short
    tail of a just-subdivided oversized block would re-inflate it.
    """
    merged: list[tuple[list[str], str]] = []
    for path, text in blocks:
        if merged and count_tokens(text) < min_tokens:
            prev_path, prev_text = merged[-1]
            candidate = f"{prev_text}\n\n{text}"
            if count_tokens(candidate) <= max_tokens:
                merged[-1] = (prev_path, candidate)
                continue
        merged.append((path, text))
    return merged


def chunk_markdown(
    markdown: str,
    doc_id: str,
    *,
    max_tokens: int = MAX_CHUNK_TOKENS,
    min_tokens: int = MIN_CHUNK_TOKENS,
) -> list[Chunk]:
    """Chunk parsed markdown per spec §3.2; returns [] for empty input."""
    blocks = _split_by_headings(markdown)
    blocks = _subdivide_oversized(blocks, max_tokens)
    blocks = _merge_small_blocks(blocks, min_tokens, max_tokens)
    return [
        Chunk(
            chunk_id=f"{doc_id}#{index:04d}",
            doc_id=doc_id,
            text=text,
            heading_path=path,
            chunk_index=index,
            token_count=count_tokens(text),
        )
        for index, (path, text) in enumerate(blocks)
    ]
