# Claude Agent

Private engineering fork focused on:
- isolated runtime/data paths
- stable CLI chain
- configurable model backends
- repeatable engineering smoke checks

## Project Status
- Main entrypoint: `claude-agent`
- Compatibility alias: `claude-code`
- Default config root: `~/.claude-agent`
- Backend selection and model choice are controlled through config and env

## Quick Start
1. Install dependencies:
```bash
npm install
```

2. Build:
```bash
bun run build
```

3. Run:
```bash
./bin/claude-agent.js
```

4. Version check:
```bash
./bin/claude-agent.js --version
```

## Configuration
Primary settings file:
- `~/.claude-agent/settings.json`

Typical minimal config:
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
- Non-interactive calls (`--print`) require valid API credentials.
- Third-party backend failures are designed to fail explicitly; no silent fallback to official OAuth flow.
- `CLAUDE_CODE_REGULAR_MCP_CONNECT_TIMEOUT_MS` can override the non-interactive regular MCP connect timeout.

## Verification Baseline
Use these as minimum engineering gates:
```bash
bun run build
npm run typecheck -- --pretty false
npm run check:runtime
npm run smoke:perf
npm run smoke:engine
```

## Runtime/Command Availability
For command/runtime capability matrix (Available / Hidden-Internal / Build-Excluded / Stub), see:
- [FEATURE_AVAILABILITY_MATRIX.md](/Users/myrickwang/Desktop/Coding/Claude/FEATURE_AVAILABILITY_MATRIX.md)

## Legal and Attribution Notice
- This repository is an independent/private derivative engineering project.
- It is **not** an official Anthropic release or supported Anthropic product.
- Anthropic, Claude, and Claude Code names remain associated with their respective owners.
- Before any redistribution, confirm applicable license, source terms, and compliance requirements.
