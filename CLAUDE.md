# CLAUDE.md

**Noa Claude** — a local-first, multi-provider coding agent (React/Ink TUI + non-interactive `--print`), reconstructed from publicly exposed Claude Code source. Toolchain is **Bun**, not npm/node. Privacy defaults are hardcoded.

## Commands

```bash
bun run dev               # build dev bundle → run dist/main-dev.js
bun run dev:source        # run from source via dev-launcher.js (no bundle step)
bun run build             # production bundle → dist/main.js (baseline features)
bun run build:dev:full    # dev build + full experimental feature set unlocked
bun run compile           # standalone binary → dist/cli (`compile:dev` for the dev variant)
bun test                  # all tests; `bun test <path>` for one file
bun run typecheck         # tsc --noEmit
bun run lint              # = check:quality = typecheck + check:docs (no eslint)
bun run check:nocheck     # @ts-nocheck ratchet vs. scripts/nocheck-ratchet.baseline.json
bun run check:runtime     # runtime health check
bun run smoke:features    # command/governance surface smoke
bun run smoke:engine      # engine smoke (no live API); `:live` needs ANTHROPIC_API_KEY
bun run e2e:loop          # compiled CLI loop/transport E2E against a local scripted API
bun run smoke:perf        # startup/perf smoke
bun run verify:ports      # byte-diff pinned prompt ports vs. an upstream binary (manual; skips without one)
bun run scan:pr-intent    # fail PR diffs with suspicious links/downloads
```

## Testing

- After writing code, never write unit tests.
- Strongly prefer E2E tests as the sole testing mechanism. Use them to verify that complex features work. At the end of an E2E run, generate a verifiable, reproducible artifact with the exact command, revision and inputs, observed output, and exit status.
- If a system must be tested in isolation, first write down every way it could fail, then write code.
- Keep an existing isolated test only when it can catch a concrete bug that the E2E tests miss. Delete tests that only restate implementation or duplicate E2E coverage.

Existing tests live in `src/test/` mirroring `src/`; self-contained (no preload).

**`typecheck` proves less than it looks like**: `tsconfig.json` excludes only `node_modules`/`dist`/`.bun`, but ~88% of non-test source files carry `@ts-nocheck` (`QueryEngine.ts`, `utils/envUtils.ts`, …), so a green `tsc --noEmit` covers the other ~12%. Prefer E2E evidence for behavior. `check:nocheck` holds a path-list baseline that may only shrink — after removing a `@ts-nocheck`, tighten it with `node scripts/check-nocheck-ratchet.mjs --update`.

**Production bundles are minified, dev bundles are not**: `bun run build` adds an identifier-minifying pass over `dist/main.js` (roughly halves the bundle; JSC pre-parse scales with bytes, so every launch is faster). Mangled stack traces and `constructor.name` from `dist/main.js` are expected, not a broken build — `utils/errors.ts` and `classifyToolError` already handle it. Use `bun run dev` / `build:dev` when you need real names.

## Feature flags — read before editing gated code

Source calls `feature('FLAG')` from `bun:bundle`, which **is not a real runtime module** — `build.ts` rewrites every `src/**.ts(x)` *in place* before bundling, stripping the import and replacing each call with a `true`/`false` literal (restored in a `finally`), enabling dead-code elimination.

- Keep `feature('X')` an **inline literal call** — never alias, wrap, or compute the flag name, or the regex/DCE breaks.
- Baseline build enables only `build.ts`'s `defaultFeatures` — `AUTO_THEME`, `BUILTIN_EXPLORE_PLAN_AGENTS`, `AUTO_MODE`; `--feature-set=dev-full` adds `fullExperimentalFeatures`; unknown flags → `false`.
- Some flags gate **modules absent from this fork** — enabling them breaks the build (`build:dev:full` is the canary). `COORDINATOR_MODE` is in neither list, so its call sites are intentionally inert branches woven through resume/session hot paths; don't "fix" them. `FEATURES.md` is the authoritative audit.

## Lean vs verbose prompt — the second load-bearing gate

`shouldUseCompactSystemPrompt(model)` in `src/constants/systemPromptCompact.ts` decides whether a model gets the compact prompt head + short tool descriptions, or the long ones. Newer generations internalize the long text during training; older ones still need it.

- Most text under the lean branch is a **verbatim port** from the upstream Claude Code binary (2.1.220 baseline, later sections through 2.1.258), not text authored here. `verify:ports` diffs against a real binary. If ported text changes, re-verify it against upstream.
- Intentional deviations are commented at their definition (`.noa/agents/*.md`, opt-in background agents, opt-out fork, inlined agent list, Noa identity line). Don't "fix" them toward upstream wording.
- **Anything whose text depends on the gate must vary its cache key with it.** `toolToAPISchema()` (`src/utils/api.ts`) and `resolveSystemPromptSections()` (`src/constants/systemPromptSections.ts`) memoize per session, so a mid-session `/model` switch would otherwise serve the previous tier's bytes. Suffix with `:L`, as upstream does.
- Only `firstParty` is a trusted model identity. Customer-run Bedrock/Vertex/Foundry and Anthropic-compatible third parties keep the verbose prompt (and other first-party-only relaxations, e.g. `NOA_CLAUDE_WRITE_REQUIRE_READ`), because a configured model id — inference profile, custom ARN, cross-region alias, proxy — proves nothing about the model behind it. `lean_prompt` in `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES` is the deliberate opt-in.
- `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1|0` forces either mode without a rebuild — use it to bisect a suspected lean-prompt regression.

## Architecture

Launch: `bin/noa.js → run-noa.js → dist/main.js → main() in src/main.tsx`

- `run-noa.js` — launcher: validates `launcher-config.js`, lockfile-guarded auto-rebuild of `dist/main.js` when source is newer (gated by `CLAUDE_CODE_LAUNCHER_AUTO_REBUILD`), then imports the bundle. Plain JS run directly by Bun — must keep working when `dist/` is stale/missing. (Same for `bin/noa.js`, `launcher-config.js`, `build.ts`.)
- `src/main.tsx` — bundle entrypoint (`main()`; REPL + UI orchestration). a few thousand LOC itself, but pulls in most of the non-test `src/` tree. `src/entrypoints/cli.tsx` is a fast-path bootstrap (`--version`, MCP subservers, bridge/daemon) that lazy-imports the main loop.
- `src/query.ts` — `query()`, the async-generator agent loop (model → tools → results → repeat). `src/QueryEngine.ts` wraps it: SDK message stream, usage, compaction, abort/retry.
- `src/Tool.ts` (`Tool` type, `ToolUseContext`, `buildTool()`) + `src/tools.ts` (registry); one dir per tool in `src/tools/<Name>Tool/` (availability is feature-gated/governed). `src/commands.ts` + `src/commands/` for slash commands.
- Subsystems: `src/services/` (api, mcp, oauth, lsp, compact, autoFix), `src/components/`+`src/hooks/` (TUI), `src/bridge/` (remote/session), `src/utils/`. README has the full map.

## Multi-provider routing

Backend by env flag: `CLAUDE_CODE_USE_OPENAI`/`_BEDROCK`/`_VERTEX`/`_FOUNDRY` (default Anthropic). Anthropic-compatible third parties (Kimi, MiniMax, DeepSeek…) use provider profiles in `~/.noa/provider-profiles.json` (Bearer `ANTHROPIC_AUTH_TOKEN`). Wiring in `src/services/api/`. Unknown OpenAI-compatible models → 128k context fallback (`src/utils/context.ts`). Only the OpenAI-compatible shim sends `store: false` — `store` is not an Anthropic Messages API field, so the other backends have no equivalent.

## Command-surface governance (don't claim false parity)

`docs/product-governance.md` is authoritative. Four buckets:
- **Product-Available / baseline** (`/fork`, `/workflows`, `/summary`, `/share`) — supported, smoke-covered.
- **Non-baseline** — callable & stable but not core; promote only with smoke coverage.
- **Build-excluded** (`/proactive`, `/peers`, `/remote-control`, `/force-snip`, `/subscribe-pr`) — deliberately unregistered, not a regression; stable `E_BUILD_EXCLUDED_*` IDs in `src/commands/buildExcluded.ts`.
- **Stub** — governance placeholders, kept out of runtime + baseline docs.

Changing product surface: run `check:docs` + `smoke:features`; keep `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, `docs/product-governance.md` in sync.

## Conventions

- Config namespace `~/.noa/` and project-local `.noa/` (e.g. `.noa/progress.md`). Resolve the user-level dir via `getClaudeConfigHomeDir()` from `src/utils/envUtils.ts` (honors `CLAUDE_CONFIG_DIR`) — never hardcode `~/.noa`. Toggles prefer `NOA_CLAUDE_*`; legacy `CLAUDE_CODE_*` still accepted.
- **Privacy hardcoded, not configurable**: telemetry, GrowthBook remote fetch, remote policy/settings overlays hard-disabled; GB gates resolve to in-code defaults. Don't reintroduce remote-fetch/telemetry sinks.
- Commit messages must not describe work as an upstream port (no "port upstream X.Y.ZZZ"); history stays as-is.
- `CLAUDE.md` is tracked. `AGENTS.md`, `CLAUDE.local.md`, and `*.log` are gitignored, so durable project rules go in `CLAUDE.md`, not `AGENTS.md`.
- Non-negotiable stability signals: interactive startup stays alive, `--print` usable, resume/continue survive compaction, MCP startup degrades gracefully, permission boundaries hold. `docs/operating-guide.md` has the failure-mode checklist.
