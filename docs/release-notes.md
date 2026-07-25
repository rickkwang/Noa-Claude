# Release Notes

## 1.6.1

### New Features

- **Claude Opus 5** — added as the first-party Opus default: 1M native context (default and maximum), 128K max output, thinking on by default (turning it off requires an explicit disable, and is only accepted at effort `high` or below — higher efforts are lowered rather than failing the request). Pricing is $5/$25 standard and $10/$50 in fast mode, so fast-mode tier selection is now model-aware. Third-party backends still default to Opus 4.8 and reach Opus 5 only by explicit pin.
- **Auto-mode classifier queue** (opt-in, default-off) — a per-agent FIFO serializer so concurrent tool checks no longer fan out parallel classifier API calls. Enable via `NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE` or the config flag. After dequeue, permission mode is re-validated and falls back to deny/ask if it changed while queued.

### Bug Fixes

- **Resume crash on malformed attachments** — a transcript with a missing or malformed attachment payload crashed resume during attachment migration. Malformed payloads are now validated and dropped (with a warning that the transcript is partially corrupt) instead of throwing.
- **Prompt history lost on write failure** — `immediateFlushHistory` cleared pending entries before the disk write, so a failed append silently dropped those prompts. Entries are now removed only after a successful write and stay queued for retry, with the Esc-rewind-during-write race guarded so a rewound entry isn't resurrected from disk.
- **Third-party Opus fallback chain** — skipped Opus 4.5 entirely (4.6 jumped straight to 4.1); now falls through 5 → 4.8 → 4.7 → 4.6 → 4.5 → 4.1.
- **Model migration notifications** — hardcoded "Opus 4.6"/"Sonnet 4.6" while the migrations write bare family aliases, telling users they'd been moved to a version they hadn't. Now resolved at notification time.
- **Stale model strings** — `/model` 1M-unavailable messages no longer name a version (matching upstream, which names only the family), and default-model descriptions use the current "Best for everyday, complex tasks" wording.

## 1.6.0

### New Features

- **Auto permission mode (shift+tab)** — the previously-mirrored YOLO/transcript classifier subsystem is now live behind a dedicated `AUTO_MODE` flag (shipped enabled in baseline builds), replacing the always-false `TRANSCRIPT_CLASSIFIER` gate. Includes an original (non-Anthropic) classifier system prompt and permissions template, upstream 2.1.210 model gate alignment (denylist instead of allowlist), and classifier request-shape alignment (two-stage XML classifier, temperature, retry count), plus a local customization swapping `auto`/`bypass` order in the shift+tab cycle.
- **Probe-once classifier fallback** — when the main loop model can't self-classify (outside the trusted Sonnet/Haiku families), the first classifier call determines whether the default-Sonnet route works and remembers the verdict for the rest of the session instead of re-probing on every call.
- **Sonnet 5 default** — now the recommended default model across pickers and refusal-message suggestions, with time-boxed introductory pricing ($2/$10 per Mtok through 2026-08-31, then $3/$15) and refactored provider-aware fallbacks (teammate model, refusal suggestions).
- **`/doctor` agentic health-check** — converted from a static screen dispatch into a prompt-driven command that runs read-only diagnostics (install health, unused extensions, memory bloat, slow hooks, context cost, permission-mode tuning) and proposes gated fixes.
- **`/autocompact` command** — persisted `autoCompactWindow` setting (`auto | 500k | 1m | 200000 | 200`), previously only configurable via env var.
- **Precomputed & reactive compaction** (opt-in, default-off) — background summary arming to skip the compact API round-trip, and a real reactive-compact implementation that compacts in place and retries when a turn comes back prompt-too-long.
- **Session-wide safety caps** — subagent spawns and WebSearch calls now cap at 200/session, resetting on `/clear`.

### Bug Fixes

- **Forged system-reminder tag injection** — untrusted content (memory files, hook stdout, a cloned repo's CLAUDE.md) could previously forge `<system-reminder>` block boundaries; now escaped.
- **Mythos 5 capability gaps** — completed thinking/context/structured-output allowlists to match Fable 5 (was silently degrading: rejected sampling params sent, empty thinking-UI blocks, context caps incorrectly capped).
- **StreamingToolExecutor concurrency cap** — now matches `runTools`' concurrency limit, instead of starting all concurrent-safe tool calls at once.
- **Request-too-large message** — corrected to reference the actual 32MB API request ceiling (was reporting the 20MB per-PDF encoding target), and now suggests `/compact`.
- **Provider-switch cache invalidation** — clears the model-string cache and classifier probe state on provider switch, preventing stale verdicts from a prior route.
- **Compact chain hardening** — precompute slot restricted to the main conversation (was leaking across subagents), lifecycle/cleanup gaps closed, and reactive-compact outcome messages now map to their distinct user-facing reasons.

### Removed

- **Bundled `claude-api` skill** — deregistered and deleted (~250KB of per-language reference docs).

### Refactors

- `docs/release-notes.md` restored as the single source of truth for release notes (a stray root `CHANGELOG.md` reintroduced in error is removed).
- `precomputedCompact.ts` de-suppressed from `@ts-nocheck`.

## 1.5.0

### New Features

- **Claude Sonnet 5 model support** — full model registration, cost tracking, and thinking/context handling for the new Sonnet 5 family.
- **Live file-path autocomplete in bash mode** — file paths are now suggested and completed live while typing shell commands.
- **`/cd` command** — moves the session's working directory without restarting the session.
- **Logo animation sequences** — programmatic animation sequences and particle effects added to the startup logo.

### Bug Fixes

- **Effort slider theming** — slider labels for low/medium/high now use semantic theme tokens (`warning`/`success`/`permission`) instead of hardcoded ansi colors, so they adapt to the active theme; `xhigh` gets a dedicated shimmer effect; Speed/Intelligence labels renamed to Faster/Smarter.
- **Hook matcher exact-match** — hyphenated matcher identifiers in hooks now require an exact match instead of a prefix match.
- **Logo banner width** — banner now matches terminal width; fixed dim-color bleed in feed titles.
- **Ghostty spinner alignment** — spinner rendering aligned with upstream Claude Code behavior.
- **Diff/code tab rendering** — leading tabs are now converted to spaces when rendering code and diffs.
- **Local-day stats bucketing** — daily stats now bucket and display by local day instead of UTC.
- **Structured-outputs model allowlist** — aligned with Opus 4.7/4.8; Opus now defaults to a 1M context window.
- **Permission mode fallback** — removed a redundant result fallback in `initialPermissionModeFromCLI`.
- **TUI ratchet viewport** — fixed a feedback loop that could break the ratchet viewport.

### Removed

- **Computer-use feature** — removed the native `ComputerTool` and associated computer-use feature surface.

### Refactors

- Centralized progress types and tightened `Tool` typechecking.
- Cleaned up Noa marketplace and launcher naming.
- Isolated provider environment state in prompt tests to prevent cross-test pollution.

## 1.4.0

### New Features

- **Keep-tail auto-compact** — auto-compaction now preserves a verbatim recent tail instead of replacing the entire conversation with a summary. A pivot is chosen so that older history is summarized while the most recent messages (including in-flight tool chains) remain intact. Falls back to full compaction when the window is too small, the tail would exceed threshold headroom, or the conversation is already re-compacting in a chain. Controlled via `CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL` (default on).
- **Compact safety-constraint preservation** — the compact prompt now explicitly instructs the model to preserve verbatim any safety or destructive-action constraints the user set (sensitive files, forbidden operations, secret handling) so they survive summarization.

### Refactors

- **Query loop harness extracted** — `query.ts` refactored into `query/transitions.ts` (state machine), `query/deps.ts` (dependency injection), `query/config.ts`, `query/tokenBudget.ts`, and `query/stopHooks.ts`. All `@ts-nocheck` annotations removed from the query directory; phantom types (`ToolUseSummaryMessage`, `StreamEvent`, `RequestStartEvent`, `TombstoneMessage`, `StopHookInfo`) now formally defined. Stop hooks are injectable via `QueryDeps` for testability.
- **Dead-code cleanup (13 upstream-only flags)** — removed never-buildable branches for `BG_SESSIONS`, `COORDINATOR_MODE`, `DIRECT_CONNECT`, `FORK_SUBAGENT`, `KAIROS_GITHUB_WEBHOOKS`, `MCP_SKILLS`, `MONITOR_TOOL`, `REVIEW_ARTIFACT`, `SSH_REMOTE`, `TEMPLATES`, `TRANSCRIPT_CLASSIFIER`, `UDS_INBOX`, `WORKFLOW_SCRIPTS`. Added no-op stubs for `HISTORY_SNIP`, `KAIROS`, `TERMINAL_PANEL`, and `EXPERIMENTAL_SKILL_SEARCH` so the dev-full profile bundles cleanly. `FEATURES.md` updated with removal audit.
- **Vestigial sourcemap cleanup** — stripped 12MB of stale inline sourcemaps from 531 source files (leftover from prior bundle reconstruction, mapping to obsolete positions). Tracked source size reduced from ~16.8MB to ~4.7MB for these files; no runtime or build effect.

### Bug Fixes

- **Query loop recovery hardened** — five fixes from harness review:
  1. `stopHooks` snapshot now respects `startsWith` output-style suffixes so `/btw` and styled paths read fresh params.
  2. Goal continuation prompt deduplicated: gated on `state.transition === undefined` instead of `turnCount === 1`, preventing duplicate injection on recovery re-entries.
  3. Prompt-too-long re-yield now tracks `lastAssistantWithheld` so dev-full builds no longer emit withheld errors twice.
  4. `max_output_tokens` recovery carries the escalated 64k cap through retries instead of resetting to the capped default.
  5. `QueryDeps` merge filters explicit `undefined` before spreading, preventing sparse partials from overwriting production deps.
- **Microcompact input clearing** — `clearOldToolResults` now also replaces large Write/Edit input strings (≥1000 chars) with a marker, preventing write-heavy sessions from retaining duplicate on-disk content that dwarfed actual tool results.
- **Reactive compact stub** — added `services/compact/reactiveCompact.ts` no-op stub so `--feature=REACTIVE_COMPACT` builds no longer fail with "Could not resolve".
- **Provider profile credential validation** — API keys now pass CJK/whitespace denylist normalization before becoming Bearer tokens, preventing malformed credentials from reaching the wire.
- **Bedrock count_tokens adaptive thinking** — `countTokensWithBedrock` now branches on `modelSupportsAdaptiveThinking` for Opus 4.7/4.8 and Fable 5, fixing silent degradation to rough estimation when `budget_tokens` was rejected on adaptive-only models.
- **Fire-and-forget promise rejection handling** — `recordTranscript` (3x in `QueryEngine.ts`) and stop-hook executions (`executePromptSuggestion`, `executeExtractMemories`, `executeAutoDream`) now attach `.catch(logError)` instead of relying solely on the global `unhandledRejection` net. Failed transcript writes log with context instead of surfacing as anonymous `tengu_unhandled_rejection`.
- **Transcript logging rejection handling** — `useLogMessages.ts` enqueueWrite promise now catches rejections, preventing unhandled rejections from the logging pipeline.
- **Remote skill stub contract** — corrected `remoteSkillState.ts` to match the expected stub contract used by `query/transitions.ts`.
- **Kimi model display cleanup** — removed dead `kimi-for-coding` display branches from `model.ts`; display now renders the raw id with no marketing name.

### Tests

- **Query loop recovery tests** — 5 loop-level recovery tests via `QueryDeps` injection: `max_output_tokens` withhold+resume, limit exhaustion, model fallback without mutating caller options, empty assistant turn, maxTurns. Regression guard: recovery limit 3→0 turns 2 tests red.
- **Stop-hook loop tests** — coverage for both stop-hook paths: `stop_hook_blocking` feeds the error back to the model and the second round receives `stop_hook_active=true`; `preventContinuation` ends the turn with the `stop_hook_prevented` terminal.
- **Microcompact tests** — expanded coverage for large Write/Edit input clearing and tokens-saved accounting.
- **Reactive compact tests** — stub contract verification.
- **Auto-compact tests** — 172 lines covering tail pivot selection, tool-chain boundary snap, environment flag disable, small window, threshold headroom, and re-compaction chain fallback.
- **Compact partial tests** — 72 lines covering `getPartialCompactMessagesToSummarize` direction behavior and auto partial failure notification suppression.
- **Provider profile tests** — 63 lines covering credential validation and denylist behavior.
- **Kimi display tests** — repinned to passthrough behavior after display branch removal.

## 1.3.7

### New Features

- **Fable 5 model support** — added full model registration, cost tracking, thinking configuration, context-window upgrade logic, and beta-flag handling for the new Fable 5 model family.
- **Size-triggered microcompact** — compaction now triggers automatically when the conversation exceeds a token-size threshold, with configurable thresholds and a visible "tokens freed" notice. `summarizeMetadata` includes a density budget anchor for more consistent summary quality.
- **Away-summary `/config` toggle** — return recaps can now be enabled or disabled reactively from the settings panel, with state persisted across sessions.
- **Explore/Plan agent personality names** — worker subagents in Explore and Plan modes now get stable display names from the historical-figure pool, with consistent color assignment across the UI.

### Refactors

- **Compact token savings normalized** — compact and away-summary token accounting unified so both paths report savings consistently. SDK schema updated to expose the normalized field.
- **Size-based microcompact tightened** — post-review adjustments to the size-triggered microcompact path: threshold calculation hardened, test coverage expanded.
- **Legacy path cleanup** — removed remaining `.claude-agent` path references from skills, PowerShell validation, IDE detection, secure storage, and error strings. All onboarding and project-instruction loading now uses `.noa` consistently.
- **Dead code removal** — dropped `getVersionChangelog` from `build.ts`, removed stale `AWAY_SUMMARY` feature-flag entries from `FEATURES.md` and build audit, deleted root `CHANGELOG.md` (release notes live in `docs/release-notes.md`).

### Bug Fixes

- **Streaming tool execution opt-in** — the streaming tool execution gate was unconditionally false (GrowthBook hard-disabled). The default is now explicit and can be enabled with `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1`.
- **Streaming tool execution recovery** — `StreamingToolExecutor.discard()` now aborts in-flight tools to prevent double-execution on fallback; the abort listener excludes `'streaming_fallback'` so the turn can retry instead of dying. Context modifiers from concurrency-safe tools are now applied in block order (previously silently dropped), matching `runTools` behavior.
- **Query loop hardening** — yields a warning when a `max_output_tokens` error is withheld but tool execution continues; consumes `pendingToolUseSummary` before `blocking_limit`/`model_error` early returns; copies `toolUseContext` instead of mutating shared options on model fallback; injects the goal prompt before the `toolUseContext.messages` snapshot so tools see the injected prompt.
- **WebSearch/WebFetch always loaded** — removed deferred-loading guards so both tools are available unconditionally, eliminating the silent-unavailability race.
- **WebFetch permissions** — deny/ask rules now take priority over preapproved hosts; matching is case-insensitive; Windows `~\` home paths are resolved correctly before permission checks.
- **Noa project instruction loading** — `.noa/project.md` and `.noa/CLAUDE.md` now load consistently across all onboarding and query paths; legacy `.claude-agent/project.md` fallback removed.
- **OpenAI-compatible shim provider-safe** — the shim no longer assumes first-party Anthropic endpoints; provider detection and capability checks are now provider-agnostic.
- **Away-summary alignment** — recap behavior realigned with official Claude Code 2.1.165 semantics.
- **README** — clarified that this is an independent project, not an active upstream fork.

## 1.3.6

### Bug Fixes

- **OpenAI-compatible streaming usage recovered** — the OpenAI shim never asked for token usage on streamed turns, so OpenAI (and every OpenAI-compatible provider) omitted the trailing usage chunk and cost/token tracking reported zero for streamed responses. Streaming requests now send `stream_options: { include_usage: true }`; the existing usage-only-chunk handling picks the numbers up unchanged. The rare endpoint that rejects the field can opt out with `CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE`.
- **OpenAI-compatible tool schemas no longer 400 under strict mode** — the shim hardcoded `strict: true` on every tool but only normalized the top-level `required`, so any tool with a nested optional field (`SendMessage`, and most MCP-server tools) produced a schema OpenAI/Azure reject with a 400. Tools are now sent non-strict by default, which preserves honest optionality across all providers and removes the side-effect of forcing top-level optional params to be required. Strict mode is available as an opt-in OpenAI/Azure reliability tweak via `CLAUDE_CODE_OPENAI_STRICT_TOOLS`, and its normalization is now fully recursive (every nested object, array item, and `anyOf`/`oneOf`/`allOf` branch gets `required` = all keys + `additionalProperties: false`, with strict-unsupported `$schema`/`$id` keys stripped).

## 1.3.5

### Bug Fixes

- **3P Opus default realigned with upstream** — 1.3.4 dropped the Bedrock/Vertex/Foundry → previous-gen Opus fallback so all providers defaulted to Opus 4.8. Upstream Claude Code still ships that fallback (`if provider !== firstParty return opus47`), so this release restores it. Sonnet/Haiku already match upstream and are unchanged. Bedrock Opus 4.7/4.8 IDs also picked up the missing `us.` CRIS prefix. Users who want Opus 4.8 on 3P can still set `ANTHROPIC_DEFAULT_OPUS_MODEL`.
- **`/claude-api` bundled skill populated** — the `claude-api` skill shipped with empty doc files, so `/claude-api` produced no usable content. All 41 reference docs are now populated to match upstream; the `migrate` and `managed-agents-onboard` flows resolve their references. Lazy file delivery keeps the runtime footprint at ~140KB per invocation instead of ~360KB. Fixed the underlying Bun `.md` loader bug in `build.ts` and `bunfig.toml` so skill imports receive raw markdown text instead of HTML.
- **Compact summary direction labeling** — full-compact paths were not stamping the `direction` field, so `isStaleFullCompactSummary` and the display ternary both relied on the undefined default. The display label was also inverted, so legacy summaries rendered as "from this point" even though full-compact is semantically "up to this point". Both full-compact paths now stamp `direction: 'up_to'`; the display ternary only special-cases `'from'`.
- **Partial compact scoped to the recent tail** — partial compaction now passes a `targetMessageCount` parameter so only the recent original-message tail is summarized, and the prompt carries a "Recent-message boundary" instruction. `formatCompactSummary` is hardened to extract the `<summary>` block before stripping `<analysis>`, so the latter can tolerate attributes without breaking the former.
- **Direct resume handling tightened** — no more fall-through to a custom title search after a UUID lookup misses; the `multipleMatches` error no longer reports a count; custom-title searches use `stopAfterDistinctMatches` to short-circuit; `shouldShowResumeSummaryGate` is wrapped in `try/catch` so a malformed stored goal never blocks resume; `getSessionLogFileInfo` populates `fileSize` for the picker; `ResumeSummaryGate` accepts a `backLabel` prop. `searchSessionsByCustomTitle` is split into focused helpers.

### Refactors

- **Custom title match helpers** — `searchSessionsByCustomTitle` is split into `filterCustomTitleMatches`, `addCustomTitleMatch`, `finalizeCustomTitleMatches`, and `normalizeCustomTitle` so each step is independently testable and the main path reads as a small composition.

## 1.3.4

### New Features

- **`/goal` auto-verification** — `/goal` and `/goal replace` now accept `--max-turns N` and `--verify "<cmd>"` flags. When a verify command is set, it runs automatically after each eligible turn; a non-zero exit blocks goal completion regardless of the evaluator's verdict. Model-requested completion stays pending until both verify passes and the evaluator approves. Verify state is preserved across session restore.
- **Built-in Explore/Plan subagents enabled by default** — `BUILTIN_EXPLORE_PLAN_AGENTS` now ships on for all build profiles. The GrowthBook A/B gate is hard-disabled in this build, so the feature is unconditional.
- **Startup banner redesigned** — new 8-line block-font ASCII logo, rounded box corners, content-driven width, inline `/provider` hint, and refined info row ordering. The endpoint row is back; the minimum width is now 64.
- **Single-file grep read registration** — `grep` / `egrep` / `fgrep` commands targeting a single file now register that file as "read", so a follow-up `Edit`/`Write` no longer needs an explicit `Read` first. Aligns with upstream Claude Code.

### Refactors

- **Compact prompts streamlined** — near-duplicate analysis instructions were merged into a parameterized helper, shared sections extracted into a constant, the summary section count was reduced from 9 to 8, an explicit `<summary>` tag instruction was added, and a density budget anchor was added. Net result: ~35% fewer prompt tokens per compact call with the same information fidelity.
- **`execFileNoThrow` converted to async/await** — prerequisite for the new awaitable goal-verify path; uses execa's `cancelSignal` API.
- **Goal state flag parsing** — ad-hoc parsing replaced with a typed `GoalFlagError` union, centralized error messages, and shared `GOAL_OPTIONS_USAGE` help text.
- **Command-surface cleanup** — removed stale build-excluded entries (`/agents-platform`, `/torch`) and stub entries (`/onboarding`, `/env`) that no longer have a backing file. Verified zero string-literal references remain.

### Bug Fixes

- **Agent worktree notification guarantee** — background agent tasks could permanently occupy the coordinator panel when the worktree probe threw, because the throw skipped `enqueueAgentNotification` and `evictTerminalTask` is gated on `notified: true`. Added `safeWorktreeResult` / `safeCleanupWorktree` helpers and a finally-block safety net that emits a minimal `failed` notification if all normal dispatch paths were skipped. The handoff classifier and the worktree probe now run in parallel.
- **Compact context recovery hardened** — `/compact` session recovery strengthened against malformed snapshots and interrupted streams, covering both interactive and auto-compact paths.
- **Empty compact summary blocks** — prevented empty transcript blocks from appearing in compact summary output.
- **Invalid thinking signature stripping** — thinking block signatures are bound to the API key/context that produced them; mid-session model/provider switches and interrupted streams could persist stale signatures that failed with a 400 on replay. Three replay paths are now closed: `/compact` strips all thinking before summarization (lossless since thinking is disabled there), `/resume` strips all thinking in `deserializeMessagesWithInterruptDetection`, and `filterInvalidSignatureThinkingBlocks` drops empty-signature blocks at any position in API normalization.
- **Provider gating tightened** — first-party and third-party provider switching hardened across beta flag handling, model remapping, and WebSearch tool provider checks.
- **Model adaptation for Opus 4.8** — Opus 4.7+ thinking defaults to `display: 'summarized'` in adaptive mode to avoid streaming empty thinking blocks; Opus 4.8 defaults to `high` effort (per the official models overview), with `xhigh` remaining opt-in; Sonnet 4.6 max output corrected from 128k to 64k (128k/300k is Batches-only).
- **Compact cache cleanup** — removed redundant `getUserContext.cache.clear` calls from three sites; `postCompactCleanup()` already handles this internally.

### Docs

- **README** — fixed commands, shortcuts, and governance info.
- **Operating guide** — documented the new `--max-turns` and `--verify` flags and auto-run verify behavior.
- **FEATURES.md** — added `BUILTIN_EXPLORE_PLAN_AGENTS` (default-on) and audit entries for `DUMP_SYSTEM_PROMPT` and `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED`.

## 1.3.3

### New Features

- **Claude Opus 4.8** — added support for the new flagship model.
- **OpenAI-compatible `reasoning_effort` translation** — opt-in via `CLAUDE_CODE_OPENAI_REASONING_EFFORT`; maps effort level to OpenAI's top-level `reasoning_effort` field. Max is clamped to `xhigh` (no OpenAI equivalent). Bedrock 4.7/4.8 effort allowlist also added.
- **Hide pre-compact tail from main view** — full-compact preserved tail no longer renders alongside its source summary; transcript (`ctrl+o`) still shows everything for inspection.

### Refactors

- **Drop incremental full-compact path** — the incremental checkpointing added in 1.3.2 is removed in favor of a simpler full-history rewrite. Edge cases (UUID collisions, summary ordering, stale-tail visibility) had accumulated; the cost was not paying off in practice. `compactConversation` now summarizes the whole post-boundary history in one pass.
- **Shared memory-file detection in compact** — centralized the JSONL memory-file detection helper so both compact paths and the session-memory path agree on the boundary.

### Bug Fixes

- Fixed `Opus 4.7+` 400s on `temperature` / `top_p` / `top_k` — those models removed sampling params; `verifyApiKey` and `queryModel` now skip `temperature` for `opus-4-7` and `opus-4-8`.
- Fixed `/provider` success string and dismissed-modal transcript entries leaking into the model context — both routes now use `display: 'skip'` plus a transient notification, since `SystemLocalCommandMessage` is wrapped as a user message by `normalizeMessagesForAPI` and shipped to the API.
- Fixed partial-compact duplicate-UUID collision in fullscreen rendering via per-base-key dedup counters.
- Fixed MCP tool input schemas that the Anthropic API rejects (top-level `oneOf` / `anyOf` / `allOf` or missing `type`) — `normalizeToolInputSchema` flattens composition keywords and defaults the type to `object`.
- Fixed `scope: "global"` system-prompt cache gating — broadened from "MCP tools only" to "any non-deferred tool", so built-in-tool-only requests no longer hit the 400.
- Fixed compact summary ordering — the post-compact message list now places `summaryMessages` after `boundaryMarker` and before any preserved content, matching the documented invariant.
- Fixed subagent worktree creation leaking the personality name on failure; corrected `daVinci` → `DaVinci` in the worker name pool.
- Updated default model health check to `Opus 4.8`; Bedrock 3P effort now defaults to `xhigh` via the provider allowlist.

### Chores

- Cleaned up review-flagged doc debt and a stale comment in `processSlashCommand.tsx` that contradicted the unconditional-skip code path.
- Updated launcher release notes to match the new compact behavior.

## 1.3.2

### New Features

- **Incremental compaction checkpoints** — full compaction now preserves a recent original-message tail and incrementally updates the prior checkpoint instead of repeatedly re-summarizing the same history.

### Refactors

- **Launcher and bundle hygiene** — `noa` now uses bundled metadata for compatibility checks, keeps mtime-based source rebuilds behind `CLAUDE_CODE_LAUNCHER_AUTO_REBUILD=1`, and rebuild watching ignores non-bundle paths.
- **Command surface cleanup** — removed dead build-excluded command registrations and the stale stub source directories they depended on.

### Bug Fixes

- Fixed compact cancel UX so manual compact, auto-compact, and message-selector summarize flows treat `Esc`/abort as cancellation instead of surfacing generic error states.
- Fixed highlight loading and session title fallback paths that could trigger hook-order issues or malformed titles.
- Fixed compact progress UI cues so compaction is visibly distinct from regular request activity.
- Fixed launcher version display so `noa` shows a stable user-facing version instead of a stale dev bundle suffix.
- Fixed session-memory compaction to run `PreCompact` and `PostCompact` hooks and to label the boundary marker with the actual trigger (`manual` vs `auto`). Previously the fast path bypassed both hooks and always wrote `auto`. Users with heavy `PreCompact` hooks will see the hook latency on every auto-compact attempt now, including ones that previously skipped it.

## 1.3.1

### New Features

- **Worker personality names** — generic worker subagents now get stable display names from a deterministic historical-figure pool, with color assignment that stays consistent across the UI.

### Refactors

- **React runtime deduplication** — build output now resolves `react`, `react-dom`, and `react-reconciler` through a single physical path so the bundled app does not carry duplicate React runtimes.
- **Claude in Chrome optional dependency handling** — startup now treats `@ant/claude-for-chrome-mcp` as truly optional and avoids auto-enabling the feature when the package is unavailable.

### Bug Fixes

- Fixed `bun run dev` and bundled startup from trying to resolve a missing `@ant/claude-for-chrome-mcp` package as if it were required.
- Fixed `Claude in Chrome` auto-enable logic so the feature does not get advertised or wired up when the optional MCP package is absent.

## 1.3.0

### New Features

- **Complete curl-installer distribution pipeline** — native install/uninstall/update chain via `curl -fsSL https://noa.ai/install.sh | bash` with atomic swap and rollback, compatible with Homebrew, WinGet, and apt/dnf.
- **Opus 4.7 xhigh effort level** — new xhigh speed/intelligence tier for Opus 4.7, removing the per-level capability gate and delegating clamping to runtime.
- **Auto-dream hardening** — lock stamp moved to post-success; adds model downshift and session cap for resource-bound environments.

### Refactors

- **Global rebrand** — all `.claude-agent` config paths, startup banners, and mode aliases renamed to `.noa` / `Noa` / `noa` / `Noa Claude` across the entire codebase.
- **Onboarding simplification** — drop redundant lodash memoize wrapper; drop sticky completion flag (derive from cwd state instead).
- **Provider profile cleanup** — `ENABLE_TOOL_SEARCH` removed from managed env keys.

### Bug Fixes

- Fixed Windows cross-project resume producing a PowerShell-incompatible `cd` command.
- Fixed spinner and elapsed-time disappearing after terminal resize or window refocus.
- Fixed skill list overflowing tab bounds inside margin box (constrained height + wrap).
- Fixed prompt suggestions not responding to mouse hover/click.
- Fixed provider command race condition and error message missing for third-party users.
- Fixed computer-use chat workflows taking routine screenshots; now prefers keyboard-driven search-selection in WeChat and similar apps.
- Fixed auto-compact entering infinite loop when collapse threshold reaches zero.
- Fixed prompt-cache attaching dynamic attribution header to `systemHash` (stripped).
- Fixed subagent resume losing cwd context and compact rollback leaving orphaned state.
- Fixed sync/async write race in sessionStorage transcript writes.
- Fixed release-notes sidebar layout rebalancing.

### Chores

- README rewritten to 172 lines with feature-first structure, keyboard shortcuts, agent execution guidance, and complete session commands.

## 1.2.0

### New Features

- **Native macOS Computer Use** — replaced the Anthropic MCP-based desktop control path with a self-contained macOS implementation built on `open`, AppleScript, `cliclick`, `screencapture`, `pbcopy`, and `pbpaste`.
- **App-first workflow** — GUI actions now require the intended app to be opened or activated first, with frontmost-app guards to keep follow-up actions anchored to the right window.
- **Search confirmation flow** — search-driven interactions now treat contact/item selection and message entry as separate phases, requiring `Return` after search results before typing the next payload.
- **App identity aliases** — common app names, localized names, and bundle ids are normalized so WeChat, Weixin, 微信, and similar variants resolve consistently.

### Refactors

- **Desktop control hardening** — coordinate actions now require a fresh screenshot context and invalidate cached coordinates after mouse actions, reducing stale-click failures.
- **Clipboard-backed typing** — non-ASCII and long text are routed through clipboard paste with clipboard restoration to avoid corruption from key synthesis.
- **AppleScript gating** — low-risk `open location` calls pass through while destructive AppleScript verbs still trigger approval.

### Bug Fixes

- Fixed focus drift after app switching by reactivating the target app before foreground actions when needed.
- Fixed `menu_click` so real menu-path failures are no longer hidden by alias retries.
- Fixed retry behavior so a failed GUI flow restarts from app activation instead of assuming the previous app state is still valid.
- Fixed log path matching for normalized project paths, including Windows drive letters.

### Chores

- Removed legacy computer-use MCP wrappers, cleanup helpers, and dead stub commands.
- Updated prompt guidance and regression coverage for the new computer-use flow.

## 1.1.0

### New Features

- **Goal evaluator-driven auto-continue** — goals now automatically continue up to 5 turns when the evaluator determines work remains. Each turn the evaluator scores goal progress and decides whether to keep going.
- **Richer goal state** — goals now track `autoContinueTurns`, `maxAutoContinueTurns`, `lastEvaluatorReason`, `completedAt`, and `stopReason` for better visibility into goal lifecycle.
- **Goal evaluator Haiku integration** — `evaluateGoalCompletion()` queries Haiku with a conservative prompt and JSON schema output to score goal progress from conversation context.
- **Centralized goal notice formatting** — `goalNotices.ts` consolidates all goal lifecycle message templates (`formatGoalCompleteNotice`, `formatGoalBudgetReachedNotice`, `formatGoalPausedNotice`, etc.) for consistent user-facing output.
- **Goal audit logging** — `goalAudit.ts` emits structured debug logs for all goal state transitions (start, success, failure, auto-continue, paused, budget-limited).

### Refactors

- **Sessions tab removed** — agents UI cleaned up: removed `SessionsView`, `SessionDetail`, `SessionRow`, and `useSessionPolling`. AgentsList and AgentsMenu simplified.
- **Build system migrated** — build script refactored from `Bun.spawn` CLI to `Bun.build()` API with a stub plugin for optional modules (`@ant/claude-for-chrome-mcp`, `@anthropic-ai/sandbox-runtime`) and feature-flag preprocessing.
- **Tree connector visual refresh** — replaced `⎿` (U+23BF) with `└─` box-drawing character across all UI prefix gutters for cleaner terminal aesthetics.

### Bug Fixes

- Fixed coordinator task panel visibility filtering.
- Fixed `decideGoalEvaluatorAction` to return `exhausted` when auto-continue turn limit is reached (instead of incorrectly calling the evaluator).
- Fixed context truncation in `buildGoalEvaluatorContext` to tail-first (preserving latest evidence) instead of head-last.

### Chores

- Added `node-forge`, `@pondwader/socks5-server` as transitive dependencies via `@anthropic-ai/sandbox-runtime`.
- Added `@anthropic-ai/vertex-sdk` for Vertex AI integration.

## 1.0.9

### New Features

- Added Sessions view — view, select, and kill active agent sessions directly from the agents menu.
- CLI `agents` command now displays active sessions alongside configured agents.

### Bug Fixes

- Fixed emoji highlighting using incorrect UTF-16 code unit boundaries — now uses Intl.Segmenter grapheme boundaries for proper multi-grapheme emoji handling.
- Fixed multi-image paste so each image correctly captures its own undo state using synchronous ref writes.
- Fixed dark theme hyperlink color (blue → cyan) for better accessibility on dark terminals.
- Fixed symlink path resolution by adding safeRealpath fallback for broken symlinks in settings detection.
- Fixed marketplace key resolution to match by source when settings key differs from manifest name.

### Chores

- Added `xhigh` effort level option for Opus 4.7+ models.
- GradientBanner now correctly passes displayModelLabel to provider detection.

## 1.0.8

### New Features

- Increased slash-command overlay visible items from 5 to 12 for a more browsable fullscreen experience.

### Bug Fixes

- Refactored system prompt generation to extract core execution guards into a dedicated section, ensuring these constraints are always present regardless of output style configuration.
- Removed the automatic scroll repin behavior when typing into an empty prompt, reducing interruption while reading long output.
- Fixed ink viewport resize behavior to preserve scrollback in default (non-alt-screen) mode.

### Chores

- Added `.claude-agent/settings.local.json` to `.gitignore`.

## 1.0.7

### Bug Fixes

- Fixed MCP tool results that return both `content` and `structuredContent` so visible blocks are preserved instead of being replaced by JSON.
- Fixed normal worktree creation to base new worktrees on local `HEAD`, preserving unpushed commits.
- Fixed npm plugin cache updates so unpinned packages refresh on explicit update and semver ranges are compared against cached versions correctly.
- Fixed `/context` output so the transcript stays visible without being added to the model-visible message history.
- Fixed MCP URL policy matching for mixed-case schemes and hosts.
- Fixed parallel Bash execution so read-only Bash failures no longer cancel unrelated read-only siblings.

### Chores

- Added regression coverage for the MCP, worktree, plugin cache, `/context`, policy matching, and streaming executor fixes.

## 1.0.6

### Bug Fixes

- Fixed release notes panel sometimes not appearing after upgrade because `lastReleaseNotesSeen` was written before the async changelog cache had loaded.
- Fixed release notes panel flicker on startup by reading `hasReleaseNotes` once via lazy initialization instead of re-evaluating each render.
- Fixed `/release-notes` so Enter expands the selected entry instead of immediately dismissing the panel.
- Fixed `/release-notes` expanded view to stay within a fixed viewport and scroll instead of overflowing the terminal.

### Chores

- Added regression coverage for the synchronous release notes accessor's bundled-changelog fallback.

## 1.0.5

### New Features

- Exposed `bypass permissions` to local users.
- Improved trust handling so the home directory can be trusted without leaking that trust to child directories.

### Bug Fixes

- Fixed fullscreen exit cleanup so residual screen artifacts no longer linger after leaving `/tui fullscreen`.
- Fixed onboarding and trust dialogs so setup screens render and dismiss more consistently.
- Fixed Bedrock `application-inference-profile` requests for Opus 4.7 by resolving the backing model before thinking/effort capability checks.
- Fixed `thinking.type.enabled is not supported` 400s on Bedrock Opus 4.7 inference profiles.

### Chores

- Added runtime coverage for the Bedrock Opus 4.7 thinking path and home-directory trust inheritance.

## 1.0.4

### New Features

- Added `xhigh` effort level for Opus 4.7+ models.
- Added support for GitLab and Bitbucket PR URLs in addition to GitHub.
- Added `CLAUDE_CODE_HIDE_CWD` and `DISABLE_UPDATES` environment variables.
- Added `duration_ms` field to PostToolUse hooks with corrected timeout default.
- Exposed effort level and thinking state to the statusline.
- Added vim visual and visual-line modes.
- Implemented automatic terminal theme detection (light/dark).
- Improved skills menu with better invocation guidance.

### Bug Fixes

- Fixed branch fork copying dangling `tool_use` entries from compacted/snip-removed transcript entries.
- Fixed malformed hooks in `settings.json` causing entire config to be rejected — now gracefully filters invalid hooks.
- Fixed `is_error` flag being lost when PostToolUse hooks replace non-MCP tool output.
- Fixed PostToolUse hooks `updatedMCPToolOutput` field to work for all tools (was MCP-only).
- Fixed resume race condition, UI lock, and fragile error classification.
- Fixed compact distinguished exhaustion, error, and `media_unstrippable` failure messages.
- Fixed wiki infinite loop by removing message state from `useEffect` dependencies.
- Fixed C++ and C# file extension aliases in the Write tool.
- Fixed rename error logging and memory error messages.
- Fixed session atomic branch writes and tag cleanup.
- Fixed feedback submission routing to GitHub Issues instead of Anthropic API.
- Fixed export dialog using deprecated `writeFileSync` — now uses async `writeFile`.
- Fixed startup banner using sync FS calls — now uses `fs/promises`.
- Fixed feedback survey transcript sharing to no longer POST to Anthropic.
- Fixed startup prefetches to be gated on `isFirstPartyAnthropicBaseUrl`.
- Fixed privacy by removing Anthropic URLs and internal-only references.
- Fixed effort slider Ctrl+C handling to properly exit through global exit path.
- Fixed `noa claude` prompt and model chain alignment.
- Fixed Opus 4.7 compatibility issues and updated hardcoded models.
- Fixed fullscreen pill and teammate snapshot.
- Fixed path references and dev-experience improvements.

### Chores

- Unified Noa Claude branding across the codebase.
- Removed dead JS stubs and converged source stubs to TypeScript.
- Restored gated runtime contracts.
- Updated README with dev commands, env vars, and expanded command list.

## 1.0.3

- Fixed plan mode state inconsistency: `/plan open` and `/plan <description>` now work regardless of current mode.
- Fixed MCP OAuth error handling when auth server returns non-JSON (captive portals, proxy auth pages).
- Fixed Windows CRLF paste handling in prompt input.
- Improved command suggestion highlighting in autocomplete.
- Refactored SkillsMenu to standard React patterns (removed React compiler runtime dependency).

## 1.0.2

- Unified `/status`, `/config`, `/usage`, and `/stats` onto the new status panel, with corrected tab navigation and layout.
- Fixed banner/provider refresh so clawd and gradient banner content updates correctly after `/login` and provider switches in default TUI mode.
- Improved model resolution after auth changes so provider-backed defaults are picked up consistently.

## 1.0.1

- Added `/tui` command to toggle between default and fullscreen (no-flicker) terminal UI mode.
- Fixed CondensedLogo never showing — the simplified mascot layout now correctly displays after onboarding and release notes are complete.
- Fixed `/tui` env var priority — `NOA_CLAUDE_NO_FLICKER` now correctly overrides persistent `tuiMode` settings.
- Rebranded user-facing strings from Claude Code to Noa Claude.

## 1.0.0

- Unified the standalone build and compile chain.
- Added global startup banner modes and removed project-level overrides.
- Switched default release notes to a local bundled source.
- Consolidated the default help surface onto repository documentation.
