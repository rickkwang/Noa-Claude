# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.4]: https://github.com/rickkwang/Noa-Claude/compare/v1.3.3...v1.3.4
