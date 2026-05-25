# Release Notes

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
