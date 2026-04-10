# 0001 Harness Productization Baseline

## Status

Accepted

## Context

The repository had already become usable as a local coding agent, but the
knowledge needed to operate and extend it was spread across source files, chat
history, and ad hoc verification habits.

That made the product harder to maintain than it needed to be. The risk was not
missing core features. The risk was drift:

- drift between README and actual capability
- drift between runtime behavior and verification expectations
- drift between long-running session behavior and recovery assumptions

## Decision

Treat the harness itself as a product surface.

This baseline introduces these rules:

- keep harness priorities documented in repository-local docs
- keep focused product docs under `docs/`
- keep a machine-checkable docs consistency gate
- treat `/status`, `/doctor`, `/compact`, `--resume`, and smoke scripts as
  first-class harness components

## Alternatives Rejected

### Rely on one large top-level document

Rejected because it becomes stale quickly and is hard for both users and agents
to navigate.

### Keep decisions in chat history only

Rejected because it does not survive long-term maintenance or agent handoff.

### Expand product surface before tightening harness

Rejected because the main risk at this stage is maintainability, not missing
surface area.

## Consequences

Future product work should prefer:

- adding a doc when behavior is easy to forget
- adding a smoke when a behavior can regress
- adding a diagnostic when a failure is opaque

Feature expansion is still allowed, but harness clarity and verification take
priority over adding more commands.
