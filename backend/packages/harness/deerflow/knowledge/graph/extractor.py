"""LLM entity/relation extractor (spec §3.4).

Each chunk is extracted independently (slice = minimal unit, status persisted
by the caller for resume). The small model (config ``rag.extract_model``)
answers with strict JSON; one gleaning round ("did you miss anything?")
merges newly-found entities/relations on top of the first pass, raising
recall by ~20-30% per the LightRAG playbook.

LLM protocol: any object with ``ainvoke(messages)`` returning a message with
``.content`` (a LangChain chat model in production, a stub in tests).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

EXTRACT_SYSTEM_PROMPT = """你是知识图谱抽取器。从用户给出的文本中抽取实体与关系，只输出严格 JSON，不要输出任何其他文字：
{"entities": [{"name": "...", "type": "...", "description": "..."}], "relations": [{"source": "...", "target": "...", "relation": "...", "description": "..."}]}
要求：
- name 使用原文中的规范名称；type 用简短类别词（如 系统/组件/人物/概念/服务/框架）；description 用一句话概括其在该文本中的角色。
- 若原文中同一概念同时出现了中文名称与英文名称（跨语言概念），其 name 用「中文（英文）」规范形（中文名在前，英文名放全角括号内）；英文名必须来自原文，不要自行翻译。
- relations 的 source 与 target 必须出现在 entities 的 name 中；relation 用简短动词或关系词。
- 文本中没有可抽取内容时，输出 {"entities": [], "relations": []}。"""

GLEANING_PROMPT_TEMPLATE = """检查是否有遗漏的实体和关系。已抽取：
{known}
请只输出**新增**的实体与关系（与已有结果重复的内容不要再次输出），使用同样的 JSON 格式；没有遗漏时输出 {{"entities": [], "relations": []}}。"""

_FENCE_RE = re.compile(r"^```(?:json)?\s*(?P<body>.*?)\s*```$", re.DOTALL)


class ExtractionError(Exception):
    """The model output could not be parsed into the extraction schema."""


@dataclass(slots=True)
class ExtractedEntity:
    name: str
    type: str = ""
    description: str = ""


@dataclass(slots=True)
class ExtractedRelation:
    source: str
    target: str
    relation: str
    description: str = ""


@dataclass(slots=True)
class ExtractionResult:
    entities: list[ExtractedEntity] = field(default_factory=list)
    relations: list[ExtractedRelation] = field(default_factory=list)


def _strip_fence(content: str) -> str:
    text = content.strip()
    match = _FENCE_RE.match(text)
    return match.group("body") if match else text


def _parse_payload(content: str) -> ExtractionResult:
    try:
        data = json.loads(_strip_fence(content))
    except json.JSONDecodeError as exc:
        raise ExtractionError(f"extraction returned malformed JSON: {exc}") from exc
    if not isinstance(data, dict) or "entities" not in data or "relations" not in data:
        raise ExtractionError("extraction JSON must carry 'entities' and 'relations' keys")
    entities = []
    for item in data.get("entities") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        entities.append(ExtractedEntity(name=name, type=str(item.get("type") or "").strip(), description=str(item.get("description") or "").strip()))
    relations = []
    for item in data.get("relations") or []:
        if not isinstance(item, dict):
            continue
        source, target = str(item.get("source") or "").strip(), str(item.get("target") or "").strip()
        relation = str(item.get("relation") or "").strip()
        if not (source and target and relation):
            continue
        relations.append(ExtractedRelation(source=source, target=target, relation=relation, description=str(item.get("description") or "").strip()))
    return ExtractionResult(entities=entities, relations=relations)


def _merge(base: ExtractionResult, extra: ExtractionResult) -> ExtractionResult:
    """Merge gleaned results: first-seen entity/relation wins, duplicates dropped."""
    known_names = {entity.name for entity in base.entities}
    for entity in extra.entities:
        if entity.name not in known_names:
            base.entities.append(entity)
            known_names.add(entity.name)
    known_triples = {(r.source, r.target, r.relation) for r in base.relations}
    for relation in extra.relations:
        triple = (relation.source, relation.target, relation.relation)
        if triple not in known_triples:
            base.relations.append(relation)
            known_triples.add(triple)
    return base


def get_extract_llm():
    """Small extraction model: config ``rag.extract_model``, else the first model."""
    from deerflow.config.app_config import get_app_config
    from deerflow.models.factory import create_chat_model

    return create_chat_model(get_app_config().rag.extract_model)


async def extract_graph(text: str, *, llm: Any = None, gleaning_rounds: int = 1) -> ExtractionResult:
    """Extract entities+relations from one chunk, with optional gleaning rounds."""
    if llm is None:
        llm = get_extract_llm()
    messages: list[dict[str, str]] = [
        {"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
        {"role": "user", "content": text},
    ]
    response = await llm.ainvoke(messages)
    result = _parse_payload(str(response.content))
    for _ in range(max(0, gleaning_rounds)):
        known = json.dumps(
            {
                "entities": [e.name for e in result.entities],
                "relations": [{"source": r.source, "target": r.target, "relation": r.relation} for r in result.relations],
            },
            ensure_ascii=False,
        )
        messages = messages + [
            {"role": "assistant", "content": str(response.content)},
            {"role": "user", "content": GLEANING_PROMPT_TEMPLATE.format(known=known)},
        ]
        response = await llm.ainvoke(messages)
        _merge(result, _parse_payload(str(response.content)))
    return result
