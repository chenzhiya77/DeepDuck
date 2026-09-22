# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with the DeerFlow frontend. It is the source of truth; the sibling `CLAUDE.md` imports it via `@AGENTS.md`.

## Project Overview

DeerFlow Frontend is a Next.js 16 web interface for an AI agent system. It communicates with a LangGraph-based backend to provide thread-based AI conversations with streaming responses, artifacts, and a skills/tools system.

**Stack**: Next.js 16, React 19, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2. Requires Node.js 22+ and pnpm 10.26.2+.

### Core dependencies

- **LangGraph SDK** (`@langchain/langgraph-sdk` ^1.5.3) — Agent orchestration and streaming
- **LangChain Core** (`@langchain/core` ^1.1.15) — Fundamental AI building blocks
- **TanStack Query** (`@tanstack/react-query` ^5.90.17) — Server state management
- **UI**: Shadcn UI, MagicUI, React Bits, and Vercel AI SDK elements (generated from registries — see Code Style)

## Commands

| Command          | Purpose                                           |
| ---------------- | ------------------------------------------------- |
| `pnpm dev`       | Dev server with Turbopack (http://localhost:3000) |
| `pnpm build`     | Production build                                  |
| `pnpm check`     | Lint + type check (run before committing)         |
| `pnpm lint`      | ESLint only                                       |
| `pnpm lint:fix`  | ESLint with auto-fix                              |
| `pnpm format`    | Prettier check (`pnpm format:write` to apply)     |
| `pnpm test`      | Run unit tests with Rstest                        |
| `pnpm test:e2e`  | Run E2E tests with Playwright (Chromium)          |
| `pnpm typecheck` | TypeScript type check (`tsc --noEmit`)            |
| `pnpm start`     | Start production server                           |

Unit tests live under `tests/unit/` and mirror the `src/` layout (e.g., `tests/unit/core/api/stream-mode.test.ts` tests `src/core/api/stream-mode.ts`). Powered by Rstest; import source modules via the `@/` path alias.

Rstest runs them as two projects (`rstest.config.ts`). `*.test.ts` / `*.test.tsx` run in a plain **node** environment — that is nearly the whole suite, and it is the default for anything that is pure logic. `*.dom.test.ts` / `*.dom.test.tsx` run in **happy-dom**, for tests that need a document: hooks driven through `renderHook` from `@testing-library/react`, and components. Keep the split — a DOM environment costs roughly 3x the runtime of the node suite, so tests that do not render should not opt into it. A hook whose behavior only exists under real React (effect ordering, cleanup on unmount, re-render on store change) belongs in a `.dom.test.*` file rather than a node test that mocks `react` itself.

E2E tests live under `tests/e2e/` and use Playwright with Chromium. They mock all backend APIs via `page.route()` network interception and test real page interactions (navigation, chat input, streaming responses). Config: `playwright.config.ts`.

## Architecture

```
Frontend (Next.js) ──▶ LangGraph SDK ──▶ LangGraph Backend (lead_agent)
                                              ├── Sub-Agents
                                              └── Tools & Skills
```

The frontend is a stateful chat application. Users create **threads** (conversations), send messages, set thread-scoped `/goal` completion conditions, and receive streamed AI responses. The backend orchestrates agents that can produce **artifacts** (files/code), **todos**, and goal state updates.

### Source Layout (`src/`)

- **`app/`** — Next.js App Router. Routes include `/` (landing), `/showcase/[thread_id]` (allowlisted public read-only demos), `/workspace/chats/[thread_id]` (authenticated chat), `/workspace/knowledge` (RAG knowledge-base workspace: three-column page — kb list, middle tab strip, kb-bound chat panel; its threads carry `metadata.kb_id` and are excluded from the global recent-chat list. `middle-tabs.tsx` mounts six forceMount keep-alive tabs — documents / wiki / recall-test / vector space / knowledge graph / evaluation; the eval tab (`eval-tab.tsx`) renders the metrics overview + ECharts trend canvas (both lazy-gated by `enabled: activeTab === "eval"` so hidden panes never fetch) and drills into a run via `EvalRunDrawer` on trend-point click; see `core/knowledge/types.ts` for the wire contracts), `/workspace/agents/[agent_name]` and `/workspace/agents/new` (custom agents), `/blog/…`, the `(auth)/{login,setup,auth/callback}` flow, `/[lang]/docs/…`, and `/api/…` route handlers (e.g. `/api/memory`).
- **`components/`** — React components:
  - `ui/` — Shadcn UI primitives (auto-generated, ESLint-ignored)
  - `ai-elements/` — Vercel AI SDK elements (auto-generated, ESLint-ignored)
  - `workspace/` — Chat page components (messages, artifacts, settings)
  - `landing/` — Landing page sections
  - `docs/` — Docs / MDX rendering components
- **`core/`** — Business logic, the heart of the app. Domains include `threads/` (creation, streaming, state), `api/` (LangGraph client singleton), `agents/` (custom agents), `auth/` (authentication), `artifacts/`, `channels/` (IM connections), `integrations/` (managed third-party integration status/install clients such as Lark CLI), `i18n/` (en-US, zh-CN), `settings/`, `memory/`, `skills/`, `messages/`, `mcp/`, `models/`, `input-polish/` (pre-send draft rewrite API), `knowledge/` (RAG knowledge-base API client, TanStack Query hooks with polling, kb-thread isolation predicates, citation extraction), `voice-input/` (browser speech-recognition helpers), `suggestions/`, `tasks/`, `todos/`, `tools/`, `workspace-changes/` (run-scoped changed-file summaries and diff fetching), `config/`, `notification/`, `pet/` (observer pet sprite: pure state derivation, tool classification, fatigue scoring, sprite resolution and placement clamping; the components that consume them live under `components/workspace/pet/`), `blog/`, plus rendering helpers (`rehype/`, `streamdown/`) and `utils/`.
- **`hooks/`** — Shared React hooks
- **`lib/`** — Utilities (`cn()` from clsx + tailwind-merge)
- **`content/`** — MDX content (blog posts, docs) rendered by the app
- **`styles/`** — Global CSS with Tailwind v4 `@import` syntax and CSS variables for theming
- **`typings/`** — Ambient TypeScript declarations
- Root files: `env.js` (env validation), `mdx-components.ts` (MDX component map)

### Data Flow

1. Optional composer helpers such as `core/input-polish` can rewrite the local draft before submission, and `core/voice-input` can transcribe browser microphone input into that same local draft; confirmed user input then flows to thread hooks (`core/threads/hooks.ts`) → LangGraph SDK streaming
2. Stream events update thread state (messages, artifacts, todos, goal). The main thread stream uses the LangGraph SDK's `throttle: true` mode so updates received in the same macrotask coalesce before React is notified; do not replace it with a numeric delay without validating the SDK's trailing-debounce behavior on a continuous stream.
   File-tool artifact auto-open work must run in an effect with timer cleanup; never schedule timers while rendering streamed `write_file` or `str_replace` updates.
   `ThreadState.artifacts` remains the authoritative artifact list. The artifacts provider persists only thread-scoped panel UI state (`open`, selected path, and a refresh bootstrap cache) in session storage; an initial empty stream value must not overwrite that restored state before history finishes loading.
   Formal artifact content is refreshed once when the run finishes; transient `write-file:` previews remain message-driven.
   The detail view exposes explicit editing only for an already-opened formal UTF-8 text artifact under `/mnt/user-data/outputs`. Drafts stay in provider memory until Save so switching right-side panels cannot discard them, render in Markdown/HTML preview, and are protected from remote refreshes by the loaded SHA-256 revision. Saving is disabled during an active run; a changed revision preserves the draft and surfaces a conflict instead of overwriting agent output.
   Regular artifact text loads request at most the first 1 MiB through an HTTP
   byte range. A truncated preview must stay lightweight and expose an explicit
   full-file action; do not mount CodeMirror for that artifact until the user
   requests and receives the complete content. The Gateway retains range
   ownership and returns 206/416 through `FileResponse`.
3. `useThreadHistory` loads persisted conversation pages from `GET /api/threads/{id}/messages/page`, preserving the backend's thread-global event `seq`; rendering overlays checkpoint/live copies at their matching canonical identities (a summarized checkpoint may contain a protected early input plus a recent tail). Context-compaction rescue diffs every retained visible identity rather than slicing at the first anchor, and keeps a run-scoped ledger of committed visible messages so replacement updates and repeated rolling checkpoint windows cannot erase an already displayed step. The resolver suppresses checkpoint/transient prefixes whose canonical position is still behind an unloaded cursor page instead of collapsing that unknown gap before a recent anchor, then adds optimistic messages without timestamp re-sorting. History invalidation preserves already-loaded pages so their established ordering positions are not discarded. Dynamic context re-keys the submitted user message from `X` to `X__user`; UI identity matching normalizes that reserved suffix only for human messages so the submitted frame and checkpoint replacement remain one visible turn. A locally submitted turn also records its pre-submit identity baseline: if `messages-tuple` publishes new AI/tool steps before `values` publishes that turn's human message, render ordering moves only those non-baseline visible steps behind the new human while leaving history, hidden controls, and reconnected runs untouched. Keep that local order anchor through finish, stop, and stream error because the SDK's settled frame can retain transient event order; replace it on the next local submit and clear it on thread switch or replay-gap recovery.
4. Stop actions call the LangGraph SDK stream stop path; `core/threads/hooks.ts` invalidates current-thread, thread-history, token-usage, and sidebar/search caches immediately and schedules one follow-up refetch because SDK stop may finish via abort + fire-and-forget cancel before backend title finalization commits
5. TanStack Query manages server state; localStorage stores user settings. The
   Settings > Tools MCP switch calls the targeted `PATCH /api/mcp/config`
   mutation, disables switches until that mutation's success refetch completes,
   displays the backend error `detail` through a toast, and invalidates
   `["mcpConfig"]` only after success.
6. Components subscribe to thread state and render updates

The chat header's context-window control is intentionally persistent: while `context_usage` is unavailable, `ContextUsageBadge` renders a gauge placeholder rather than unmounting; once data arrives, the same position shows the percentage. `useThreadTokenUsage` retains placeholder data only when the response `thread_id` still matches the active route, so same-thread refetches do not flicker and cross-thread navigation never displays the previous chat's usage.

Run duration is run-scoped UI metadata even though the compatibility field `additional_kwargs.turn_duration` is repeated on historical AI messages. `core/messages/run-duration.ts` folds those copies into one display anchored after the run's last visible message group. `MessageList` owns the temporary client-side duration for a just-completed live turn until authoritative history arrives. The duration is total run wall-clock time, not per-message reasoning time; reasoning disclosure and run activity/duration are rendered separately.

The workspace-change card follows the same rule: it is resolved from `(threadId, runId)` alone, so every AI message of a run would render an identical copy. A run ends in more than one terminal assistant bubble whenever the model emits answer text that never gains a tool call, so `core/messages/workspace-change-anchor.ts` picks the run's last assistant bubble and `MessageListItem` renders the badge only for that anchor (#4555). Any future run-scoped display belongs in the same place — do not hang one off every message. The two anchor helpers deliberately differ in which group types they accept as a run's last position, because an anchor is only useful where the display is actually rendered: run duration is emitted by `MessageList` around every group, so it accepts any type, while the workspace-change card comes from `MessageListItem` and so restricts to `assistant`. Keep a new helper's candidate set matched to its own render site rather than unifying them.

Composer drafts are tab-scoped browser state. `core/threads/composer-draft.ts` stores only text plus the selected slash-skill name in `sessionStorage`, keyed by user, agent, and logical conversation scope. New-chat pages pass the stable scope `"new"` because their runtime `threadId` is a fresh UUID on every reload; established conversations use their real thread ID. `InputBox` waits for enabled skills before restoring a skill chip, degrades a missing/disabled skill back to editable slash text, and clears the stored draft through `SendMessageOptions.onSent` only after the send passes the in-flight guard. Attachments, sidecar quotes, voice state, and polish undo state are not persisted.

Auth UI note: the login page's "keep me signed in" option submits only `remember_me` to the Gateway and may persist only the email address through `core/auth/remember-login.ts`. Passwords and tokens must never be stored in frontend storage; the `HttpOnly access_token` and readable `csrf_token` cookies remain Gateway-owned.

`/goal` and `/compact` are built-in composer commands, not skill activations. `src/components/workspace/input-box.tsx` intercepts `/goal`, `/goal clear`, and `/goal <condition>` before normal chat submission, calling Gateway `GET/PUT/DELETE /api/threads/{thread_id}/goal`. Setting `/goal <condition>` also submits the condition text as the next user task so the agent starts running immediately; status and clear do not start a run. Goal and compact requests are tied to the current `threadId` with an `AbortController`, so switching threads or unmounting the composer aborts in-flight requests and stale responses cannot update the new thread's composer state. The chat pages render `GoalStatus` above the composer from `AgentThreadState.goal`, with local optimistic state until the next stream `values` update arrives. `/compact` calls `POST /api/threads/{thread_id}/compact` to summarize older active context while leaving the full visible chat history intact; it is skipped on new/empty threads and blocked server-side while a run is in flight. Thread rename uses the same serialized state-write route; the rename dialog stays open and surfaces the server error when an active run returns 409.

The `/` skill list stays reachable after a skill is selected: typing `/` in the editable text beside the chip reopens it, and picking an entry swaps the chip rather than adding a second one, because the wire format carries exactly one leading `/skill`. That list offers skills only while a chip is selected — a builtin command owns the whole composer line, so `/goal` behind a selected skill would submit as chat text instead of running the command. The trigger itself is unchanged: a slash only opens the list at the start of the input (`getLeadingSlashSkillQuery`), pinned by `tests/e2e/chat.spec.ts`.

Human input requests are a structured message protocol layered on normal chat history. The backend writes request payloads to `ToolMessage.artifact.human_input`, `src/core/messages/human-input.ts` owns the runtime validators/types, and `src/components/workspace/messages/human-input-card.tsx` renders the reusable card. The protocol is versioned on the request side only: v1 covers `free_text` / `choice_with_other`, and v2 adds `form` (typed fields — text/textarea/number/select/multi_select/checkbox/date — with required-field validation in the card). Replies deliberately stay on the v1 response protocol: the form card submits a `response_kind: "text"` reply whose value is the human-readable summary plus one JSON block keyed by stable field names (`buildHumanInputFormSubmissionValue` — the readable part alone is ambiguous because labels/values may contain the separators), so the model can reconstruct the submitted mapping without a structured response kind. The validators reject unknown versions/modes (and field names colliding with JS `Object.prototype` members) so future protocol bumps degrade to the plain-text ToolMessage fallback rather than rendering a broken card. Form values are read through own-property access only (`readHumanInputFormValue`); select fields stay controlled from their empty-string placeholder state through selection; checkbox fields are native `<input type="checkbox">` controls seeded to an explicit `false` (`buildInitialHumanInputFormValues`) so an untouched checkbox submits as "no" while a `required` checkbox keeps must-agree semantics (no HTML `required` attribute — native constraint validation would intercept the custom submit path), and form controls carry label/`htmlFor`, `aria-required` plus a visually-hidden localized "required" marker, and `aria-invalid`/error associations whose error node stays mounted while any field is still invalid. Composer-bypass closure: `deriveHumanInputThreadState` treats a visible plain human message as answering the latest unanswered request opened before it (only the latest — nothing guarantees a single outstanding request across runs, and closing all would silently swallow older decisions; an older request left open simply becomes the active card again). This lets current users bypass a structured form through the normal composer and preserves compatibility with old v1-only frontends that degrade a v2 request to plain text. `MessageList` owns answered/latest/pending state for visible cards, but derives answered responses from raw `thread.messages` because replies are hidden; pending cards clear when the hidden reply appears, when dispatch is dropped, or when a new `thread.error` reports an async stream failure. Page-level card submit callbacks must send a normal human message and put `hide_from_ui: true` plus the response payload in the fourth `sendMessage(..., options)` argument as `options.additionalKwargs`; the third argument remains run context such as `{ agent_name }`. Composer entry points remain enabled while a human-input request is open; a normal visible message intentionally bypasses the card and starts the next run without structured response metadata.

Tool-calling AI messages can contain user-visible text as well as `tool_calls`. `core/messages/utils.ts` keeps these turns in an `assistant:processing` group, and `components/workspace/messages/message-group.tsx` must render the visible text as a processing step instead of treating the message as only tool metadata. This preserves provider text such as error explanations or "trying another approach" notes during tool-heavy runs.
While the current turn is still loading, a content-only AI message after the latest visible human input also stays in that processing group until the turn settles: a provider may append tool-call chunks to the same message later, and classifying it as a final assistant bubble too early makes the text jump into the steps panel. `MessageGroup` therefore renders processing text even before the first tool call arrives.
The same rule applies after an earlier tool call: a later content-only AI message remains visible after the current last tool-call step while streaming, because that message may itself gain another tool call before the turn settles.
Because the same message is rendered by two different components over its lifetime, reasoning must sit above the answer text in both. `MessageListItem` paints the settled bubble's `<Reasoning>` disclosure above its content, so `MessageGroup` puts the trailing reasoning disclosure above the assistant text that follows it and `convertToSteps` emits a message's reasoning step before its content step — otherwise the two swap places the instant the turn settles (#4576). Assistant text emitted _before_ that reasoning keeps its earlier position; only the answer the reasoning produced moves below it.

Edit-and-rerun is deliberately latest-turn-only. `core/messages/utils.ts::getLatestEditableTurn()` exposes a human turn only when the transcript is idle and the most recent visible turn ends in a terminal assistant message. `core/threads/hooks.ts::editAndRegenerateMessage()` calls `POST /api/threads/{id}/runs/edit-regenerate/prepare`, submits the returned replacement message/checkpoint/metadata through the same LangGraph stream path as regenerate, optimistically hides the superseded message ids, and clears the optimistic replacement once the persisted replacement arrives.

`MessageGroup` builds its tool-result and browser-preview lookups once per processing group before converting messages to steps. The lookup preserves the first non-empty result and first screenshot-bearing browser view for each tool-call ID, matching the streamed-message display semantics without repeatedly scanning the full group for every tool call.

### Key Patterns

- **Server Components by default**, `"use client"` only for interactive components
- **Static root boundary** — `src/app/layout.tsx` must not read cookies or import
  chat-only KaTeX/Streamdown styles. Auth and workspace layouts own the cookie-derived
  locale provider; docs derive locale from their route, and blog owns its preference
  cookie. Public server routes load one dictionary at a time through
  `core/i18n/translations.ts`; the interactive auth/workspace client provider owns both
  formatter-bearing dictionaries because functions cannot cross the RSC boundary.
  Keep public `/` static and keep rich-content CSS on the routes that render it.
- **Thread hooks** (`useThreadStream`, `useSubmitThread`, `useThreads`) are the primary API interface
- **Thread routes** — construct Web UI chat paths through `core/threads/utils.ts::pathOfThread()`, which percent-encodes both custom agent names and thread IDs before inserting them into route segments
- **LangGraph client** is a singleton obtained via `getAPIClient()` in `core/api/`
- **Run stream options** are sanitized by `core/api/stream-mode.ts`: the Gateway-supported set is `values`, `messages-tuple`, `updates`, `debug`, `tasks`, `checkpoints`, and `custom`; any request containing an unsupported mode throws before HTTP instead of being partially forwarded or silently defaulting to `values`. `streamResumable` is retained by thread hooks only for SDK-side reconnect bookkeeping but stripped before the HTTP request because the Gateway does not accept that request option; actual replay uses the SSE `Last-Event-ID` cursor. Keep this boundary aligned with the backend request schema; `messages` and `events` are not supported and must not be forwarded.
- **SSE replay gaps** are handled in `core/api/api-client.ts`, which wraps both initial and joined run streams because the upstream SDK ignores unknown event names. An id-less backend `gap` control frame clears stale reconnect metadata, emits an internal `stream_replay_gap` custom event, reloads durable thread values, and rejoins after the server-provided retained tail, with up to five recovery rejoins after the original stream (six total stream calls on an all-gap exhaustion path). The wrapper remains a lazy async iterable because the SDK consumes it with `for await`. `core/threads/hooks.ts` clears optimistic/transient/subtask state, invalidates durable history caches, and shows the localized recovery warning; never let a gap fall through as a normal stream finish or cancel the still-running backend run.
- **Streaming Markdown rendering** is owned by `core/streamdown`: Streamdown's `animated` / `isAnimating` API handles incremental word animation, while the shared `streamdownRenderingPlugins` config registers the named code-highlighting and Mermaid plugins required by Streamdown 2.5. Keep wrappers and derived configs wired to that shared object; do not reintroduce a rehype plugin that wraps every word, because reparsing a growing block remounts old words and replays their animation.
- Citation links in message and artifact Markdown must derive their `citation:` label from the full `ReactNode` children tree, since Streamdown may provide element or array children during streaming rather than a plain string.
- **Environment validation** uses `@t3-oss/env-nextjs` with Zod schemas (`src/env.js`). Skip with `SKIP_ENV_VALIDATION=1`
- **Subtask step history and runtime metadata** (`core/tasks/`) — the subtask card shows a subagent's full step timeline (#3779): its assistant reasoning turns interleaved with the tools it ran. `Subtask.steps[]` is accumulated live from `task_running` events (appended via `mergeSteps`, not overwritten) and backfilled on expand for historical runs by `fetchSubtaskSteps`, which pages the events endpoint scoped to one task (GET `/runs/{runId}/events?event_types=subagent.step&task_id=…&after_seq=…`) until a short page, so the run-wide limit can't truncate the timeline. `task_started` carries the effective `model_name`; `task_running` carries a cumulative usage snapshot after each completed LLM call. `core/tasks/lifecycle.ts` normalizes these additive events, and `computeNextSubtask` keeps the largest cumulative total so replayed or late SSE frames cannot double-count or roll the folded card backward. Terminal ToolMessage metadata (`subagent_model_name` / `subagent_token_usage`) restores the same values from normal history after reload; no per-card event fetch is needed. `core/tasks/steps.ts` is the pure step model: `messageToStep` (live), `eventsToSteps` (reload), `mergeSteps` (dedup by `message_index`), and `stepsForDisplay` (what the card renders — keeps tool steps + AI steps with text, drops the trailing final-answer AI step when completed since it's shown as `result`). `core/tasks/context.tsx`'s `useUpdateSubtask` applies updates against a `tasksRef` mirroring the latest state (not a closure snapshot), so a late-resolving `fetchSubtaskSteps` backfill merges into current state instead of clobbering SSE steps or sibling subtasks that arrived meanwhile. The owning `run_id` is carried onto history content messages in `buildVisibleHistoryMessages` so the card can resolve the events endpoint.

### Interaction Ownership

- `src/components/workspace/pet/agent-pet.tsx` reads the workspace shell's thin subscription
  (`core/threads/activity-context.tsx`, spec §10.3 — the pet is "the app's light", not one page's) and
  feeds a rendered `PetState` to `pet-sprite.tsx`, which only draws (it resolves the sprite, plays the
  sheet with `background-position` + `steps(N, jump-none)`, and reports a finished one-shot back).
  Three invariants hold that split: **(a)** the mount point is the workspace shell — `AgentPet` is
  rendered inside `SidebarInset` in `workspace-content.tsx`, and `SidebarInset` carries the
  `[container-type:inline-size]` so the pet's `@container (max-width: 480px)` hide rule measures the
  **content area** (not the `ResizablePanelGroup`, whose container measures chat + side panel). It is
  therefore present on every `/workspace/*` page and deliberately absent from the public routes
  (`/`, `/login`, `/[lang]/docs`, `/blog`) — those never render `WorkspaceContent`, and the root
  layout must stay static. Conversation surfaces register their `(threadId, liveRunId, href)` so the
  shell follows the last one you were in; `href` is the registrant's own canonical route back to that
  thread (a kb thread's is the knowledge page, a custom agent's is under `agents/<name>/chats/…`), so
  the shell never derives one from the id — deriving would run a kb thread without its kb binding;
  registering is a set, not a lease (unmounting a surface must not drop the subscription — that is
  what lets the pet outlive the page); **(b)** the pet is an observer
  — it reads that subscription and derived state, and never sends, mutates, owns
  agent/thread/memory, or subscribes to custom events; **(c)** the sprite stays `pointer-events-none`
  so clicks pass through, and interaction rides window-level hit-testing on the pet's box instead of
  giving the pet pointer events. One Alt gesture, two branches split by the same 4px threshold:
  past it, Alt+drag moves the pet (pointer capture, offset written on release); below it, Alt+click
  jumps back to the thread the pet stands for — and only when that thread is not already the current
  page (compared by path, because the knowledge page strips its `thread` param once applied). Both
  branches swallow the click that follows, so neither can also activate a message link underneath.
- `src/components/workspace/settings/models-settings-page.tsx` owns the **Models** section and
  its two views: the chat-model list (with add/edit dialogs) and `functional-models-view.tsx`,
  the RAG functional-model editor. The section's own prose — and the functional view's, which
  used to sit alone under the view switch — lives in the **one ⓘ on the section title**
  (`info-tip.tsx`; `text` is the accessible name, `content` the rendered bubble), so neither view
  spends a line on description. The chat-model rows are `bg-card` on purpose: the settings body
  and an outlined row resolve to the same colour, and the filled row is what the functional
  view's panels use. The functional view reads `core/rag/hooks.ts`
  (`GET/PUT /api/rag/config`, admin-gated) and builds its payload with the pure helpers in
  `core/rag/config-form.ts`; the backend replaces the whole `rag_config.json` object, so those
  helpers carry the file's own overrides forward and keep Save disabled until the admin edits
  something — do not replace that guard with a payload-emptiness check. Its three
  model-reference rows (graph extraction, eval judge, caption VLM) are all plain pickers over
  the configured `models:` entries via `modelReferenceOptions` / `visionReferenceOptions`; the
  backend resolves what each role needs from the named entry, so none of them asks for an endpoint or
  a key of its own. The caption row's candidates are every vision-capable entry — the entry's `use:`
  class decides which protocol the caption call speaks (spec 2026-09-18), so nothing is filtered out
  by provider. The **embedding and rerank rows are the exception** (spec 2026-09-14 §4.1):
  they pick a *provider* from the backend's curated allowlist rather than a `models:` entry, and
  the embedding row also carries the sparse-source select — the field that decides whether a
  dense-only provider is usable at all. Every provider-driven row is **always rendered**: a row the
  selected provider fixes (a built-in address, the other parse mode, the sparse fields when the source
  is not `external`) is shown **locked** with the reason instead of being hidden — a control that
  disappears on a provider switch reads as a missing feature, and the tallest cell used to push the
  two retrieval columns out of alignment. Every group is therefore laid out as one form: a label
  gutter on the left, values on the right, hairline-separated rows. The two retrieval roles are the
  one **two-value** form — they share four rows (provider / model / API key / endpoint), so each of
  those labels is written **once** in the gutter instead of once per column, and the columns are told
  apart by the bold role heading above them, whose English tag rides in a muted pill. The sparse
  settings live behind an advanced disclosure, **nested** under the sparse-source select
  (`RowLabel nested` → `NESTED_GUTTER`: an indent and a rule, not a prefix): they are asked the
  same four questions as the embedding service, in the same order, so their visible labels are
  the *shared* ones and only their accessible names (`F.sparse*`) tell the two apart out loud —
  「稀疏」 used to be repeated on every row to say what the indent says once. The sparse-source
  select and the provider above it are one **rule**, not two fields: `GET /api/rag/config` returns
  `embedding_providers` (`[{provider_id, emits_sparse, has_fixed_endpoint, default_endpoint}]`,
  straight off the backend allowlist), and
  `resolveSparseCapability` in `core/rag/config-form.ts` combines that list with a model-level
  probe into three states — `supported` / `unsupported` / `unknown` — while
  `isSparseSourceUnsupported` turns a known refusal into the warning (and the disabled Save) when
  the _form's_ provider is the one being asked for the sparse half. Rules that hold it: it is judged
  from the form value, so switching the picker warns before anything is saved; and **unknown is not
  unsupported** — a missing capability list, an unlisted provider, or a probe that could not answer
  all leave the configuration alone, because the write is refused server-side anyway and a warning
  we cannot justify is worse than silence. The alert in the card and the sentence beside Save carry
  the same copy: a disabled button without a reason reads as a broken button. Every explanatory
  sentence sits behind an ⓘ tooltip — only state (the embedding-change warning, the
  environment-provenance badge, the no-changes hint) stays visible.

  The model-level half of that answer comes from `POST /api/rag/config/probe-embedding` via
  `useProbeSparseCapability` (spec 2026-09-16 §3 D4.2). Four things about it are load-bearing:
  (1) **the verdict carries the values it was taken for** (`sparseProbeKey` = `provider|model|
base_url`), and is only applied when that key still matches the form — editing the model is
  asking a _different_ question, so the old answer is dropped rather than reused; (2) it fires only
  when the question can be asked at all — the allowlist says this provider _can_, the form is
  actually asking it for the sparse half, a model is named, and `sources.embedding_api_key !==
"unset"`. That last one is deliberately **not** "the input box is not empty": an
  environment-backed key arrives as an empty box (`sources[key] === "env"`), and reading it as
  missing would leave the feature dead in exactly the deployment that uses it; (3) it is debounced
  (`PROBE_DEBOUNCE_MS`), because each probe is one real, billable embedding call and the trigger
  conditions are already true after the first keystroke of a model id; (4) `unverifiable` is
  rendered as 「未验证」 and **passes**: only a known `unsupported` greys out 「跟随向量模型」
  (`isSparseProviderOptionDisabled`) and keeps Save blocked, and the admin's own choice of sparse
  source is never silently rewritten. The probe writes nothing (no cache invalidation) and reports
  no toast — "could not check" is a state that row renders, not an error to dismiss. That state
  rides **inside the sparse-source field** (`OptionSelect`'s `trailing` slot, after the value and
  before the chevron): the trigger is a fixed-height box, so nothing moves when the mark appears or
  goes, whereas the same mark on a line of its own pushed every row below it down and back on each
  open. It is a _sibling_ of `SelectValue` and never a child, because Radix mirrors the selected
  item's text into the trigger — a child would be copied into the option labels too.

  The external sparse service has its own probe (connectivity spec §3 D4), because a wrong port or a
  service that is not up used to surface as "some chunks failed" at ingest time. Its state rides in
  the **address field** (`接口地址`, the one you fix when it is wrong): same in-field slot idea, reserved
  padding rather than a line of its own. Three states, none of them blocking: `ok` (silent), and
  `连不上` / `没返回词项` — the second is deliberately _not_ the first, because a reachable service that
  returns no terms sends the admin to the model, not to the network. It fires when the source is
  `external` **and** an address is present (debounced, once per `provider|address|has-key`), and a key
  counts as present when the deployment stores one or the environment backs it. **It only reports** —
  a service that is down now may be up in a minute, and blocking the save would repeat the mistake the
  `unverifiable` rule exists to avoid.

  Every explanatory sentence sits behind an ⓘ tooltip — only state (the embedding-change warning, the
  environment-provenance badge, the no-changes hint) stays visible. That badge rides *inside* the
  credential field it describes (`SecretInput`: one positioned wrapper, the field's own padding
  spent on it), because beside
  the field it took width from the row — and the retrieval pair has two fields on that row.

  The endpoint row follows the same principle — **decide from the capability block, not from a
  provider name** (spec 2026-09-17 §3 D1/D5) — and **both endpoint rows now do it** (alignment spec
  §3 D4). `resolveEndpointRow` answers three questions for one leg: whether the selected provider
  fixes its own address (`has_fixed_endpoint` ⇒ the row is a `LockedBox`), what to show there (a
  stored address when the deployment set one, else that row's `default_endpoint`), and whether there
  is an override of the admin's own to drop — that last one renders **「恢复默认」 inside the box**,
  an action that clears the field, and is absent when there is nothing to clear so it never becomes a
  button that does nothing. It is one core with **two thin wrappers** (`resolveFixedEndpointRow` /
  `resolveRerankEndpointRow`, each handing it that leg's provider value, stored value and capability
  block): the rows are allowed to share a judgement, and must not share a _copy_ of it — a second
  copy is exactly how the rerank column ended up hardcoding a provider name while the embedding one
  read the block. A stored address is deliberately **not** ignored: it still wins at runtime, which
  is what keeps a workspace-scoped DashScope endpoint usable, so the row shows it rather than
  claiming the vendor's default applies. The rerank row takes its answer from `rerank_providers`,
  whose entries carry **no `emits_sparse`** (that leg has no sparse half) — the two blocks are one
  rule in two shapes, so do not unify their types. Two rules hold it: the lock follows the _row_, so
  a second such provider needs no second hardcoded id; and **unknown does not lock** — a response
  predating the capability block leaves the field editable instead of taking it away on a guess. One
  visible consequence of a locked row printing an address: the 「由提供方固定」 reason only appears
  where there is nothing to show, so the two endpoint rows no longer carry it (the parse rows do —
  their lock is about the _mode_, not about a vendor address).

  Saving can now end three ways (spec 2026-09-17 save-time probe §3 D3), and the view has to tell
  them apart: a 400 is the ordinary failure path (a toast carrying the server's `detail`, already
  true before this), a **`null`** `warning` means the server verified what it wrote, and a
  **non-`null`** one means the write went through but could not be verified. That last case gets its
  own `<p role="status">` above the Save row — the muted form `models-add-dialog` already uses, on a
  line of its own so it does not compete with the `sparseBlockReason` / `noChanges` slot that shares
  that row — and it is **state, not a toast**: the sentence is the server's own, and a notice that
  dismisses itself is worse than none. It belongs to the save it describes, so the next save
  replaces it (including with `null`); a keystroke does not, because it describes what is _in force_
  rather than the unsaved form. A response from a gateway that predates the field reads as `null`
  (`saved.warning ?? null`) — silence, never an invented warning.

  The same view carries the **rebuild-index entry** (spec 2026-09-14 §5 / P4): because this panel is app-wide while a rebuild is
  library-scoped, the row picks the target library itself (session-only state) and the confirm dialog
  names it before anything runs — the copy states that source files are not re-parsed. Progress is
  read through `useReindexStatus` (`reindex-status.ts` decides the polling cadence), and the action
  stays disabled while a run is in flight. Adding a chat model is a **two-step wizard** (`models-add-dialog.tsx`): step 1
  collects identity + credentials (provider / endpoint / api_key / one or more Model IDs) and its
  **Next** button runs `POST /api/models/config/validate` first, so a bad key or an unknown Model ID is
  caught before anything is stored — step 2 is unreachable until that probe passes. The probe's
  optional `warning` (the endpoint path looks like a method or model-list URL) rides along to step 2
  as a `role="status"` note instead of blocking, because the probe tolerates that value while the
  runtime does not. Step 2 is
  `model-capability-editor.tsx`: supported context windows (200K/400K/1M) plus the default, the
  vision/thinking chips, and the supported reasoning-effort levels plus the default. The effort rows
  render by **declaration, not by provider** (spec 2026-09-19): the levels row is always there — it is
  the only place a level can be declared, so hiding it would make an uncurated model permanently
  undeclarable — and only the default row waits on a non-empty selection, since a default outside its
  own subset is not expressible. Every payload path carries the declared levels through untouched; an
  entry that declares them keeps them, whichever protocol its leg speaks, because the backend
  translates the level into that protocol's own parameter name. The brief interval when this surface
  hid the rows for `anthropic` and emptied the axis on submit is **withdrawn** — that was a guard
  against forwarding the OpenAI spelling to a client that rejects it, and the translation replaced it.
  `core/models/capability-registry.ts` prefills a **suggested** set for known model ids, matched on
  the model id alone; the UI labels it as a suggestion rather than a detected fact — never claim a
  probe that does not exist.

- `src/core/models/reasoning-effort.ts` owns the composer's model-capability gating as pure rules
  (`offeredModes` / `isModeOffered`, `resolveMode`, `reasoningEffortLevels`, `resolveReasoningEffort`,
  `effortAfterModelSelect` / `effortAfterModeSelect`), and
  `src/components/workspace/composer-reasoning-controls.tsx` owns the `ModeMenu` / `EffortMenu` that
  consume them; the composer and the sidecar panel both render those components instead of their own
  copies, because the previous sidecar duplicate carried the same defect. Two invariants hold: **the
  menus gate themselves** — the effort menu lists only the model's declared
  `supported_reasoning_efforts` subset and is hidden in `flash`, where it would be a dead control, and
  the mode menu shows Flash alone for a model without thinking support instead of Pro/Ultra entries
  that `resolveMode` silently rewrites — and **the displayed value is the sent value**, through the
  chain *user pick > model default > mode heuristic*, where switching modes does not rewrite the effort
  once the model declares a default. The three observed forms (thinking+effort declared / thinking only
  / neither) are pinned by `tests/unit/components/workspace/composer-reasoning-controls.dom.test.tsx`.

- `src/app/workspace/chats/[thread_id]/page.tsx` owns composer busy-state wiring.
- `src/app/workspace/chats/[thread_id]/page.tsx` owns branch-from-turn submission and navigation; sidecar `MessageList` instances do not receive the branch action.
- `src/app/workspace/chats/[thread_id]/page.tsx` and `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` own edit-and-rerun submission wiring because the page must preserve normal/custom-agent run context; `MessageList` only detects the latest editable user turn and renders the inline editor.
- `src/app/workspace/chats/[thread_id]/page.tsx` gates the Workspace Browser trigger and browser right panel on `/api/features -> browser_control.enabled`; default/failed feature discovery hides the browser control so optional backend installs do not show a dead Live socket.
- `src/app/workspace/chats/[thread_id]/page.tsx` and `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` own active-goal display state for their composer overlays.
- `src/components/workspace/messages/message-list.tsx` owns human-input card answered/latest/pending gating; entry pages only translate a submitted card response into `sendMessage` calls.
- `src/components/workspace/browser-view/browser-view-panel.tsx` forwards each physical pointer click as one `click` input; do not also emit `down`/`up` for the same gesture because the remote Playwright click would run twice.
- `src/components/workspace/browser-view/use-browser-stream.ts` requests binary JPEG
  frames with `frame_format=binary`; status, URL, tabs, and navigation rejection
  messages remain JSON. `LatestBrowserFrameBuffer` keeps only the newest pending
  frame, publishes through `useSyncExternalStore` at most once per animation
  frame, and owns object-URL revocation. Keep the Gateway's legacy JSON/base64
  frame path for older clients.
- **Knowledge-page notifications are column-scoped (2026-09-08)**: the global
  `<Toaster>` (workspace-content, viewport bottom-right) lands on top of the
  knowledge chat composer, so the knowledge page routes its own notifications
  into the middle column instead. `components/workspace/knowledge/kb-toast.ts`
  exports a `toast` facade (same call surface as sonner) that injects
  `toasterId: KB_TOASTER_ID`, and `panels-shell.tsx` mounts the matching
  `<Toaster id={KB_TOASTER_ID} style={{ position: "absolute" }}>` inside the
  middle column (`relative`), whose width shrinks with the column so it never
  spills into the chat panel. sonner 2.x filters by id both ways — an id-less
  global Toaster renders only id-less toasts — so the two surfaces never
  duplicate. New code under `components/workspace/knowledge/` imports `toast`
  from `./kb-toast`, never from `sonner` directly; core hooks and other pages
  keep the global surface.
- **Knowledge-page document failure notifications are in-tab (2026-08-29)**:
  document upload/index failures deliberately bypass both the global sonner
  surface and the column-scoped `kb-toast` facade — a viewport-anchored toast
  cannot stay inside the documents tab, and the failure list is stateful
  (retry / dismiss / hover-to-expand), which sonner is not shaped for.
  `components/workspace/knowledge/doc-failure-panel.tsx` renders an
  absolutely-positioned card inside the documents tab's bottom-right corner
  (bg-white dark:bg-black + border + shadow-lg, matching the global toast
  look — `bg-background` was rejected for blending into the page). Detection
  lives in `useDocFailureNotifier` (a rename of the earlier
  `useDocFailureToasts` — detection semantics unchanged): notify only on
  transition to `failed` / no backfill on first load / dedupe within a cycle
  / re-notify on retry-then-fail / retract on leaving `failed` / `report`
  folds in both upload-rejected-at-door and retry-request-failed. Rows carry
  a `retryable` flag; retryable rows render a compact retry button reusing
  the row-level `onRetryDocument` (key = document id). Card is
  state-driven — no timers, no auto-dismiss; header ✕ closes all, per-row ✕
  closes one, hover on the collapsed single-row strip expands the body
  (hover on the ✕ itself does not expand — the sensor is only on the body).
- **Knowledge-page eval tab structure (2026-09-08)**: `eval-tab.tsx` owns
  three views (Questions / Overview / History) under one persistent toolbar —
  segmented control + three action buttons (Sparkles「生成考题」/ Plus「添加考题」
  / Play「运行评测」) + a bank-scoped search input, all locked to `h-7` on a
  44px toolbar baseline matching the other five middle tabs. `useToolbarTier`
  folds everything except the segmented control into a ⋯ menu on narrow
  panels. Add-question and synthesis dialogs are **controlled from EvalTab**
  (`bankAddOpen` / `bankSynthesisOpen` state) so toolbar buttons can open
  them; the bank component never renders its own entry buttons. All run
  triggers (header button, ⋯ menu, bank row context menu, row ⋮) delegate to
  a single `requestRun` on EvalTab — child components must not carry their
  own `useTriggerEvalRun` mutation, which would bypass the optimistic
  in_flight flag and the full-tier confirmation dialog.
  **Run banner (`eval-run-banner.tsx`)**: idle state renders `[Tier Name][⌄]`
  (chevron = tier dropdown, session-only state, default `l1`, never
  persisted); running state morphs the chevron slot into `[Phase Name + n/3
  (disabled)][✕]` — the ✕ is a two-step inline cancel (first click morphs to
  destructive 「确认终止?」 with a 3s timeout, second click fires
  `useCancelEvalRun`). Narrow panels put the same two-step cancel inside the
  ⋯ menu (`onSelect preventDefault` keeps the menu open). Progress polling
  is the history query `useEvalRuns` gated by the pure function
  `evalRunsRefetchInterval(data) = in_flight ? 3000 : false` in
  `eval-run-status.ts`; the drain edge (`in_flight` true→false) invalidates
  the latest/trend/history queries so the idle summary and the tables converge
  without a view switch. Phase labels are 4-character Chinese (`检索评测` /
  `答题评测` / `质量评估`) with an `n/3` counter shown only when
  `tier === "l1_l2"` or `step > 1` — a quick-tier run never shows `1/3`
  because it cannot reach `3/3`. Cancelled runs render in history with a
  `Ban` icon and muted 「已终止」 label, distinct from `completed` and
  `error`; the banner summary slot morphs to a single-line 「评测已终止」
  after drain.
  **Question synthesis**: dialog (`eval-synthesis-dialog.tsx`) is a document
  dropdown pre-filtered to `status === "ready"` (a doc without chunks would
  409 anyway) + a count select (1–10, default 5) → `useTriggerSynthesis`
  (toast on `enqueued` / `already_running`, close dialog on `enqueued`).
  Review panel (`eval-synthesis-review.tsx`) is inline in the bank view,
  appearing when staging is non-empty: metadata row (source doc ·
  generated_at · remaining · dropped count) + candidate cards (query full
  text + category/paths Badges + anchor chunk count + collapsible
  reference_answer) + per-card 「✓ 采纳」 (`useAcceptSynthesisCandidate`) /
  「✕ 忽略」 (`useRejectSynthesisCandidate`) + a 「全部忽略」 secondary
  button (serial per-card reject — no batch endpoint, staging stays small
  under wholesale-replace semantics). `in_progress` shows a top spinner
  「生成中…」; polling is `useSynthesisStatus` gated by the pure function
  `synthesisRefetchInterval(data) = in_progress ? 3000 : false` in
  `synthesis-status.ts` (same pattern as `eval-run-status.ts`).
  **Multi-path `expected_paths`**: both save dialogs
  (`eval-save-question-dialog.tsx` for recall-panel saves,
  `eval-add-question-dialog.tsx` for bank manual adds) use a three-item
  Checkbox group (vector / graph / wiki) instead of a Select; `canSubmit`
  requires at least one checked (front-end post for the backend's
  `min_length=1`). Save-dialog default is `[...selectionPaths]` (Set
  iteration order = click order = submission order) so a mixed-path
  selection pre-checks multiple boxes; add-dialog defaults to vector only.
  Bank table and drawer render `expected_paths` as multiple Badges. Tests
  must assert checkbox state via `getAttribute("aria-checked")` — the Radix
  checkbox's JS property is not the DOM attribute, so `toHaveProperty`
  silently passes on stale state (vector-tab tests have the same pitfall
  pinned).
  **Wiki row anchoring (`recall-test-panel.tsx`)**: a wiki hit with non-empty
  `source_chunk_ids` renders a checkbox that folds all its source chunks
  into `selectedChunkIds` and adds `wiki` to `defaultSavePaths`;
  manual-card rows (`source_type === "manual"`) never render a checkbox and
  carry a native `title` tooltip explaining why (lightweight, `getByTitle`
  assertable). Chunk selection is idempotent — already-selected chunks are
  not re-added, so the submission body has no duplicates; checked state =
  "all source chunks already selected".
  **Trend chart (`eval-trend-chart.tsx` + `.utils.ts`)**: ECharts main chart
  with 6 default legend lines + 4 picker candidates (`PICKER_METRICS`:
  faithfulness / answer_relevancy / citation_precision / graph_seed_hit) +
  baseline/threshold marker series. Picker is a card-header `DropdownMenu`
  (`SlidersHorizontal` trigger, `h-7`, `DropdownMenuCheckboxItem` × 4,
  `onSelect preventDefault` for continuous multi-select, session-only
  state). **Picker series are not in `legend.data`** — the picker is an
  independent multi-select entry, keeping the six-line legend's defaultOn
  semantics separate. Y-axis auto-scales to the visible series set
  (`resolveVisibleKeys` = legend ∪ picker) via `buildYAxisRange` (±0.05
  padding, 10pp rounding, capped to `[0, 1]`, minimum-range guard); when
  `yMin > 0` a card-header chip shows the effective range label. Tooltip
  renders a `notRunInTier` dummy row for picker metrics whose value is
  `null` at that ordinal — ECharts only emits axis params for non-null
  points, so the dummy row must be added explicitly. **`context_recall` is
  retired from the picker and the main-chart series** but is still shown as
  a 28×12 sparkline in its L2 tile (all 7 L2 tiles carry sparklines fed by
  the trend payload's `sparks` block). X-axis is a **run ordinal, not a
  timestamp** — a missing run in the middle must not silently compress two
  disjoint periods into adjacent points (spec §2.2 ordinal-warp protection).
  Legend changes flow back via `legendselectchanged` → ref pass-through →
  EvalTab `setLegendSelected` → prop re-injection → data effect rebuilds
  option; the ref pass-through avoids identity-change triggering
  `setOption` loops.
  Wire contracts live in `core/knowledge/types.ts`; hooks in
  `core/knowledge/hooks.ts` under the `knowledgeEval*Key` /
  `knowledgeSynthesisKey` factory namespace.
- `src/core/threads/hooks.ts` owns pre-submit upload state and thread submission.
- **Harness constitution view (2026-09-12)**: `components/workspace/constitution/` owns the
  run-scoped "what did this run assemble" view — a header trigger plus a Dialog, opened from
  `app/workspace/chats/[thread_id]/page.tsx`'s right cluster. Four invariants:
  **(a)** the two tiers are **two components**, not one with a detail switch
  (`constitution-user-view.tsx` reads only `stages[]` and the gate events, so it is
  structurally unable to paint a middleware or tool name; `constitution-developer-view.tsx`
  is where the real names, the `kind`/`frequency` axes, the `hooks[]` list and the raw gate
  `changes` keys belong — do not merge them, and do not hand the user tier more props);
  **(b)** `constitution-ring.tsx` is a drawing primitive that takes **all** its copy as props,
  because both tiers share it and their vocabularies differ — teaching it to call `useI18n`
  is how the two drift back together;
  **(c)** the trigger's visibility **is** the snapshot's existence: a run with no snapshot
  renders no trigger, which is why neither tier needs an empty-state string;
  **(d)** the reads are run-scoped — `core/constitution/hooks.ts` is keyed by
  `(threadId, runId)`, where the run id comes from `useThreadStream`'s **`liveRunId`** for the
  run in flight and from the newest `message.run_id` after a reload. `liveRunId` is written
  from the per-run `onCreated` (**not** `onStart`, which fires once per thread) and is paired
  with its owning thread id so a thread change invalidates it without a reset effect — such an
  effect also fires on a new thread's `undefined → real` transition and would wipe the id it
  had just recorded. A snapshot's first `run.start` reaches the store **after** the run is
  created (measured 0.17–2.2 s) while the page asks as soon as it knows the run id, so
  `fetchConstitution` re-asks a bounded number of times before accepting "no snapshot": the
  caller caches the answer for the run's lifetime (`staleTime: Infinity`), so a raced empty
  answer would otherwise freeze for the whole run.
- **Delivery verdict line (2026-09-12)**: `components/workspace/changes/workspace-change-badge.tsx`
  carries one extra line for a run's terminal delivery receipt (`run.delivery`, read by
  `core/delivery/`) — quiet when the run handed its output over, raised when it did not. Four
  rules hold it: **(a)** it shares the file card rather than opening a second one (the file list
  answers "what changed", this answers "was it handed over"), so do not split it out and do not
  add a second anchor; **(b)** the switch is the **verdict's** presence, never the receipt's — most
  runs publish only the base record with no verdict fields, and switching on the receipt would
  print "handed over 0" on almost every run; **(c)** it renders only delivery facts and never the
  run's terminal state — "how did this run end" belongs to the run-status work, and a missing
  receipt must not hide the file card (a test pins exactly that); **(d)** the counts come off the
  verdict's own lists with no set arithmetic, because `satisfied` means *at least one* produced
  output was handed over — a partial hand-over passes, and the line reports the real ratio
  instead of claiming everything was handed over.
- **Run-status and failure notice (2026-09-12)**: `core/run-status/` decides *how a run ended* and
  *why a start failed*; `components/workspace/run-status/` renders both. Four rules hold it:
  **(a) two anchors, one component.** A start that failed renders under **the reader's own message** —
  the one `onError` kept back and marked in `additional_kwargs.deerflow_run_status`, which is what
  `core/messages/start-failure-anchor.ts` looks for. Deliberately **not** "the last user turn with
  nothing after it": that rule also matches an ordinary trailing turn the notice has nothing to say
  about, and would hang this failure under a turn that never failed. A run that ended renders under
  **the run's last answer bubble**, sharing the file card's `showWorkspaceChanges` anchor so one
  run's story stays in one place.
  **(b) pre-stream failures have one landing site.** The SDK's stream manager routes a rejected run
  creation to `useStream`'s `onError` instead of rejecting `submit`, so `sendMessage` and
  `submitPreparedReplay` **never** see a 409/400/404/503 — do not go looking for a per-path catch.
  The category comes from `HTTPError.status` alone: `core/run-status/start-failure.ts` reads that
  field, and nothing classifies free text. **Do not change `getStreamErrorMessage`'s behaviour** —
  `submitPreparedReplay` depends on it always returning a sentence; the classifier is a separate
  entry composed next to it.
  **(c) the sentence carries the instruction; the chip carries the ending.** The frozen copy states
  each remedy inside the sentence ("…wait for it or stop it"), which is why only two kinds carry a
  control: `inspect` gets the details disclosure (the backend's own `error` is otherwise invisible),
  and the gone-chat sentence **is** its own control — it says "start again from the list", so it
  renders as a link to the conversations list instead of gaining a label of its own. The stop button
  and the model picker are already on screen in the composer, and restarting a service has no in-page
  destination, so those three stay plain sentences. A run that failed does **not** repeat its
  sentence in the notice — the chip above it already says "this run didn't finish", and the notice
  adds only what the chip cannot, the backend's own `error`.
  **(d) nothing is shown for a `none`, and a run with no anchor shows nothing at all.** `success`,
  a run with no terminal state yet, and the two frontend-bug statuses (422/501) all classify to
  `none` and produce **no nodes** — `success` in particular must never gain a chip. Unknown statuses
  resolve to `none` rather than the nearest sentence: `core/run-status/types.ts`'s `PRESENTED_KINDS`
  is the one list of what may be shown, it mirrors `run-status-i18n-keys.json`, and a backend guard
  reads it as text so a new kind cannot ship without copy. Separately, **a run stopped before it
  produced a closing answer bubble renders nothing** — its messages end in tool/processing state, so
  it has no `assistant` group for the anchor to land on (measured on the real stack: a thread with
  two user turns held a single `assistant-turn` group). That is accepted behaviour, not a gap to
  patch: the reader stopped it, so there is no ending to announce. The file card has the same
  limitation from the same shared anchor.
- `src/components/workspace/chats/chat-box.tsx` owns the desktop right-panel layout, and **all three** right panels (artifacts, sidecar, browser) share one `ResizablePanelGroup` — do not fork a non-resizable branch per panel kind, which is how the artifacts divider silently lost its drag handle (#4465). Open/close is `collapse()` / `resize()` on the side panel's imperative handle, not conditional rendering, so the width can animate. Three constraints hold that together: the size transition is applied from the group as `[&>[data-panel]]:transition-[flex-grow]` because the sized flex item is the library's own `[data-panel]` element rather than the child `className` lands on; it is applied only while an open/close is in flight, so a drag is not interpolated frame by frame; and during the animation the panel content is held at its final width in `cqw` and clipped, because a reflowing message list re-runs its scroll-to-bottom (pinned by `tests/e2e/sidecar-chat.spec.ts`'s no-animated-scroll test) and a re-wrapping composer changes which responsive labels it shows. Because the panel is `collapsible`, the library can also collapse it to `0%` on its own when a drag crosses `minSize`, without going through the state that owns it. `onResize` records the last positive size while the pointer moves, but the owning `sidecar` / `browserView` / `artifactsOpen` state must only mirror a final `0%` layout from `onLayoutChanged`, after pointer release; closing on the first `0%` resize frame breaks a continuous drag that reaches the edge and then reverses before release.

## Code Style

- **Imports**: Enforced ordering (builtin → external → internal → parent → sibling), alphabetized, newlines between groups. Use inline type imports: `import { type Foo }`.
- **Unused variables**: Prefix with `_`.
- **Class names**: Use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- **Path alias**: `@/*` maps to `src/*`.
- **Components**: `ui/` and `ai-elements/` are generated from registries (Shadcn, MagicUI, React Bits, Vercel AI SDK) — don't manually edit these.

## Environment

Backend API URLs are optional; an nginx proxy is used by default:

```
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8001
NEXT_PUBLIC_LANGGRAPH_BASE_URL=http://localhost:8001/api
```

Leave these unset for the standard `make dev` / Docker flow, where nginx serves the public `/api/langgraph/*` prefix and rewrites it to Gateway's native `/api/*` routes.

To reach a dev server on anything other than localhost — a LAN address, or a proxied hostname — list the host in `DEER_FLOW_DEV_ALLOWED_ORIGINS` (comma-separated; a full URL is reduced to its host). It feeds Next's `allowedDevOrigins`, which gates `/_next/*`, fonts, and HMR. Without it those requests get a 403 and the page renders server-side but never hydrates, so nothing on it — including the login form — responds. Development only; production builds ignore it.

## Resources

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangChain Core Concepts](https://js.langchain.com/docs/concepts)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Next.js App Router](https://nextjs.org/docs/app)

## Contributing

When adding features:

1. Follow the established `src/` structure
2. Add TypeScript types and proper error handling
3. Write unit tests under `tests/unit/` (`pnpm test`) and E2E tests under `tests/e2e/` (`pnpm test:e2e`)
4. Run `pnpm check` before committing
5. Update this `AGENTS.md` when architecture, commands, or conventions change

Route asset budgets are enforced with `pnpm perf:check`. The command measures
`/login` from a normal production build, then builds in static-demo mode for the
fixture-backed workspace routes. It starts the production server on temporary local
ports, measures the unique JavaScript and CSS files referenced by representative
routes, writes the detailed result to `.next/performance-results.json`, and compares
totals with `performance-budgets.json`. Fix route ownership or split points when a
budget fails; do not raise a ceiling without documenting and reviewing the measured
regression.
