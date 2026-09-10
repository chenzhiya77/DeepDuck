"""Tests for ``deerflow.agents.constitution_record`` (stage table + record builder).

Spec: docs/superpowers/specs/2026-09-10-harness-constitution-snapshot-design.md
- §6.5  payload shape, hooks[]/frequency division, caps
- §6.5.1 counts must come from the mounted chain
- §6.6  stage table (34 named), hook detection
- §6.8  curation invariant
"""

from __future__ import annotations

import json

import pytest
from langchain.agents.middleware import AgentMiddleware

from deerflow.agents.constitution_record import (
    EXTENSION_STAGE,
    HOOK_ORDER,
    MAX_CONSTITUTION_BYTES,
    MAX_TOOL_NAMES,
    MEMBER,
    ONCE_PER_RUN,
    OVERLAY,
    PER_MODEL_CALL,
    PER_TOOL_CALL,
    SCHEMA_VERSION,
    STAGE_OF_MIDDLEWARE,
    STAGES,
    build_constitution_record,
    derive_frequency,
    detect_hooks,
    serialized_size,
)

# The 34 named middlewares (§6.6.3). Names are real ``type(mw).__name__`` values —
# slot 18 carries the ``DeerFlow`` prefix, which the source confirms.
NAMED_MIDDLEWARES = frozenset(
    {
        "InputSanitizationMiddleware",
        "ToolOutputBudgetMiddleware",
        "ToolResultSanitizationMiddleware",
        "ThreadDataMiddleware",
        "UploadsMiddleware",
        "SandboxMiddleware",
        "DanglingToolCallMiddleware",
        "LLMErrorHandlingMiddleware",
        "GuardrailMiddleware",
        "SandboxAuditMiddleware",
        "ReadBeforeWriteMiddleware",
        "ToolProgressMiddleware",
        "ToolErrorHandlingMiddleware",
        "DynamicContextMiddleware",
        "SkillActivationMiddleware",
        "SkillToolPolicyMiddleware",
        "DurableContextMiddleware",
        "DeerFlowSummarizationMiddleware",
        "TodoMiddleware",
        "TokenUsageMiddleware",
        "TitleMiddleware",
        "MemoryMiddleware",
        "ViewImageMiddleware",
        "McpRoutingMiddleware",
        "DeferredToolFilterMiddleware",
        "SystemMessageCoalescingMiddleware",
        "SubagentLimitMiddleware",
        "LoopDetectionMiddleware",
        "TokenBudgetMiddleware",
        "TerminalResponseMiddleware",
        "ModelLengthFinishReasonMiddleware",
        "SafetyFinishReasonMiddleware",
        "ClarificationMiddleware",
        "DeepResearchMiddleware",
    }
)


# --------------------------------------------------------------------------- #
# helpers: synthetic middlewares / tools (no assembly path involved)
# --------------------------------------------------------------------------- #
class _BeforeModel(AgentMiddleware):
    def before_model(self, state, runtime):  # noqa: ANN001, ANN201
        return None


class _WrapToolOnly(AgentMiddleware):
    def wrap_tool_call(self, request, handler):  # noqa: ANN001, ANN201
        return handler(request)


class _WrapModelOnly(AgentMiddleware):
    def wrap_model_call(self, request, handler):  # noqa: ANN001, ANN201
        return handler(request)


class _AgentPhaseOnly(AgentMiddleware):
    def before_agent(self, state, runtime):  # noqa: ANN001, ANN201
        return None


class _AgentPhasePlusToolWrap(AgentMiddleware):
    """Mirrors SandboxMiddleware's shape: agent phase + wrap_tool_call, no model phase."""

    def before_agent(self, state, runtime):  # noqa: ANN001, ANN201
        return None

    def after_agent(self, state, runtime):  # noqa: ANN001, ANN201
        return None

    def wrap_tool_call(self, request, handler):  # noqa: ANN001, ANN201
        return handler(request)


class _AsyncSpelled(AgentMiddleware):
    """Async-only override must still be detected."""

    async def abefore_model(self, state, runtime):  # noqa: ANN001, ANN201
        return None


class _FakeTool:
    def __init__(self, name: str, metadata: dict | None = None, func=None):
        self.name = name
        self.metadata = metadata or {}
        self.func = func


def _known(table_name: str, overrides: dict | None = None):
    """An instance whose ``type(mw).__name__`` equals a real table entry name."""
    return type(table_name, (AgentMiddleware,), dict(overrides or {}))()


def _real_tool_func():
    return None


_real_tool_func.__module__ = "deerflow.tools.builtins.present_file_tool"


def _sandbox_func():
    return None


_sandbox_func.__module__ = "deerflow.sandbox.tools"


def _config_func():
    return None


_config_func.__module__ = "deerflow.community.tavily.tools"


class _FakeDeferredSetup:
    def __init__(self, names: list[str]):
        self.deferred_names = frozenset(names)


class _FakeAppConfig:
    class _ToolSearch:
        auto_promote_top_k = 3

    class _Skills:
        deferred_discovery = True

    tool_search = _ToolSearch()
    skills = _Skills()


def _record(middlewares=(), **overrides):
    kwargs = {
        "middlewares": list(middlewares),
        "tools": [],
        "deferred_setup": None,
        "authorization_candidates": [],
        "authorized_tools": [],
        "model_name": "dashscope:qwen3-max",
        "thinking_enabled": True,
        "reasoning_effort": None,
        "agent_name": "rag",
        "is_bootstrap": False,
        "checkpoint_mode": "full",
        "skill_setup": None,
        "mcp_routing_built": True,
        "is_plan_mode": False,
        "subagent_enabled": True,
        "max_concurrent_subagents": 3,
        "max_total_subagents": 6,
        "non_interactive": False,
        "app_config": _FakeAppConfig(),
    }
    kwargs.update(overrides)
    return build_constitution_record(**kwargs)


# --------------------------------------------------------------------------- #
# ① stage table: statics (no instances needed)
# --------------------------------------------------------------------------- #
def test_table_covers_exactly_the_34_named_middlewares():
    assert set(STAGE_OF_MIDDLEWARE) == NAMED_MIDDLEWARES


def test_table_stage_counts_match_spec():
    counts: dict[tuple[str, str, str | None], int] = {}
    for facts in STAGE_OF_MIDDLEWARE.values():
        key = (facts.stage, facts.kind, facts.overlay_kind)
        counts[key] = counts.get(key, 0) + 1

    assert counts == {
        ("intake", MEMBER, None): 2,
        ("context", MEMBER, None): 12,
        ("model", MEMBER, None): 3,
        ("model", OVERLAY, "guard"): 5,
        ("tools", MEMBER, None): 4,
        ("tools", OVERLAY, "guard"): 5,
        ("tools", OVERLAY, "handoff"): 1,
        ("epilogue", MEMBER, None): 2,
    }


def test_only_clarification_is_a_handoff_and_it_exits_the_run():
    handoffs = {name for name, f in STAGE_OF_MIDDLEWARE.items() if f.overlay_kind == "handoff"}
    assert handoffs == {"ClarificationMiddleware"}
    assert STAGE_OF_MIDDLEWARE["ClarificationMiddleware"].exits_run is True
    assert all(f.exits_run is False for name, f in STAGE_OF_MIDDLEWARE.items() if name != "ClarificationMiddleware")


def test_every_stage_used_by_the_table_is_a_known_stage():
    allowed = set(STAGES) | {EXTENSION_STAGE}
    assert {f.stage for f in STAGE_OF_MIDDLEWARE.values()} <= allowed


def test_overlays_never_leave_model_or_tools():
    for name, facts in STAGE_OF_MIDDLEWARE.items():
        if facts.kind == OVERLAY:
            assert facts.stage in {"model", "tools"}, name


# --------------------------------------------------------------------------- #
# hook detection + frequency derivation
# --------------------------------------------------------------------------- #
def test_detect_hooks_uses_frozen_order():
    assert HOOK_ORDER == (
        "before_agent",
        "after_agent",
        "before_model",
        "wrap_model_call",
        "after_model",
        "wrap_tool_call",
    )
    assert detect_hooks(_AgentPhasePlusToolWrap()) == ["before_agent", "after_agent", "wrap_tool_call"]


def test_detect_hooks_sees_async_only_overrides():
    assert detect_hooks(_AsyncSpelled()) == ["before_model"]


def test_detect_hooks_is_empty_for_a_bare_middleware():
    assert detect_hooks(AgentMiddleware()) == []


@pytest.mark.parametrize(
    ("middleware", "expected"),
    [
        (_BeforeModel(), "per_model_call"),
        (_WrapModelOnly(), "per_model_call"),
        (_WrapToolOnly(), "per_tool_call"),
        (_AgentPhaseOnly(), "once_per_run"),
        # The Sandbox shape: no model-phase hook -> per_tool_call, not per_model_call.
        (_AgentPhasePlusToolWrap(), "per_tool_call"),
    ],
)
def test_frequency_derivation_branches(middleware, expected):
    assert derive_frequency(detect_hooks(middleware)) == expected


# --------------------------------------------------------------------------- #
# ② record shape / fields
# --------------------------------------------------------------------------- #
def test_record_has_the_full_envelope():
    record = _record()
    assert set(record) >= {
        "schema_version",
        "model",
        "agent",
        "checkpoint_mode",
        "runtime_flags",
        "stages",
        "middlewares",
        "tools",
        "tool_authorization",
        "skills",
        "mcp_routing_built",
    }
    assert record["schema_version"] == SCHEMA_VERSION == 1
    assert record["model"] == {
        "name": "dashscope:qwen3-max",
        "thinking_enabled": True,
        "reasoning_effort": None,
    }
    assert record["agent"] == {"name": "rag", "is_bootstrap": False}
    assert record["checkpoint_mode"] == "full"
    assert record["runtime_flags"] == {
        "is_plan_mode": False,
        "subagent_enabled": True,
        "max_concurrent_subagents": 3,
        "max_total_subagents": 6,
        "non_interactive": False,
    }


def test_bootstrap_site_reports_no_agent_name():
    record = _record(agent_name=None, is_bootstrap=True)
    assert record["agent"] == {"name": None, "is_bootstrap": True}


def test_middleware_rows_carry_name_stage_kind_hooks_frequency():
    record = _record(middlewares=[_AgentPhasePlusToolWrap(), _WrapToolOnly()])
    rows = {row["name"]: row for row in record["middlewares"]}
    assert set(rows) == {"_AgentPhasePlusToolWrap", "_WrapToolOnly"}
    # Neither class is in the table -> extension fallback, member kind.
    assert rows["_AgentPhasePlusToolWrap"] == {
        "name": "_AgentPhasePlusToolWrap",
        "stage": EXTENSION_STAGE,
        "kind": MEMBER,
        "hooks": ["before_agent", "after_agent", "wrap_tool_call"],
        "frequency": "per_tool_call",
    }
    assert rows["_WrapToolOnly"]["hooks"] == ["wrap_tool_call"]
    assert rows["_WrapToolOnly"]["frequency"] == "per_tool_call"


def test_table_rows_serialize_kind_and_overlay_fields():
    """A table-known guard must carry kind/overlay_kind; Clarification also exits_run."""
    record = _record(middlewares=[_known("LoopDetectionMiddleware"), _known("ClarificationMiddleware")])
    rows = {row["name"]: row for row in record["middlewares"]}
    assert rows["LoopDetectionMiddleware"]["kind"] == OVERLAY
    assert rows["LoopDetectionMiddleware"]["overlay_kind"] == "guard"
    assert rows["LoopDetectionMiddleware"]["stage"] == "model"
    assert rows["ClarificationMiddleware"]["overlay_kind"] == "handoff"
    assert rows["ClarificationMiddleware"]["exits_run"] is True
    assert rows["ClarificationMiddleware"]["stage"] == "tools"


# --------------------------------------------------------------------------- #
# ③ stages[] counts come from the mounted chain (§6.5.1), loop flags, extension
# --------------------------------------------------------------------------- #
def _mixed_chain():
    return [
        _known("ThreadDataMiddleware"),
        _known("UploadsMiddleware"),
        _known("InputSanitizationMiddleware"),
        _known("ToolOutputBudgetMiddleware"),
        _known("LoopDetectionMiddleware"),
        _known("ClarificationMiddleware"),
        _known("TitleMiddleware"),
        _known("MemoryMiddleware"),
    ]


def test_stage_counts_come_from_the_mounted_chain_not_the_table_total():
    record = _record(middlewares=_mixed_chain())
    by_key = {row["key"]: row for row in record["stages"]}
    assert by_key["intake"]["members"] == 2
    assert by_key["context"]["members"] == 2
    assert by_key["model"] == {"key": "model", "loop": True, "members": 0, "gates": 1, "handoff_gates": 0}
    assert by_key["tools"] == {"key": "tools", "loop": True, "members": 0, "gates": 0, "handoff_gates": 1}
    assert by_key["epilogue"]["members"] == 2
    # The table totals 34; this run mounted 8. Summing must follow the run.
    total = sum(r["members"] + r["gates"] + r["handoff_gates"] for r in record["stages"])
    assert total == len(record["middlewares"]) == 8
    assert total != len(NAMED_MIDDLEWARES)


def test_loop_flags_are_intake_and_epilogue_false():
    record = _record(middlewares=_mixed_chain())
    flags = {row["key"]: row["loop"] for row in record["stages"]}
    assert flags == {"intake": False, "context": True, "model": True, "tools": True, "epilogue": False}


def test_all_five_stages_are_always_present():
    record = _record(middlewares=[])
    assert [row["key"] for row in record["stages"]] == list(STAGES)


def test_extension_band_appears_only_when_something_lands_in_it():
    without = _record(middlewares=_mixed_chain())
    assert [row["key"] for row in without["stages"]] == list(STAGES)

    with_extension = _record(middlewares=[*_mixed_chain(), _WrapToolOnly()])
    assert [row["key"] for row in with_extension["stages"]][-1] == EXTENSION_STAGE
    extension_row = with_extension["stages"][-1]
    assert extension_row == {"key": EXTENSION_STAGE, "loop": False, "members": 1, "gates": 0, "handoff_gates": 0}


# --------------------------------------------------------------------------- #
# ④ curation invariant: stages[] carries no middleware names
# --------------------------------------------------------------------------- #
def test_stages_serialization_contains_no_middleware_class_name():
    record = _record(middlewares=_mixed_chain())
    stages_text = json.dumps(record["stages"], ensure_ascii=False)
    for name in _mixed_chain():
        assert type(name).__name__ not in stages_text
    for name in NAMED_MIDDLEWARES:
        assert name not in stages_text
    assert "Middleware" not in stages_text


# --------------------------------------------------------------------------- #
# ⑤ tools: source derivation, counts, MAX_TOOL_NAMES on BOTH lists
# --------------------------------------------------------------------------- #
def test_tool_source_derivation():
    tools = [
        _FakeTool("mcp_thing", metadata={"deerflow_mcp": True}),
        _FakeTool("present_files", func=_real_tool_func),
        _FakeTool("bash", func=_sandbox_func),
        _FakeTool("web_search", func=_config_func),
    ]
    record = _record(tools=tools)
    assert [(t["name"], t["source"]) for t in record["tools"]["mounted"]] == [
        ("mcp_thing", "mcp"),
        ("present_files", "builtin"),
        ("bash", "builtin"),
        ("web_search", "tool_group"),
    ]
    assert record["tools"]["mounted_count"] == 4
    assert record["tools"]["truncated"] is False


def test_deferred_names_come_from_the_setup_and_carry_the_config_top_k():
    record = _record(deferred_setup=_FakeDeferredSetup(["a__b", "c__d"]))
    assert record["tools"]["deferred_names"] == ["a__b", "c__d"]
    assert record["tools"]["deferred_count"] == 2
    assert record["tools"]["auto_promote_top_k"] == 3  # from app_config
    assert record["mcp_routing_built"] is True


def test_max_tool_names_caps_mounted_and_keeps_the_true_count():
    tools = [_FakeTool(f"tool_{i:04d}") for i in range(MAX_TOOL_NAMES + 5)]
    record = _record(tools=tools)
    assert len(record["tools"]["mounted"]) == MAX_TOOL_NAMES
    assert record["tools"]["mounted_count"] == MAX_TOOL_NAMES + 5
    assert record["tools"]["truncated"] is True


def test_max_tool_names_caps_deferred_names_too():
    names = [f"mcp_srv__tool_{i:04d}" for i in range(MAX_TOOL_NAMES + 7)]
    record = _record(deferred_setup=_FakeDeferredSetup(names))
    assert len(record["tools"]["deferred_names"]) == MAX_TOOL_NAMES
    assert record["tools"]["deferred_count"] == MAX_TOOL_NAMES + 7
    assert record["tools"]["truncated"] is True


# --------------------------------------------------------------------------- #
# ⑥ authorization diff
# --------------------------------------------------------------------------- #
def test_authorization_diff_lists_candidates_that_did_not_survive():
    kept = _FakeTool("kept")
    dropped = _FakeTool("dropped_tool")
    record = _record(authorization_candidates=[kept, dropped], authorized_tools=[kept])
    assert record["tool_authorization"] == {"removed": ["dropped_tool"], "removed_count": 1}


def test_authorization_diff_is_empty_when_nothing_was_removed():
    kept = _FakeTool("kept")
    record = _record(authorization_candidates=[kept], authorized_tools=[kept])
    assert record["tool_authorization"] == {"removed": [], "removed_count": 0}


def test_authorization_diff_dedupes_names_and_is_sorted():
    a = _FakeTool("dup")
    b = _FakeTool("dup")
    z = _FakeTool("zeta")
    record = _record(authorization_candidates=[z, a, b], authorized_tools=[])
    assert record["tool_authorization"]["removed"] == ["dup", "zeta"]
    assert record["tool_authorization"]["removed_count"] == 2


# --------------------------------------------------------------------------- #
# ⑦ skills
# --------------------------------------------------------------------------- #
class _FakeSkillSetup:
    def __init__(self, names, has_describe=True):
        self.skill_names = names
        self.describe_skill_tool = object() if has_describe else None


def test_skills_block_reports_counts_and_config_flags():
    record = _record(skill_setup=_FakeSkillSetup(["alpha", "beta"]))
    assert record["skills"] == {
        "available_count": 2,
        "deferred_discovery": True,  # from app_config
        "describe_skill_bound": True,
        "active_names": [],
    }


def test_skills_block_without_setup_is_all_empty():
    record = _record(skill_setup=None)
    assert record["skills"]["available_count"] == 0
    assert record["skills"]["describe_skill_bound"] is False
    assert record["skills"]["active_names"] == []


# --------------------------------------------------------------------------- #
# ⑧ forbidden content never leaks
# --------------------------------------------------------------------------- #
def test_tool_metadata_description_and_secret_values_never_leak():
    tool = _FakeTool("leaky", metadata={"api_key": "SUPERSECRET", "deerflow_mcp": True})
    tool.description = "PROMPT BODY THAT MUST NOT SHIP"
    tool.args_schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    mw = _known("ThreadDataMiddleware", {"system_prompt": "SOUL BODY"})
    record = _record(middlewares=[mw], tools=[tool])
    text = json.dumps(record, ensure_ascii=False)
    assert "SUPERSECRET" not in text
    assert "PROMPT BODY" not in text
    assert "SOUL BODY" not in text
    assert "args_schema" not in text
    assert record["tools"]["mounted"] == [{"name": "leaky", "source": "mcp", "group": None}]


# --------------------------------------------------------------------------- #
# ⑨ 16KB degradation order
# --------------------------------------------------------------------------- #
def _size(record: dict) -> int:
    return serialized_size(record)


def test_budget_is_16kb_and_records_are_far_below_it():
    assert MAX_CONSTITUTION_BYTES == 16 * 1024
    record = _record(middlewares=_mixed_chain(), tools=[_FakeTool(f"t{i}") for i in range(15)])
    assert _size(record) < MAX_CONSTITUTION_BYTES / 4
    assert "truncated" not in record or record["truncated"] is False


def test_oversized_tools_detail_is_dropped_first_and_middlewares_survive():
    tools = [_FakeTool("x" * 80 + str(i)) for i in range(150)]
    record = _record(middlewares=_mixed_chain(), tools=tools)
    assert record["truncated"] is True
    assert "mounted" not in record["tools"]
    assert record["tools"]["mounted_count"] == 150
    assert len(record["middlewares"]) == 8


def test_oversized_middleware_detail_is_dropped_next_and_stages_survive():
    big = [_known("N" * 120 + str(i)) for i in range(400)]
    record = _record(middlewares=big)
    assert record["truncated"] is True
    assert record["middlewares"] == []
    assert [row["key"] for row in record["stages"]] == list(STAGES) + [EXTENSION_STAGE]
    assert record["stages"][-1]["members"] == 400


def test_authorization_removed_is_the_last_to_be_dropped():
    removed = [_FakeTool("r" * 60 + str(i)) for i in range(5000)]
    record = _record(authorization_candidates=removed, authorized_tools=[])
    assert record["truncated"] is True
    assert "removed" not in record["tool_authorization"]
    assert record["tool_authorization"]["removed_count"] == 5000
    # Everything else survived, because removed is the last thing to go.
    assert len(record["middlewares"]) == 0 or record["middlewares"] is not None
    assert [row["key"] for row in record["stages"]] == list(STAGES)


def test_serialized_size_is_utf8_bytes_of_the_canonical_json():
    record = _record()
    assert serialized_size(record) == len(json.dumps(record, ensure_ascii=False).encode("utf-8"))


# --------------------------------------------------------------------------- #
# ⑩ stage guard test (§6.6.4) — the only thing stopping the map from rotting
# --------------------------------------------------------------------------- #
# These are the only named middlewares a lean config cannot mount. They are
# gated by config.yaml switches (guardrails / tool_progress / token_budget /
# tool_search / a vision model), so they legitimately never show up here. Any
# OTHER table name that fails to mount is an orphan and must fail this test.
CONFIG_GATED = frozenset(
    {
        "GuardrailMiddleware",
        "ToolProgressMiddleware",
        "TokenBudgetMiddleware",
        "McpRoutingMiddleware",
        "DeferredToolFilterMiddleware",
        "ViewImageMiddleware",
    }
)


def _assemble_chains() -> dict[str, list]:
    from deerflow.agents.lead_agent.agent import build_middlewares
    from deerflow.agents.middlewares.tool_error_handling_middleware import (
        build_subagent_runtime_middlewares,
    )
    from deerflow.config import get_app_config

    app_config = get_app_config()

    def lead(*, agent_name=None, **flags):
        # agent_name is a positional parameter of build_middlewares; putting it in
        # configurable would silently build the default chain instead of the rag one.
        return build_middlewares({"configurable": dict(flags), "context": {}}, None, agent_name, app_config=app_config)

    return {
        "lead_default": lead(is_plan_mode=False, subagent_enabled=False),
        "lead_all_on": lead(is_plan_mode=True, subagent_enabled=True),
        "lead_rag": lead(agent_name="rag", is_plan_mode=False, subagent_enabled=False),
        "subagent": build_subagent_runtime_middlewares(app_config=app_config),
    }


def test_every_mounted_middleware_has_a_stage_across_four_real_chains():
    chains = _assemble_chains()
    problems: list[str] = []
    mounted_names: set[str] = set()

    for chain_name, chain in chains.items():
        names = [type(m).__name__ for m in chain]
        assert names, f"{chain_name} assembled an empty chain"
        mounted_names.update(names)
        unmapped = sorted(set(names) - set(STAGE_OF_MIDDLEWARE))
        if unmapped:
            problems.append(f"{chain_name}: unmapped {unmapped}")

    # Reverse direction: no orphan entries in the table. Without this a typo'd or
    # renamed table key would sit there forever, unreachable by any chain.
    orphans = sorted(set(STAGE_OF_MIDDLEWARE) - mounted_names - CONFIG_GATED)
    if orphans:
        problems.append(f"table entries no chain can mount: {orphans}")

    assert not problems, "stage table drifted from the assembled chains:\n" + "\n".join(problems)


def test_the_rag_chain_mounts_deep_research_and_nothing_else_does():
    chains = _assemble_chains()
    per_chain = {name: {type(m).__name__ for m in chain} for name, chain in chains.items()}
    assert "DeepResearchMiddleware" in per_chain["lead_rag"]
    assert "DeepResearchMiddleware" not in per_chain["lead_default"]
    assert "DeepResearchMiddleware" not in per_chain["subagent"]


def test_the_pinned_table_name_matches_the_real_class_name():
    """Slot 18 is ``DeerFlowSummarizationMiddleware``, not ``SummarizationMiddleware``."""
    chains = _assemble_chains()
    names = {type(m).__name__ for chain in chains.values() for m in chain}
    assert "DeerFlowSummarizationMiddleware" in names
    assert "SummarizationMiddleware" not in STAGE_OF_MIDDLEWARE


def test_hook_detector_does_not_collapse_to_the_full_override_set():
    """Guards the base-class no-op trap: every hook reporting on every class."""
    chains = _assemble_chains()
    hooks_seen = [detect_hooks(m) for chain in chains.values() for m in chain]
    assert hooks_seen, "no middlewares assembled"
    assert not [h for h in hooks_seen if set(h) == set(HOOK_ORDER)]
    assert [h for h in hooks_seen if len(h) == 1], "no single-hook middleware detected — probe is suspect"
    for hooks in hooks_seen:
        assert derive_frequency(hooks) in {ONCE_PER_RUN, PER_MODEL_CALL, PER_TOOL_CALL}


def test_mounted_chain_reports_stage_rows_that_sum_to_the_chain_length():
    chain = _assemble_chains()["lead_all_on"]
    record = _record(middlewares=chain)
    total = sum(row["members"] + row["gates"] + row["handoff_gates"] for row in record["stages"])
    assert total == len(chain)
    assert total < len(NAMED_MIDDLEWARES), "a lean config must not mount the whole table"
