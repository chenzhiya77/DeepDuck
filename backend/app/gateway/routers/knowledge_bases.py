"""Knowledge-base management API (spec §5.3, Phase-1 subset).

Thin router: resolve caller → owner-only gate (``can_access`` → 403) →
delegate to :class:`KnowledgeService`. Uploads return 202 — indexing runs
in the background worker (spec §3.7), progress is polled via the documents
list.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.gateway.services.knowledge_service import (
    DocumentProcessingError,
    KnowledgeService,
    ProjectionModelUnavailableError,
    ProjectionNotComputedError,
)
from deerflow.knowledge.access import can_access
from deerflow.knowledge.eval.dataset import GoldenDatasetError
from deerflow.knowledge.eval.ondemand import EvalQuestionBankEmpty
from deerflow.knowledge.eval.question_bank import QuestionBankInvalidQuestion
from deerflow.knowledge.parser import SUPPORTED_UPLOAD_SUFFIXES
from deerflow.knowledge.projection.reducer import UmapUnavailableError

router = APIRouter(prefix="/api/knowledge-bases", tags=["knowledge-bases"])


class KbCreateRequest(BaseModel):
    name: str
    description: str = ""

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class KbUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("name must not be blank")
        return value


class EvalQuestionCreateRequest(BaseModel):
    """P5 二期题库新增（spec 2026-08-27 §4.2）：id 由服务端生成——请求体携带
    id 字段直接 422；枚举与 chunk id 格式校验统一委托 ``validate_question``
    （schema 单一事实源），Pydantic 层不做第二份校验。"""

    model_config = ConfigDict(extra="forbid")

    query: str
    category: str
    expected_path: str
    relevant_chunk_ids: list[str] = Field(default_factory=list)
    relevant_entities: list[str] = Field(default_factory=list)
    reference_answer: str | None = None


class RecallTestRequest(BaseModel):
    """P1 recall-test payload: one query fanned out to the three paths."""

    query: str
    top_k: int = Field(default=5, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def _query_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must not be blank")
        return value


class VectorProjectionQueryRequest(BaseModel):
    """POST vector-projection/query payload: raw question text (spec §7)."""

    text: str

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


def _service(request: Request) -> KnowledgeService:
    service = getattr(request.app.state, "knowledge_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Knowledge service not available")
    return service


def _user_id(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return str(user.id)


async def _require_kb_access(request: Request, kb_id: str) -> KnowledgeService:
    """404 when the KB is missing, 403 when the caller is not the owner."""
    service = _service(request)
    kb = await service.store.get_kb(kb_id)
    if kb is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if not await can_access(service.store, _user_id(request), kb_id):
        raise HTTPException(status_code=403, detail="You do not have access to this knowledge base")
    return service


async def _get_document_or_404(service: KnowledgeService, kb_id: str, doc_id: str) -> dict:
    document = await service.store.get_document(doc_id)
    if document is None or document["kb_id"] != kb_id:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.get("")
async def list_knowledge_bases(request: Request):
    service = _service(request)
    return await service.store.list_kbs(_user_id(request))


@router.post("", status_code=201)
async def create_knowledge_base(request: Request, body: KbCreateRequest):
    service = _service(request)
    return await service.store.create_kb(
        kb_id=uuid.uuid4().hex,
        owner_id=_user_id(request),
        name=body.name,
        description=body.description,
    )


@router.get("/supported-formats")
async def supported_formats():
    """Upload allowlist (Task 6, spec §6). Registered before ``/{kb_id}`` so
    the literal segment wins over the path parameter. Static data — the
    frontend uses it for the file-picker ``accept`` and pre-upload intercept."""
    return {"suffixes": sorted(SUPPORTED_UPLOAD_SUFFIXES)}


@router.get("/{kb_id}")
async def get_knowledge_base(request: Request, kb_id: str):
    service = await _require_kb_access(request, kb_id)
    return await service.store.get_kb(kb_id)


@router.patch("/{kb_id}")
async def update_knowledge_base(request: Request, kb_id: str, body: KbUpdateRequest):
    service = await _require_kb_access(request, kb_id)
    return await service.store.update_kb(kb_id, name=body.name, description=body.description)


@router.delete("/{kb_id}", status_code=204)
async def delete_knowledge_base(request: Request, kb_id: str):
    service = await _require_kb_access(request, kb_id)
    await service.delete_kb_cascade(kb_id=kb_id)
    return Response(status_code=204)


@router.get("/{kb_id}/documents")
async def list_documents(request: Request, kb_id: str):
    service = await _require_kb_access(request, kb_id)
    # service 层组装：path_status 携带 vector/graph，wiki 为库级镜像注入（spec §5）
    return await service.list_documents(kb_id)


@router.post("/{kb_id}/documents", status_code=202)
async def upload_document(request: Request, kb_id: str, file: UploadFile = File(...)):
    """Accept a document and return immediately; indexing runs in the worker."""
    service = await _require_kb_access(request, kb_id)
    content = await file.read()
    try:
        return await service.upload_document(
            kb_id=kb_id,
            uploader_id=_user_id(request),
            filename=file.filename or "document",
            content=content,
        )
    except ValueError as exc:  # unsafe filename
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{kb_id}/documents/{doc_id}", status_code=204)
async def delete_document(request: Request, kb_id: str, doc_id: str):
    service = await _require_kb_access(request, kb_id)
    deleted = await service.delete_document_cascade(kb_id=kb_id, doc_id=doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return Response(status_code=204)


@router.post("/{kb_id}/documents/{doc_id}/retry", status_code=202)
async def retry_document(request: Request, kb_id: str, doc_id: str):
    service = await _require_kb_access(request, kb_id)
    document = await _get_document_or_404(service, kb_id, doc_id)
    if document["status"] != "failed":
        raise HTTPException(status_code=409, detail="Only failed documents can be retried")
    return await service.retry_document(kb_id=kb_id, doc_id=doc_id)


@router.get("/{kb_id}/documents/{doc_id}/chunks")
async def list_document_chunks(
    request: Request,
    kb_id: str,
    doc_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    service = await _require_kb_access(request, kb_id)
    await _get_document_or_404(service, kb_id, doc_id)
    items = await service.store.list_chunks(doc_id, offset=offset, limit=limit)
    total = await service.store.count_chunks(doc_id)
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.get("/{kb_id}/documents/{doc_id}/files/{file_path:path}")
async def get_document_file(request: Request, kb_id: str, doc_id: str, file_path: str):
    """Serve parser-extracted assets (``images/…``) referenced by chunk markdown.

    The path must resolve inside the document's own ``images/`` directory —
    traversal attempts and the source document itself get a plain 404. The
    worker persists the images next to ``storage_path`` after each parse.
    """
    service = await _require_kb_access(request, kb_id)
    document = await _get_document_or_404(service, kb_id, doc_id)
    doc_dir = Path(document["storage_path"]).parent.resolve()
    images_root = doc_dir / "images"
    target = (doc_dir / file_path).resolve()
    if not target.is_relative_to(images_root) or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target)


class UpdateChunkRequest(BaseModel):
    """Phase-3 Batch-1 P2: slice text editing."""

    text: str = Field(min_length=1, description="New chunk content")


@router.patch("/{kb_id}/chunks/{chunk_id}")
async def update_chunk(request: Request, kb_id: str, chunk_id: str, body: UpdateChunkRequest):
    """Update chunk text with re-embedding (Phase-3 Batch-1 P2).

    Recalculates token_count, writes last_edited_at, and triggers Qdrant upsert
    with the same point ID but new dense vector. Entities JSON column remains
    unchanged (ID 引用 preserved).
    """
    service = await _require_kb_access(request, kb_id)
    chunk = await service.update_chunk_text(kb_id=kb_id, chunk_id=chunk_id, text=body.text)
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return chunk


class DeletePreviewRequest(BaseModel):
    """Phase-3 Batch-1 P5: delete impact preview."""

    chunk_ids: list[str] = Field(min_length=1, description="Chunk IDs to preview deletion for")


@router.post("/{kb_id}/chunks/delete-preview")
async def preview_chunk_deletion(request: Request, kb_id: str, body: DeletePreviewRequest):
    """Preview chunk deletion impact without actually deleting (Phase-3 Batch-1 P5).

    Returns orphaned entities, affected entities, and relation deletions for
    display in delete confirmation dialog. Pure read-only operation.
    """
    service = await _require_kb_access(request, kb_id)
    impact = await service.preview_chunk_deletion(kb_id=kb_id, chunk_ids=body.chunk_ids)
    if impact is None:
        raise HTTPException(status_code=404, detail="One or more chunks not found")
    return impact


@router.delete("/{kb_id}/chunks/{chunk_id}", status_code=204)
async def delete_chunk(request: Request, kb_id: str, chunk_id: str):
    """Delete one chunk with the full cascade (Task 5 收尾): graph
    contributions, orphan entity vectors, wiki disqualification chain, chunk
    vector point, business row. 409 while the document pipeline is mid-flight
    (same guard as re-extraction)."""
    service = await _require_kb_access(request, kb_id)
    try:
        deleted = await service.delete_chunk_cascade(kb_id=kb_id, chunk_id=chunk_id)
    except DocumentProcessingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return Response(status_code=204)


@router.post("/{kb_id}/chunks/{chunk_id}/re-extract")
async def re_extract_chunk(request: Request, kb_id: str, chunk_id: str):
    """Re-extract entities/relations for a single chunk (Phase-3 Batch-1 P3).

    Concurrency guard: only terminal document states (ready/failed) may trigger
    re-extraction — an in-flight pipeline returns 409. Runs the Spec §5 five-step
    flow on the chunk's current text (never re-parses the source file).
    """
    service = await _require_kb_access(request, kb_id)
    try:
        result = await service.re_extract_chunk(kb_id=kb_id, chunk_id=chunk_id)
    except DocumentProcessingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return result


@router.post("/{kb_id}/wiki/generate", status_code=202)
async def generate_wiki_entries(request: Request, kb_id: str, mode: Literal["incremental", "full"] = "incremental"):
    """Enqueue wiki generation (Task 14): ``incremental`` (default) digests
    dirty entries and backfills missing eligible ones; ``full`` rebuilds every
    eligible entry (rule-upgrade scenario)."""
    service = await _require_kb_access(request, kb_id)
    enqueued = service.trigger_wiki_generation(kb_id, only_dirty=mode != "full")
    return {"status": "enqueued" if enqueued else "already_running"}


@router.get("/{kb_id}/wiki/entries")
async def list_wiki_entries(request: Request, kb_id: str):
    service = await _require_kb_access(request, kb_id)
    return await service.list_wiki_entries(kb_id)


@router.get("/{kb_id}/wiki/entries/{entry_id}")
async def get_wiki_entry(request: Request, kb_id: str, entry_id: str):
    service = await _require_kb_access(request, kb_id)
    entry = await service.get_wiki_entry(kb_id=kb_id, entry_id=entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Wiki entry not found")
    return entry


@router.delete("/{kb_id}/wiki/entries/{entry_id}", status_code=204)
async def delete_wiki_entry(request: Request, kb_id: str, entry_id: str):
    service = await _require_kb_access(request, kb_id)
    deleted = await service.delete_wiki_entry(kb_id=kb_id, entry_id=entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Wiki entry not found")
    return Response(status_code=204)


class UpdateWikiEntryRequest(BaseModel):
    """Phase-3 Batch-1 P1: dual-mode wiki entry editing."""

    content: str = Field(min_length=1, description="Main content (replaceable on re-generation)")
    supplement_content: str | None = Field(default=None, description="User annotations (persistent)")


@router.patch("/{kb_id}/wiki/entries/{entry_id}")
async def update_wiki_entry(request: Request, kb_id: str, entry_id: str, body: UpdateWikiEntryRequest):
    """Update wiki entry content and supplement layer (Phase-3 Batch-1 P1).

    Main content can be replaced by next LLM re-generation; supplement layer
    persists across regeneration cycles.
    """
    service = await _require_kb_access(request, kb_id)
    entry = await service.update_wiki_entry(
        kb_id=kb_id,
        entry_id=entry_id,
        content=body.content,
        supplement_content=body.supplement_content,
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Wiki entry not found")
    return entry


class CreateManualCardRequest(BaseModel):
    """Phase-3 Batch-1 P6: manual knowledge card creation (spec §8)."""

    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    include_in_wiki_search: bool = False

    @field_validator("title", "content")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class UpdateManualCardRequest(BaseModel):
    """PATCH semantics: absent fields stay unchanged."""

    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    include_in_wiki_search: bool | None = None

    @field_validator("title", "content")
    @classmethod
    def _not_blank(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("must not be blank")
        return value


@router.post("/{kb_id}/manual-knowledge", status_code=201)
async def create_manual_card(request: Request, kb_id: str, body: CreateManualCardRequest):
    """Create a manual knowledge card (Phase-3 Batch-1 P6).

    Cards with ``include_in_wiki_search`` on are embedded into Qdrant for the
    Task-8 wiki-path merge; off cards are management-only (spec §8).
    """
    service = await _require_kb_access(request, kb_id)
    return await service.create_manual_card(
        kb_id=kb_id,
        owner_id=_user_id(request),
        title=body.title,
        content=body.content,
        tags=body.tags,
        include_in_wiki_search=body.include_in_wiki_search,
    )


@router.get("/{kb_id}/manual-knowledge")
async def list_manual_cards(
    request: Request,
    kb_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    include_in_wiki_search: bool | None = Query(None),
):
    service = await _require_kb_access(request, kb_id)
    return await service.list_manual_cards(kb_id=kb_id, offset=offset, limit=limit, include_in_wiki_search=include_in_wiki_search)


@router.get("/{kb_id}/manual-knowledge/{card_id}")
async def get_manual_card(request: Request, kb_id: str, card_id: str):
    service = await _require_kb_access(request, kb_id)
    card = await service.get_manual_card(kb_id=kb_id, card_id=card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Manual knowledge card not found")
    return card


@router.patch("/{kb_id}/manual-knowledge/{card_id}")
async def update_manual_card(request: Request, kb_id: str, card_id: str, body: UpdateManualCardRequest):
    service = await _require_kb_access(request, kb_id)
    card = await service.update_manual_card(
        kb_id=kb_id,
        card_id=card_id,
        title=body.title,
        content=body.content,
        tags=body.tags,
        include_in_wiki_search=body.include_in_wiki_search,
    )
    if card is None:
        raise HTTPException(status_code=404, detail="Manual knowledge card not found")
    return card


@router.delete("/{kb_id}/manual-knowledge/{card_id}", status_code=204)
async def delete_manual_card(request: Request, kb_id: str, card_id: str):
    service = await _require_kb_access(request, kb_id)
    deleted = await service.delete_manual_card(kb_id=kb_id, card_id=card_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Manual knowledge card not found")
    return Response(status_code=204)


@router.post("/{kb_id}/recall-test")
async def recall_test(request: Request, kb_id: str, body: RecallTestRequest):
    """P1 召回测试：一个 query 并行扇出到 vector/graph/wiki 三路检索 impl。

    走真实检索链路（embedding/rerank/实体抽取 LLM），按调试接口定位——
    无速率豁免；单路失败降级为空 hits，不拖垮整响应。
    """
    service = await _require_kb_access(request, kb_id)
    return await service.recall_test(kb_id=kb_id, user_id=_user_id(request), query=body.query, top_k=body.top_k)


@router.get("/{kb_id}/graph")
async def get_knowledge_graph(request: Request, kb_id: str):
    """知识图谱可视化（graph spec 2026-08-19 §4）：全量实体/关系 + Louvain 社区标注。

    无缓存——百级图现算是毫秒级，内容永远最新。
    """
    service = await _require_kb_access(request, kb_id)
    return await service.get_knowledge_graph(kb_id)


@router.get("/{kb_id}/vector-projection")
async def get_vector_projection(
    request: Request,
    kb_id: str,
    collections: str = Query(default="chunks,entities,wiki,cards"),
    algo: Literal["pca", "umap"] = "pca",
    dims: int = Query(default=2, ge=2, le=3),
    sample_size: int = Query(default=5000, ge=100, le=10000),
    refresh: bool = False,
):
    """向量空间投影（spec 2026-08-15 §7）：四 collection 同图 2D/3D 坐标。

    缓存由内容指纹驱动——内容未变直接命中；`refresh=true` 强制重算。
    计算走后台线程，不阻塞事件循环。
    """
    service = await _require_kb_access(request, kb_id)
    keys = [part.strip() for part in collections.split(",") if part.strip()]
    try:
        return await service.get_vector_projection(kb_id, collections=keys, algo=algo, dims=dims, sample_size=sample_size, refresh=refresh)
    except ValueError as exc:  # unknown collection keys (fetcher contract)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UmapUnavailableError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{kb_id}/vector-projection/query")
async def project_query_vector(
    request: Request,
    kb_id: str,
    body: VectorProjectionQueryRequest,
    collections: str = Query(default="chunks,entities,wiki,cards"),
    algo: Literal["pca", "umap"] = "pca",
    dims: int = Query(default=2, ge=2, le=3),
    sample_size: int = Query(default=5000, ge=100, le=10000),
):
    """query 文本投影（spec §9 检索联动）：复用缓存的 PCA 模型 transform。

    不触发投影计算——缓存不存在（409）或非 PCA 模型（409）直接拒绝。
    """
    service = await _require_kb_access(request, kb_id)
    keys = [part.strip() for part in collections.split(",") if part.strip()]
    try:
        return await service.project_query_vector(kb_id, text=body.text, collections=keys, algo=algo, dims=dims, sample_size=sample_size)
    except (ProjectionNotComputedError, ProjectionModelUnavailableError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ── eval question bank（spec 2026-08-27 §4.2）────────────────────────────


@router.get("/{kb_id}/eval/questions")
async def list_eval_questions(request: Request, kb_id: str):
    """读全量题库；文件不存在 → 空表（新 KB 不是错误）；存量文件脏 → 500 指行号。"""
    service = await _require_kb_access(request, kb_id)
    try:
        return await service.list_eval_questions(kb_id)
    except GoldenDatasetError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{kb_id}/eval/questions", status_code=201)
async def create_eval_question(request: Request, kb_id: str, body: EvalQuestionCreateRequest):
    """新增一题：id 服务端生成；新入参违例 → 422，存量文件脏 → 500 指行号。"""
    service = await _require_kb_access(request, kb_id)
    try:
        return await service.create_eval_question(
            kb_id,
            query=body.query,
            category=body.category,
            expected_path=body.expected_path,
            relevant_chunk_ids=body.relevant_chunk_ids,
            relevant_entities=body.relevant_entities,
            reference_answer=body.reference_answer,
        )
    except QuestionBankInvalidQuestion as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except GoldenDatasetError as exc:
        # 存量 golden.jsonl 非法是运维问题（手工编辑引入脏行），不是调用方
        # 入参问题——500 显式暴露行号，绝不静默跳过。
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{kb_id}/eval/questions/{question_id}", status_code=204)
async def delete_eval_question(request: Request, kb_id: str, question_id: str):
    service = await _require_kb_access(request, kb_id)
    try:
        await service.delete_eval_question(kb_id, question_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Eval question not found") from exc
    except GoldenDatasetError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{kb_id}/eval-runs", status_code=202)
async def trigger_eval_run(request: Request, kb_id: str):
    """触发一次按需 Layer 1 评测（spec 2026-08-27 §5）：复刻 wiki generate 的
    in-flight 幂等语义——enqueued / already_running；题库为空 → 409。"""
    service = await _require_kb_access(request, kb_id)
    try:
        enqueued = await service.trigger_eval_run(kb_id)
    except EvalQuestionBankEmpty as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "enqueued" if enqueued else "already_running"}


@router.get("/{kb_id}/eval-runs/latest")
async def get_latest_eval_metrics(request: Request, kb_id: str):
    """评测指标总览（spec 2026-08-24 §3.2/§4.2）：两层各自最近一次 completed
    且对应层 metrics 非空且非 ci 的运行；一层无数据该层为 null。
    """
    service = await _require_kb_access(request, kb_id)
    return await service.get_latest_eval_metrics(kb_id)


@router.get("/{kb_id}/eval-runs/trend")
async def get_eval_trend(
    request: Request,
    kb_id: str,
    granularity: Literal["day", "week", "month"] = "day",
    days_back: int = Query(default=30, ge=1),
    weeks_back: int = Query(default=12, ge=1),
    months_back: int = Query(default=6, ge=1),
    include_ci: bool = False,
):
    """指标趋势（spec §4.2）：统一末次语义聚合，两层独立取数。

    窗口参数按粒度配对——day 用 ``days_back``（clamp ≤90）、week 用
    ``weeks_back``、month 用 ``months_back``；响应只回显当前粒度匹配的那个键。
    ``include_ci=true`` 时 ci 运行进入取数集合。
    """
    service = await _require_kb_access(request, kb_id)
    return await service.get_eval_trend(kb_id, granularity=granularity, days_back=days_back, weeks_back=weeks_back, months_back=months_back, include_ci=include_ci)


# 注意注册顺序：latest / trend 字面量路由必须先于 {run_id} 参数路由。
@router.get("/{kb_id}/eval-runs/{run_id}")
async def get_eval_run(request: Request, kb_id: str, run_id: str):
    """单次评测运行详情（spec §4.2）：drawer 数据源；跨 kb 访问 404。"""
    service = await _require_kb_access(request, kb_id)
    run = await service.get_eval_run(kb_id, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return run
