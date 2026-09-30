"""The shipped RAG templates stay in step with the schema (spec 2026-09-26 §5.3).

``rag_config.example.json`` is the copy an operator pastes into place, so it must load
through the real model and mention every model-reference key the settings form can write —
otherwise a new role ships as a field the template never tells anyone about.
``config.example.yaml`` advertises the same keys as commented examples inside its ``rag:``
block instead of activating one, because a name there points at a ``models:`` entry that
most deployments do not have.

Deliberately **not** asserted: that the JSON template carries no real model names. Three
fields in it do today (``embedding_model`` / ``rerank_model`` / ``extract_model``); replacing
them is the inventory's C-2 item, out of this pair's scope.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from deerflow.config.rag_config_file import MODEL_REFERENCE_FIELDS, RagConfigFile

ROOT = Path(__file__).resolve().parents[2]
RAG_EXAMPLE = ROOT / "rag_config.example.json"
CONFIG_EXAMPLE = ROOT / "config.example.yaml"

#: The two roles that had no field at all before spec 2026-09-26.
NEW_ROLE_FIELDS = ("wiki_model", "synthesis_model")

#: The two MinerU cloud knobs that had no field at all before spec 2026-09-29.
NEW_PARSE_KNOBS = ("parse_language", "parse_model_version")

#: The two caption generation knobs that had no field at all before spec 2026-09-30.
NEW_CAPTION_KNOBS = ("caption_max_tokens", "caption_temperature")


def _json_keys() -> list[str]:
    return list(json.loads(RAG_EXAMPLE.read_text(encoding="utf-8")))


def _rag_block() -> str:
    text = CONFIG_EXAMPLE.read_text(encoding="utf-8")
    start = re.search(r"^rag:\s*$", text, re.MULTILINE)
    assert start is not None, "config.example.yaml has no top-level `rag:` block"
    return text[start.end() :]


def test_the_json_template_loads_through_the_real_model():
    payload = json.loads(RAG_EXAMPLE.read_text(encoding="utf-8"))

    RagConfigFile.model_validate(payload)


def test_the_json_template_ships_both_roles_as_empty_overrides():
    payload = json.loads(RAG_EXAMPLE.read_text(encoding="utf-8"))

    for field in NEW_ROLE_FIELDS:
        assert field in payload, f"{field} is missing from rag_config.example.json"
        assert payload[field] == "", f"{field} must ship as an empty override, not {payload[field]!r}"
        assert field in MODEL_REFERENCE_FIELDS, f"{field} is not a model-reference field"


def test_the_json_template_keeps_the_roles_next_to_default_model():
    keys = _json_keys()

    anchor = keys.index("default_model")

    assert keys[anchor + 1 : anchor + 3] == list(NEW_ROLE_FIELDS)


def test_the_yaml_template_advertises_both_roles_as_commented_examples():
    block = _rag_block()

    for field in NEW_ROLE_FIELDS:
        assert re.search(rf"^\s*#\s*{field}:\s*\S", block, re.MULTILINE), f"{field} has no commented example in the rag block"
        # A `models:` entry reference is deployment-specific: the template must not activate one.
        assert not re.search(rf"^\s*{field}:", block, re.MULTILINE), f"{field} must stay commented out"


def test_the_yaml_template_advertises_both_parse_knobs_as_commented_examples():
    block = _rag_block()

    for field in NEW_PARSE_KNOBS:
        assert re.search(rf"^\s*#\s*{field}:\s*\S", block, re.MULTILINE), f"{field} has no commented example in the rag block"
        # Plain values, but the template still activates nothing: every row ships commented.
        assert not re.search(rf"^\s*{field}:", block, re.MULTILINE), f"{field} must stay commented out"


def test_the_yaml_template_keeps_the_parse_rows_in_order():
    block = _rag_block()
    names = re.findall(r"^\s*#\s*(parse_\w+):", block, re.MULTILINE)

    assert names == ["parse_provider", "parse_base_url", "parse_tier", *NEW_PARSE_KNOBS]


def test_the_yaml_template_advertises_both_caption_knobs_as_commented_examples():
    block = _rag_block()

    for field in NEW_CAPTION_KNOBS:
        assert re.search(rf"^\s*#\s*{field}:\s*\S", block, re.MULTILINE), f"{field} has no commented example in the rag block"
        # Plain values, but the template still activates nothing: every row ships commented.
        assert not re.search(rf"^\s*{field}:", block, re.MULTILINE), f"{field} must stay commented out"


def test_the_yaml_template_keeps_the_caption_rows_next_to_vlm_model():
    block = _rag_block()
    names = re.findall(r"^\s*#\s*(vlm_model|caption_\w+):", block, re.MULTILINE)

    assert names == ["vlm_model", *NEW_CAPTION_KNOBS]


def test_the_yaml_template_is_bumped_for_the_new_fields():
    # A floor, not an equality: the next schema bump may move it further (the same shape as
    # test_config_version's `> 26` check).
    text = CONFIG_EXAMPLE.read_text(encoding="utf-8")

    version = int(re.search(r"^config_version:\s*(\d+)", text, re.MULTILINE).group(1))

    assert version >= 42, "config.example.yaml must be bumped for the two caption knobs"
