# Claude Agent

An open-source build of Claude Code based on the publicly exposed source code.

## Core Modifications

Three key changes from the upstream:

1. **Telemetry removed** — All outbound OpenTelemetry, GrowthBook analytics, Sentry error reporting, and custom event logging are dead-code-eliminated or stubbed.
2. **Security guardrails stripped** — System-level instructions injected into conversations (hardcoded refusal patterns, cyber risk instruction blocks) are removed.
3. **Experimental features unlocked** — 68 of 88 feature flags that compile cleanly are enabled.

## Capability Highlights

This build adds several enhancements beyond upstream:

- **Multi-Provider Support** — OpenAI-compatible, AWS Bedrock, Google Vertex, Microsoft Foundry alongside Anthropic's first-party API.
- **Agent Routing** — Assign different models to different agents via `settings.json` (`agentModels`, `agentRouting`).
- **MCP Tool Compaction** — MCP tool results are included in context compaction, reducing token usage 20-40% for MCP-heavy sessions.
- **128k Fallback** — Unknown OpenAI-compatible models use a conservative 128k context window to prevent compact threshold underestimation.
- **store:false Privacy** — Third-party API requests include `store: false` to prevent conversation data from being used for training.
- **Cache Cost Normalization** — OpenAI-compatible provider cache reads are correctly attributed, avoiding 2× cost inflation in `/cost` output.
- **Auto-fix Hook** — After file edits, automatically run configurable lint/test commands.
- **Cache-probe** — `/cache-probe` command to diagnose API cache hit rate by comparing `cached_tokens` across identical requests.
- **Wiki Commands** — `/wiki init`, `/wiki status`, `/wiki ingest` for project documentation management.
- **Provider Profile Manager** — `/provider` command to create and manage named provider configurations.
- **SSRF Protection** — URL resolution validated against IPv4/IPv6 private ranges before outbound requests.

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

| Provider | Environment | Enable |
|----------|-------------|--------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | default |
| OpenAI-compatible | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` | `CLAUDE_CODE_USE_OPENAI=1` |
| AWS Bedrock | `ANTHROPIC_BASE_URL` + Bedrock credentials | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex | `ANTHROPIC_BASE_URL` + Vertex credentials | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Foundry | `ANTHROPIC_BASE_URL` + Foundry credentials | `CLAUDE_CODE_USE_FOUNDRY=1` |

## Key Commands

- `/fork` - Fork session into a resumable branch
- `/workflows` - Manage local reusable workflows
- `/summary` - Generate structured session summary
- `/share` - Export session snapshot
- `/cache-probe` - Probe API cache hit rate by sending identical requests
- `/wiki` - Project documentation management (init / status / ingest)
- `/provider` - Manage named provider configurations

See [docs/operating-guide.md](docs/operating-guide.md) for runtime, session, worktree, agent, and progress-artifact documentation. See [docs/product-governance.md](docs/product-governance.md) for command surface governance.

## Privacy

This build ships with hardcoded privacy defaults (no configuration needed):

- All telemetry paths hard-disabled
- GrowthBook remote fetch hard-disabled
- Remote policy overlays hard-disabled

## Verification

```bash
bun run build && ./dist/cli --version
bun run typecheck
bun run check:runtime
bun run smoke:features
```

## License Note

This repository is a reconstruction based on publicly exposed source code. The original Claude Code source is the property of Anthropic. This build exists because the source was publicly exposed through their npm distribution.

- Not an official Anthropic release or supported product
- Anthropic, Claude, and Claude Code are trademarks of their respective owners
- Use at your own discretion
