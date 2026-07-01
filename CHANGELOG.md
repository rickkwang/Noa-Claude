# Changelog

## v1.5.0

### Added
- Claude Sonnet 5 model support
- Live file-path autocomplete in bash mode
- `/cd` command to move the session working directory
- Programmatic logo animation sequences and particle effects

### Fixed
- Effort slider labels now use semantic theme tokens (instead of hardcoded ansi colors) and get a dedicated shimmer effect at `xhigh`; relabeled to Faster/Smarter
- Exact-match hyphenated matcher identifiers in hooks
- Logo banner now matches terminal width; fixed dim bleed in feed titles
- Ghostty spinner aligned with upstream Claude Code
- Leading tabs converted to spaces in code/diff rendering
- Daily stats now bucket by local day instead of UTC (including date display)
- Structured-outputs allowlist aligned with Opus 4.7/4.8; Opus now defaults to 1M context
- Removed redundant result fallback in `initialPermissionModeFromCLI`
- TUI ratchet viewport feedback loop no longer breaks

### Removed
- Computer-use (native ComputerTool) feature

### Chore
- Cleaned up Noa marketplace and launcher names
- Refined agent verification guidance
- Centralized progress types and tightened Tool typecheck
- Isolated provider env in prompt tests

## v1.4.0

- Keep-tail auto-compact: preserve verbatim recent tail during auto-compaction
- Compact safety-constraint preservation in summarization prompt
- Query loop harness extracted (`query/transitions.ts`, `deps.ts`, `config.ts`, `tokenBudget.ts`, `stopHooks.ts`)
- Phantom types formally defined; all `@ts-nocheck` removed from `src/query/*`
- Dead-code cleanup: 13 upstream-only flags removed, dev-full profile repaired
- 12MB vestigial inline sourcemaps stripped from 531 source files
- Query loop recovery hardened (5 fixes from harness review)
- Microcompact input clearing for large Write/Edit inputs
- Reactive compact stub for dev-full builds
- Provider profile credential validation with CJK/whitespace denylist
- Bedrock `count_tokens` adaptive thinking for adaptive-only models
- Fire-and-forget promise rejection handling with `.catch(logError)`
