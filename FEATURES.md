# Features Audit

Last updated: 2026-05-15

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
- `AUTO_THEME`
- `BASH_CLASSIFIER`
- `BUILTIN_EXPLORE_PLAN_AGENTS` (default-on; enables the built-in Explore + Plan subagents. Its GrowthBook A/B gate `tengu_amber_stoat` is inert here — GrowthBook is hard-disabled — so the default `true` applies.)
- `CACHED_MICROCOMPACT`
- `COMMIT_ATTRIBUTION`
- `CONNECTOR_TEXT`
- `CONTEXT_COLLAPSE`
- `COORDINATOR_MODE`
- `EXPERIMENTAL_SKILL_SEARCH`
- `EXTRACT_MEMORIES`
- `FILE_PERSISTENCE`
- `FORK_SUBAGENT`
- `HISTORY_PICKER`
- `HISTORY_SNIP`
- `KAIROS`
- `KAIROS_BRIEF`
- `LODESTONE`
- `MCP_RICH_OUTPUT`
- `MCP_SKILLS`
- `MESSAGE_ACTIONS`
- `MONITOR_TOOL`
- `NATIVE_CLIPBOARD_IMAGE`
- `NEW_INIT`
- `POWERSHELL_AUTO_MODE`
- `PROMPT_CACHE_BREAK_DETECTION`
- `QUICK_SEARCH`
- `REACTIVE_COMPACT`
- `REVIEW_ARTIFACT`
- `SHOT_STATS`
- `SKILL_IMPROVEMENT`
- `SLOW_OPERATION_LOGGING`
- `TEAMMEM`
- `TEMPLATES`
- `TERMINAL_PANEL`
- `TOKEN_BUDGET`
- `TRANSCRIPT_CLASSIFIER`
- `TREE_SITTER_BASH`
- `TREE_SITTER_BASH_SHADOW`
- `UDS_INBOX`
- `ULTRATHINK`
- `UNATTENDED_RETRY`
- `VERIFICATION_AGENT`
- `VOICE_MODE`
- `WEB_BROWSER_TOOL`
- `WORKFLOW_SCRIPTS`

## Unlocked but Runtime-Caveated

- `BRIDGE_MODE` (requires claude.ai account + bridge prerequisites)
- `CCR_AUTO_CONNECT` (depends on bridge + rollout/config state)
- `CCR_MIRROR` (depends on bridge + env/config)
- `KAIROS_CHANNELS` (channel-capable MCP + rollout requirements)
- `KAIROS_GITHUB_WEBHOOKS` (requires channel/bridge context)
- `KAIROS_PUSH_NOTIFICATION` (requires notification-capable context)
- `DOWNLOAD_USER_SETTINGS` (depends on first-party auth/settings sync path)
- `UPLOAD_USER_SETTINGS` (depends on first-party auth/settings sync path)
- `DIRECT_CONNECT` (depends on remote capabilities)
- `NATIVE_CLIENT_ATTESTATION` (platform/integration dependent)
- `SSH_REMOTE` (remote environment dependent)
- `OVERFLOW_TEST_TOOL` (test/diagnostic pathway)
- `IS_LIBC_GLIBC` (platform-specific)
- `IS_LIBC_MUSL` (platform-specific)
- `HARD_FAIL` (runtime mode behavior gate)

## Not Unlockable in This Build (by flag-only unlock)

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

## Command Surfaces Outside Flag Unlock

These are not solved by feature-flag unlock and are tracked in the feature matrix:

- Build-excluded slash commands
- Stub/internal placeholder commands
- Runner/daemon surfaces excluded by product scope

Refer to `FEATURE_AVAILABILITY_MATRIX.md` for command-level availability.
