# Optimization Roadmap

Last updated: 2026-04-11

## Goal

Raise this repo from "usable derivative" to "auditable, predictable productized fork" by improving correctness signals, narrowing UX ambiguity, and reducing divergence drift.

## Phase 1: Truth and Guardrails (in progress)

1. Unify status language across docs and code.
2. Add consistency checks to fail CI/local checks when docs overstate capability.
3. Keep a single source of truth for command-surface status.

Success criteria:
- No contradictory status terms across `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, and `docs/feature-gap-audit.md`.
- `bun run check:docs` fails on inconsistent matrix section labels.

## Phase 2: User-Visible Baseline Hardening

1. Validate and harden primary chains: interactive REPL, `--print`, `/fork`, `/workflows`, `/summary`, `/share`.
2. Add smoke coverage for command discoverability and non-interactive behavior boundaries.
3. Ensure degraded dependencies (MCP timeout, missing auth, feature gates) always produce explicit user-facing reason codes.

Success criteria:
- Reproducible smoke pass for baseline chains.
- No silent behavior changes on auth/provider mismatch.

## Phase 3: Non-Baseline Surface Governance

1. For "implemented but non-baseline" commands, enforce one of two UX paths:
   - Explicitly visible and documented purpose.
   - Internal-only with deterministic hide policy.
2. For stubs/build-excluded surfaces, standardize failure messages and tracking metadata.
3. Track promotion candidates with acceptance checks (tests + docs + support note).

Success criteria:
- Every non-baseline command has explicit ownership and policy.
- Stub/build-excluded inventory remains current and machine-checkable.

## Phase 4: Capability Expansion (Selective)

1. Promote the highest-value excluded/stub surface only when chain-level prerequisites exist.
2. Deliver one feature at a time with: command implementation, runtime guardrails, smoke coverage, and docs.
3. Avoid bulk "unlock" without functional parity.

Success criteria:
- Each promoted command has production semantics, not just visibility.
- Feature matrix changes are paired with implementation and checks in the same PR.

## Working Rules

1. Never mark command surface as `Available` unless it is callable and user-meaningful in current build.
2. Visibility changes are not considered capability delivery.
3. Any matrix edit must pass `bun run check:docs` and corresponding smoke checks.
