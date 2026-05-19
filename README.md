# Noa Claude

A local-first coding agent for software work — long sessions, resumable forks, multi-provider routing, and privacy defaults that don't require configuration.

Noa is a productized fork of publicly exposed Claude Code source, rebuilt for developers who want local control, provider flexibility, and continuity features that hold up under real daily use.

## Quick Start

Install:

```bash
curl -fsSL https://raw.githubusercontent.com/rickkwang/Noa-Claude/main/install.sh | bash
```

Or build from source:

```bash
git clone https://github.com/rickkwang/Noa-Claude.git && cd Noa-Claude
bun run dev
```

Typical first session:

```bash
noa
/login
/doctor
/help
```

Then open a project and ask for real work: fix a bug, explain a subsystem, review a diff, or fork a branch of investigation with `/fork`.

## Core Features

**Sessions**
- `/fork` — Create a resumable fork of the current conversation
- `/resume` — Resume a previous conversation
- `/compact` — Summarize long conversations to preserve context
- `/tree` — Navigate session history and branches
- `/clear` — Clear the current conversation and start fresh
- `/export` — Export conversation to a file
- `/rename` — Rename the current session
- `/tag` — Tag the current session for quick lookup
- `/summary` — Generate structured session summaries
- `/share` — Export share snapshots under `.claude-agent/shares`

**Provider routing**
- `/provider` — Switch between saved provider profiles (JSON-based, stored in `~/.claude-agent/provider-profiles.json`)
- `/model` — Switch model or list available models
- `/login` / `/logout` — Authenticate with your provider

**Agent execution**
- `/agent` — Spawn sub-agents for parallel task execution
- `/computer` — Control macOS desktop (screenshots, clicks, keyboard) for automation workflows

**Verification and diagnostics**
- `/doctor` — Diagnose installation health and configuration
- `/status` — Inspect runtime state, MCP, plugins, and agents
- `/cache-probe` — Diagnose API cache hit rate by comparing `cached_tokens` across identical requests
- `/usage` — View token usage for current session
- `/cost` — Estimate cost of the current conversation

**Configuration**
- `/config` — View and edit settings
- `/workflows` — Manage reusable workflows
- `/wiki init` / `/wiki status` / `/wiki ingest` — Project documentation management
- `AGENTS.md` / `CLAUDE.md` — Project-level context files

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `ctrl+t` | Toggle todo list |
| `ctrl+o` | Toggle transcript mode |
| `ctrl+shift+b` | Toggle brief-only view |
| `ctrl+l` | Clear screen and force full redraw (recovery path) |
| `ctrl+e` | Open external editor |
| `ctrl+g` | Go to line |
| `ctrl+s` | Stash chat input |
| `escape` | Abort current operation |
| `ctrl+c` | Cancel speulation when idle |
| `shift+enter` | Multi-line input |

## Multi-Provider Support

Noa ships first-party support for multiple backends:

| Provider | Environment | Enable |
|----------|-------------|--------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | default |
| OpenAI-compatible | `OPENAI_BASE_URL` + `OPENAI_API_KEY` | `CLAUDE_CODE_USE_OPENAI=1` |
| AWS Bedrock | `ANTHROPIC_BEDROCK_BASE_URL` + AWS credentials | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex | `ANTHROPIC_VERTEX_PROJECT_ID` + region vars | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Foundry | `ANTHROPIC_FOUNDRY_RESOURCE` + `ANTHROPIC_FOUNDRY_API_KEY` | `CLAUDE_CODE_USE_FOUNDRY=1` |

Provider profiles enable saved configurations for providers like Kimi, MiniMax, DeepSeek, and other Anthropic-compatible endpoints using Bearer token auth (`ANTHROPIC_AUTH_TOKEN`).

**OpenAI-compatible configuration:**
- `OPENAI_BASE_URL` — API endpoint (default: `https://api.openai.com/v1`)
- `OPENAI_API_KEY` — API key
- `OPENAI_MODEL` — Model override (default: `gpt-4o`)

**AWS Bedrock:**
- `ANTHROPIC_BEDROCK_BASE_URL` — Optional custom endpoint
- `AWS_REGION` or `AWS_DEFAULT_REGION` — Region (default: `us-east-1`)
- `AWS_BEARER_TOKEN_BEDROCK` — API key auth (bypasses AWS SDK auth)

**Google Vertex:**
- `ANTHROPIC_VERTEX_PROJECT_ID` — GCP project ID
- `VERTEX_REGION_CLAUDE_*` — Per-model region override
- Auth: `GOOGLE_APPLICATION_CREDENTIALS` or ADC

**Microsoft Foundry:**
- `ANTHROPIC_FOUNDRY_RESOURCE` — Azure resource name
- `ANTHROPIC_FOUNDRY_BASE_URL` — Optional full endpoint override
- `ANTHROPIC_FOUNDRY_API_KEY` — API key auth
- Auth without key: Azure AD via `DefaultAzureCredential`

## Capability Highlights

- **Multi-Provider Support** — OpenAI-compatible, AWS Bedrock, Google Vertex, Microsoft Foundry, and Anthropic's first-party API.
- **Sub-Agent Orchestration** — Assign different models to different agents via `settings.json` (`agentModels`, `agentRouting`).
- **macOS Desktop Control** — ComputerTool for screenshot-based GUI automation, keyboard-driven workflows preferred.
- **MCP Tool Compaction** — MCP tool results are included in context compaction, reducing token usage 20–40% for MCP-heavy sessions.
- **128k Fallback** — Unknown OpenAI-compatible models use a conservative 128k context window to prevent compact threshold underestimation.
- **Auto-fix Hook** — After file edits, automatically run configurable lint/test commands (configured in `settings.json` under `autoFix`).
- **Cache-probe** — `/cache-probe` command to diagnose API cache hit rate.
- **SSRF Protection** — URL resolution validated against IPv4/IPv6 private ranges before outbound HTTP requests.
- **TUI Mode** — `/tui` switches between default and fullscreen (no-flicker) terminal layout.
- **PR Intent Scan** — CI checks PR added lines for suspicious links/download patterns and fails on high-severity findings.
- **Privacy** — Third-party API requests include `store: false` to prevent training data use.

## Architecture

```
Entry → QueryEngine → Agent Loop → Tools / Services / State
```

| Subsystem | Path | Purpose |
|-----------|------|---------|
| Commands | `src/commands/` | 114 slash commands |
| Tools | `src/tools/` | 57 tool implementations (file, shell, web, tasks, MCP, computer) |
| Components | `src/components/` | React TUI components |
| Hooks | `src/hooks/` | React state and side-effect hooks |
| Bridge | `src/bridge/` | Remote execution and session bridging |
| Services | `src/services/` | Backend services (API, MCP, OAuth, LSP, analytics, autoFix) |
| Utils | `src/utils/` | Shared utilities (git, auth, file, session, ssrf) |

## Build Commands

| Command | Output |
|---------|--------|
| `bun run dev` | Run directly from source |
| `bun run build` | Production JS bundle to `dist/main.js` |
| `bun run build:dev` | Dev build |
| `bun run build:dev:full` | Dev build + ~70 experimental features |
| `bun run compile` | Standalone binary at `dist/cli` |

All builds require [Bun](https://bun.sh).

## Runtime Toggles

- `NOA_CLAUDE_NO_FLICKER=1` — Enable fullscreen anti-flicker layout
- `NOA_CLAUDE_DISABLE_MOUSE=1` — Fullscreen layout with mouse tracking off
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS=1` — Mouse tracking on, clicks ignored
- `CLAUDE_CODE_HIDE_CWD=1` — Hide cwd from status bar
- `DISABLE_UPDATES=1` — Disable automatic update checks

Legacy `CLAUDE_CODE_*` names are still accepted for compatibility; `NOA_CLAUDE_*` is preferred.

## Privacy

Hardcoded privacy defaults — no configuration needed:

- All telemetry paths hard-disabled
- GrowthBook remote fetch hard-disabled
- Remote policy overlays hard-disabled
- Third-party API requests include `store: false` to prevent training data use
- Runtime help links resolve locally

## Verification

```bash
bun run compile && ./dist/cli --version  # Compile and verify binary
bun run typecheck                        # Type check
bun test                                # Run all tests
bun test <path>                          # Run a single test file
```

Default local maintenance checks:

```bash
bun run check:runtime                    # Runtime health check
bun run smoke:features                   # Feature surface smoke
bun run smoke:engine                     # Engine smoke (no live API)
bun run scan:pr-intent                   # Block suspicious PR links
```

Release candidate provider check:

```bash
bun run smoke:engine:live                # Live provider smoke (needs ANTHROPIC_API_KEY)
```

## Engineering Bar

Core stability signals treated as non-negotiable:

- Interactive startup stays alive
- `--print` stays usable for non-interactive coding
- Resume/continue survive compaction and transcript recovery
- MCP startup degrades gracefully instead of blocking
- Tool orchestration preserves permission boundaries and retry safety
- Remote/session plumbing keeps trust, auth, and reconnect explicit
- SSRF protection validates all outbound URLs against private address ranges

See [docs/operating-guide.md](docs/operating-guide.md) for runtime, session, worktree, and agent documentation. See [docs/product-governance.md](docs/product-governance.md) for command surface governance.

## License

This repository is a reconstruction based on publicly exposed source code. The original Claude Code source is the property of Anthropic.

- Not an official Anthropic release or supported product
- Anthropic, Claude, and Claude Code are trademarks of their respective owners