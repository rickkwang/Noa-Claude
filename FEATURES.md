# Features Audit

Last updated: 2026-10-10

This file is the build/runtime audit for experimental feature flags in this repository.

## Build Profiles

- `baseline`: default `bun run build` profile in this repository.
- `dev-full`: opt-in profile (`bun run build:dev:full`) that enables expanded experimental unlocks.

## Scope

- Flags listed below are discovered from source `feature('FLAG')` usage.
- "Unlocked" here means the flag can be enabled in the expanded `dev-full` profile.
- Runtime availability can still depend on auth/provider/environment prerequisites.

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

- `CACHED_MICROCOMPACT` — `services/compact/cachedMCConfig.ts` returns a config
  with `enabled: false` and no supported models, so cache editing never engages.
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
- `TungstenTool` — a name-only object behind `USER_TYPE === 'ant'`.
  `TungstenLiveMonitor.ts` is also an empty class, but `REPL.tsx` imports it
  unconditionally, so the module must keep resolving.
- `VerifyPlanExecutionTool` — an empty class, loaded only when
  `CLAUDE_CODE_VERIFY_PLAN === 'true'`, which `build.ts` defines as `'false'`;
  the registry then drops it because it has no `isEnabled`. Its `constants.ts`
  (`VERIFY_PLAN_EXECUTION_TOOL_NAME`) is read from the ant-only branch of
  `classifierDecision.ts`.

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

Refer to `FEATURE_AVAILABILITY_MATRIX.md` for command-level availability.

## Upstream Parity Notes

- **Custom themes (`/theme`)** — aligned with upstream Claude Code:
  user themes from `<config>/themes/*.json`, plugin-provided themes
  (`themes/` dir or `themes`/`experimental.themes` manifest paths, slugs
  namespaced `<plugin>:`), `custom:<slug>` values for the `theme` setting,
  the picker's custom-theme rows + ctrl+e edit, and the theme editor
  (fork-on-edit for plugin themes). Intentional deviation: upstream gates
  custom themes behind safe mode (`--safe-mode` / `CLAUDE_CODE_SAFE_MODE=1`)
  and shows a "disabled in safe mode" notice; this fork has no safe-mode
  concept, so that gate and its copy are absent.
- **`/status` "Session kind" row** — the upstream row uses
  `CLAUDE_CODE_SESSION_KIND=bg` and `attacherCaps`. This fork has detached
  background sessions with its own `NOA_CLAUDE_BG_JOB` marker and PTY
  attach/detach protocol (`src/utils/background/`); it does not use those
  upstream signals. The upstream row has not been ported.
