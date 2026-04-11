# Claude Agent

An open-source build of Claude Code based on the publicly exposed source code.

## Core Modifications

Three key changes from the upstream:

1. **Telemetry removed** — All outbound OpenTelemetry, GrowthBook analytics, Sentry error reporting, and custom event logging are dead-code-eliminated or stubbed.
2. **Security guardrails stripped** — System-level instructions injected into conversations (hardcoded refusal patterns, cyber risk instruction blocks) are removed.
3. **Experimental features unlocked** — 68 of 88 feature flags that compile cleanly are enabled.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/rickkwang/Claude-Agent/main/install.sh | bash
```

Or build from source:

```bash
git clone https://github.com/rickkwang/Claude-Agent.git && cd Claude-Agent
bun run compile
./dist/cli --version
```

## Build Commands

| Command | Output | Note |
|---------|--------|------|
| `bun run build` | `dist/main.js` | Requires bun runtime |
| `bun run compile` | `dist/cli` | Standalone executable |
| `bun run build:dev:full` | `dist/main-dev.js` | Dev build + all experimental features |

## Supported Providers

| Provider | Environment |
|----------|-------------|
| Anthropic (default) | `ANTHROPIC_API_KEY` |
| AWS Bedrock | `ANTHROPIC_BASE_URL` + Bedrock credentials |
| Google Vertex | `ANTHROPIC_BASE_URL` + Vertex credentials |

## Key Commands

- `/fork` - Fork session into a resumable branch
- `/workflows` - Manage local reusable workflows
- `/summary` - Generate structured session summary
- `/share` - Export session snapshot

## Privacy

This build ships with hardcoded privacy defaults (no configuration needed):

- All telemetry paths hard-disabled
- GrowthBook remote fetch hard-disabled
- Remote policy overlays hard-disabled

## Verification

```bash
bun run build && ./dist/cli --version
```

## License Note

This repository is a reconstruction based on publicly exposed source code. The original Claude Code source is the property of Anthropic. This build exists because the source was publicly exposed through their npm distribution.

- Not an official Anthropic release or supported product
- Anthropic, Claude, and Claude Code are trademarks of their respective owners
- Use at your own discretion
