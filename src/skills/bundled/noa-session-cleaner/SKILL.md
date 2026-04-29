---
name: noa-session-cleaner
description: Safely clean noisy resume sessions (like ping/test/hello) from Noa Claude storage. Use this whenever the user asks to clean resume history, remove meaningless sessions, reduce clutter in session lists, or delete test sessions from .claude-agent without touching official history.
---

# Noa Session Cleaner

Use this skill when the user wants to clean noisy sessions from Noa Claude storage.

## Safety Rules

1. Default to dry-run first.
2. Restrict scope to `.claude-agent/projects` unless the user explicitly expands scope.
3. Prefer title/first-user-message matching over broad full-text matching.
4. Never delete outside user-approved roots.
5. Show candidate files before deletion, then execute deletion.
6. After deletion, re-scan and report remaining matches.

## Default Scope

- Root: `~/.claude-agent/projects`
- Primary target patterns: `ping`, `test`, `hello`, `/usage`
- Primary target files: top-level `*.jsonl` session files
- Out of scope: related `subagents/*.jsonl` and `tool-results/*` are NOT touched by this skill — deletion is restricted to the primary session files

## Workflow

1. Scan candidates:
   - Enumerate `*.jsonl` sessions.
   - Read first ~20 lines and detect title/first prompt indicators.
   - Build a candidate list.
2. Present result:
   - Count by directory.
   - Exact file paths.
3. Delete (only after user confirms):
   - Delete candidate primaries only. Do not touch `subagents/` or `tool-results/`.
4. Verify:
   - Re-run scan with same filters.
   - Report before/after counts.

## Suggested Commands

The bundled script auto-detects `rg`, falling back to `grep -E` if ripgrep is missing.

```bash
# scan and write candidates to /tmp/noa_session_candidates.txt
./scripts/noa_session_cleaner.sh scan
```

```bash
# delete (interactive confirmation by default)
./scripts/noa_session_cleaner.sh delete

# delete non-interactively (only after candidates have been reviewed)
ASSUME_YES=1 ./scripts/noa_session_cleaner.sh delete
```

## Output Format

Always report:

1. `Scope`
2. `Matched Files (count + paths)`
3. `Action Taken`
4. `Verification (remaining count)`

## Don’ts

- Don’t run broad `rg -l ping ...` as the final deletion criteria by itself.
- Don’t mix `.claude` and `.claude-agent` unless user explicitly asks.
- Don’t claim deletion succeeded without a verification pass.
