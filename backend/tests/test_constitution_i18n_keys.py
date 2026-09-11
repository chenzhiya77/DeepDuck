"""Guard for the constitution i18n key manifest (frontend side of the copy table).

Spec: docs/superpowers/specs/2026-09-12-harness-constitution-frontend-design.md §8.2.

The copy table lives in the frontend (copy is a frontend concern), but two of
its inputs are owned by the backend: the 34 middleware class names must be
`type(mw).__name__` values, and the six gate keys must be the catalog's
middleware tags. This test reads the checked-in manifest across the module
boundary (precedent: `test_compose_default_bind_host.py` reads `docker/`) so a
rename on either side turns CI red instead of silently dropping a tooltip or
rendering a bare class name.
"""

from __future__ import annotations

import json
from pathlib import Path

from deerflow.agents.constitution_record import STAGE_OF_MIDDLEWARE
from deerflow.runtime.events.catalog import (
    MIDDLEWARE_READ_GATE_TAG,
    MIDDLEWARE_SANDBOX_AUDIT_TAG,
    MIDDLEWARE_SKILL_POLICY_TAG,
    MIDDLEWARE_SUBAGENT_LIMIT_TAG,
    MIDDLEWARE_TOOL_PROGRESS_TAG,
    MIDDLEWARE_TOOL_PROMOTION_TAG,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "frontend" / "src" / "core" / "constitution" / "constitution-i18n-keys.json"

GATE_TAGS = {
    MIDDLEWARE_READ_GATE_TAG,
    MIDDLEWARE_TOOL_PROGRESS_TAG,
    MIDDLEWARE_SUBAGENT_LIMIT_TAG,
    MIDDLEWARE_TOOL_PROMOTION_TAG,
    MIDDLEWARE_SANDBOX_AUDIT_TAG,
    MIDDLEWARE_SKILL_POLICY_TAG,
}


def _manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _string_leaves(node: object) -> list[str]:
    if isinstance(node, str):
        return [node]
    if isinstance(node, list):
        leaves: list[str] = []
        for entry in node:
            leaves.extend(_string_leaves(entry))
        return leaves
    if isinstance(node, dict):
        leaves = []
        for value in node.values():
            leaves.extend(_string_leaves(value))
        return leaves
    return []


def test_manifest_middlewares_match_the_stage_table():
    """Bidirectional: a middleware renamed on either side must fail here."""
    manifest_names = _manifest()["middlewares"]

    assert set(manifest_names) == set(STAGE_OF_MIDDLEWARE)
    # Set equality alone would hide a duplicated entry in the manifest.
    assert len(manifest_names) == len(set(manifest_names)) == len(STAGE_OF_MIDDLEWARE)


def test_manifest_gate_keys_match_the_catalog_tags():
    gate_keys = _manifest()["core"]["gate"]

    assert set(gate_keys) == GATE_TAGS
    assert len(gate_keys) == len(GATE_TAGS)


def test_middleware_names_are_index_keys_not_plain_core_keys():
    """The class names index the tooltip table, so they never live under core."""
    manifest = _manifest()
    core_leaves = set(_string_leaves(manifest["core"]))

    assert core_leaves.isdisjoint(set(manifest["middlewares"]))
