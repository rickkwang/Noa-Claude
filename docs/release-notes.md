# Release Notes

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
