# Claude Code Upstream Sync Checklist

Use this checklist once per week to detect upstream fixes that should be mirrored in Noa Claude.

## Weekly checklist

1. Connection layer
- WebSocket reconnect logic and retry budgets
- Handshake close-code handling (`1000/1001/1006/4001/4003`)
- Connection state transitions and stale-session recovery

2. Permission layer
- SDK permission prompt behavior
- Hook and SDK race semantics (winner/loser cancelation)
- Abort signal propagation boundaries (local vs parent controller)

3. Hook/abort semantics
- PermissionRequest hook contract
- Hook timeout and cancellation defaults
- Any change to allow/deny/passthrough precedence

4. SDK control schema
- `control_request` / `control_response` payload shape changes
- New subtypes or required fields
- Backward-compatibility and fallback handling

## Decision policy

- High risk upstream fix: reproduce with a local test first, then port the fix.
- Medium risk change: assess compatibility and add regression coverage if behavior differs.
- Low risk/no-op: record and defer.

## Weekly record template

Fill one table per weekly sync run.

| Date | Area | Upstream change | Risk level | Need local patch | Compatibility impact | Action |
| --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | Connection / Permission / Hooks / SDK schema | Summary + upstream link/commit | High / Medium / Low | Yes / No | None / Minor / Breaking | Ported / Deferred / N/A |

## Notes template

### YYYY-MM-DD Sync Notes

- Reviewer:
- Sources checked:
- Reproduced changes:
- Tests added/updated:
- Follow-ups:
