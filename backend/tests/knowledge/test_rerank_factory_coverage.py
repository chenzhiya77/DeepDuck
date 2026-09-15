"""Guard: every rerank construction site resolves through ``reranker_factory``.

Spec 2026-09-14 §4.1 / P1: the search paths and the recall test must build the
*same* reranker the configuration selects — an evaluation that grades a
different retriever than the one serving queries is not an evaluation. The
failure is silent, too: the wrong provider usually raises, and
``RerankerError`` degrades to the embedding-cosine order, so nothing surfaces.

Scope is the rerank leg only. The embedding leg still has a legitimate direct
``DashScopeEmbedder()`` default until P3 lands.

Scope, the other way: this covers *direct construction by class name*. An
aliased import (``DashScopeReranker as DS``), a ``getattr`` lookup, or a
subclass would slip past — the guard's job is to block the shape a regression
actually takes (copying the line above it), not to be a proof.
"""

from __future__ import annotations

import ast
from pathlib import Path

from deerflow.knowledge.providers import PROVIDER_ALLOWLIST

_BACKEND = Path(__file__).resolve().parents[2]
_PRODUCTION_ROOTS = (
    _BACKEND / "app",
    _BACKEND / "packages" / "harness" / "deerflow",
)
#: Class names of every allowlisted rerank implementation — driven by the table so a
#: new rerank provider extends the guard instead of escaping it.
_RERANK_CLASSES = {spec.implementation.rsplit(":", 1)[-1] for spec in PROVIDER_ALLOWLIST["rerank"].values()}


def _called_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def test_no_production_module_constructs_a_rerank_provider_directly():
    offenders: list[str] = []
    for root in _PRODUCTION_ROOTS:
        for path in sorted(root.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = _called_name(node)
                if name in _RERANK_CLASSES:
                    offenders.append(f"{path.relative_to(_BACKEND)}:{node.lineno} -> {name}()")

    assert not offenders, "重排 provider 只能经 build_reranker() 构造，直连构造点：" + "; ".join(offenders)
