# Structural Reorg Contract (No Core Behavior Change)

Date: 2026-04-23
Status: Accepted

## Scope
This reorganization is structural only. Core execution semantics must remain unchanged while the codebase is reorganized into clearer orchestration and runtime layers.

## Non-Negotiable Behavior Contracts
The following behaviors are treated as immutable during this migration:

1. CLI argument semantics
- Same command names, flags, defaults, and precedence.
- Existing command registration order remains unchanged.

2. Permission semantics
- Permission mode resolution, bypass/auto behavior, and prompts remain unchanged.
- Existing allow/deny flows and tool gating behavior remain unchanged.

3. Session restore semantics
- Resume selection, stale-session confirmation, and restore path behavior remain unchanged.
- Existing restore side effects and ordering remain unchanged.

4. Tool invocation semantics
- Tool selection, execution ordering, and event/hook sequencing remain unchanged.
- Existing remote/direct/ssh turn submission behavior remains unchanged.

## New Structural Layout
The following layer skeleton is introduced:

- `src/entrypoints/bootstrap`
- `src/entrypoints/modes`
- `src/services/resources`
- `src/services/extensions`
- `src/services/runtime`

Intent:
- `entrypoints/bootstrap`: CLI program assembly/orchestration.
- `entrypoints/modes`: mode selection and dependency injection.
- `services/resources`: discovery/loading normalization for skills/plugins/output styles.
- `services/extensions`: hook/command registration and de-registration registry.
- `services/runtime`: mode-runtime decision helpers.

## Compatibility Strategy
A compatibility-first migration is used:

1. Legacy paths stay callable during migration.
2. New modules are introduced as wrappers/adapters first.
3. Old paths forward to new layers where moved.

Compatibility retention target:
- Keep compatibility shims for 2 released versions.
- Deprecation notice starts immediately in docs.
- Removal is planned for version N+2 in a separate cleanup plan.

## Soft Boundary Gate
A soft architecture gate is added via `scripts/check-architecture-boundaries.mjs` and CI reporting.

- It warns on cross-layer imports that violate target boundaries.
- It does not block merge/release in this phase.
- A strict mode (`--strict`) is available for later hard-gating.

## Exit Criteria For This Phase
1. Bootstrap orchestration extracted into dedicated modules.
2. Mode boundary helpers introduced and wired.
3. Resources and extensions single-point adapters introduced.
4. CI emits architecture boundary warnings (soft gate only).
5. No CLI-visible behavior regressions in typecheck/build/runtime/smoke checks.
