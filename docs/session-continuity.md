# Session Continuity

Long-running work depends on three paths staying aligned:

- `/compact`
- `--resume`
- transcript and session metadata persistence
- repo-local progress artifacts

## `/compact`

`/compact` is the product surface for shrinking a long session while keeping
the conversation usable.

The expected result is:

- the session remains active
- compacted history is still reviewable
- future turns continue from the compacted state

## `--resume`

`--resume <session-id>` should restore a prior session without falling back to
official Claude account flows.

Expected behavior:

- invalid IDs fail clearly
- compacted sessions still resume correctly
- project-local session metadata is restored consistently
- malformed transcript sources fail with a stable compatibility error
- interrupted resume paths fail explicitly instead of silent state drift

## Progress Artifacts

For long or interrupted work, keep a small structured state file in the
project-local product namespace:

- `.claude-agent/progress.md`

See [docs/progress-artifacts.md](/Users/myrickwang/Desktop/Coding/Claude/docs/progress-artifacts.md)
for the recommended structure.

## Verification

Repository-level verification for session continuity:

- `npm run check:runtime`
- `npm run smoke:engine`

These checks are expected to catch regressions in session utilities, compact
boundaries, and resume routing.
