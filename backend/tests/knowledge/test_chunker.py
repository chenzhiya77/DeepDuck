"""Tests for the structure-aware markdown chunker (spec §3.2).

Strategy under test: H1/H2 heading-boundary splits; blocks > 1024 tokens are
subdivided by paragraph; blocks < 100 tokens merge into the previous sibling
(only when the merged block stays within the size cap); every chunk carries
``heading_path`` / ``chunk_index`` / ``token_count``; target 512±256.

Fixture token distribution (cl100k_base, measured):
- 第一章 block: 449 tokens
- 1.1 block: 32 tokens  → merged forward into the 第一章 block (≈481)
- 1.2 block: 1055 tokens → paragraph-packed into 1016 + 38 (code fence tail)
- 第二章 block: 236 tokens
"""

from __future__ import annotations

from pathlib import Path

from deerflow.knowledge.chunker import MAX_CHUNK_TOKENS, chunk_markdown, count_tokens

FIXTURE_MD = (Path(__file__).parent / "fixtures" / "sample.md").read_text(encoding="utf-8")


class TestHeadingBoundarySplits:
    def test_splits_on_h1_h2_boundaries(self):
        chunks = chunk_markdown(FIXTURE_MD, "doc-1")
        assert len(chunks) == 4
        assert chunks[0].heading_path == ["第一章 知识库概述"]
        assert chunks[1].heading_path == ["第一章 知识库概述", "1.2 大规模语料处理"]
        assert chunks[3].heading_path == ["第二章 检索架构"]

    def test_h3_does_not_split_but_stays_in_text(self):
        md = "# 章\n\n" + "正文。" * 30 + "\n\n### 小节标题\n\n" + "更多正文。" * 20
        chunks = chunk_markdown(md, "doc-1")
        assert len(chunks) == 1
        assert "### 小节标题" in chunks[0].text

    def test_code_fence_hash_comment_is_not_a_boundary(self):
        chunks = chunk_markdown(FIXTURE_MD, "doc-1")
        fence_chunks = [c for c in chunks if "```python" in c.text]
        assert len(fence_chunks) == 1
        assert "# 这是一行代码注释，不是标题，绝不能触发切块" in fence_chunks[0].text

    def test_content_before_first_heading_gets_empty_path(self):
        md = "前言段落，没有任何标题。\n\n# 第一章\n\n" + "正文。" * 40
        chunks = chunk_markdown(md, "doc-1")
        assert chunks[0].heading_path == []
        assert "前言段落" in chunks[0].text

    def test_empty_markdown_returns_no_chunks(self):
        assert chunk_markdown("", "doc-1") == []
        assert chunk_markdown("   \n\n  ", "doc-1") == []


class TestOversizedSubdivision:
    def test_oversized_block_subdivided_by_paragraph(self):
        chunks = chunk_markdown(FIXTURE_MD, "doc-1")
        oversized_children = [c for c in chunks if c.heading_path == ["第一章 知识库概述", "1.2 大规模语料处理"]]
        # 1055-token block packs by paragraph into 1016 + 38.
        assert len(oversized_children) == 2
        for chunk in oversized_children:
            assert chunk.token_count <= MAX_CHUNK_TOKENS
        # Paragraph packing keeps the heading text with the first child.
        assert oversized_children[0].text.startswith("## 1.2 大规模语料处理")
        # The short tail (code fence, 38 tokens) stays its own block because
        # merging it back would exceed the 1024 cap.
        assert oversized_children[1].token_count < 100

    def test_single_oversized_paragraph_hard_split(self):
        one_long_paragraph = "# 章\n\n" + "无换行长句。" * 400  # single paragraph, >1024 tokens
        chunks = chunk_markdown(one_long_paragraph, "doc-1")
        assert len(chunks) >= 2
        for chunk in chunks:
            assert chunk.token_count <= MAX_CHUNK_TOKENS


class TestSmallBlockMerge:
    def test_small_block_merged_into_previous_sibling(self):
        chunks = chunk_markdown(FIXTURE_MD, "doc-1")
        first = chunks[0]
        # The 32-token 1.1 block merges into the 449-token 第一章 block.
        assert "1.1 设计目标" in first.text
        assert "一期聚焦私有知识库" in first.text
        assert first.heading_path == ["第一章 知识库概述"]
        assert 440 <= first.token_count <= 520

    def test_consecutive_small_blocks_merge_together(self):
        md = "# 章\n\n" + "正文。" * 80 + "\n\n## 小节一\n\n很短。\n\n## 小节二\n\n也很短。"
        chunks = chunk_markdown(md, "doc-1")
        assert len(chunks) == 1
        assert "小节一" in chunks[0].text and "小节二" in chunks[0].text


class TestChunkSchema:
    def test_chunk_ids_and_index_are_sequential(self):
        chunks = chunk_markdown(FIXTURE_MD, "doc-1")
        assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
        assert [c.chunk_id for c in chunks] == [f"doc-1#{i:04d}" for i in range(len(chunks))]

    def test_every_chunk_carries_schema_fields(self):
        for chunk in chunk_markdown(FIXTURE_MD, "doc-1"):
            assert chunk.doc_id == "doc-1"
            assert chunk.text.strip()
            assert isinstance(chunk.heading_path, list)
            assert chunk.token_count > 0
            assert chunk.page is None  # full.md carries no page markers (Phase 1)
            assert chunk.entities == []  # backfilled later by the graph path

    def test_token_count_matches_actual_encoding(self):
        for chunk in chunk_markdown(FIXTURE_MD, "doc-1"):
            assert chunk.token_count == count_tokens(chunk.text)
