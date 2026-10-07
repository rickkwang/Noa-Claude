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

### Implemented but Non-Baseline

These commands are callable, but they are not core product workflows:

- `/cleanup-data`
- `/clean-sessions`
- `/output-style`
- `/rate-limit-options`
- `/provider`
- `/rewind`
- `/goal`
- `/reload-skills`
- `/pause-memory`
- `/background`

Policy:

- keep behavior stable
- do not claim full product parity
- promotion to baseline requires smoke coverage and user-value justification
- `/output-style` is a direct entry to the picker that `/config` hosts; both write `outputStyle` to local settings, so the two entry points must stay interchangeable
- `/background` (alias `/bg`), ← on an empty prompt, `noa agents`, `noa --bg`, `noa reply` and `noa attach|logs|stop|kill|respawn|rm` are one surface: background sessions run in detached PTY hosts with no daemon. `scripts/e2e-background.mjs` covers compiled terminal replies, permission dialogs and Fleet controls with a scripted local API; `scripts/e2e-agents-view.mjs` covers the broader live workflow (needs tmux and a working model). Not covered: prewarmed spares, groups/pins, cloud sessions, and carrying running shells/subagents into the fork (the move asks first and stops them). Background sessions are isolated like upstream: Edit/Write/NotebookEdit into the shared checkout is rejected until the session calls EnterWorktree — `worktree.bgIsolation: "none"` (or `NOA_CLAUDE_BG_ISOLATION=none` / `CLAUDE_BG_ISOLATION=none`) works in place

Tracked surfaces:

- `/cleanup-data`
- `/clean-sessions`
- `/output-style`
- `/rate-limit-options`
- `/provider`
- `/rewind`
- `/goal`
- `/reload-skills`
- `/pause-memory`
- `/background`

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

- Treat `/fork` as the supported product baseline.
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

## Release Checklist

Before tagging a release:

1. Bump `version` in `package.json` and add the `docs/release-notes.md` entry.
2. Update the install URL in `README.md` to the new tag — it is pinned (e.g. `.../Noa-Claude/v1.10.0/install.sh`), not a moving `master` ref. The installer itself resolves the newest **published GitHub Release** at runtime (semver max over strict release tags — not the tags list, which also carries imported upstream Claude Code refs like `v2.1.x` that were never Noa releases; overridable via `NOA_INSTALL_REF` / `NOA_INSTALL_REPO_TARBALL_URL`), so both fresh installs and `noa update` land on released snapshots rather than arbitrary `master` commits.
3. Bump `FALLBACK_REF` in `install.sh` to the new tag — it is the offline/rate-limited default when the GitHub API is unreachable. `src/test/installScript.test.ts` reads this value from the script, so no test edit is needed.
4. Commit the release changes, create the tag, and verify `git show <tag>:install.sh` resolves.
5. Publish the GitHub Release for that existing tag — an unpublished tag is invisible to the installer, which reads `/releases`, not `/tags`.
