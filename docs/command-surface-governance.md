# Command Surface Governance

Last updated: 2026-04-11

## Purpose

Define explicit policy for command visibility and status to prevent drift between docs, UX, and runtime behavior.

## Baseline Commands

These are primary user workflows and must remain discoverable and production-meaningful.

- `/fork`
- `/workflows`
- `/summary`
- `/share`

## Implemented but Non-Baseline

These commands are callable but are not core product workflows.

- `/assistant`
- `/heapdump`
- `/output-style`
- `/thinkback-play`
- `/rate-limit-options`

Policy:
- Keep behavior stable.
- Do not claim full product parity.
- Promotion to baseline requires smoke coverage and user-value justification.

## Build-Excluded Commands

These commands are intentionally not available in this build and must remain hidden.

- `/proactive`
- `/peers`
- `/agents-platform`
- `/remoteControlServer`
- `/torch`
- `/force-snip`
- `/subscribe-pr`

Policy:
- `isHidden` must remain `true`.
- Runtime call must throw a stable `not available in this build` message with a stable `E_BUILD_EXCLUDED_*` error ID.

## Stub Commands

Commands with `isEnabled: () => false` remain placeholders until implementation.

Policy:
- Keep out of baseline docs.
- Track implementation status in `FEATURE_AVAILABILITY_MATRIX.md` and `docs/feature-gap-audit.md`.

## Promotion Checklist

Before moving any command to baseline:

1. Implement runtime semantics end-to-end.
2. Add smoke checks for discoverability and execution boundaries.
3. Update `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, and this governance doc in the same change.
4. Ensure `bun run check:docs` and `bun run smoke:features` pass.
