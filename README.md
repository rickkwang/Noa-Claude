# Noa Claude

An open-source coding agent built from publicly exposed Claude Code source.

## Core Differences from Upstream

- **Telemetry removed** — All outbound OpenTelemetry, GrowthBook analytics, Sentry error reporting, and custom event logging are dead-code-eliminated or stubbed.
- **Security guardrails stripped** — System-level instruction blocks injected into conversations are removed.
- **Multi-provider support** — OpenAI-compatible, AWS Bedrock, Google Vertex, Microsoft Foundry alongside Anthropic's first-party API.
- **Local default links** — Default help, release notes, validation hints, and runtime guidance resolve to repository-local or project-owned URLs instead of upstream docs.
- **dev-full profile** — Opt-in `bun run build:dev:full` enables additional feature flags for internal/dev scenarios.

## Key Commands

```
/help      - Inspect built-in command surface and skill registry
/fork      - Create a resumable fork of the current conversation      [baseline]
/workflows - Manage local reusable workflows                          [baseline]
/summary   - Generate structured session summaries                        [baseline]
/share     - Export local session share snapshots under .claude-agent/shares [baseline]
/compact   - Summarize and compact conversation history
/status    - Inspect current runtime state, MCP, plugins, and agents
/config    - View and edit settings
/model     - Switch model or list available models
/login     - Authenticate with your provider
/logout    - Clear stored credentials
/doctor    - Diagnose installation health and configuration
/tui       - Switch between default and fullscreen REPL layout
/usage     - View token usage for current session
/cost      - Estimate cost of the current conversation
```

Baseline commands (`[baseline]`) are the supported product workflows. Other commands are available but not part of the core surface.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/rickkwang/Noa-Claude/main/install.sh | bash
```

Or build from source:

```bash
git clone https://github.com/rickkwang/Noa-Claude.git && cd Noa-Claude
bun run compile
./dist/cli --version
```

## Build Commands

| Command | Output | Note |
|---------|--------|------|
| `bun run build` | `dist/main.js` | Requires bun runtime |
| `bun run compile` | `dist/cli` + `dist/main.js` | Standalone binary + bundled JS entry |
| `bun run build:dev:full` | `dist/main-dev.js` | Dev build + expanded experimental feature profile |

## Runtime Toggles

- `NOA_CLAUDE_NO_FLICKER=1` enables the fullscreen anti-flicker REPL layout
- `NOA_CLAUDE_NO_FLICKER=0` disables it
- `NOA_CLAUDE_DISABLE_MOUSE=1` keeps fullscreen layout but turns off mouse tracking
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS=1` keeps mouse tracking but ignores clicks and drags

Legacy `CLAUDE_CODE_*` names are still accepted for compatibility, but `NOA_CLAUDE_*` is the preferred brand prefix.

## Supported Providers

| Provider | Environment | Enable |
|----------|-------------|--------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | default |
| OpenAI-compatible | `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` | `CLAUDE_CODE_USE_OPENAI=1` |
| AWS Bedrock | `ANTHROPIC_BASE_URL` + Bedrock credentials | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex | `ANTHROPIC_BASE_URL` + Vertex credentials | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Foundry | `ANTHROPIC_BASE_URL` + Foundry credentials | `CLAUDE_CODE_USE_FOUNDRY=1` |

### OpenAI-Compatible Model Discovery

Enabled only when `CLAUDE_CODE_USE_OPENAI=1`. Discovery probes `GET /v1/models` and `GET /models` from `OPENAI_BASE_URL`. Azure endpoints include `api-key` and optional `OPENAI_API_VERSION`. If model listing fails on a local/Ollama-compatible endpoint, it falls back to `GET /api/tags`. Discovery failures do not block startup.

### Gemini Auth Modes

- `GEMINI_AUTH_MODE=api-key|access-token|adc`
- `api-key`: `GEMINI_API_KEY` (fallback `GOOGLE_API_KEY`)
- `access-token`: `GEMINI_ACCESS_TOKEN`
- `adc`: local ADC via `GOOGLE_APPLICATION_CREDENTIALS` or default gcloud ADC file

## Capability Highlights

- **Multi-Provider Support** — OpenAI-compatible, AWS Bedrock, Google Vertex, Microsoft Foundry alongside Anthropic's first-party API.
- **Agent Routing** — Assign different models to different agents via `settings.json` (`agentModels`, `agentRouting`).
- **MCP Tool Compaction** — MCP tool results are included in context compaction, reducing token usage 20–40% for MCP-heavy sessions.
- **128k Fallback** — Unknown OpenAI-compatible models use a conservative 128k context window to prevent compact threshold underestimation.
- **store:false Privacy** — Third-party API requests include `store: false` to prevent conversation data from being used for training.
- **Cache Cost Normalization** — OpenAI-compatible provider cache reads are correctly attributed, avoiding 2× cost inflation in `/cost` output.
- **Auto-fix Hook** — After file edits, automatically run configurable lint/test commands.
- **Cache-probe** — `/cache-probe` command to diagnose API cache hit rate by comparing `cached_tokens` across identical requests.
- **Wiki Commands** — `/wiki init`, `/wiki status`, `/wiki ingest` for project documentation management.
- **Provider Profile Manager** — `/provider` command to create and manage named provider configurations.
- **PR Intent Scan** — CI checks PR added lines for suspicious links/download patterns and fails on high-severity findings.
- **SSRF Protection** — URL resolution validated against IPv4/IPv6 private ranges before outbound requests.
- **TUI Mode** — `/tui` switches between default and fullscreen (no-flicker) terminal UI.

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
bun run check:runtime
bun run smoke:features
bun run smoke:engine
bun run scan:pr-intent
```

Release candidate provider check:

```bash
bun run smoke:engine:live
```

`smoke:engine:live` requires `ANTHROPIC_API_KEY`. For CI, use the manual workflow in `.github/workflows/smoke-engineering-live.yml`.

## Engineering Bar

The repo treats these as first-class stability signals:

- interactive startup stays alive
- `--print` stays usable for non-interactive coding
- resume/continue survive compaction and transcript recovery
- MCP startup degrades gracefully instead of blocking the shell
- tool orchestration preserves permission boundaries and retry safety
- remote/session plumbing keeps trust, auth, and reconnect behavior explicit

When making runtime changes, prefer fixing the failure-mode regression or validation gap before adding new surface area.

See [docs/operating-guide.md](docs/operating-guide.md) for runtime, session, worktree, agent, and progress-artifact documentation. See [docs/product-governance.md](docs/product-governance.md) for command surface governance and baseline definitions.

## License Note

This repository is a reconstruction based on publicly exposed source code. The original Claude Code source is the property of Anthropic.

- Not an official Anthropic release or supported product
- Anthropic, Claude, and Claude Code are trademarks of their respective owners
- Use at your own discretion
