"""Guard for the delivery i18n key manifest.

Spec: docs/superpowers/specs/2026-09-12-harness-delivery-layer-design.md §6.

The delivery copy is keyed by the verdict's three states, and those states are a
contract: `run.delivery.content_schema.properties.stage.enum`. This test reads the
frontend manifest across the module boundary (precedent:
`test_compose_default_bind_host.py` reads `docker/`) and asserts the two sets are
equal, so a fourth verdict state added to the contract, or a renamed copy key,
fails here instead of rendering an untranslated `stage` value to the user.

The keys are the enum values verbatim on purpose — with the same spelling, this
stays a set comparison rather than a mapping table.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "frontend" / "src" / "core" / "delivery" / "delivery-i18n-keys.json"
CONTRACT_PATH = REPO_ROOT / "contracts" / "run_event_stream_contract.json"


def _manifest_stages() -> list[str]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))["stages"]


def _contract_stages() -> list[str]:
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    event = next(event for event in contract["events"] if event["event_type"] == "run.delivery")
    return event["content_schema"]["properties"]["stage"]["enum"]


def test_delivery_copy_covers_exactly_the_contract_verdict_states():
    staged = _manifest_stages()

    assert set(staged) == set(_contract_stages())
    # Set equality alone would hide a duplicate entry in the manifest.
    assert len(staged) == len(set(staged))
