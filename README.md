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

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Build the CLI:

```bash
bun run build
```

3. Start the assistant:

```bash
./bin/claude-agent.js
```

4. Check the version:

```bash
./bin/claude-agent.js --version
```

You can also use the compatibility alias:

```bash
./bin/claude-code.js --version
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

## Working With Projects

Project-specific assets live under `.claude-agent/` in the current project:

- `.claude-agent/workflows`
- `.claude-agent/shares`
- `.claude-agent/mcp.json`
- `.claude-agent/CLAUDE.md`

Legacy `.claude/` paths are still read for compatibility when present, but new writes go to `.claude-agent/`.

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

### `/summary`

Produces a structured summary of the current session.

Supported modes:

- `short`
- `detailed`

### `/share`

Exports a local snapshot of the current session for sharing or archiving.

Snapshots are written under `.claude-agent/shares`.

## Verification

Use these commands to check that the local installation is healthy:

```bash
bun run build
npm run typecheck -- --pretty false
npm run check:runtime
npm run smoke:features
npm run smoke:perf
npm run smoke:engine
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
