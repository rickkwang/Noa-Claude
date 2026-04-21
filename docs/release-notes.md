# Release Notes

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
