# Feature Availability Matrix

Last updated: 2026-05-27

## Scope
- This matrix reflects the current repository build/runtime behavior.
- Status definitions:
  - `Baseline`: primary user-facing supported workflow.
  - `Implemented but Non-Baseline`: callable, but not part of primary workflow.
  - `Build-Excluded`: not registered in the runtime command loader; an `E_BUILD_EXCLUDED_*` contract is retained for governance and CI assertions.
  - `Stub`: placeholder tracked in governance only; not registered in runtime and has no functional implementation.
- Default `bun run build` profile in this repo is conservative; expanded unlock profile is opt-in via `bun run build:dev:full`.
- Experimental unlockability details are maintained in [FEATURES.md](./FEATURES.md).

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
| MiniMax Anthropic-compatible backend | Available | Default product path and launcher checks in place. |
| Official Claude OAuth fallback on 3P path | Disabled by policy | Missing/invalid 3P token fails clearly; no OAuth fallback. |

## Slash Commands: Implemented but Non-Baseline
| Command | Status | Notes |
|---|---|---|
| `/assistant` | Available | Assistant preference/status command implemented; full assistant runtime remains gated by build/runtime capabilities. |
| `/cleanup-data` | Available | Unified cleanup command for local tracking data; requires `--confirm` to execute deletions. |
| `/heapdump` | Available | Exposed for engineering diagnostics. |
| `/output-style` | Available | Deprecated shim only; compatibility prompt to `/config`, not promotable to baseline unless replaced by a supported configuration workflow. |
| `/thinkback-play` | Available | Thinkback helper; still gated by runtime feature availability. |
| `/rate-limit-options` | Available | Rate-limit action sheet; still gated by subscriber/runtime availability. |
| `/cache-probe` | Available | Probe API cache hit rate by sending identical requests and comparing `cached_tokens` values. |
| `/wiki` | Available | Project documentation management via `init`, `status`, `ingest` subcommands. |
| `/provider` | Available | Manage named provider configurations (create, list, switch, delete profiles). |

## Slash Commands: Product-Available
| Command | Status | Notes |
|---|---|---|
| `/fork` | Available | Creates a resumable fork of the current conversation. |
| `/workflows` | Available | Supports local `list/create/run/delete` and project workflow discovery. |
| `/summary` | Available | Produces structured short or detailed session summaries. |
| `/share` | Available | Exports local session share snapshots under `.noa/shares`. |

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
  - `Implemented but Non-Baseline`: implemented and callable, but not a primary user workflow.
