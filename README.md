# Claude Agent

Private engineering fork focused on:
- isolated runtime/data paths
- stable CLI chain
- MiniMax (Anthropic-compatible) default backend
- repeatable engineering smoke checks

## Project Status
- Main entrypoint: `claude-agent`
- Compatibility alias: `claude-code`
- Default config root: `~/.claude-agent`
- Default backend base URL: `https://api.minimaxi.com/anthropic`
- Default model: `MiniMax-M2.7`

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
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_API_KEY": "YOUR_MINIMAX_KEY"
  },
  "model": "MiniMax-M2.7"
}
```

Notes:
- Non-interactive calls (`--print`) require valid API credentials.
- Third-party backend failures are designed to fail explicitly; no silent fallback to official OAuth flow.

## Verification Baseline
Use these as minimum engineering gates:
```bash
bun run build
npm run typecheck -- --pretty false
npm run check:runtime
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
