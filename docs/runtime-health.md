# Runtime Health

The primary runtime inspection surfaces are `/status` and `/doctor`.

## `/status`

Use `/status` to inspect current runtime state:

- CLI entry
- config directory and settings candidates
- backend mode and base URL
- worktree metadata
- MCP summary
- LSP state
- plugin state
- search tool state
- sandbox runtime compatibility
- running/pending agent visibility from `/agents`

`/status` is for current state and current configuration sources.

## `/doctor`

Use `/doctor` when something is wrong or unclear.

It is intended to answer:

- is this installation healthy
- which layer is failing
- what action should the user take next

Current doctor coverage includes:

- install path and invoked binary
- update channel and permissions
- sandbox dependency status
- plugin errors
- LSP startup state
- config and environment validation
- context usage warnings
- actionable next step hints per failing layer

## MCP Healthcheck Degradation

`claude-agent mcp list` keeps startup/list operations responsive when slow MCP
servers are present:

- direct/project/user servers use `CLAUDE_AGENT_MCP_HEALTHCHECK_TIMEOUT_MS`
- plugin-like servers use `CLAUDE_AGENT_MCP_PLUGIN_HEALTHCHECK_TIMEOUT_MS`
- timed out servers are marked as `timeout(degraded, Nms)` instead of blocking
  the whole command

Default values are tuned for non-blocking checks and can be overridden with
environment variables.

## Expected Workflow

When debugging startup or tool failures:

1. check `/status`
2. run `/doctor`
3. use `npm run check:runtime` for repository-level verification
4. use `npm run smoke:engine` before treating a fix as complete
