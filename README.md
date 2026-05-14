# Noa Claude

A local-first coding agent for real software work: long sessions, resumable forks, multi-provider routing, and stronger privacy defaults.

Noa Claude is built from publicly exposed Claude Code source and extended into a more productized open-source fork. The focus is not just parity with upstream, but a dependable daily driver for people who want local control, provider flexibility, and a runtime that takes continuity and verification seriously.

## Project Statistics

| Metric | Value |
|--------|-------|
| Version | 1.0.9 |
| TypeScript files | 2,051 |
| Total lines of code | ~530,164 |
| Dependencies | 65 |
| Built-in commands | 114 |
| Built-in tools | 57 |
| React components | 147 |
| React hooks | 86 |

## Architecture

```
Entry → QueryEngine → Agent Loop → Tools / Services / State
```

**Core subsystems:**

| Subsystem | Files/Dirs | Purpose |
|-----------|------------|---------|
| `commands/` | 114 files | Slash commands (git, GitHub, session, plugin, etc.) |
| `tools/` | 57 dirs | Tool implementations (file, shell, web, tasks, MCP) |
| `components/` | 147 files | React TUI components |
| `hooks/` | 86 files | React state and side-effect hooks |
| `bridge/` | 31 files | Remote execution and session bridging |
| `services/` | 25 dirs | Backend services (API, MCP, OAuth, LSP, analytics) |
| `utils/` | 31 dirs + 320+ files | Shared utilities (git, auth, file, session) |
| `state/` | 7 files | Application state management |
| `skills/` | bundled/ | Skill system with built-in skills |

**Largest source files:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/main.tsx` | 4,820 | Main application entry |
| `src/query.ts` | 1,822 | Query processing |
| `src/QueryEngine.ts` | 1,322 | Agent query engine |
| `src/hooks/useTypeahead.tsx` | ~1,400 | Autocomplete hook |
| `src/hooks/useReplBridge.tsx` | ~720 | Bridge connection hook |

## Project Directory Structure

```
Noa-Claude/
├── bin/                    # CLI entry point
│   ├── noa.js
│   └── claude-agent-import.js
├── scripts/                # Build & maintenance scripts
│   ├── smoke-engineering.mjs
│   ├── check-runtime-health.mjs
│   ├── pr-intent-scan.mjs
│   └── ...
├── docs/                   # Documentation
│   ├── release-notes.md
│   ├── operating-guide.md
│   └── product-governance.md
├── src/                    # Source code (~530k lines)
│   ├── commands/           # 114 slash commands
│   ├── tools/              # 57 tool implementations
│   ├── components/         # 147 React components
│   ├── hooks/             # 86 React hooks
│   ├── bridge/            # 31 files (remote execution)
│   ├── services/          # 25 service modules
│   ├── utils/             # 320+ utility functions
│   ├── state/             # Application state (7 files)
│   ├── skills/bundled/    # Built-in skills
│   ├── cli/               # CLI transport layer
│   ├── ink/               # UI theme system
│   └── [core files]       # main.tsx, query.ts, etc.
├── dist/                   # Build output
├── vendor/                 # Third-party libraries
└── node_modules/           # Dependencies
```

## Why Noa Claude

- **Local-first by default** — Runtime guidance, help links, and operational docs resolve to repository-local or project-owned surfaces instead of upstream-owned endpoints.
- **Privacy-forward build** — Telemetry, analytics, and remote policy overlays are hard-disabled or stubbed out.
- **Multi-provider ready** — Anthropic, OpenAI-compatible backends, AWS Bedrock, Google Vertex, and Microsoft Foundry are supported in one CLI.
- **Built for long-running work** — Resume, compaction, forks, agents, and MCP degradation behavior are treated as core runtime quality, not side details.
- **Developer-oriented builds** — `bun run build:dev:full` enables the full dev profile for internal testing and experimentation.

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

Then open a project directory and ask for real work: fix a bug, explain a subsystem, review a diff, or fork a branch of investigation with `/fork`.

## Key Commands

**Baseline workflows** (`[baseline]` — supported core surface):

```
/fork      - Create a resumable fork of the current conversation
/workflows - Manage local reusable workflows
/summary   - Generate structured session summaries
/share     - Export local session share snapshots under .claude-agent/shares
```

**Other frequently used commands:**

```
/help      - Inspect built-in command surface and skill registry
/resume    - Resume a previous conversation
/goal      - Set or inspect a long-running thread goal
/compact   - Summarize and compact conversation history
/export    - Export conversation to a file
/rename    - Rename the current session
/tag       - Tag the current session for quick lookup
/memory    - Open and edit memory files
/clear     - Clear the current conversation and start fresh
/copy      - Copy recent assistant response or code blocks to clipboard
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

## Build Commands

| Command | Output | Note |
|---------|--------|------|
| `bun run dev` | — | Run directly from source (fastest iteration) |
| `bun run build` | `dist/main.js` | Production JS bundle |
| `bun run build:dev` | `dist/main-dev.js` | Dev build with dev version string |
| `bun run build:dev:full` | `dist/main-dev.js` | Dev build + all ~70 experimental features enabled |
| `bun run compile` | `dist/cli` + `dist/main.js` | Standalone binary + bundled JS entry |

All build commands require [Bun](https://bun.sh).

## Runtime Toggles

- `NOA_CLAUDE_NO_FLICKER=1` — Enable fullscreen anti-flicker REPL layout
- `NOA_CLAUDE_DISABLE_MOUSE=1` — Keep fullscreen layout but turn off mouse tracking
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS=1` — Keep mouse tracking but ignore clicks and drags
- `CLAUDE_CODE_HIDE_CWD=1` — Hide current working directory from the status bar
- `DISABLE_UPDATES=1` — Disable automatic update checks on startup

Legacy `CLAUDE_CODE_*` names are still accepted for compatibility, but `NOA_CLAUDE_*` is the preferred brand prefix.

## Supported Providers

| Provider | Environment | Enable |
|----------|-------------|--------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | default |
| OpenAI-compatible | `OPENAI_BASE_URL` + `OPENAI_API_KEY` | `CLAUDE_CODE_USE_OPENAI=1` |
| AWS Bedrock | `ANTHROPIC_BEDROCK_BASE_URL` + AWS credentials | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex | `ANTHROPIC_VERTEX_PROJECT_ID` + region vars | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Foundry | `ANTHROPIC_FOUNDRY_RESOURCE` + `ANTHROPIC_FOUNDRY_API_KEY` | `CLAUDE_CODE_USE_FOUNDRY=1` |

### OpenAI-Compatible

- `OPENAI_BASE_URL` — API endpoint (default: `https://api.openai.com/v1`)
- `OPENAI_API_KEY` — API key
- `OPENAI_MODEL` — Model override (default: `gpt-4o`)

### AWS Bedrock

- `ANTHROPIC_BEDROCK_BASE_URL` — Optional custom endpoint
- `AWS_REGION` or `AWS_DEFAULT_REGION` — Region (default: `us-east-1`)
- `AWS_BEARER_TOKEN_BEDROCK` — API key auth (bypasses AWS SDK auth)
- `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` — Per-model region override for Haiku

### Google Vertex

- `ANTHROPIC_VERTEX_PROJECT_ID` — GCP project ID
- `VERTEX_REGION_CLAUDE_*` — Per-model region (e.g., `VERTEX_REGION_CLAUDE_3_5_SONNET`)
- `CLOUD_ML_REGION` — Default region fallback
- Auth: GCP credentials via `GOOGLE_APPLICATION_CREDENTIALS` or ADC

### Microsoft Foundry

- `ANTHROPIC_FOUNDRY_RESOURCE` — Azure resource name (e.g., `my-resource`)
- `ANTHROPIC_FOUNDRY_BASE_URL` — Optional full endpoint override
- `ANTHROPIC_FOUNDRY_API_KEY` — API key auth
- Auth without key: Azure AD via `DefaultAzureCredential` (env vars, managed identity, Azure CLI)

## Capability Highlights

- **Multi-Provider Support** — OpenAI-compatible, AWS Bedrock, Google Vertex, Microsoft Foundry, and Anthropic's first-party API.
- **Agent Routing** — Assign different models to different agents via `settings.json` (`agentModels`, `agentRouting`).
- **MCP Tool Compaction** — MCP tool results are included in context compaction, reducing token usage 20–40% for MCP-heavy sessions.
- **128k Fallback** — Unknown OpenAI-compatible models use a conservative 128k context window to prevent compact threshold underestimation.
- **store:false Privacy** — Third-party API requests include `store: false` to prevent conversation data from being used for training.
- **Cache Cost Normalization** — OpenAI-compatible provider cache reads are correctly attributed, avoiding 2× cost inflation in `/cost` output.
- **Auto-fix Hook** — After file edits, automatically run configurable lint/test commands.
- **Cache-probe** — `/cache-probe` command to diagnose API cache hit rate by comparing `cached_tokens` across identical requests.
- **Wiki Commands** — `/wiki init`, `/wiki status`, `/wiki ingest` for project documentation management.
- **Provider Profile Manager** — Provider configurations managed via `settings.json` (`agentModels`, `agentRouting`).
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
bun test                    # run all tests
bun test <path>             # run a single test file
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
