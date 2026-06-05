# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.5] - 2026-06-05

### Fixes

- **3P model default realignment** (`4c43d6bf`, partially supersedes `d686afa7`) — Aligned 3P provider defaults with upstream Claude Code (v2.1.165):
  - **Opus**: 1P = 4.8, 3P (Bedrock/Vertex/Foundry) stays on 4.7. The 3P→4.8 promotion attempted in `d686afa7` was reverted because upstream still ships the 4.7 fallback for Opus. Override via `ANTHROPIC_DEFAULT_OPUS_MODEL`.
  - **Sonnet**: 1P and 3P both default to 4.6. The previous 3P→4.5 fallback was a fork-only addition upstream never had; its removal (from `d686afa7`) is kept.
  - **Bedrock Opus IDs**: added missing `us.` CRIS prefix to Opus 4.7/4.8 Bedrock IDs (`us.anthropic.claude-opus-4-{7,8}`).
- **Bundled `/claude-api` skill** (`48a54365`) — The skill shipped with empty doc files, so `/claude-api` produced no usable content. Populated all 41 reference docs to match the upstream skill byte-for-byte, reconstructed `SKILL.md`, and fixed two delivery bugs:
  - Added a base directory via a lazy files thunk so the model can Read any doc on demand. Inline only the core per-language docs; large docs (managed-agents, model-migration) are served from disk (~140KB/invocation instead of ~360KB if everything were inlined).
  - Bun defaults to an HTML loader for `.md` but the skill imports expect raw markdown text. Forced the text loader in `build.ts` (bundle) and `bunfig.toml` (runtime / dev:source).
- **Compact summary direction** (`52bcef42`) — `compactConversation` and the session-memory full-compact path now stamp `direction: 'up_to'` on their summaries; `isStaleFullCompactSummary` already keyed on the field but the undated default made the check rely on undefined. Flipped the display ternary so the only "from this point" special case is the actual `'from'` direction — legacy undated summaries no longer render as "from this point".
- **Partial compact scope** (`5079da05`) — `getPartialCompactPrompt` now accepts a `targetMessageCount` and emits a "Recent-message boundary" instruction so the model summarizes only the recent tail selected for partial compaction, not the entire retained context. Also hardened `formatCompactSummary`: `<summary>` extraction moved to the top of the pipeline (returns trimmed content as `Summary:\n...` when matched), and `<analysis>` stripping now tolerates attributes (e.g. `<analysis lang="en">`).
- **Direct resume handling** (`2de3445e`) — `/resume <uuid>` no longer falls through to a custom-title search after the UUID path; it now goes straight from UUID → `getLastSessionLog` → resume-or-summary-gate. The `multipleMatches` error no longer exposes the count. Custom-title search gains a `stopAfterDistinctMatches` option so the call short-circuits once 2 distinct sessions have matched. The shared summary-gate predicate is now `shouldShowResumeSummaryGate` (a try/catch wrapper) used by both code paths. `getLastSessionLog` now populates `fileSize` via a new `getSessionLogFileInfo` helper so the gate predicate has consistent data. `ResumeSummaryGate` accepts a new `backLabel` prop ("Cancel" from the direct-resume path, "Back to list" from the picker path).

### Refactors

- **Custom title match helpers** (`2de3445e`) — `searchSessionsByCustomTitle` was split into `filterCustomTitleMatches` / `addCustomTitleMatch` / `finalizeCustomTitleMatches` / `normalizeCustomTitle` to support the new early-stop path. Exposed `_filterCustomTitleMatchesForTesting` and added matching runtime-health assertions in `scripts/check-runtime-health.mjs`.

## [1.3.4] - 2026-06-04

### Features

- **`/goal` auto-verification** (`f37f1c1f`) — `/goal` and `/goal replace` now support `--max-turns N` and `--verify "<cmd>"` flags. When a verify command is configured, it runs automatically after each eligible goal turn. A non-zero exit code prevents goal completion regardless of the evaluator's opinion; model-requested completion stays pending until both verify passes and the evaluator approves. Includes full session restore support for verify state.
- **Built-in Explore/Plan subagents enabled by default** (`6c036d69`) — `BUILTIN_EXPLORE_PLAN_AGENTS` is now on by default in all build profiles. GrowthBook gating is inert in this build (hard-disabled), so the feature ships unconditionally.
- **Startup banner redesign** (`f02094e0`, `3ee3b65b`, `980c3269`) — New 8-line block-font ASCII logo with rounded box corners, dynamic content-driven width, inline `/provider` hint, and refined info row ordering. Endpoint row restored; minimum width widened to 64.
- **Single-file grep read registration** (`2ace853a`) — `grep`/`egrep`/`fgrep` commands targeting a single file now register that file as "read", allowing subsequent Edit/Write operations to proceed without an explicit Read call. Aligns with upstream Claude Code v2.1.160 behavior.

### Fixes

- **Agent worktree notification guarantee** (`6d8ad32a`) — Background agent tasks could permanently occupy the coordinator panel when the worktree probe threw, because the throw skipped `enqueueAgentNotification` and `evictTerminalTask` is gated on `notified: true`. Added `safeWorktreeResult`/`safeCleanupWorktree` helpers and a finally-block safety net that emits a minimal `failed` notification if all normal dispatch paths were skipped.
- **Compact context recovery hardening** (`d66e9ad0`) — Strengthened `/compact` session recovery against malformed snapshots and interrupted streams. Covers both interactive and auto-compact paths.
- **Empty compact summary blocks** (`a94e760a`) — Prevented empty transcript blocks from appearing in compact summary output.
- **Invalid thinking signature stripping** (`44e6cb21`) — Thinking block signatures are bound to the API key/context that produced them. After a mid-session model/provider switch or interrupted stream, replayed blocks fail with a 400 "Invalid signature in thinking block". Closed three paths that replayed them:
  - `/compact`: strips all thinking before summarization (thinking is disabled there, lossless).
  - `/resume`: strips all thinking in `deserializeMessagesWithInterruptDetection`.
  - API normalization: `filterInvalidSignatureThinkingBlocks` drops empty-signature blocks at any position.
- **Provider gating tightening** (`85fa056c`) — Hardened first-party and third-party provider switching logic, including beta flag handling, model remapping, and WebSearch tool provider checks.
- **Model adaptation for Opus 4.8** (`95a78088`) —
  - Thinking: Opus 4.7+ defaults to `display: 'summarized'` in adaptive thinking mode to prevent empty thinking blocks in the UI.
  - Effort: Opus 4.8 defaults to `high` (per official models overview), not `xhigh`. `xhigh` remains opt-in.
  - Context: Sonnet 4.6 max output corrected from 128k to 64k (128k/300k is Batches-only).
- **Compact cache cleanup** (`f05bdea8`) — Removed redundant `getUserContext.cache.clear` calls from three call sites in `compact.ts`; `postCompactCleanup()` already handles this internally.

### Refactors

- **Compact prompt streamlining** (`4c5f348b`) — Merged near-identical analysis instructions into a parameterized function, extracted shared sections into a constant, reduced summary output from 9 to 8 sections, added explicit `<summary>` tag instruction, added density budget anchor, and replaced verbose example block with a single-line hint. Net result: ~35% fewer prompt tokens per compact call with same information fidelity.
- **`execFileNoThrow` async/await** (`f37f1c1f`) — Converted `execFileNoThrowWithCwd` from Promise/then chains to async/await using execa's `cancelSignal` API. Prerequisite for the new awaitable goal verify path.
- **Goal state parsing** (`f37f1c1f`) — Replaced ad-hoc flag parsing with a typed `GoalFlagError` union, centralized error messages in `GOAL_FLAG_ERROR_MESSAGES`, and introduced `GOAL_OPTIONS_USAGE` for consistent help text across `/goal` and `/goal replace`.
- **Command-surface cleanup** (`6c036d69`) — Removed stale build-excluded entries for `/agents-platform` and `/torch`, and stub entries for `/onboarding` and `/env`. Verified zero string-literal references remain for any of the four.

### Docs

- **README update** (`21e22b01`) — Fixed commands, shortcuts, and governance info.
- **Operating guide** (`f37f1c1f`) — Documented the new `--max-turns` and `--verify` flags, auto-run verify behavior, and updated status output.
- **Feature documentation** (`6c036d69`) — Added `BUILTIN_EXPLORE_PLAN_AGENTS` to `FEATURES.md` (default-on). Added audit entries for `DUMP_SYSTEM_PROMPT` and `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED`.

[1.3.5]: https://github.com/rickkwang/Noa-Claude/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/rickkwang/Noa-Claude/compare/v1.3.3...v1.3.4
