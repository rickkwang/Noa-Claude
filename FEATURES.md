# Features Audit

Last updated: 2026-11-07

This file is the single availability audit for this repository: build profiles, feature-flag unlock status, and command/runtime availability.

## Build Profiles

- `baseline`: default `bun run build` profile in this repository.
- `dev-full`: opt-in profile (`bun run build:dev:full`) that enables expanded experimental unlocks.

## Scope

- Flags listed below are discovered from source `feature('FLAG')` usage.
- "Unlocked" here means the flag can be enabled in the expanded `dev-full` profile.
- Runtime availability can still depend on auth/provider/environment prerequisites.

## Availability Status Definitions

- Status definitions:
  - `Baseline`: primary user-facing supported workflow.
  - `Implemented but Non-Baseline`: callable, but not part of primary workflow.
  - `Build-Excluded`: not registered in the runtime command loader; an `E_BUILD_EXCLUDED_*` contract is retained for governance and CI assertions.
  - `Stub`: placeholder tracked in governance only; not registered in runtime and has no functional implementation.

Default `bun run build` profile in this repo is conservative; the expanded unlock profile is opt-in via `bun run build:dev:full`.

## Build Guardrails and Telemetry Posture
| Surface | Status | Notes |
|---|---|---|
| Telemetry exporters/reporting | Removed | Runtime analytics/reporting paths are hard no-op in this build. |
| Security prompt guardrail injection | Removed | Extra injected guardrail prompt blocks are removed from prompt assembly. |
| Remote managed-settings overlay | Disabled | Remote eligibility path is hard-disabled in this build. |
| Remote policy-limits overlay | Disabled | Remote eligibility path is hard-disabled in this build. |
| Experimental unlock profile | Available | Expanded profile is available via `bun run build:dev:full` (not default). |

## Core Product Chains
| Chain | Status | Notes |
|---|---|---|
| CLI startup (`noa`) | Available | Stable, isolated product directory defaults. |
| Non-interactive (`--print`) | Available | Regular MCP now uses bounded wait + background continue. |
| Interactive REPL | Available | Mainline usable; some historical complexity remains. |
| Desktop GUI (`gui/`) | Implemented but Non-Baseline | Development Electron shell; Browser tabs for any HTTP/HTTPS address and Suggested website cards from terminal output/completed replies, with isolated, persisted per-project browser sessions that keep public pages away from private addresses (`bun run --cwd gui test:browser`); new-task usage stats from the CLI `/stats` aggregation (`bun run --cwd gui test:stats`); a Files pane that keeps the tree beside the open file when wide enough (`bun run --cwd gui test:files-split`); searchable files, guarded text editing, unified/split local Git review and per-file and staged/unstaged-hunk stage/unstage/revert, context and tool activity; searchable settings, composer preferences, CLI-backed configuration/Hook/skill/plugin inspection and MCP controls; math/diagrams, scoped media, review comments, structured results and paged conversation history. Grouped subagent creation, event-ordered lifecycle rows and a task-specific Active/Done Subagents panel; expandable returned thinking, paged questions and syntax-highlighted Write previews. New-task environment row shows “This computer” as a static label (cloud execution is unavailable, so there is no “Work in” menu). 512 KiB text/image preview / 3,000 rendered-line limits; no full Codex parity claim. Verified with `scripts/e2e-gui-workspace.mjs`; native conversation fixtures: `bun run --cwd gui test:rendering`. |
| MiniMax Anthropic-compatible backend | Available | Default product path and launcher checks in place. |
| Official Claude OAuth fallback on 3P path | Disabled by policy | Missing/invalid 3P token fails clearly; no OAuth fallback. |

The `/skills` picker combines sources in one list with aligned name/details columns. Enter and Space cycle skill modes, `/` searches, `t` sorts by estimated token usage, and Esc saves and closes. Author-disabled model invocation stays locked in the picker.

## Slash Commands: Implemented but Non-Baseline
| Command | Status | Notes |
|---|---|---|
| `/cleanup-data` | Available | Unified cleanup command for local tracking data; requires `--confirm` to execute deletions. Custom-location memory dirs (env/settings override) only lose known memory files — unrecognized items are kept and reported. |
| `/clean-sessions` | Available | Interactive picker for deleting small/trivial session transcripts (sidecar dirs go with them); bulk `delete --confirm` requires `--trivial-only` and the default size bucket. The running session and recently-modified (<10m) sessions are always excluded. |
| `/output-style` | Available | Direct entry to the output-style picker; writes `outputStyle` to local settings, the same key and source as `/config` → Output style. |
| `/rate-limit-options` | Available | Rate-limit action sheet; still gated by subscriber/runtime availability. |
| `/provider` | Available | Manage named provider configurations (create, list, switch, delete profiles). |
| `/rewind` | Available | Restore code and conversation to a previous checkpoint (aliases `/checkpoint`, `/undo`); interactive only. |
| `/reload-skills` | Available | Re-scans skill directories mid-session. Covers the gap the file watcher cannot: it only watches directories that existed at startup. |
| `/pause-memory` | Available | Session-scoped auto-memory pause. One-directional — resuming falls back to `CLAUDE_CODE_DISABLE_AUTO_MEMORY` / `autoMemoryEnabled`, it cannot override them. |
| `/goal` | Available | Long-running objective with evaluator loop, auto-continue limits, token budget, and optional verify command. |
| `/code-review` | Available | Review the local diff (default), a PR number, branch, or path with effort tiers `low`–`max`, optional `--fix`, `--comment` (PR only), and `--max-findings`; alias `/review`. Runs as a forked agent; the last effort and cap typed are reused. `ultra` (cloud review) is not supported. `scripts/e2e-code-review.mjs` covers argument handling and prompt construction with a scripted model. |
| `/background` | Available | Alias `/bg`. Forks the conversation into a background session and exits (bare `/bg` mid-turn stops the turn and the background session finishes it; `/bg <prompt>` waits for the turn). ← on an empty prompt moves it and opens the agents view instead. `/exit` in a background session detaches; `/stop` ends it. |

## Slash Commands: Product-Available
| Command | Status | Notes |
|---|---|---|
| `/fork` | Available | Creates a resumable fork of the current conversation. |

## Slash Commands: Build-Excluded
| Command | Status |
|---|---|
| `/proactive` | Build-Excluded |
| `/peers` | Build-Excluded |
| `/remote-control` | Build-Excluded |
| `/force-snip` | Build-Excluded |
| `/subscribe-pr` | Build-Excluded |

`/remote-control` in this section refers to the slash command surface only.
Bridge/remote runtime modules can exist in source, but this build does not register the command in the loader. `E_BUILD_EXCLUDED_*` contracts are retained in `src/commands/buildExcluded.ts` for governance assertions in `scripts/smoke-features.mjs`.

## Slash Commands: Stub
| Command | Status |
|---|---|
| `/autofix-pr` | Stub |
| `/bughunter` | Stub |
| `/teleport` | Stub |
| `/good-claude` | Stub |
| `/mock-limits` | Stub |
| `/reset-limits` | Stub |
| `/issue` | Stub |

## Runtime Modes Outside Slash Commands
| Capability | Status | Source |
|---|---|---|
| Daemon mode | Build-Excluded | Not in source |
| Daemon worker registry | Build-Excluded | Not in source |
| Environment runner | Build-Excluded | Not in source |
| Self-hosted runner | Build-Excluded | Not in source |
| Background sessions + agents view (`noa agents`, `noa --bg <task>`, `noa attach/logs/stop/kill/respawn/rm <id>`, `noa reply <id> <message>`) | Available (core) | `src/utils/background/`, `src/components/FleetView/` — detached PTY host per session, no daemon. `disableAgentView` / `NOA_CLAUDE_DISABLE_AGENT_VIEW=1` turns it off; `leftArrowOpensAgents: false` (or ← opens agents in `/config`) keeps ← a cursor key. Writes into the shared checkout are blocked until the session isolates via EnterWorktree (`worktree.bgIsolation` / `NOA_CLAUDE_BG_ISOLATION`, default `worktree`) |
| Local subagent coordination | Available | Ordinary background subagents can use `SendMessage` for peer communication, subject to parent permissions and agent tool restrictions. Foreground and background ordinary local subagents share `NOA_CLAUDE_MAX_CONCURRENT_AGENTS` (default 20; `0` disables the cap); running parents retain their slot while awaiting children. Covered by `scripts/e2e-agent-coordination.mjs` |
| Template jobs | Build-Excluded | Not in source |
| Remote control in this build | Build-Excluded | `src/bridge/bridgeEnabled.ts` |
| Channels in print mode | Build-Excluded | `src/cli/print.ts` |
| Auto/Bypass mode tool reminders | Available | Auto uses the upstream bias-toward-action reminder; Auto/Bypass can add bash-first guidance when Bash and Edit or Write are available. `NOA_CLAUDE_BASH_FIRST=0` disables it; `NOA_CLAUDE_BASH_FIRST_VARIANT=strict|relaxed` overrides the model-dependent wording. Covered by `scripts/e2e-agent-loop.mjs --case mode-auto` / `--case mode-bypass` and interactive `scripts/e2e-startup-boundaries.mjs --case bypass-mode-prompt` |
| Restricted mode (`--restricted`, `NOA_CLAUDE_RESTRICTED=1`) | Available (partial) | `src/utils/envUtils.ts` `isRestrictedMode`, `src/tools.ts` `getAllBaseTools`, `src/main.tsx` settings-source and bypass gates, `src/utils/permissions/filesystem.ts` write confinement. Removes Bash/PowerShell/REPL/WebFetch unless `--tools` names them, ignores user/project/local settings files (policy and `--settings` still load), refuses bypassPermissions, and hard-denies writes outside the working directories. Not yet: read confinement to working directories, and the approval gate for settings/git/tool-config writes beyond the existing `ask` safety checks. Covered by `scripts/e2e-restricted-safe.mjs` |
| Safe mode (`--safe-mode`, `NOA_CLAUDE_SAFE_MODE=1`) | Available | `src/utils/envUtils.ts` `isSafeMode`; per-loader gates in `src/utils/claudemd.ts`, `src/skills/loadSkillsDir.ts`, `src/utils/hooks/hooksConfigSnapshot.ts`, `src/utils/sessionStart.ts`, `src/utils/plugins/pluginLoader.ts`, `src/services/mcp/config.ts`, `src/outputStyles/loadOutputStylesDir.ts`, `src/keybindings/loadUserBindings.ts`, `src/tools/AgentTool/loadAgentsDir.ts`, `src/utils/customThemes.ts`. Keeps policy-managed customizations and auth, model, built-in tools and permissions. Distinct from `--bare`, which also disables keychain and OAuth reads. Covered by `scripts/e2e-restricted-safe.mjs` |

## Engineering Interpretation
- Current product is operational for primary usage: interactive coding and non-interactive `--print`.
- `/fork` are now part of the supported product baseline and are covered by dedicated non-live smoke checks.
- Excluded/stub commands are not a runtime defect; they are deliberate build-scope or placeholder surfaces.
- For roadmap prioritization, treat these categories differently:
  - `Build-Excluded`: requires feature delivery, not a simple toggle.
  - `Stub`: requires net-new implementation.
  - `Implemented but Non-Baseline`: implemented and callable, but not a primary user workflow.

## Unlocked & Runtime-Active

- `AGENT_MEMORY_SNAPSHOT`
- `AGENT_TRIGGERS`
- `AGENT_TRIGGERS_REMOTE`
- `ALLOW_TEST_VERSIONS`
- `AUTO_MODE` (default-on; gates the auto permission mode — the shift+tab carousel stop that delegates per-action approvals to the yolo/transcript safety classifier. Ships enabled in the baseline build. Runtime availability is still gated by model support (first-party Claude opus/sonnet 4.6+ / 5+ only), the `disableAutoMode` setting, and a first-entry opt-in consent dialog. Its GrowthBook rollout gate `tengu_auto_mode_config` is inert here — GrowthBook is hard-disabled — so the in-code default (`enabled`) applies.)
- `AUTO_THEME`
- `BASH_CLASSIFIER`
- `BUILTIN_EXPLORE_PLAN_AGENTS` (default-on; enables the built-in Explore + Plan subagents. Its GrowthBook A/B gate `tengu_amber_stoat` is inert here — GrowthBook is hard-disabled — so the default `true` applies.)
- `COMMIT_ATTRIBUTION`
- `CONNECTOR_TEXT`
- `EXTRACT_MEMORIES`
- `FILE_PERSISTENCE`
- `HISTORY_PICKER`
- `KAIROS`
- `KAIROS_BRIEF`
- `LODESTONE`
- `MCP_RICH_OUTPUT`
- `MESSAGE_ACTIONS`
- `MONITOR_TOOL` (the `Monitor` tool: runs a shell command in the background and reports its output lines as batched task-notification events; not in the baseline build — enable with `--feature=MONITOR_TOOL` or `dev-full`)
- `POWERSHELL_AUTO_MODE`
- `PROMPT_CACHE_BREAK_DETECTION`
- `QUICK_SEARCH`
- `SHOT_STATS`
- `SKILL_IMPROVEMENT`
- `SLOW_OPERATION_LOGGING`
- `TEAMMEM`
- `TOKEN_BUDGET`
- `TREE_SITTER_BASH`
- `TREE_SITTER_BASH_SHADOW`
- `ULTRATHINK`
- `UNATTENDED_RETRY`
- `VERIFICATION_AGENT`

## Unlocked but Runtime-Caveated

- `BRIDGE_MODE` (requires claude.ai account + bridge prerequisites)
- `CCR_AUTO_CONNECT` (depends on bridge + rollout/config state)
- `CCR_MIRROR` (depends on bridge + env/config)
- `KAIROS_CHANNELS` (channel-capable MCP + rollout requirements)
- `KAIROS_PUSH_NOTIFICATION` (requires notification-capable context)
- `DOWNLOAD_USER_SETTINGS` (depends on first-party auth/settings sync path)
- `UPLOAD_USER_SETTINGS` (depends on first-party auth/settings sync path)
- `NATIVE_CLIENT_ATTESTATION` (platform/integration dependent)
- `IS_LIBC_GLIBC` (platform-specific)
- `IS_LIBC_MUSL` (platform-specific)
- `HARD_FAIL` (runtime mode behavior gate)

## Unlocked but Inert (placeholder implementation)

These flags build and are enabled in `dev-full`, but the implementation behind
them is a placeholder in this fork, so enabling them adds no working behavior.
The placeholders exist so the gated call sites resolve; each must keep exporting
every name those call sites read (see `CLAUDE.md`, "Feature flags").

- `EXPERIMENTAL_SKILL_SEARCH` — `services/skillSearch/` returns no results
  (`isSkillSearchEnabled()` is `false`); the `DiscoverSkills` tool is a
  name-constant stub with no implementation.
- `HISTORY_SNIP` — `services/compact/snipCompact.ts` never snips
  (`isSnipRuntimeEnabled()` is `false`); the `Snip` tool is a null shell.
- `OVERFLOW_TEST_TOOL` — the tool is a null shell and never registers.
- `TERMINAL_PANEL` — the `TerminalCapture` tool is a null shell and never
  registers.
- `WEB_BROWSER_TOOL` — the tool and its panel are null shells and never
  register.

`KAIROS` stays under "Runtime-Active" for the parts that exist (e.g. the Brief
tool), but its `Sleep`, `SendUserFile` and `PushNotification` tools are class
shells that the tool registry drops, and its session-transcript segment writer
is a no-op.

The remaining tool shells are gated outside `feature()` and are inert in every
build profile. In each case only the tool's main file is a shell — sibling
constant modules are real and referenced:

- `REPLTool` and `SuggestBackgroundPRTool` — empty classes behind
  `USER_TYPE === 'ant'`, which `build.ts` pins to `'external'`. `REPLTool/constants.ts`
  (`REPL_TOOL_NAME`, repl-mode logic) and `primitiveTools.ts` are live code.

## Not Unlockable in This Build (by flag-only unlock)

The following flag references modules absent from this repository. Adding it
to a build profile fails at bundle resolve time (see the omission note above
`fullExperimentalFeatures` in build.ts):

- `COORDINATOR_MODE` (coordinator/workerAgent) — `isCoordinatorMode()` resolves
  false; its branches are deeply woven into resume/session hot paths and are
  retained rather than excised.

`VOICE_MODE` builds, but is off in every profile, including dev-full: its
native recorder (`audio-capture-napi`) is an empty npm placeholder, so `/voice`
throws, and the `voice_stream` STT endpoint needs claude.ai OAuth. Its branches
stay in source, inert; re-add the flag to `build.ts` once a working recorder
and STT path exist.

Build-scope exclusions:

- `BYOC_ENVIRONMENT_RUNNER` (build-scope runner surface)
- `DAEMON` (daemon mode remains build-scoped)
- `SELF_HOSTED_RUNNER` (runner surface not product-enabled)
- `ABLATION_BASELINE` (internal/test gate)
- `ANTI_DISTILLATION_CC` (service-side coupling)
- `BREAK_CACHE_COMMAND` (internal/debug usage)
- `COWORKER_TYPE_TELEMETRY` (telemetry hard-disabled in this build)
- `ENHANCED_TELEMETRY_BETA` (telemetry hard-disabled in this build)
- `MEMORY_SHAPE_TELEMETRY` (telemetry hard-disabled in this build)
- `PERFETTO_TRACING` (telemetry/tracing disabled in this build)
- `PROACTIVE` (product scope intentionally excluded)
- `DUMP_SYSTEM_PROMPT` (ant-only `--dump-system-prompt` eval entrypoint; eliminated from external builds by design)
- `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED` (orphan optimization gate; referenced in `AutoUpdaterWrapper` but not part of any named build profile)

## Runtime GrowthBook Gates That Always Resolve to Defaults

GrowthBook remote fetch is hard-disabled and both override channels
(`CLAUDE_INTERNAL_FC_OVERRIDES`, `/config` Gates tab) require `USER_TYPE=ant`,
so for normal users these gates always return their in-code defaults. The
guarded branches are kept (reachable via internal/dev channels) but are inert
in shipped builds:

- `tengu_otk_slot_v1` (default `false`) — max_output_tokens same-request 8k→64k
  escalate retry in query.ts never fires; multi-turn recovery still applies.
- `tengu_hive_evidence` (default `false`) — the VERIFICATION_AGENT system-prompt
  section never injects, even in dev-full builds.

## Command Surfaces Outside Flag Unlock

These are not solved by feature-flag unlock and are tracked in the feature matrix:

- Build-excluded slash commands
- Stub/internal placeholder commands
- Runner/daemon surfaces excluded by product scope

Refer to the command-level availability tables above.

## Upstream Parity Notes

- **Custom themes (`/theme`)** — aligned with upstream Claude Code:
  user themes from `<config>/themes/*.json`, plugin-provided themes
  (`themes/` dir or `themes`/`experimental.themes` manifest paths, slugs
  namespaced `<plugin>:`), `custom:<slug>` values for the `theme` setting,
  the picker's custom-theme rows + ctrl+e edit, the theme editor
  (fork-on-edit for plugin themes), and safe-mode gating
  (`--safe-mode` / `NOA_CLAUDE_SAFE_MODE=1`).
- **`/status` "Session kind" row** — the upstream row uses
  `CLAUDE_CODE_SESSION_KIND=bg` and `attacherCaps`. This fork has detached
  background sessions with its own `NOA_CLAUDE_BG_JOB` marker and PTY
  attach/detach protocol (`src/utils/background/`); it does not use those
  upstream signals. The upstream row has not been ported.
