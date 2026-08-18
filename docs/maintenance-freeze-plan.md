# Maintenance Freeze Plan

Last updated: 2026-04-18

## Status

Noa Claude is in feature freeze.

The core coding-agent runtime is considered stable enough for maintenance mode.
The project should now prioritize correctness, reliability, verification, and
documentation alignment over new feature surface area.

## Goals

- Keep baseline workflows stable.
- Reduce regression risk in startup, tool execution, resume, compact, MCP, and provider paths.
- Preserve the current product boundary between baseline, non-baseline, build-excluded, and stubbed surfaces.
- Avoid adding new user-facing command surface unless explicitly unfrozen.

## Allowed Changes

- Bug fixes for shipped baseline behavior.
- Stability fixes for startup, `--print`, resume/continue, compact, tool execution, MCP, bridge/session plumbing, and provider routing.
- Verification improvements, including smoke checks, runtime health checks, and live provider validation.
- Documentation updates that clarify existing behavior or freeze policy.
- Security, privacy, or data-safety fixes.
- Small refactors only when they directly reduce risk for a bug fix or validation gap.

## Not Allowed During Freeze

- New baseline commands.
- Promotion of non-baseline commands to baseline without an explicit unfreeze decision.
- New provider modes or runtime surfaces unless needed to fix a shipped path.
- Broad refactors that do not close a concrete bug, test gap, or operational risk.
- Re-expansion of build-excluded surfaces into default availability.

## Priority Order

1. Regressions in baseline workflows: `/fork`, `/workflows`, `/summary`, `/share`.
2. Runtime correctness: startup, `--print`, resume/continue, compact, and tool execution.
3. Provider reliability: configured endpoint behavior, live smoke failures, request/response compatibility.
4. Operational degradation: MCP timeouts, slow startup, stuck tasks, failed recovery.
5. Documentation drift: governance, operating guide, README, feature matrix.

## Required Checks

Run these for every maintenance change:

```bash
bun run typecheck
bun run check:docs
bun run check:runtime
bun run smoke:features
```

Run these when touching runtime startup, provider behavior, command execution, or release-critical paths:

```bash
bun run build
bun run smoke:engine
```

Run this before a release candidate when provider credentials are available:

```bash
bun run smoke:engine:live
```

`smoke:engine:live` requires `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` and may use `ANTHROPIC_BASE_URL`
for non-default provider endpoints.

## Triage Rules

- If a bug affects baseline behavior, fix it before any non-baseline work.
- If a failure only affects stubbed or build-excluded surface, keep it out of the release path unless it leaks into visible behavior.
- If a test is flaky, either stabilize it or document the concrete external dependency that makes it non-deterministic.
- If live smoke fails, classify it as provider configuration, network/auth, or runtime compatibility before changing code.

## Unfreeze Criteria

Only unfreeze for a specific scoped change when all of these are true:

- There is a written reason to expand product surface area.
- The new behavior has an owner and validation path.
- `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, and `docs/product-governance.md` are updated in the same change.
- Dedicated smoke coverage exists for the promoted surface.

## Review Checklist

- Does this change preserve the current baseline boundary?
- Does it improve reliability, correctness, security, verification, or documentation?
- Are affected failure modes covered by existing or new checks?
- Is live provider validation required before release?
- Is the change small enough to review without re-opening broad product design?
