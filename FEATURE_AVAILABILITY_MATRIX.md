# Feature Availability Matrix

Last updated: 2026-04-08

## Scope
- This matrix reflects the current repository build/runtime behavior.
- Status definitions:
  - `Available`: usable in current build.
  - `Hidden-Internal`: implemented but intentionally hidden from normal help/UX.
  - `Build-Excluded`: command exists but hard-fails with `not available in this build`.
  - `Stub`: placeholder only (`isEnabled: () => false`), no functional implementation.

## Core Product Chains
| Chain | Status | Notes |
|---|---|---|
| CLI startup (`claude-agent`, `claude-code`) | Available | Stable, isolated product directory defaults. |
| Non-interactive (`--print`) | Available | Regular MCP now uses bounded wait + background continue. |
| Interactive REPL | Available | Mainline usable; some historical complexity remains. |
| MiniMax Anthropic-compatible backend | Available | Default product path and launcher checks in place. |
| Official Claude OAuth fallback on 3P path | Disabled by policy | Missing/invalid 3P token fails clearly; no OAuth fallback. |

## Slash Commands: Hidden but Implemented
| Command | Status | Notes |
|---|---|---|
| `/heapdump` | Available | Recently unhidden for engineering diagnostics. |
| `/output-style` | Hidden-Internal | Deprecated shim; points users to `/config`. |
| `/thinkback-play` | Hidden-Internal | Internal helper for thinkback flow; gated + plugin-dependent. |
| `/rate-limit-options` | Hidden-Internal | Internal flow, subscriber-oriented and UI-triggered. |

## Slash Commands: Product-Available
| Command | Status | Notes |
|---|---|---|
| `/fork` | Available | Creates a resumable fork of the current conversation. |
| `/workflows` | Available | Supports local `list/create/run/delete` and project workflow discovery. |
| `/summary` | Available | Produces structured short or detailed session summaries. |
| `/share` | Available | Exports local session share snapshots under `.claude-agent/shares`. |

## Slash Commands: Build-Excluded (Hard Fail in This Build)
| Command | Status |
|---|---|
| `/assistant` | Build-Excluded |
| `/proactive` | Build-Excluded |
| `/peers` | Build-Excluded |
| `/agents-platform` | Build-Excluded |
| `/remoteControlServer` | Build-Excluded |
| `/torch` | Build-Excluded |
| `/force-snip` | Build-Excluded |
| `/subscribe-pr` | Build-Excluded |

## Slash Commands: Internal or Placeholder Surfaces
| Command | Status |
|---|---|
| `/onboarding` | Stub |
| `/autofix-pr` | Stub |
| `/bughunter` | Stub |
| `/break-cache` | Stub |
| `/ctx_viz` | Stub |
| `/oauth-refresh` | Stub |
| `/debug-tool-call` | Stub |
| `/perf-issue` | Stub |
| `/teleport` | Stub |
| `/good-claude` | Stub |
| `/mock-limits` | Stub |
| `/backfill-sessions` | Stub |
| `/reset-limits` | Stub |
| `/env` | Stub |
| `/issue` | Stub |
| `/ant-trace` | Stub |

## Runtime Modes Outside Slash Commands
| Capability | Status | Source |
|---|---|---|
| Daemon mode | Build-Excluded | `src/daemon/main.ts` |
| Daemon worker registry | Build-Excluded | `src/daemon/workerRegistry.ts` |
| Environment runner | Build-Excluded | `src/environment-runner/main.ts` |
| Self-hosted runner | Build-Excluded | `src/self-hosted-runner/main.ts` |
| Background session attach/launch | Build-Excluded | `src/cli/bg.ts` |
| Template jobs | Build-Excluded | `src/cli/handlers/templateJobs.ts` |
| Remote control in this build | Build-Excluded | `src/bridge/bridgeEnabled.ts` |
| Channels in print mode | Build-Excluded | `src/cli/print.ts` |

## Engineering Interpretation
- Current product is operational for primary usage: interactive coding and non-interactive `--print`.
- `/fork`, `/workflows`, `/summary`, and `/share` are now part of the supported product baseline and are covered by dedicated non-live smoke checks.
- Excluded/stub commands are not a runtime defect; they are deliberate build-scope or placeholder surfaces.
- For roadmap prioritization, treat these categories differently:
  - `Build-Excluded`: requires feature delivery, not a simple toggle.
  - `Stub`: requires net-new implementation.
  - `Hidden-Internal`: selectively expose only when user-facing value is real and stable.
