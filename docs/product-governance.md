# Product Governance

Last updated: 2026-08-07

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
- `/clean-sessions`
- `/heapdump`
- `/output-style`
- `/thinkback-play`
- `/rate-limit-options`
- `/cache-probe`
- `/wiki`
- `/provider`

Policy:

- keep behavior stable
- do not claim full product parity
- promotion to baseline requires smoke coverage and user-value justification
- `/output-style` is a deprecated shim only and is not eligible for baseline promotion unless replaced by a supported configuration workflow

Tracked surfaces:

- `/assistant`
- `/cleanup-data`
- `/clean-sessions`
- `/heapdump`
- `/output-style`
- `/thinkback-play`
- `/rate-limit-options`
- `/cache-probe`
- `/wiki`
- `/provider`

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

## Roadmap

The implementation roadmap is in this document.

## Maintenance Freeze

The current freeze policy lives in [maintenance-freeze-plan.md](./maintenance-freeze-plan.md).

Use it as the default freeze-period decision framework for bug fixes, stability work, validation changes, and any proposed product-surface expansion. This page remains the command-surface boundary; the maintenance plan defines what changes are allowed during freeze.

## Operating Principles

- Treat `/fork`, `/workflows`, `/summary`, and `/share` as the supported product baseline.
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
