# Operating Guide

Last updated: 2026-07-27

This document merges the runtime, session, worktree, agent, and progress-artifact notes into one operational guide.

## Runtime Health

The primary runtime inspection surfaces are `/status`, `/doctor`, and the terminal `noa doctor` subcommand (see below — `/doctor` and `noa doctor` are not the same thing).

Runtime behavior switches are driven by environment variables:

- `NOA_CLAUDE_NO_FLICKER` controls the fullscreen anti-flicker REPL layout
- `NOA_CLAUDE_DISABLE_MOUSE` keeps fullscreen layout but skips mouse tracking
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS` keeps mouse tracking but ignores clicks and drags
- Tools start while the model response is still streaming. `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=0` waits for the full response instead — use it to bisect a suspected tool-execution regression.

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
- running/pending agent visibility (the `/agents` UI has been removed)

### `/doctor` vs `noa doctor`

Same name, two different surfaces. Pick by whether the model still works.

`noa doctor` (terminal subcommand) prints a plain-text report and exits
(`src/utils/doctorTextReport.ts`): installation type/path/version, platform,
invoked binary vs `installMethod`, ripgrep state, invalid settings files, update
permissions and channel, env-var validation, version locks, MCP config parse
errors, agent-definition parse errors, plugin load errors, keybinding warnings,
sandbox dependencies, CLAUDE.md and agent-description context cost, unreachable
permission rules — then a summary line stating the issue count. No model, no
tokens, no network (the dist-tag version lookup is short-circuited because
`MACRO.DISTRIBUTION` is pinned to `curl`), and no MCP servers started.

It is one renderer for every context — terminal, pipe, `noa doctor > issue.txt`.
It replaced an Ink screen that could not run without a TTY at all (Ink needs raw
mode: in a pipe it threw and printed a stack trace instead of the diagnostics,
while still exiting 0) and that blocked on a keypress. Every source the screen
read has a plain module entry point, including the tool-permission context, so
the text path is not a reduced version of it. The single thing given up is MCP
tool-schema context cost, which needs live MCP connections: connecting them meant
spawning every stdio server in project MCP config just to be looked at, which
forced the command to skip the workspace-trust dialog. `/context` reports that
cost inside a session. Exit code is 0 regardless; the issue count is in the
summary line. Unlike the old screen it does not prune stale update locks — a
piped invocation reports state rather than mutating it.

`/doctor` (alias `/checkup`, in-session) is an agentic prompt command: it drives
the model through ten read-only checks — install health, unused skills/MCP
servers/plugins, LOCAL memory dedup, derivable content in checked-in memory
files, lazy-loading migration, slow hooks, context-heavy extensions, version,
auto-mode default, frequently denied read-only commands — then proposes fixes
behind a confirmation gate. It costs tokens and requires a working model, and
Check 7 is local-only by design (no remote version comparison).

Rule of thumb: reach for `noa doctor` when auth, provider routing, or startup is
broken — it is the only diagnostic path that does not depend on the thing being
diagnosed. Reach for `/doctor` when the install is fine but the session feels
bloated, slow, or over-permissive.

### MCP Healthcheck Degradation

`noa mcp list` keeps startup/list operations responsive when slow MCP servers are present:

- direct/project/user servers use `CLAUDE_AGENT_MCP_HEALTHCHECK_TIMEOUT_MS`
- plugin-like servers use `CLAUDE_AGENT_MCP_PLUGIN_HEALTHCHECK_TIMEOUT_MS`
- timed out servers are marked as `timeout(degraded, Nms)` instead of blocking the whole command

Important visibility rule:

- `/mcp` and `mcp list` show MCP servers, not total enabled plugins
- plugins that only provide skills/agents/hooks and no MCP server do not appear in MCP server lists

### MCP headersHelper Trust

A `headersHelper` declared in project (`.mcp.json`) or local scope runs only when
the declaring directory's repository has its own persisted trust
(`projects[<git root>].hasTrustDialogAccepted` in the global config):

- this holds in `--print`/CI too; there is no non-interactive bypass. Without trust the
  server connects with its static `headers` and stderr names the exact key to set
- trust inherited from a parent folder does not count, and it also suppresses the trust
  dialog, so a nested repository has to get the key set directly
- the helper runs in the declaring directory; a project-scope helper gets no
  credential-shaped environment variables (proxy settings are kept)

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
- every model completion request remains pending until the independent evaluator confirms it, including goals without `--verify`
- the evaluator sees running shells and subagents started during the active goal. It can confirm an expected long-running service; unfinished required work defers continuation. Earlier unrelated tasks do not block the goal. Work started during evaluation requires another check; replacing a goal invalidates outstanding evaluations and queued wakeups for it
- interactive API outages, unclassified API errors, output-limit failures, unreadable tool calls and host-managed sign-in refreshes retry at most three times, after about 1, 5 and 15 minutes; auth, credit, context and model failures pause the goal for `/goal resume` while preserving its objective and evidence
- a goal paused by a rate limit, exhausted retries, a failed turn or lack of progress continues on the user's next prompt; task notifications do not resume it
- three consecutive evaluated turns without successful tool use pause continuation (a new user prompt resets the count); an impossible verdict pauses the goal for `/goal resume`
- interactive background check-ins start after 30 minutes, back off to 1 hour then 2 hours, and stop after three idle check-ins until a user prompt; `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` disables check-ins and automatic retries
- token usage includes input, output, cache reads, cache writes, and child-agent responses; streaming blocks from the same response are counted once
- child-agent usage is charged to the goal active at launch; replacing or clearing that goal does not transfer usage to a later goal
- if a token budget is reached, the goal becomes `budget_limited` and will not auto-continue
- budgets are checked after responses finish, so an in-flight response can exceed the limit
- budget-limited goals resume only when the same objective is set with a larger `--budget`
- session restore replays transcript evidence to recover goal status, usage, verify command, auto-continue count, and stop reason

For tasks with clear acceptance conditions, use `/goal <objective> --verify "python3 independent_check.py"`. Keep that check independent of model-generated tests. A public test passing covers its assertions, not every requirement; completion reports should identify checks run and requirements still unverified. The small opt-in real-model checks in `scripts/evals/coding/README.md` grade finished artifacts separately from the agent's report.

The model can inspect, create, and request completion through the goal tool. Pause, resume, clear, and replace remain user-controlled slash commands.

### Background replies and recovery

`noa reply <id> '<message>'` sends a text prompt without attaching. In `noa agents`, Space previews the selected session and opens a reply input; Ctrl+S sends the main draft to the selected session. Enter on the main screen still creates a session.

Replies use the existing input queue and do not answer permission dialogs. Slash and bang prefixes in external replies remain text. Inbox entries retain their UUID until the user message is flushed to the transcript, so a process restart preserves unacknowledged replies.

An orphaned session with a live child prevents duplicate revival. Stopping it requires a verifiable process identity; when identity cannot be established, Noa refuses to signal the PID. Custom configuration directories have separate socket namespaces; hosts started by an older build under a custom directory must be stopped with that older build before restarting. The default configuration's socket path stays compatible.

Background hosts explicitly inherit the active configuration directory. An inherited default product directory must not redirect a child away from a caller's custom `CLAUDE_CONFIG_DIR`.

### Experimental first-party message threads

`NOA_CLAUDE_TETHER_LIVE=1` (legacy alias `CLAUDE_CODE_TETHER_LIVE=1`) opts in to the `message-threads-2026-08-12` beta observed in official CC. The default remains stateless. This path retains conversation state at the first-party service; its public Messages API contract and credential eligibility are not established by local scripted tests.

Only a direct first-party endpoint uses threads. Other providers retain full requests. Complete responses can continue with incremental messages and inherited static fields; changed history, model, tools, permissions or hooks create a fresh thread. Unsupported protocol responses disable threading for the model (a rejected beta header disables it for the session); expired pointers and fingerprint failures have bounded recovery. Partial streams never become continuation anchors.

Deliberate deviation from upstream: continuations omit static `system`/`tools` by default, where upstream sends them in full unless its `tengu_quiet_heron` gate is on. A fingerprint mismatch that names an omitted field switches the session to full fields. Unrecognised HTTP 400s are surfaced, not retried stateless.

### Auto-compact

Proactive auto-compact summarizes the whole conversation; no verbatim tail is kept. A configured window (`/autocompact` or `CLAUDE_CODE_AUTO_COMPACT_WINDOW`) routes compaction through the reactive compactor, which keeps the most recent rounds when they fit. When the current window would block and the last served model has a larger window, the summary is written by that model.

Deliberate deviation from upstream: for model ids upstream does not recognize (window source `unknown-model`), upstream also sends proactive compaction to its reactive path. In a scripted probe with a 200k default window, that path sent no summary at 170k or 190k, so the conversation grew toward the API limit. Noa summarizes at its threshold (167k on that window) instead. Only `claude-test-200k` was probed; recognized model ids were not compared.

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

This product supports local subagents defined as markdown files in `.noa/agents/` (project) and `~/.noa/agents/` (user). `/agents` no longer has a management UI; it only prints this guidance.

Agents can come from these scopes:

- built-in
- user settings
- project settings
- local settings
- plugin sources
- managed policy sources

The loader resolves precedence across these scopes.

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
