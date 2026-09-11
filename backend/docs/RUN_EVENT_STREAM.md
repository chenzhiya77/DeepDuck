# Run Event Stream

The run event stream is DeerFlow's append-only record of what happened during
an agent run. Producers write through `RunEventStore`; history, debug, subtask,
memory-audit, and workspace-review consumers read projections of the same rows.

The machine-readable contract is
`contracts/run_event_stream_contract.json`. Canonical event names and
categories live in `deerflow.runtime.events.catalog`; conformance tests require
the runtime catalog and JSON contract to match exactly.

## Record Envelope

Every persisted event has these required fields:

| Field | Meaning |
| --- | --- |
| `thread_id` | Thread that owns the event. |
| `run_id` | Run that produced the event. |
| `seq` | Store-assigned sequence, strictly increasing within a thread. |
| `event_type` | Fixed event name or documented dynamic pattern. |
| `category` | Consumer-routing bucket. |
| `content` | Event payload, normally a string or JSON object. |
| `metadata` | Filterable or audit metadata. |
| `created_at` | Timezone-aware ISO-8601 timestamp. |

Backends may return additional fields. `DbRunEventStore`, for example, returns
`user_id` and may add serialization markers such as `content_is_json` to
metadata. Consumers must ignore unknown envelope and metadata fields.

`event_type` is limited to 32 characters and `category` to 16 characters by the
database schema. Catalog-backed definitions enforce the same limits before
writing so they cannot emit values that only the memory or JSONL store accepts.

`seq` is thread-global, not run-local. Memory and database stores assign it
monotonically for their supported deployment modes. JSONL only provides this
guarantee within one process; shared multi-process deployments must use the
database store.

## Categories

`category="message"` means an event is eligible for a message projection; it
does not guarantee that the row is visible in the UI. Thread-history APIs also
filter middleware model calls, subagent AI responses, and superseded regenerate
runs, and the frontend honors message-level visibility markers such as
`hide_from_ui`. Subagent events remain available through the run-events
endpoint; parent `task` ToolMessages remain in thread history so subtask cards
can restore their terminal status after reload.

All other categories are excluded from message projections and are available
through run-event or specialized APIs:

| Category | Purpose |
| --- | --- |
| `trace` | Execution evidence. |
| `outputs` | Root graph completion output and terminal delivery receipt. |
| `error` | Callback-observed failure evidence. |
| `middleware` | Middleware state-change audit evidence. |
| `context` | Effective hidden-context identity. |
| `subagent` | Subagent lifecycle and step history. |
| `workspace` | Workspace/output file-change evidence. |

## Producers

`RunJournal` emits callback-derived events:

| Event type | Category | Producer |
| --- | --- | --- |
| `run.start` | `trace` | Root `on_chain_start()` |
| `run.end` | `outputs` | Root `on_chain_end()` |
| `run.error` | `error` | `on_chain_error()` |
| `llm.human.input` | `message` | First persisted lead-agent human input |
| `llm.ai.response` | `message` | `on_llm_end()` |
| `llm.tool.result` | `message` | `on_tool_end()` |
| `llm.error` | `trace` | `on_llm_error()` |
| `context:memory` | `context` | `record_memory_context()` |
| `middleware:{tag}` | `middleware` | `record_middleware()` |

Current middleware tags are `guardrail`, `safety_termination`,
`skill_activation`, and `skill_secrets`. The pattern is intentionally open so
new middleware tags are additive. Because the full event type is limited to 32
characters and `middleware:` uses 11, a tag must contain 1-21 characters.

### Gate Events

Six more tags are emitted when a gate **actually changes execution** — it blocks
a tool call, drops delegations, or releases deferred tool schemas. Observation
alone does not emit: e.g. `ToolOutputBudgetMiddleware` externalizing an oversized
result is not a gate event, but a blocked write is.

Every gate tag that blocks a specific tool call carries `tool_call_id`, which is
what lets a UI attach the notice to that call's card. `subagent_limit` drops a
**batch**, so it carries `dropped_tool_call_ids` (array, message order) instead;
`tool_promotion` blocks nothing and carries neither.

| Tag | Emitted when | `changes` |
| --- | --- | --- |
| `read_gate` | A write is blocked because the target was not read first (content-hash mark missing/mismatched). | `tool_name`, `tool_call_id`, `path` (virtual), `reason` |
| `tool_progress` | A tool's stagnation state escalates. `action` is `warn` or `block`. | `tool_name`, `tool_call_id`, `from_phase`, `to_phase`, `consecutive_problems`, `error_type`, `block_reason` |
| `subagent_limit` | Excess `task` calls are truncated. | `dropped_count`, `dropped_tool_call_ids`, `requested_count`, `allowed`, `cap` (`per_response_concurrency` \| `per_run_total`), `prior_delegations`, `remaining_total` |
| `tool_promotion` | Deferred MCP tool schemas are released. | `source` (`model` \| `auto_routing`), `names`, `count`, and `top_k` for the routing path |
| `sandbox_audit` | A `bash` command is blocked by position-based command-substitution rules. | `tool_name`, `tool_call_id`, `verdict`, `reason` |
| `skill_policy` | A tool outside the active skill's `allowed-tools` is blocked. | `tool_name`, `tool_call_id`, `policy_source` (`slash` \| `skill_context`), `active_path_count` |

Three properties hold for every one of them:

- **`changes` never carries the content that was blocked.** No command text, no
  file contents, no retrieval query, no secret values — only the decision facts.
  This follows `safety_finish_reason_middleware`'s rule of not persisting the very
  content the provider filtered.
- **Best-effort on both channels, and neither can change execution.** The journal
  leg silently skips when `__run_journal` is absent (embedded client, subagent
  runs) and swallows any `record_middleware` failure with a warning; the live leg
  skips when there is no stream writer and swallows a failed frame the same way.
- **Dual-delivered: a live `custom` SSE frame *and* this persisted event**, with
  the same payload on both. A gate acting is exactly the moment a run "goes quiet",
  and the journal's write buffer only flushes at `flush_threshold` — journal-only
  events would land after the run ended, too late to explain anything. The live
  frame deliberately does **not** depend on the journal, because embedded clients
  have no journal but do stream custom events. IM channels are unaffected: they
  subscribe to `messages-tuple` and `values` only, never `custom`.

`tool_progress` only emits on a **phase transition**, not on every problem call:
the state machine is hysteretic (three consecutive problems to escalate, a good
result resets it, `blocked` is terminal), so one run produces a handful of events
rather than one per tool call.

### Run-Start Constitution Payload

`run.start.content` always carries `chain`, and carries `constitution` on the
**first** root chain start of a run.

- **Why only the first**: a run emits one `run.start` per `astream` — the user
  turn plus every hidden goal continuation re-trigger the root chain. The journal
  attaches the snapshot to the first one only, so a run never persists the same
  payload twice.
- **Where it comes from**: the agent factory publishes it from the locals it just
  used to build the graph (the mounted middleware chain, the mounted tool
  catalogue, and the Layer-1 authorization diff). It is a record of *what was
  assembled*, not a re-derivation from config.
- **It can be absent**: no snapshot is published for embedded clients, for a
  custom `agent_factory`, or for a run with no event store. `run.start` is then
  byte-identical to what it was before this field existed.
- **`stages[]` carries only stage keys and counts — never a middleware name.**
  That is what lets an end-user view be a curated projection instead of a
  filtered subset of internals.
- **`category: "trace"`** keeps the payload out of message projections, so it
  never enters the IM channel reply allowlist.
- **Budget**: capped at `MAX_CONSTITUTION_BYTES` (16 KB) with a fixed degradation
  order — drop the `tools.mounted` detail, then the `middlewares` detail, and
  `tool_authorization.removed` last; `truncated: true` marks any of them. Tool
  name lists are capped at `MAX_TOOL_NAMES` (200) each for `mounted` and
  `deferred_names`.

### Opaque Run Outputs

`run.end.content` is the root graph output and is intentionally opaque. Its
nested representation is not currently identical across storage backends:

- `MemoryRunEventStore` retains the original Python container and nested
  values.
- `JsonlRunEventStore` and `DbRunEventStore` serialize through
  `json.dumps(default=str)`, so nested values that are not directly JSON
  serializable are read back as strings.

Consumers may use `run.end` as completion evidence, but must not depend on
backend-identical nested output values. Normalizing those values would be a
separate runtime compatibility change rather than part of this current-state
contract.

`subagents/step_events.py::subagent_run_event()` maps streamed `task_*` chunks
to persisted events. The worker batches them through `put_batch()`:

| Event type | Source chunk | Required content |
| --- | --- | --- |
| `subagent.start` | `task_started` | `task_id`, `description` |
| `subagent.step` | `task_running` | `task_id`, `message_index`, `kind`, `text`, `truncated`; AI steps add `tool_calls`, tool steps add `tool_name` |
| `subagent.end` | terminal `task_*` | `task_id`, `status`; optional model, usage, result/error, and truncation fields |

Terminal subagent status is one of `completed`, `failed`, `cancelled`, or
`timed_out`.

Malformed lifecycle chunks are not persisted. Every chunk requires a non-empty
string `task_id`; `task_running` additionally requires a non-negative integer
`message_index` and a message object.

`workspace_changes.record_workspace_changes()` writes `workspace_changes` in
category `workspace` when a run changed files. Its string content is a summary;
the structured versioned summary, file list, and limits live in
`metadata.workspace_changes`.

`runtime.runs.worker._persist_delivery_receipt()` writes `run.delivery` in
category `outputs` once per run, through an idempotent write so crash recovery can
safely backfill it. It answers "did this run hand over what it produced" —
`presented` / `paths` / `by_tool` record what `present_files` handed over, and a
run that **produced** output artifacts additionally carries a verdict:
`verification`, `produced_paths`, `presented_paths`, `matched_paths`, `stage`
(`presented` | `mismatched` | `not_started`) and `satisfied`.

**Two shapes, and the verdict is the switch.** A run that produced no output
artifacts emits only the base record, with no verdict fields at all — that is the
majority shape, so a consumer must switch on the presence of `satisfied`, never on
the event's presence. Note also that `satisfied` means *at least one* produced
output was handed over: `matched_paths` may be shorter than `produced_paths`, so
`presented` is not a claim that everything was handed over. A run that produced
outputs without satisfying delivery ends as `error` with
`Artifact delivery incomplete: no produced output artifact was presented`.

The JSON contract defines required and optional payload fields using JSON
Schema. It is the authoritative field-level reference.

## Consumers

| Consumer | Read path and behavior |
| --- | --- |
| Frontend thread history | `GET /api/threads/{thread_id}/messages/page` scans `list_messages()`, removes middleware rows, subagent AI responses, and superseded regenerate runs, then applies frontend message visibility rules. |
| Per-run message clients | Thread-scoped and stateless run message endpoints call `list_messages_by_run()`. |
| Run debug/audit | `GET /api/threads/{thread_id}/runs/{run_id}/events` calls `list_events()` and supports `event_types`, `task_id`, `limit`, and `after_seq`. |
| Historical subtask cards | Fetch `subagent.step` through the run-events endpoint, filtered and paginated by `task_id`. |
| Memory audit | Filters run events to `context:memory` and compares `content_sha256`; full memory text is not duplicated into the event store. |
| Workspace review | `GET /api/threads/{thread_id}/runs/{run_id}/workspace-changes` projects the latest `workspace_changes` payload. |

Token and cost summaries are not reconstructed by reading event rows.
`RunJournal` accumulates usage while callbacks fire, and the worker writes the
aggregates to `RunRow`.

External Langfuse/LangSmith tracing is a parallel callback pipeline, not a
`RunEventStore` consumer. It is correlated through trace metadata rather than
being derived from these rows.

Evaluation consumers discussed in #4243 are planned rather than present in
this tree. They should read evidence through `list_events()` and treat the
compatibility and terminal-state limits below as part of that integration.

## Compatibility

The existing mixture of dot-separated, colon-separated, and bare-word names is
frozen. This contract documents current behavior; it does not normalize names.
A rename, removal, category change, required-field removal, or required-field
type change is breaking and needs an explicit versioned migration or dual-write
period.

Adding a new event type or optional field is additive. Consumers must ignore
unknown event types and unknown optional fields. Producers must add a catalog
entry, update the JSON contract and this document, and extend the conformance
tests in the same change.

`ai_message` is a read-only legacy alias for `llm.ai.response`. Current
producers never emit it. Category-based message projections and store queries
for the last visible AI message recognize previously persisted alias rows, so
the `/messages/page` endpoint also attaches feedback correctly. The legacy
`/messages` endpoint still returns those rows but only enriches feedback for the
canonical name. Legacy aliases live outside the canonical catalog and must not
be used by new producers.

## Known Gaps

- Tool-call intent is embedded in `llm.ai.response.content.tool_calls`; it is
  not a first-class event. A missing or timed-out result may have no dedicated
  outcome event.
- `run.end.metadata.status` is only a root graph completion marker and is
  always `success`. `RunRow.status` remains authoritative for lifecycle state,
  and worker loss may leave no terminal event.
- Nested non-JSON values in `run.end.content` have backend-dependent
  representations: memory retains Python values, while JSONL and database
  stores read them back as strings.
- Loop detection and deferred-tool promotion do not currently emit middleware
  events.
- Journal attribution, token accounting, and external tracing metadata still
  depend on manual instrumentation at several LLM call sites.
