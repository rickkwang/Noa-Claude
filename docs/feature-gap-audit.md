# Feature Gap Audit

This document classifies surfaces that exist upstream or in the codebase but are not currently part of the product baseline.

## Can Be Enabled Directly

These surfaces already have code paths in place but are not part of the baseline promise.

| Surface | Status | Reason | Upgrade condition |
|---|---|---|---|
| `/assistant` | Implemented but Non-Baseline | Implements assistant preference/status management only. | Promote after full assistant runtime activation and execution semantics are delivered. |
| `/output-style` | Implemented but Non-Baseline | Deprecated compatibility shim. | Replace shim with supported UX before promotion. |
| `/thinkback-play` | Implemented but Non-Baseline | Runtime gate still applies. | Remove gate dependency and stabilize user workflow semantics. |
| `/rate-limit-options` | Implemented but Non-Baseline | Subscriber/runtime gate still applies. | De-gate and stabilize across auth/provider modes. |
| `/heapdump` | Implemented but Non-Baseline | Engineering diagnostics, not mainline UX. | Promote only if converted to supported user diagnostics workflow. |

## Needs Implementation

These surfaces are present only as build exclusions or stubs and require actual feature delivery, not a toggle.

| Surface | Status | Reason | Upgrade condition |
|---|---|---|---|
| `/proactive` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/peers` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/agents-platform` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/remoteControlServer` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/torch` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/force-snip` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/subscribe-pr` | Build-Excluded | Intentionally excluded from this build. | Requires full feature delivery (not visibility toggle). |
| `/onboarding` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/autofix-pr` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/bughunter` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/break-cache` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/ctx_viz` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/oauth-refresh` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/debug-tool-call` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/perf-issue` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/teleport` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/good-claude` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/mock-limits` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/backfill-sessions` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/reset-limits` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/env` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/issue` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |
| `/ant-trace` | Stub | Placeholder (`isEnabled: () => false`). | Requires net-new implementation. |

## Do Not Force Open

These surfaces are intentionally gated by environment, account, platform, or external service prerequisites. They should be made clearer and less confusing, but not treated as simple unlocks.

| Surface | Status | Notes |
|---|---|---|
| `BRIDGE_MODE` | Runtime-caveated | Depends on bridge prerequisites. |
| `DIRECT_CONNECT` | Runtime-caveated | Depends on remote capabilities. |
| `SSH_REMOTE` | Runtime-caveated | Depends on remote environment. |
| `DOWNLOAD_USER_SETTINGS` | Runtime-caveated | Depends on first-party auth/settings sync. |
| `UPLOAD_USER_SETTINGS` | Runtime-caveated | Depends on first-party auth/settings sync. |
| `KAIROS_CHANNELS` | Runtime-caveated | Depends on channel-capable MCP and rollout context. |
| `KAIROS_GITHUB_WEBHOOKS` | Runtime-caveated | Requires channel/bridge context. |
| `KAIROS_PUSH_NOTIFICATION` | Runtime-caveated | Requires notification-capable context. |
| `NATIVE_CLIENT_ATTESTATION` | Runtime-caveated | Platform/integration dependent. |

## Recommended Next Steps

1. Expose the direct-activation surfaces only if there is user-facing value.
2. Implement the stubbed command surfaces one by one, starting from the ones with the clearest workflow value.
3. Keep runtime-caveated surfaces clearly documented so they are not mistaken for missing features.
