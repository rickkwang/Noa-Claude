# Product Governance

Last updated: 2026-10-13

This document replaces the separate command surface, feature gap, and roadmap notes with one product-facing control surface.

## Scope

This page covers three related concerns:

- command visibility and status
- current capability gaps
- near-term product direction

## Command Surface

### Product-Available

These are the baseline workflows that must remain discoverable and meaningful:

- `/fork`

### Implemented but Non-Baseline

These commands are callable, but they are not core product workflows:

- `/cleanup-data`
- `/clean-sessions`
- `/output-style`
- `/rate-limit-options`
- `/provider`
- `/rewind`
- `/goal`
- `/reload-skills`
- `/pause-memory`
- `/background`
- `/agents`
- `/code-review` (alias `/review`)

Policy:

- keep behavior stable
- `/code-review` replaces the former `/review` prompt; it is user-invoked only and is not exposed through the MCP server
- do not claim full product parity
- promotion to baseline requires smoke coverage and user-value justification
- `/skills` shows all skill sources in one list. Enter/Space cycles modes, `/` searches, `t` sorts by token usage, and Esc saves and closes. Author-disabled model invocation is locked in the picker. `scripts/e2e-permission-lists.mjs --skills-only` covers the rendered controls, persistence, scrolling and narrow terminals.
- `/output-style` is a direct entry to the picker that `/config` hosts; both write `outputStyle` to local settings, so the two entry points must stay interchangeable
- `/background` (alias `/bg`), ← on an empty prompt, `noa agents`, `noa --bg`, `noa reply` and `noa attach|logs|stop|kill|respawn|rm` are one surface: background sessions run in detached PTY hosts with no daemon. `scripts/e2e-multiedit.mjs` covers MultiEdit atomicity and reading a background shell's output file with Read; `scripts/e2e-background.mjs` covers compiled terminal replies, permission dialogs and Fleet controls with a scripted local API; `scripts/e2e-agents-view.mjs` covers the broader live workflow (needs tmux and a working model). Not covered: prewarmed spares, groups/pins, cloud sessions, and carrying running shells/subagents into the fork (the move asks first and stops them). Background sessions are isolated like upstream: Edit/MultiEdit/Write/NotebookEdit into the shared checkout is rejected until the session calls EnterWorktree — `worktree.bgIsolation: "none"` (or `NOA_CLAUDE_BG_ISOLATION=none` / `CLAUDE_BG_ISOLATION=none`) works in place

Ordinary local subagents share a foreground/background concurrency budget (`NOA_CLAUDE_MAX_CONCURRENT_AGENTS`, default 20; `0` disables the cap). Spawns and resumes are refused when full, including when backgrounding is disabled; a waiting parent retains its slot and backgrounding keeps the same slot. Ordinary background subagents may use `SendMessage` for peer communication within inherited permissions and their configured tool restrictions. Explicit names address foreground and background subagents alike; reserved recipient names and names shaped like agent IDs are refused. Pending messages are checked again before normal completion, including after the final text response and SubagentStop hooks, within the existing turn limit. Consumed collaboration messages and model-visible hook/compaction attachments are recorded in the subagent transcript and retained on resume. If the turn limit prevents consumption, accepted inbox messages are saved as unanswered continuation context without another model call. Message identity and origin survive delivery and resume; peer messages identify their sender and transcript input remains human input. Sidechain tool results retain intervening context in their parent chain. The final inbox check and closing message admission happen synchronously. Both `SendMessage` and transcript input refuse messages during cleanup; transcript input retains the unsent draft for retry. `scripts/e2e-agent-coordination.mjs` covers name routing, final-response and hook-time delivery, collaboration history and fresh-process resume, parallel tool hook context, denied messaging, mixed capacity, slot reuse, nested refusal and resume capacity. `scripts/e2e-harness-state.ts` covers atomic inbox closure and rejection through the shared queue used by transcript input.

Tracked surfaces:

- `/cleanup-data`
- `/clean-sessions`
- `/output-style`
- `/rate-limit-options`
- `/provider`
- `/rewind`
- `/goal`
- `/reload-skills`
- `/pause-memory`
- `/background`
- `/agents`
- `/code-review`

### Build-Excluded

These commands are intentionally not available in this build and must remain hidden:

- `/proactive`
- `/peers`
- `/remote-control`
- `/force-snip`
- `/subscribe-pr`

Policy:

- not registered in the runtime command loader; the loader's "unknown command" path is the user-visible failure mode
- `BUILD_EXCLUDED_ERROR_CONTRACTS` in `src/commands/buildExcluded.ts` retains a stable `E_BUILD_EXCLUDED_*` error ID per surface for governance/CI assertions only
- `/remote-control` here refers to the slash command surface; bridge/remote runtime code may exist but must remain unavailable in this build

Tracked surfaces:

- `/proactive`
- `/peers`
- `/remote-control`
- `/force-snip`
- `/subscribe-pr`

### Stub

These commands remain governance-only placeholders until implementation.

Policy:

- keep out of baseline docs
- keep them out of runtime command registration until implementation exists
- track implementation status in `FEATURE_AVAILABILITY_MATRIX.md`

Tracked surfaces:

- `/autofix-pr`
- `/bughunter`
- `/teleport`
- `/good-claude`
- `/mock-limits`
- `/reset-limits`
- `/issue`

## Feature Gaps

The current gap inventory is split into three buckets:

- directly activatable but non-baseline
- build-excluded
- stubbed

The authoritative table lives in this document.

Startup modes are not slash commands and are tracked under "Runtime Modes Outside Slash Commands" in `FEATURE_AVAILABILITY_MATRIX.md`. Open gaps for `--restricted`:

- read confinement to the working directories is not enforced (writes are; `pathInAllowedWorkingPath` in `src/utils/permissions/filesystem.ts` is the hook point for reads in `checkReadPermissionForTool`)
- the approval gate for settings, git and tool-configuration writes relies on the existing `ask` safety checks (`checkPathSafetyForAutoEdit`), not a dedicated restricted-mode approval path

`--safe-mode` is a troubleshooting profile, not a command surface, and does not change the buckets above.

## Roadmap

The implementation roadmap is in this document.

## Maintenance Freeze

The current freeze policy lives in [maintenance-freeze-plan.md](./maintenance-freeze-plan.md).

Use it as the default freeze-period decision framework for bug fixes, stability work, validation changes, and any proposed product-surface expansion. This page remains the command-surface boundary; the maintenance plan defines what changes are allowed during freeze.

## Operating Principles

- Treat `/fork` as the supported product baseline.
- Treat implemented-but-non-baseline commands as stable-but-not-core.
- Treat build-excluded commands as deliberate build scope; do not describe them as regressions in this build.
- Treat stubs as implementation gaps and keep them out of baseline claims.
- When in doubt, verify behavior with smoke coverage before promoting a surface.

## Verification Targets

Use these checks when changing product surface area:

- `bun run check:docs`
- `bun run smoke:features`
- `bun run smoke:engine`
- `bun run smoke:engine:live` for endpoint-verified changes
- `bun run scan:pr-intent` for PR safety review

## Promotion Checklist

Before moving any command to baseline:

1. Implement runtime semantics end-to-end.
2. Add smoke checks for discoverability and execution boundaries.
3. Update `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, and this document in the same change.
4. Ensure `bun run check:docs` and `bun run smoke:features` pass.

## Release Checklist

Before tagging a release:

1. Bump `version` in `package.json` and add the `docs/release-notes.md` entry.
2. Update the install URL in `README.md` to the new tag — it is pinned (e.g. `.../Noa-Claude/v1.10.0/install.sh`), not a moving `master` ref. The installer itself resolves the newest **published GitHub Release** at runtime (semver max over strict release tags — not the tags list, which also carries imported upstream Claude Code refs like `v2.1.x` that were never Noa releases; overridable via `NOA_INSTALL_REF` / `NOA_INSTALL_REPO_TARBALL_URL`), so both fresh installs and `noa update` land on released snapshots rather than arbitrary `master` commits.
3. Bump `FALLBACK_REF` in `install.sh` to the new tag — it is the offline/rate-limited default when the GitHub API is unreachable. `src/test/installScript.test.ts` reads this value from the script, so no test edit is needed.
4. Commit the release changes, create the tag, and verify `git show <tag>:install.sh` resolves.
5. Publish the GitHub Release for that existing tag — an unpublished tag is invisible to the installer, which reads `/releases`, not `/tags`.
