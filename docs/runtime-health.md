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

## Expected Workflow

When debugging startup or tool failures:

1. check `/status`
2. run `/doctor`
3. use `npm run check:runtime` for repository-level verification
4. use `npm run smoke:engine` before treating a fix as complete
