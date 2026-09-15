"""Tests for the pluggable embedding providers (spec 2026-09-14 §4.1 / §4.2).

Two things are load-bearing here and are what these tests pin:

1. **The cross-check.** ``sparse_source=provider`` is only valid for a provider that emits
   both halves. A generic OpenAI-compatible endpoint returns dense only, so pairing it with
   ``provider`` must be refused at build time — otherwise the deployment discovers at
   retrieval time that it silently lost a whole route.
2. **The dimension rule.** The Qdrant collections are fixed at 1024, so a non-1024 provider
   must be refused loudly, and the refusal must tell the user which exit to take (the
   rebuild entry). DashScope pins its dimension *in the request* (`parameters.dimension`),
   so it needs no probe; a generic endpoint cannot self-certify, so it is probed once —
   the probe also serves as a connectivity check (spec §4.2 维度 #1).

The interface stays what it always was — ``embed(texts, text_type) -> list[EmbeddingResult]``
— so callers are unchanged (甲: a composition adapter, spec §4.2).
"""

from __future__ import annotations

import httpx
import pytest

from deerflow.knowledge.embedder import DashScopeEmbedder, EmbedderAuthError, EmbedderError
from deerflow.knowledge.embedder_factory import build_embedder
from deerflow.knowledge.embedder_openai import OpenAICompatibleEmbedder
from deerflow.knowledge.sparse import BM25SparseEncoder, TEISparseEncoder

OPENAI_BASE = "http://127.0.0.1:8080"
SPARSE_BASE = "http://127.0.0.1:8081"


@pytest.fixture(autouse=True)
def _clear_probe_cache():
    """The dimension probe is cached per process; tests must not see each other's entries."""
    from deerflow.knowledge import embedder_factory as factory_mod

    factory_mod._PROBED_DIMENSIONS.clear()
    yield
    factory_mod._PROBED_DIMENSIONS.clear()


def _stub_config(monkeypatch, **rag_updates):
    """Point ``build_embedder`` at a stubbed ``rag`` block."""
    from deerflow.knowledge import embedder_factory as factory_mod

    real = factory_mod.get_app_config()
    stub = real.model_copy(update={"rag": real.rag.model_copy(update=rag_updates)})
    monkeypatch.setattr(factory_mod, "get_app_config", lambda: stub)


def _openai_transport(recorded: list[httpx.Request], *, dims: int = 1024, order: list[int] | None = None, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "nope"}})
        import json

        texts = json.loads(request.content.decode())["input"]
        indexes = order or list(range(len(texts)))
        return httpx.Response(
            200,
            json={"data": [{"index": indexes[i], "embedding": [float(indexes[i] + 1)] * dims} for i in range(len(texts))]},
        )

    return httpx.MockTransport(handler)


def _openai_embedder(client: httpx.AsyncClient, **kwargs) -> OpenAICompatibleEmbedder:
    kwargs.setdefault("model", "bge-m3")
    return OpenAICompatibleEmbedder(base_url=OPENAI_BASE, client=client, **kwargs)


# ── OpenAI-compatible dense provider ────────────────────────────────────────


@pytest.mark.asyncio
async def test_openai_embedder_pins_the_request_shape():
    recorded: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=_openai_transport(recorded)) as client:
        results = await _openai_embedder(client, api_key="sk-test").embed(["甲", "乙"], text_type="document")

    request = recorded[0]
    assert str(request.url) == f"{OPENAI_BASE}/v1/embeddings"
    assert request.headers["authorization"] == "Bearer sk-test"
    assert request.headers["content-type"].startswith("application/json")
    import json

    body = json.loads(request.content.decode())
    assert body == {"model": "bge-m3", "input": ["甲", "乙"]}, "通用形状只有 model + input"
    assert [len(r.dense) for r in results] == [1024, 1024]
    assert all(r.sparse.indices == [] for r in results), "通用 provider 只出 dense（稀疏由组合层补）"


@pytest.mark.asyncio
async def test_openai_embedder_orders_results_by_index():
    """响应可能乱序 —— 按 text_index 归位，别信数组顺序。"""
    recorded: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=_openai_transport(recorded, order=[1, 0])) as client:
        results = await _openai_embedder(client).embed(["第一", "第二"])

    assert results[0].dense[0] == 1.0, "index=0 的那条要回到第一个位置"
    assert results[1].dense[0] == 2.0


@pytest.mark.asyncio
async def test_openai_embedder_splits_batches_and_reports_auth_failure():
    recorded: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=_openai_transport(recorded)) as client:
        await _openai_embedder(client, batch_size=2).embed(["a", "b", "c"])
    assert len(recorded) == 2

    async with httpx.AsyncClient(transport=_openai_transport(recorded, status=401)) as client:
        with pytest.raises(EmbedderAuthError):
            await _openai_embedder(client, api_key="bad").embed(["a"])

    async with httpx.AsyncClient(transport=_openai_transport(recorded, status=500)) as client:
        with pytest.raises(EmbedderError):
            await _openai_embedder(client, max_retries=2, retry_backoff_seconds=0).embed(["a"])


# ── build_embedder: resolution, cross-check, dimension ──────────────────────


@pytest.mark.asyncio
async def test_build_embedder_defaults_to_dashscope_and_keeps_its_sparse(monkeypatch):
    """老配置（什么都不设）⇒ 百炼 + 同出双路，行为与今天一致；且它自证维度、无需探测。"""
    from deerflow.knowledge.providers import resolve_provider

    _stub_config(monkeypatch)

    embedder = build_embedder()

    assert isinstance(embedder, DashScopeEmbedder), "默认仍是百炼实现，不套组合层"
    assert resolve_provider("embedding", "dashscope").pins_dimension is True


@pytest.mark.asyncio
async def test_build_embedder_refuses_dense_only_provider_with_provider_sparse(monkeypatch):
    """交叉校验：通用嵌入只出 dense ⇒ sparse_source 必须改成 external/bm25。"""
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_sparse_source="provider")

    with pytest.raises(ValueError, match="sparse"):
        build_embedder()


@pytest.mark.asyncio
async def test_build_embedder_composes_external_sparse(monkeypatch):
    _stub_config(
        monkeypatch,
        embedding_provider="openai-compatible",
        embedding_base_url=OPENAI_BASE,
        embedding_dimension=1024,  # 声明维度 ⇒ dense 裸装，组合层结构一眼可见
        embedding_sparse_source="external",
        sparse_provider="tei-sparse",
        sparse_base_url=SPARSE_BASE,
    )

    embedder = build_embedder()

    assert isinstance(getattr(embedder, "_dense", None), OpenAICompatibleEmbedder)
    assert isinstance(getattr(embedder, "_sparse", None), TEISparseEncoder)


@pytest.mark.asyncio
async def test_build_embedder_composes_local_bm25(monkeypatch):
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_dimension=1024, embedding_sparse_source="bm25")

    embedder = build_embedder()

    assert isinstance(getattr(embedder, "_sparse", None), BM25SparseEncoder), "bm25 零模型、无需端点"


@pytest.mark.asyncio
async def test_external_sparse_requires_an_endpoint(monkeypatch):
    _stub_config(
        monkeypatch,
        embedding_provider="openai-compatible",
        embedding_base_url=OPENAI_BASE,
        embedding_sparse_source="external",
        sparse_provider="tei-sparse",
        sparse_base_url=None,
    )

    with pytest.raises(ValueError, match="sparse_base_url"):
        build_embedder()


@pytest.mark.asyncio
async def test_declared_dimension_other_than_1024_is_refused(monkeypatch):
    """非 1024 一律拒绝启用，且错误里要给出重建入口这条出路（spec §4.2 维度 #4）。"""
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_sparse_source="bm25", embedding_dimension=1536)

    with pytest.raises(ValueError, match="1024"):
        build_embedder()


@pytest.mark.asyncio
async def test_declared_dimension_overrides_the_measured_length(monkeypatch):
    """显式声明是权威：某些自建服务的探测不稳（spec §4.2 维度 #1），声明了就不再测。"""
    from deerflow.knowledge import embedder_factory as factory_mod

    recorded: list[httpx.Request] = []
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_sparse_source="bm25", embedding_dimension=1024)

    async with httpx.AsyncClient(transport=_openai_transport(recorded, dims=768)) as client:
        await build_embedder(client=client).embed(["一"])

    assert factory_mod._PROBED_DIMENSIONS == {}, "声明之后不做探测，也就不留测量记录"
    assert len(recorded) == 1, "只有那次真实嵌入"


@pytest.mark.asyncio
async def test_probe_reads_the_real_length_and_refuses_non_1024(monkeypatch):
    """未声明 ⇒ 用首次真实调用的返回长度认证；非 1024 当场拒绝（不再多打一次探测请求）。"""
    recorded: list[httpx.Request] = []
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_sparse_source="bm25")

    async with httpx.AsyncClient(transport=_openai_transport(recorded, dims=768)) as client:
        embedder = build_embedder(client=client)
        with pytest.raises(ValueError, match="1024"):
            await embedder.embed(["探测"])

    assert len(recorded) == 1, "认证与首次嵌入同一次往返"


@pytest.mark.asyncio
async def test_probe_certifies_once_per_process(monkeypatch):
    from deerflow.knowledge import embedder_factory as factory_mod

    recorded: list[httpx.Request] = []
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_model="bge-m3", embedding_sparse_source="bm25")

    async with httpx.AsyncClient(transport=_openai_transport(recorded)) as client:
        await build_embedder(client=client).embed(["一次"])
        await build_embedder(client=client).embed(["两次"])

    assert factory_mod._PROBED_DIMENSIONS == {("openai-compatible", OPENAI_BASE, "bge-m3"): 1024}
    assert len(recorded) == 2, "两次真实嵌入，零次额外探测"


@pytest.mark.asyncio
async def test_non_pinning_provider_mismatch_is_not_an_embedder_error(monkeypatch):
    """维度不符必须抛 ValueError —— 抛 EmbedderError 会被 index_chunks 当软失败吞掉。"""
    recorded: list[httpx.Request] = []
    _stub_config(monkeypatch, embedding_provider="openai-compatible", embedding_base_url=OPENAI_BASE, embedding_sparse_source="bm25")

    async with httpx.AsyncClient(transport=_openai_transport(recorded, dims=512)) as client:
        with pytest.raises(ValueError) as excinfo:
            await build_embedder(client=client).embed(["文本"])

    assert not isinstance(excinfo.value, EmbedderError)
    assert "重建" in str(excinfo.value), "错误里要指向重建入口这条出路"
