# Release Notes

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
