# Product Governance

Last updated: 2026-04-11

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
- `/workflows`
- `/summary`
- `/share`

### Implemented but Non-Baseline

These commands are callable, but they are not core product workflows:

- `/assistant`
- `/cleanup-data`
- `/heapdump`
- `/output-style`
- `/thinkback-play`
- `/rate-limit-options`

Policy:

- keep behavior stable
- do not claim full product parity
- promotion to baseline requires smoke coverage and user-value justification
- `/output-style` is a deprecated shim only and is not eligible for baseline promotion unless replaced by a supported configuration workflow

Tracked surfaces:

- `/assistant`
- `/cleanup-data`
- `/heapdump`
- `/output-style`
- `/thinkback-play`
- `/rate-limit-options`

### Build-Excluded

These commands are intentionally not available in this build and must remain hidden:

- `/proactive`
- `/peers`
- `/agents-platform`
- `/remote-control`
- `/torch`
- `/force-snip`
- `/subscribe-pr`

Policy:

- `isHidden` must remain `true`
- runtime call must throw a stable `not available in this build` message with a stable `E_BUILD_EXCLUDED_*` error ID
- `/remote-control` here refers to the slash command surface; bridge/remote runtime code may exist but must remain unavailable in this build

Tracked surfaces:

- `/proactive`
- `/peers`
- `/agents-platform`
- `/remote-control`
- `/torch`
- `/force-snip`
- `/subscribe-pr`

### Stub

Commands with `isEnabled: () => false` remain placeholders until implementation.

Policy:

- keep out of baseline docs
- track implementation status in `FEATURE_AVAILABILITY_MATRIX.md`

Tracked surfaces:

- `/onboarding`
- `/autofix-pr`
- `/bughunter`
- `/break-cache`
- `/ctx_viz`
- `/oauth-refresh`
- `/debug-tool-call`
- `/perf-issue`
- `/teleport`
- `/good-claude`
- `/mock-limits`
- `/backfill-sessions`
- `/reset-limits`
- `/env`
- `/issue`
- `/ant-trace`

## Feature Gaps

The current gap inventory is split into three buckets:

- directly activatable but non-baseline
- build-excluded
- stubbed

The authoritative table lives in [feature-gap-audit.md](./feature-gap-audit.md).

The compatibility layer for previous doc links is retained in the small pointer files for:

- `docs/command-surface-governance.md`
- `docs/feature-gap-audit.md`
- `docs/optimization-roadmap.md`
- `docs/runtime-health.md`
- `docs/session-continuity.md`
- `docs/worktrees.md`
- `docs/agents.md`
- `docs/progress-artifacts.md`

## Roadmap

The implementation roadmap is in [optimization-roadmap.md](./optimization-roadmap.md).

The compatibility layer for previous roadmap links is retained in the small pointer file at `docs/optimization-roadmap.md`.

## Promotion Checklist

Before moving any command to baseline:

1. Implement runtime semantics end-to-end.
2. Add smoke checks for discoverability and execution boundaries.
3. Update `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, and this document in the same change.
4. Ensure `bun run check:docs` and `bun run smoke:features` pass.
