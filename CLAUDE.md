# CLAUDE.md

**Noa Claude** — a local-first, multi-provider coding agent (React/Ink TUI + non-interactive `--print`), reconstructed from publicly exposed Claude Code source. Toolchain is **Bun**, not npm/node. Privacy defaults are hardcoded.

## Commands

- `verify:ports` / `verify:harness` are manual and skip without an upstream binary; `verify:harness` also needs `compile`.
- `e2e:background` / `e2e:startup` need tmux; `e2e:install` needs network; `e2e:sandbox` skips where sandboxing is unsupported.
- `build` is baseline features only.

## Testing

- Verify behavior with E2E tests, not new unit tests (unit tests here tend to restate implementation). End each E2E run with a reproducible artifact: exact command, revision, inputs, observed output, exit status.
- Probe and E2E sessions that exercise harness behavior (tool calls, subagents, Monitor, compaction) run with `--model claude-haiku-5-5`; use a larger model only when the probe tests that model's own behavior.
- Exception: a system testable only in isolation — first list every way it could fail, then write the test.
- Assemble credential-shaped fixtures at runtime (`['xoxb', '123…', 'abc…'].join('-')`): GitHub push protection rejects any history containing a real-token-shaped literal, even an obviously fake one.

**`typecheck` proves little**: ~85% of non-test source carries `@ts-nocheck`. Checked: `query.ts`, `QueryEngine.ts`, `tools.ts`, `services/tools/`, `utils/permissions/permissions.ts`, `services/compact/compact.ts`, against the `Message` union in `types/message.ts`. The `check:nocheck` baseline may only shrink; after removing a `@ts-nocheck`, run `node scripts/check-nocheck-ratchet.mjs --update`.

**Production bundles are minified**: mangled stack traces / `constructor.name` in `dist/main.js` are expected (`src/utils/errors.ts` and `classifyToolError` handle them); use `dev`/`build:dev` for real names. Production defines `NODE_ENV=production`, so `NODE_ENV === 'test'` branches and test hooks exist only from source.

Dead-code checks on `src/` exports must also scan `scripts/` and `bin/`: `scripts/check-runtime-health.mjs` imports `_*ForTesting` exports that only it uses, and deleting one breaks only `bun run check:runtime` (not `bun test` or `typecheck`).

## Where the rest lives

Path-scoped rules in `.claude/rules/` (symlinked as `.noa/rules/`) load automatically when you touch matching files; tools that don't load them should read the matching file first:

- Code gated by `feature('…')` → `docs/feature-flags.md`
- Startup, `main.tsx`, `run-noa.js`/`build.ts`/launcher → `startup.md`
- Prompt text or `toolToAPISchema` → `prompt-cache.md` (lean vs verbose: `src/constants/CLAUDE.md`)
- Provider routing → `src/services/api/CLAUDE.md`; preserved thinking → `preserved-thinking.md`
- Skill hooks, task status, transcripts, Ink `Text` → `skill-hooks.md`, `task-status.md`, `transcripts.md`, `ink-text.md`
- Writing or deleting tests (preload, isolated tests) → `testing.md`; editing CI workflows → `ci.md`
- Verifying the model-capability tables against the upstream binary → `docs/upstream-binary.md`

## Conventions

- Config lives in `~/.noa/` and project `.noa/`. Resolve the user dir with `getClaudeConfigHomeDir()` (`src/utils/envUtils.ts`, honors `CLAUDE_CONFIG_DIR`), never a hardcoded `~/.noa`. Toggles prefer `NOA_CLAUDE_*`; legacy `CLAUDE_CODE_*` still accepted.
- Privacy is hardcoded: telemetry, GrowthBook remote fetch, and remote policy/settings overlays are disabled; GB gates use in-code defaults. Don't reintroduce remote-fetch or telemetry sinks.
- Command surface: don't claim parity beyond `docs/product-governance.md` (authoritative). For product-surface changes, follow `.noa/skills/product-surface/SKILL.md`.
- Stability invariants: interactive startup stays alive, `--print` works, resume/continue survive compaction, MCP startup degrades gracefully, permission boundaries hold. Failure-mode checklist: `docs/operating-guide.md`.
- Code comments are in English, no Chinese comments; string literals used as examples (e.g. multilingual test cases) may stay in their original language. Talking to the user can still be in Chinese.
- Comments and identifiers don't name the app a design or asset was borrowed from (e.g. "as Codex does", "from the Codex bundle", bundled names like OXr/F3); write the intent and values only ("16px folder in the label's color", `glyphs.ts` not `codexIcons.ts`). Protocol syntax such as `codex-file-citation` is not a comment; keep it. Keep icons already taken from Codex rather than replacing them.

## Commit and push

- Commit messages must not describe work as an upstream port.
- Only run `git commit` when the user explicitly says "commit" in the current request. After making changes, stop uncommitted, report, and wait; earlier authorization does not carry over.
- Commit directly on the current `master`; don't create feature branches (single-person repo, all history is on master).
- Don't push unless the user asks.
- The working tree often has concurrent changes from other sessions, which may even commit first. Before pushing, verify that `git log origin/master..HEAD` contains only the commits the user authorized for this push.
- Chain commit and push with `&&`: if the commit fails (e.g. nothing to commit), stop and ask; don't continue to push.
- Before committing, check `git status` for an unexpected ahead state and whether the target files still have a diff; report anything unusual first.

**Why:** three incidents: the user once said "commit first" and I applied it to later tasks, and the user said not to commit without being asked; the user said no branch was needed and I created one anyway; another session had already committed the pending test files together with unreviewed changes as ecbda55a, my commit failed, yet the push still ran and pushed that whole commit to the remote.

Since 2026-11-03 a GitHub ruleset ("master requires ci-ok", id 26493676) requires the `ci-ok` aggregate job of PR Quality Gate on master. Repository admins bypass it, so direct pushes to master still work and print "Bypassed rule violations ... ci-ok". That bypass skips the gate: say so before pushing to master, and after pushing, check the ci-ok result on that commit instead of reporting the push as CI-green.

**Why:** heavy jobs skip on docs-only changes and skipped matrix jobs report under an unexpanded name, so only `ci-ok` can be the required check; per-job required checks would hang PRs.
