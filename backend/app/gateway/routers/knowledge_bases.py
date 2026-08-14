"""Knowledge-base management API (spec §5.3, Phase-1 subset).

Thin router: resolve caller → owner-only gate (``can_access`` → 403) →
delegate to :class:`KnowledgeService`. Uploads return 202 — indexing runs
in the background worker (spec §3.7), progress is polled via the documents
list.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator

from app.gateway.services.knowledge_service import KnowledgeService
from deerflow.knowledge.access import can_access
from deerflow.knowledge.parser import SUPPORTED_UPLOAD_SUFFIXES

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


@router.post("/{kb_id}/wiki/generate", status_code=202)
async def generate_wiki_entries(request: Request, kb_id: str, mode: Literal["incremental", "full"] = "incremental"):
    """Enqueue wiki generation (Task 14): ``incremental`` (default) digests
    dirty entries and backfills missing eligible ones; ``full`` rebuilds every
    eligible entry (rule-upgrade scenario)."""
    service = await _require_kb_access(request, kb_id)
    service.trigger_wiki_generation(kb_id, only_dirty=mode != "full")
    return {"status": "enqueued"}


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


@router.post("/{kb_id}/recall-test")
async def recall_test(request: Request, kb_id: str, body: RecallTestRequest):
    """P1 召回测试：一个 query 并行扇出到 vector/graph/wiki 三路检索 impl。

    走真实检索链路（embedding/rerank/实体抽取 LLM），按调试接口定位——
    无速率豁免；单路失败降级为空 hits，不拖垮整响应。
    """
    service = await _require_kb_access(request, kb_id)
    return await service.recall_test(kb_id=kb_id, user_id=_user_id(request), query=body.query, top_k=body.top_k)
