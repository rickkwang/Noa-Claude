# CLAUDE.md

**Noa Claude** — a local-first, multi-provider coding agent (React/Ink TUI + non-interactive `--print`), reconstructed from publicly exposed Claude Code source. Toolchain is **Bun**, not npm/node. Privacy defaults are hardcoded.

## Commands

Non-obvious requirements:
- `verify:ports` / `verify:harness` are manual and skip without an upstream binary; `verify:harness` also needs `compile`.
- `e2e:background` and `e2e:startup` need tmux; `e2e:install` needs network (`bun install`); `e2e:sandbox` skips where sandboxing is unsupported.
- `lint` = typecheck + docs check (no eslint). `compile` → `dist/cli`; `build` is baseline features only.

## Testing

- Verify behavior with E2E tests, not new unit tests: unit tests here tend to restate implementation, and E2E runs catch real regressions. End each E2E run with a reproducible artifact: exact command, revision, inputs, observed output, exit status.
- Exception: a system that can only be tested in isolation — first list every way it could fail, then write the test.
- Keep an existing isolated test only if it catches a concrete bug E2E misses; delete ones that restate implementation or duplicate E2E coverage.

Tests are self-contained (no preload). Assemble credential-shaped fixtures at runtime (`['xoxb', '123…', 'abc…'].join('-')`): GitHub push protection rejects pushes whose history contains a literal that matches a real token format, even an obviously fake one.

**`typecheck` proves little**: ~85% of non-test source carries `@ts-nocheck`, so green `tsc` covers ~15%. The agent loop is checked — `query.ts`, `QueryEngine.ts`, `tools.ts`, `services/tools/`, `utils/permissions/permissions.ts`, `services/compact/compact.ts` — against the `Message` union in `types/message.ts`. Prefer E2E evidence. `check:nocheck`'s baseline may only shrink; after removing a `@ts-nocheck`, run `node scripts/check-nocheck-ratchet.mjs --update`.

**Production bundles are minified**: mangled stack traces / `constructor.name` in `dist/main.js` are expected (`utils/errors.ts` and `classifyToolError` handle them); use `dev`/`build:dev` for real names. Production defines `NODE_ENV=production`, so `NODE_ENV === 'test'` branches and test hooks exist only from source.

**Only the compiled binary is code-split**: `compile` splits per `import()` so fast paths load only the bootstrap chunk (`dist/cli --version` ~10ms vs ~75ms). Every static import in `main.tsx` loads on every launch; dynamic ones don't.

## Feature flags — read before editing gated code

`feature('FLAG')` from `bun:bundle` is not a runtime module: `build.ts` rewrites `src/**.ts(x)` in place before bundling, replacing each call with a `true`/`false` literal for DCE (restored in a `finally`).

- Keep `feature('X')` an inline literal call — never alias, wrap, or compute the name.
- Baseline enables `build.ts`'s `defaultFeatures` (`AUTO_THEME`, `BUILTIN_EXPLORE_PLAN_AGENTS`, `AUTO_MODE`); `--feature-set=dev-full` adds `fullExperimentalFeatures`; unknown flags → `false`.
- Some flags gate modules absent from this fork. A green `build:dev:full` only proves the bundle resolves — placeholder modules must still export every name their call sites read, or the binary dies at startup/first turn; CI runs `e2e-agent-loop.mjs --entry dist/main-dev.js` on the full bundle for this. `COORDINATOR_MODE` is in neither list; its inert branches in resume/session paths are intentional. `FEATURES.md` is the authoritative audit.

## Prompt cache keys

Lean vs verbose prompt details live in `src/constants/CLAUDE.md`. Anything whose text depends on that gate must vary its cache key: `toolToAPISchema()` (`src/utils/api.ts`) and `resolveSystemPromptSections()` (`src/constants/systemPromptSections.ts`) memoize per session, so suffix with `:L` as upstream does, or a mid-session `/model` switch serves the wrong tier.

## Architecture

- `run-noa.js` — validates `launcher-config.js`, lockfile-guarded auto-rebuild of `dist/main.js` when source is newer (`CLAUDE_CODE_LAUNCHER_AUTO_REBUILD`), then imports it. It, `bin/noa.js`, `launcher-config.js`, and `build.ts` are plain JS run by Bun and must work with `dist/` stale or missing.
- `src/entrypoints/cli.tsx` — `bootstrapCli()` (exported as `main`): fast paths (`--version`, MCP subservers, bridge/daemon), then lazy-imports `main.tsx`. Keep its imports dynamic (`check:runtime` asserts `--version` never evaluates `main.tsx`). The appended bootstrap calls `bootstrapCli()` as a bare identifier, so the name must stay unique in bundle scope.
- `dev:source` uses the same bootstrap so early flags like `--bare` apply before tool modules load.
- Subsystems and directory map: see README.

## Multi-provider routing

Provider wiring and its gotchas live in `src/services/api/CLAUDE.md` (loaded when working there).

## Command-surface governance

Don't claim command parity beyond `docs/product-governance.md`, which is authoritative. For product-surface changes, use the `product-surface` skill.

## Conventions

- Config lives in `~/.noa/` and project `.noa/` (e.g. `.noa/progress.md`). Resolve the user dir with `getClaudeConfigHomeDir()` (`src/utils/envUtils.ts`, honors `CLAUDE_CONFIG_DIR`), never a hardcoded `~/.noa`. Toggles prefer `NOA_CLAUDE_*`; legacy `CLAUDE_CODE_*` still accepted.
- Privacy is hardcoded: telemetry, GrowthBook remote fetch, and remote policy/settings overlays are disabled; GB gates use in-code defaults. Don't reintroduce remote-fetch or telemetry sinks.
- `Text` from `src/ink.ts` is `ThemedText`: `color` accepts raw values, but `backgroundColor` only resolves theme keys, so a raw hex background is silently dropped (typecheck won't catch it). Use `BaseText` for raw background colors.
- Commit messages must not describe work as an upstream port; history stays as-is.
- `CLAUDE.md` is tracked; durable rules go here.
- Skill hook cleanup and success callbacks use registration identity, not command equality. Budgets are cumulative per source and session (1,024 hooks / 16,384 matcher characters), including hooks already consumed by `once`. When plugin-only hook policy excludes a skill's hooks, its `allowed-tools` must also be excluded, including inline shell expansion and fork execution.
- Agent skill hooks must register and clean up through `setAppStateForTasks ?? setAppState`; background agents' `setAppState` may be a no-op. Agent exit always clears session hooks, including hooks registered by skills during the run.
- Transcript tombstones may truncate the last entry directly; removing earlier entries must preserve the original file on write failure. Finish pending appends before replacing a transcript. Tail entries remain removable above the full-rewrite size limit using bounded buffers.
- Stability invariants: interactive startup stays alive, `--print` works, resume/continue survive compaction, MCP startup degrades gracefully, permission boundaries hold. Failure-mode checklist: `docs/operating-guide.md`.
