# Product Help

This document is the default local help hub for Noa Claude.

## Getting Started

- Use `/help` to inspect the built-in command surface.
- Use `/release-notes` to view the bundled release notes.
- Use `bun run compile` to build a standalone binary.

## Security

- Review commands before running them.
- Keep untrusted repositories and files isolated.
- Prefer the docs in this repository over external product pages for default workflows.
- External builds can opt into fork subagents with `CLAUDE_CODE_FORK_SUBAGENT=1`.

## Release Notes

Release notes are bundled locally and cached in `~/.claude-agent/cache/changelog.md`.

## Support

- See `docs/operating-guide.md` for runtime and session behavior.
- See `docs/product-governance.md` for command-surface policy.
