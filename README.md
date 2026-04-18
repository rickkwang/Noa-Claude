# Noa Claude

An open-source build of Claude Code based on the publicly exposed source code, branded as Noa Claude.

## Core Modifications

Three key changes from the upstream:

1. **Telemetry removed** — All outbound OpenTelemetry, GrowthBook analytics, Sentry error reporting, and custom event logging are dead-code-eliminated or stubbed.
2. **Security guardrails stripped** — System-level instructions injected into conversations (hardcoded refusal patterns, cyber risk instruction blocks) are removed.
3. **Default links localized** — default help, release notes, validation hints, and other runtime-facing guidance resolve to repository-local or project-owned URLs instead of upstream docs.
4. **Experimental profile available** — opt-in `dev-full` profile enables additional feature flags for internal/dev scenarios.

## Product Positioning

Noa Claude is a mature core coding agent with an intentionally scoped surface area.

- The primary agent loop, tool execution, session resume, compact, and remote/session plumbing are production-grade.
- Baseline workflows are limited to the product-owned surfaces documented in `docs/product-governance.md`.
- Non-baseline, build-excluded, and stubbed commands are deliberate scope controls, not accidental omissions.

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
- **OpenAI-Compatible Model Discovery** — `/model` merges static options with runtime-discovered models from `/v1/models` or `/models` (with Ollama `/api/tags` fallback).
- **Gemini Multi-Auth** — Gemini OpenAI-compatible endpoint supports `api-key`, `access-token`, and `adc` authentication modes.
- **PR Intent Scan** — CI checks PR added lines for suspicious links/download patterns and fails on high-severity findings.
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
| `bun run compile` | `dist/cli` + `dist/main.js` | Standalone binary + bundled JS entry |
| `bun run build:dev:full` | `dist/main-dev.js` | Dev build + expanded experimental feature profile |

## Supported Providers

| Provider | Environment | Enable |
|----------|-------------|--------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | default |
| OpenAI-compatible | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` | `CLAUDE_CODE_USE_OPENAI=1` |
| AWS Bedrock | `ANTHROPIC_BASE_URL` + Bedrock credentials | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex | `ANTHROPIC_BASE_URL` + Vertex credentials | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Foundry | `ANTHROPIC_BASE_URL` + Foundry credentials | `CLAUDE_CODE_USE_FOUNDRY=1` |

### OpenAI-Compatible Model Discovery

- Enabled only when `CLAUDE_CODE_USE_OPENAI=1`.
- Discovery probes `GET /v1/models` and `GET /models` from `OPENAI_BASE_URL`.
- Azure endpoints include `api-key` and optional `api-version` (`OPENAI_API_VERSION`) during discovery.
- If model listing fails and the endpoint looks local/Ollama-compatible, it probes `GET /api/tags`.
- Discovery failures do not block startup or `/model`; they are debug-log only.

### Gemini Auth Modes

- `GEMINI_AUTH_MODE=api-key|access-token|adc`
- `api-key`: `GEMINI_API_KEY` (fallback `GOOGLE_API_KEY`)
- `access-token`: `GEMINI_ACCESS_TOKEN`
- `adc`: local ADC (`GOOGLE_APPLICATION_CREDENTIALS` or default gcloud ADC file)

When credentials are missing, Noa Claude returns a mode-specific actionable error instead of a generic provider failure.

## Key Commands

- `/fork` - Fork session into a resumable branch
- `/workflows` - Manage local reusable workflows
- `/summary` - Generate structured session summary
- `/share` - Export session snapshot
- `/cache-probe` - Probe API cache hit rate by sending identical requests
- `/wiki` - Project documentation management (init / status / ingest)
- `/provider` - Manage named provider configurations
- `/loop` - Run fixed-interval recurring tasks or dynamic self-rescheduling maintenance loops
- `/tasks` - View and manage background tasks plus scheduled loops/jobs

See [docs/operating-guide.md](docs/operating-guide.md) for runtime, session, worktree, agent, and progress-artifact documentation. See [docs/product-governance.md](docs/product-governance.md) for command surface governance.

## Privacy

This build ships with hardcoded privacy defaults (no configuration needed):

- All telemetry paths hard-disabled
- GrowthBook remote fetch hard-disabled
- Remote policy overlays hard-disabled
- Default runtime help and guidance resolved to local/project-owned links

## Verification

Default local maintenance checks:

```bash
bun run compile && ./dist/cli --version
bun run typecheck
bun run lint
bun run check:runtime
bun run smoke:features
bun run smoke:engine
bun run scan:pr-intent
```

Release candidate provider check:

```bash
bun run smoke:engine:live
```

`smoke:engine:live` requires provider credentials (at minimum `ANTHROPIC_API_KEY`).
For CI, use the manual workflow in `.github/workflows/smoke-engineering-live.yml`.

## Engineering Bar

The repo treats these as first-class stability signals:

- interactive startup stays alive
- `--print` stays usable for non-interactive coding
- resume/continue survive compaction and transcript recovery
- MCP startup degrades instead of blocking the shell
- tool orchestration preserves permission boundaries and retry safety
- remote/session plumbing keeps trust, auth, and reconnect behavior explicit

When making runtime changes, prefer fixing the failure-mode regression or validation gap before adding new surface area.

## License Note

This repository is a reconstruction based on publicly exposed source code. The original Claude Code source is the property of Anthropic. This build exists because the source was publicly exposed through their npm distribution.

- Not an official Anthropic release or supported product
- Anthropic, Claude, and Claude Code are trademarks of their respective owners
- Use at your own discretion
