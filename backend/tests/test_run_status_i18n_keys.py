"""Guard for the run-status i18n key manifest.

Spec: docs/superpowers/specs/2026-09-12-harness-run-status-failure-design.md §5.

Which failures get a sentence is a frontend decision — the `FailureKind` union and
the `PRESENTED_KINDS` subset both live in `frontend/src/core/run-status/types.ts` —
but the copy table is checked in beside it, and the two must agree. The backend
cannot import a TS type, so this reads the exported constant as text (the same
module-boundary read `test_gateway_runtime_cleanup.py` does against
`frontend/next.config.js`) and asserts the sets are equal: a presented kind added
without copy, a kind quietly dropped from the manifest, or a renamed constant all
fail here instead of rendering a failure with no sentence.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "frontend" / "src" / "core" / "run-status" / "run-status-i18n-keys.json"
PRESENTED_KINDS_SOURCE = REPO_ROOT / "frontend" / "src" / "core" / "run-status" / "types.ts"

_PRESENTED_KINDS_BLOCK = re.compile(r"export const PRESENTED_KINDS = \[(.*?)\]", re.S)
_STRING_LITERAL = re.compile(r'"([^"]+)"')


def _manifest_kinds() -> list[str]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))["kinds"]


def _frontend_presented_kinds() -> list[str]:
    source = PRESENTED_KINDS_SOURCE.read_text(encoding="utf-8")
    block = _PRESENTED_KINDS_BLOCK.search(source)
    assert block is not None, "PRESENTED_KINDS is no longer exported from frontend/src/core/run-status/types.ts"
    return _STRING_LITERAL.findall(block.group(1))


def test_manifest_kinds_match_the_frontend_presented_kinds():
    manifest_kinds = _manifest_kinds()

    assert set(manifest_kinds) == set(_frontend_presented_kinds())
    # Set equality alone would hide a duplicate entry in the manifest.
    assert len(manifest_kinds) == len(set(manifest_kinds))
