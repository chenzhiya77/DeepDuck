"""The retired VLM key has no operator-facing carriers left (inventory B-2, spec 2026-09-30 D4).

``SILICONFLOW_VLM_API_KEY`` stopped being read when the 2026-09-23 pair retired the VLM
key's environment fallback, but four surfaces still advertised it — the env template, the
two READMEs, and the live smoke's gate list. The closeout pair deleted it from all four;
this guard keeps the name from coming back, and pins that the keys that are still live
survived the deletion (a wrong-line deletion would otherwise pass silently).

Historical records are exempt by design, not by omission: the register
(``docs/PRE_RELEASE_HARDCODE_INVENTORY.md``) and the older specs/plans under ``docs/``
keep quoting the name as history, so the scan is the four carriers, not the whole repo.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

RETIRED = "SILICONFLOW_VLM_API_KEY"

#: The four operator-facing surfaces the closeout pair cleaned (B-2's remaining carriers).
CARRIERS = (
    ROOT / ".env.example",
    ROOT / "README.md",
    ROOT / "UPSTREAM_README.md",
    ROOT / "backend" / "tests" / "knowledge" / "test_e2e_smoke.py",
)

#: Keys that are still live and appear in every carrier — the deletion removes one name,
#: not the surrounding list.
LIVE_KEYS = ("DASHSCOPE_EMBEDDING_API_KEY", "DASHSCOPE_RERANK_API_KEY", "MINERU_API_TOKEN")


def test_the_four_carriers_do_not_mention_the_retired_vlm_key():
    for path in CARRIERS:
        text = path.read_text(encoding="utf-8")
        assert RETIRED not in text, f"{path.relative_to(ROOT)} still carries {RETIRED}"


def test_the_carriers_still_list_the_live_keys():
    """Positive control for the deletion: the list around the retired name stays intact."""
    for path in CARRIERS:
        text = path.read_text(encoding="utf-8")
        for key in LIVE_KEYS:
            assert key in text, f"{path.relative_to(ROOT)} lost the live key {key}"
