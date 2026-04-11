# Claude Agent

`Claude Agent` is a local coding assistant CLI. It is designed to run from your own machine, keep its data isolated from other installs, and support configurable model backends.

## What You Can Use

- Main command: `claude-agent`
- Compatibility alias: `claude-code`
- Default user config root: `~/.claude-agent`
- Project-local config root: `.claude-agent/`

The current product baseline includes:

- `/fork` - fork the current conversation into a resumable session
- `/workflows` - manage and run local reusable workflows
- `/summary` - generate a structured summary of the current session
- `/share` - export a local share snapshot for a session

## Quick Install

```bash
./install.sh
```

This script installs dependencies, builds the CLI, and links `claude-agent` and `claude-code` into `~/.local/bin`.

## Quick Start

1. Build the CLI:

```bash
bun run build
```

2. Start the assistant:

```bash
./bin/claude-agent.js
```

3. Check the version:

```bash
claude-agent --version
```

You can also use the compatibility alias:

```bash
claude-code --version
```

## Configuration

The primary settings file is:

- `~/.claude-agent/settings.json`

A minimal backend configuration looks like this:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-provider.example/v1",
    "ANTHROPIC_API_KEY": "YOUR_API_KEY"
  },
  "model": "YOUR_MODEL_NAME"
}
```

Notes:

- `--print` and other non-interactive calls require valid API credentials.
- Third-party backend failures are surfaced explicitly. They do not silently fall back to the official Claude OAuth flow.
- `CLAUDE_CODE_REGULAR_MCP_CONNECT_TIMEOUT_MS` controls the non-interactive regular MCP connect timeout.
- `CLAUDE_CODE_CLAUDEAI_MCP_CONNECT_TIMEOUT_MS` controls the non-interactive claude.ai MCP connect timeout.
- `CLAUDE_AGENT_MCP_HEALTHCHECK_TIMEOUT_MS` controls `mcp list` timeout for direct servers.
- `CLAUDE_AGENT_MCP_PLUGIN_HEALTHCHECK_TIMEOUT_MS` controls `mcp list` timeout for plugin-like servers.
- `mcp list` marks slow servers as `timeout(degraded, Nms)` instead of blocking the full result.

### Privacy, Guardrails, and Feature-Gate Defaults

This build uses hard product defaults (not opt-in toggles):

- Telemetry reporting is hard-disabled in runtime code paths (OTEL export, 1P event reporting, feedback telemetry sink, tracing exporters).
- Security prompt guardrail injection is hard-removed from the system prompt assembly layer.
- Remote managed-settings overlays and remote policy-limits overlays are hard-disabled in this build.
- GrowthBook remote fetch is hard-disabled. Local GrowthBook evaluation remains enabled for local runtime feature-gate behavior.
- Experimental feature unlock is part of the build profile baseline:
  - `bun run build` uses `--profile=full-unlocked`
  - `bun run compile` and `bun run build:dev` use `--profile=baseline`
  - `bun run build:dev:full` uses `--profile=full-unlocked`

For an auditable unlockability/result table, see [FEATURES.md](/Users/myrickwang/Desktop/Coding/Claude/FEATURES.md).

## Working With Projects

Project-specific assets live under `.claude-agent/` in the current project:

- `.claude-agent/workflows`
- `.claude-agent/shares`
- `.claude-agent/mcp.json`
- `.claude-agent/CLAUDE.md`

Legacy `.claude/` paths are still read for compatibility when present, but new writes go to `.claude-agent/`.

## Build Modes

The repository exposes two build profiles:

- `bun run build` uses `--profile=full-unlocked`
- `bun run compile` uses `--profile=baseline`
- `bun run build:dev` uses `--profile=baseline`
- `bun run build:dev:full` uses `--profile=full-unlocked`
- `--bare` / `--local-only` / `CLAUDE_CODE_SIMPLE=1` is the local-minimal runtime mode: it skips telemetry, 1P logging init, GrowthBook refresh, remote managed settings, policy limits, startup analytics, and session data upload.

For the current feature audit and unlockability status, see [FEATURES.md](/Users/myrickwang/Desktop/Coding/Claude/FEATURES.md).

## Product Guides

Focused product docs live under `docs/`:

- [docs/operating-guide.md](/Users/myrickwang/Desktop/Coding/Claude/docs/operating-guide.md)
- [docs/product-governance.md](/Users/myrickwang/Desktop/Coding/Claude/docs/product-governance.md)
- [docs/decisions/README.md](/Users/myrickwang/Desktop/Coding/Claude/docs/decisions/README.md)

## Built-In Commands

### `/fork`

Forks the current conversation and returns a resumable session ID.

Use it when you want to branch from the current state without losing the original thread.

### `/workflows`

Manages local reusable workflows.

Supported subcommands:

- `list`
- `create <name> :: <step1> ;; <step2>`
- `run <name> [k=v ...]`
- `delete <name>`

Workflow files are stored in `.claude-agent/workflows` and legacy `.claude/workflows` is still accepted for reads.

Project-level MCP servers are stored in `.claude-agent/mcp.json`. Legacy `.mcp.json` is still read when present, but new writes go to `.claude-agent/mcp.json`.
`/mcp` and `claude-agent mcp list` show MCP servers only. Plugins that do not
declare an MCP server (for example skills-only plugins) are still enabled but
won't appear in MCP server listings.

### `/summary`

Produces a structured summary of the current session.

Supported modes:

- `short`
- `detailed`

### `/share`

Exports a local snapshot of the current session for sharing or archiving.

Snapshots are written under `.claude-agent/shares`.

### `/cleanup-data`

Previews or deletes local tracking data while keeping config/settings files.

Examples:

- `/cleanup-data project` (preview)
- `/cleanup-data project --confirm` (execute)
- `/cleanup-data all --confirm` (also clears global prompt history)

## Verification

Use these commands to check that the local installation is healthy:

```bash
bun run build
bun run typecheck
bun run check:runtime
bun run smoke:features
bun run smoke:perf
bun run smoke:engine
```

## Command Availability

For the full command/runtime capability matrix, see:

- [FEATURE_AVAILABILITY_MATRIX.md](/Users/myrickwang/Desktop/Coding/Claude/FEATURE_AVAILABILITY_MATRIX.md)

## Troubleshooting

- If interactive startup exits immediately, run `./bin/claude-agent.js --version` first to confirm the launcher works.
- If `--print` fails on a third-party backend, check that `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` are set correctly in `~/.claude-agent/settings.json`.
- If a workflow is not found, confirm the file exists under `.claude-agent/workflows` or `.claude/workflows`.
- If a share export fails, make sure the project directory is writable.

## Attribution

- This repository is an independent/private derivative engineering project.
- It is not an official Anthropic release or supported Anthropic product.
- Anthropic, Claude, and Claude Code names remain associated with their respective owners.
- Before redistribution, confirm the applicable license, source terms, and compliance requirements.
