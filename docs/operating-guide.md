# Operating Guide

Last updated: 2026-07-27

This document merges the runtime, session, worktree, agent, and progress-artifact notes into one operational guide.

## Runtime Health

The primary runtime inspection surfaces are `/status` and `/doctor`.

Runtime behavior switches are driven by environment variables:

- `NOA_CLAUDE_NO_FLICKER` controls the fullscreen anti-flicker REPL layout
- `NOA_CLAUDE_DISABLE_MOUSE` keeps fullscreen layout but skips mouse tracking
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS` keeps mouse tracking but ignores clicks and drags
- `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1` opts in to streaming tool execution (tools start while the model response is still streaming). Experimental and off by default — the streaming path is not yet validated in this build.

Fork subagents are intentionally unavailable in this build. `/fork` remains a conversation-branch command, not an implicit subagent launcher.

### `--bare` and Provider Profiles

Provider profiles (`~/.noa/provider-profiles.json`) are a Noa-only feature with no upstream counterpart — do not "align" it away during upstream parity work.

Under `--bare` / `CLAUDE_CODE_SIMPLE=1`, `applyActiveProviderProfileEnv()` is a no-op: the caller's `ANTHROPIC_*` env is the entire auth/routing contract. The gate also covers the no-active-profile case, which would otherwise delete the caller's env keys before the request client is created. `/provider` and the `/login` provider-setup wizard in a bare session still write the selection to disk, but report that it takes effect next session. A caller-supplied `ANTHROPIC_AUTH_TOKEN` counts as auth under `--bare` (3P Bearer providers), so `auth status` reports it rather than "logged out".

The same contract applies to settings-sourced env: under bare, provider/auth/model vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, …) are stripped from `settings.json` `env`, the global config `env`, and merged settings before they reach `process.env`, so a profile persisted by `persistProviderEnvToUserSettings` cannot reroute a bare session. `--settings` (flagSettings) and managed policy stay deliberate channels and are exempt. Non-provider settings env vars still apply. This filtering is deliberate hardening beyond upstream 2.1.220, which applies settings env under bare unfiltered.

### `/status`

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

### `/doctor`

Use `/doctor` when something is wrong or unclear.

It is intended to answer:

- is this installation healthy
- which layer is failing
- what action should the user take next

It is part of the Noa Claude runtime inspection surface and should be read as a local installation health check.

### MCP Healthcheck Degradation

`noa mcp list` keeps startup/list operations responsive when slow MCP servers are present:

- direct/project/user servers use `CLAUDE_AGENT_MCP_HEALTHCHECK_TIMEOUT_MS`
- plugin-like servers use `CLAUDE_AGENT_MCP_PLUGIN_HEALTHCHECK_TIMEOUT_MS`
- timed out servers are marked as `timeout(degraded, Nms)` instead of blocking the whole command

Important visibility rule:

- `/mcp` and `mcp list` show MCP servers, not total enabled plugins
- plugins that only provide skills/agents/hooks and no MCP server do not appear in MCP server lists

## Session Continuity

Long-running work depends on these paths staying aligned:

- `/compact`
- `--resume`
- transcript and session metadata persistence
- repo-local progress artifacts

The project-local progress artifact lives at:

- `.noa/progress.md`

### `/goal`

Use `/goal` for one long-running objective that should survive normal turns and resume from session transcripts.

Supported commands:

- `/goal <objective> [--budget N] [--max-turns N] [--verify "<cmd>"]` creates a goal when none is active
- `/goal` shows status, token usage, auto-continue count, verify command, and the last evaluator reason
- `/goal pause` pauses an active goal
- `/goal resume` resumes a paused goal and resets the auto-continue counter
- `/goal clear` removes the current goal
- `/goal replace <objective> [--budget N] [--max-turns N] [--verify "<cmd>"]` explicitly replaces the current goal and resets usage

Runtime behavior:

- only one goal can be active in a thread
- an existing active or paused goal is not replaced unless the user runs `/goal replace`
- after each eligible main-thread turn, a lightweight evaluator checks whether the goal is complete
- if the evaluator says the goal is incomplete, Noa Claude auto-continues up to 5 turns by default, or the limit supplied with `--max-turns`
- after the configured number of auto-continue turns, the goal is paused and can be resumed with `/goal resume`
- a `--verify` command runs automatically after each eligible goal turn; a non-zero exit code always prevents completion
- when `--verify` is configured, model-requested completion remains pending until the verify command passes and the evaluator approves completion
- if a token budget is reached, the goal becomes `budget_limited` and will not auto-continue
- budget-limited goals resume only when the same objective is set with a larger `--budget`
- session restore replays transcript evidence to recover goal status, usage, verify command, auto-continue count, and stop reason

The model can inspect, create, and mark a goal complete through the goal tool. Pause, resume, clear, and replace remain user-controlled slash commands.

### Progress Artifacts

Use a project-local path inside the product namespace:

- `.noa/progress.md`

Recommended structure:

```md
# Progress

## Objective
One sentence describing the current task.

## Done
- Completed item

## Remaining
- Next item

## Risks
- Current risk or open question

## Next Step
One concrete next action.
```

## Worktrees

Worktrees are the preferred isolation mechanism for parallel repository tasks.

The product should treat worktree context as first-class state:

- current worktree name
- worktree branch
- worktree path
- original cwd

## Agents

This product supports local subagents through `/agents`.

Agents can come from these scopes:

- built-in
- user settings
- project settings
- local settings
- plugin sources
- managed policy sources

The `/agents` UI resolves precedence for you.

## Auto-fix

File edits can automatically trigger lint and test commands via the auto-fix hook (configured in `settings.json` under `autoFix`).

When enabled, the following workflow executes after each file edit:

1. Collect modified files by tool (Bash, Edit, Write, Grep, Glob)
2. Run configured lint/test commands
3. On lint failure: present linter output with fix options
4. On test failure: pause for user decision to retry, skip, or abort

## Verification

Repository-level verification for these operational surfaces:

- `bun run check:runtime`
- `bun run smoke:engine`
- `bun run smoke:engine:live` when validating a real provider path

Live smoke prerequisites:

- `ANTHROPIC_API_KEY` must be configured
- optional `ANTHROPIC_BASE_URL` for non-default provider endpoints
- optional `CLAUDE_AGENT_SMOKE_LIVE_TIMEOUT_MS` to tune timeout

CI entrypoint:

- `.github/workflows/smoke-engineering-live.yml` (manual dispatch + weekly schedule)

## Failure-Mode Checklist

Use these as the first-line regression targets for agent/runtime changes:

- resume and continue after compaction
- interrupted turns and auto-resume
- MCP startup degradation and timeout fallback
- permission rejection and subsequent retry
- remote-session reconnect after stale or dropped transport
- tool execution ordering when concurrent read-only work is allowed
- search on a machine without system ripgrep — Grep/Glob must fail with the
  `ripgrep not found on PATH` install hint, not a bare ENOENT or empty results
  (`/doctor` and `/status` report rg mode and working state)

## Performance Baselines

Track these as release-gating regressions, not just ad hoc metrics:

- cold start time
- time to first token
- time to first tool availability
- resume latency from existing transcript
- non-interactive `--print` completion time
