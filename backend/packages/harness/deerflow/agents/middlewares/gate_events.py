"""Best-effort audit of gate decisions, shared by the instrumented middlewares.

A *gate* event is recorded when a middleware actually changes execution: it
blocks a tool call, drops delegations, or releases deferred tool schemas.
Observation alone (sanitizing content, externalizing an oversized result) is not
a gate event.

Two invariants are enforced here rather than at each call site, because getting
either wrong at one site is a silent behavioural change:

- **Never raises.** A snapshot of what happened is worth strictly less than the
  run it observes, so any storage failure degrades to a warning.
- **Never carries the blocked content.** Callers pass decision facts only — no
  command text, no file bodies, no retrieval queries, no secret values. See
  ``safety_finish_reason_middleware``'s rule of not persisting the very content
  the provider filtered.

Runtimes without ``__run_journal`` (embedded client, subagent execution) skip
recording entirely.

Spec: docs/superpowers/specs/2026-09-11-harness-gate-instrumentation-design.md
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def record_gate_event(
    runtime: Any,
    *,
    tag: str,
    name: str,
    hook: str,
    action: str,
    changes: dict[str, Any],
) -> None:
    """Record one gate decision. Silently does nothing when there is no journal."""
    context = getattr(runtime, "context", None)
    journal = context.get("__run_journal") if isinstance(context, dict) else None
    if journal is None:
        return
    try:
        journal.record_middleware(tag=tag, name=name, hook=hook, action=action, changes=changes)
    except Exception:  # noqa: BLE001 — audit must never change execution
        logger.warning("gate event %r not recorded", tag, exc_info=True)


__all__ = ["record_gate_event"]
