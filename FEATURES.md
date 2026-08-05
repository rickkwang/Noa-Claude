# Features Audit

Last updated: 2026-08-05

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
- `CACHED_MICROCOMPACT`
- `COMMIT_ATTRIBUTION`
- `CONNECTOR_TEXT`
- `CONTEXT_COLLAPSE`
- `EXPERIMENTAL_SKILL_SEARCH`
- `EXTRACT_MEMORIES`
- `FILE_PERSISTENCE`
- `HISTORY_PICKER`
- `HISTORY_SNIP`
- `KAIROS`
- `KAIROS_BRIEF`
- `LODESTONE`
- `MCP_RICH_OUTPUT`
- `MESSAGE_ACTIONS`
- `NATIVE_CLIPBOARD_IMAGE`
- `POWERSHELL_AUTO_MODE`
- `PROMPT_CACHE_BREAK_DETECTION`
- `QUICK_SEARCH`
- `REACTIVE_COMPACT`
- `SHOT_STATS`
- `SKILL_IMPROVEMENT`
- `SLOW_OPERATION_LOGGING`
- `TEAMMEM`
- `TERMINAL_PANEL`
- `TOKEN_BUDGET`
- `TREE_SITTER_BASH`
- `TREE_SITTER_BASH_SHADOW`
- `ULTRATHINK`
- `UNATTENDED_RETRY`
- `VERIFICATION_AGENT`
- `VOICE_MODE`
- `WEB_BROWSER_TOOL`

## Unlocked but Runtime-Caveated

- `BRIDGE_MODE` (requires claude.ai account + bridge prerequisites)
- `CCR_AUTO_CONNECT` (depends on bridge + rollout/config state)
- `CCR_MIRROR` (depends on bridge + env/config)
- `KAIROS_CHANNELS` (channel-capable MCP + rollout requirements)
- `KAIROS_PUSH_NOTIFICATION` (requires notification-capable context)
- `DOWNLOAD_USER_SETTINGS` (depends on first-party auth/settings sync path)
- `UPLOAD_USER_SETTINGS` (depends on first-party auth/settings sync path)
- `NATIVE_CLIENT_ATTESTATION` (platform/integration dependent)
- `OVERFLOW_TEST_TOOL` (test/diagnostic pathway)
- `IS_LIBC_GLIBC` (platform-specific)
- `IS_LIBC_MUSL` (platform-specific)
- `HARD_FAIL` (runtime mode behavior gate)

## Not Unlockable in This Build (by flag-only unlock)

Implementation modules absent from this repository — enabling either of these
fails `bun run build:dev:full` at bundle resolve time (see the omission note
above `fullExperimentalFeatures` in build.ts):

- `COORDINATOR_MODE` (coordinator/workerAgent) — `isCoordinatorMode()` resolves
  false; its branches are deeply woven into resume/session hot paths and are
  retained rather than excised.

`TRANSCRIPT_CLASSIFIER` used to appear here (the upstream flag for the auto-mode
yolo classifier). The classifier prompts (`yolo-classifier-prompts/*.txt`) are
now present in this fork and the whole subsystem was re-gated under the dedicated
`AUTO_MODE` flag above, which ships enabled in the baseline build.
`TRANSCRIPT_CLASSIFIER` no longer gates anything.

### Removed never-buildable surfaces

The following flags previously gated absent modules. Their `feature()` branches
have been deleted from source entirely (they no longer appear in any build), so
they are no longer flag-unlockable and no longer carry dead branches:

- `BG_SESSIONS` (utils/taskSummary, utils/udsClient)
- `DIRECT_CONNECT` (src/server/* command surface)
- `FORK_SUBAGENT` (UserForkBoilerplateMessage)
- `KAIROS_GITHUB_WEBHOOKS` (bridge/webhookSanitizer, UserGitHubWebhookMessage)
- `MCP_SKILLS` (skills/mcpSkills)
- `MONITOR_TOOL` (tasks/MonitorMcpTask + dialogs)
- `REVIEW_ARTIFACT` (ReviewArtifactTool + permission UI)
- `SSH_REMOTE` (ssh/createSSHSession implementation)
- `TEMPLATES` (src/jobs)
- `UDS_INBOX` (UserCrossSessionMessage)
- `WORKFLOW_SCRIPTS` (WorkflowTool + LocalWorkflowTask + dialogs)

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
- `tengu_streaming_tool_execution2` (default `false`) — streaming tool execution
  stays off; `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1` is the only working opt-in.

## Command Surfaces Outside Flag Unlock

These are not solved by feature-flag unlock and are tracked in the feature matrix:

- Build-excluded slash commands
- Stub/internal placeholder commands
- Runner/daemon surfaces excluded by product scope

Refer to `FEATURE_AVAILABILITY_MATRIX.md` for command-level availability.

## Upstream Parity Notes

- **Custom themes (`/theme`)** — aligned with upstream Claude Code 2.1.220:
  user themes from `<config>/themes/*.json`, plugin-provided themes
  (`themes/` dir or `themes`/`experimental.themes` manifest paths, slugs
  namespaced `<plugin>:`), `custom:<slug>` values for the `theme` setting,
  the picker's custom-theme rows + ctrl+e edit, and the theme editor
  (fork-on-edit for plugin themes). Intentional deviation: upstream gates
  custom themes behind safe mode (`--safe-mode` / `CLAUDE_CODE_SAFE_MODE=1`)
  and shows a "disabled in safe mode" notice; this fork has no safe-mode
  concept, so that gate and its copy are absent.
- **`/status` "Session kind" row** — upstream 2.1.221 added a row after
  "Session ID" showing `interactive` / `background job · attached` /
  `background job · unattended`, driven by the `CLAUDE_CODE_SESSION_KIND=bg`
  env contract plus an `attacherCaps` attach-state signal. Intentional
  deviation: this fork has no detached background-job session type (and no
  `CLAUDE_CODE_SESSION_KIND`/`attacherCaps` plumbing anywhere in `src/`), so
  the row would permanently read "interactive". Not ported; revisit only if a
  real background-job session type lands here.
