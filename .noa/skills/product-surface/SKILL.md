---
name: product-surface
description: Use when adding, removing, or re-bucketing Noa Claude commands, features, or docs surface. Runs check:docs and smoke:features and keeps README.md, FEATURE_AVAILABILITY_MATRIX.md, and docs/product-governance.md in sync.
---

# Product surface

`docs/product-governance.md` is authoritative; don't claim false parity. Buckets:
- **Product-Available / baseline** (`/fork`) — supported, smoke-covered.
- **Non-baseline** — callable and stable but not core; promote only with smoke coverage.
- **Build-excluded** (`/proactive`, `/peers`, `/remote-control`, `/force-snip`, `/subscribe-pr`) — deliberately unregistered; stable `E_BUILD_EXCLUDED_*` IDs in `src/commands/buildExcluded.ts`.
- **Stub** — placeholders, kept out of runtime and baseline docs.

When changing product surface, run `check:docs` + `smoke:features` and keep `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, `docs/product-governance.md` in sync.
