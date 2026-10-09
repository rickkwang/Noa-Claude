# CLAUDE.md

**Noa Claude** — a local-first, multi-provider coding agent (React/Ink TUI + non-interactive `--print`), reconstructed from publicly exposed Claude Code source. Toolchain is **Bun**, not npm/node. Privacy defaults are hardcoded.

## Commands

```bash
bun run dev               # build dev bundle → run dist/main-dev.js
bun run dev:source        # run from source via dev-launcher.js (no bundle step)
bun run build             # production bundle → dist/main.js (baseline features)
bun run build:dev:full    # dev build + full experimental feature set
bun run compile           # standalone binary → dist/cli (`compile:dev` for dev)
bun test                  # all tests; `bun test <path>` for one file
bun run typecheck         # tsc --noEmit
bun run lint              # = check:quality = typecheck + check:docs (no eslint)
bun run check:nocheck     # @ts-nocheck ratchet vs. scripts/nocheck-ratchet.baseline.json
bun run check:runtime     # runtime health check
bun run smoke:features    # command/governance surface smoke
bun run smoke:engine      # engine smoke (no live API); `:live` needs ANTHROPIC_API_KEY
bun run smoke:perf        # startup/perf smoke
bun run scan:pr-intent    # fail PR diffs with suspicious links/downloads
# E2E (local scripted API unless noted)
bun run e2e:loop          # compiled CLI loop/transport
bun run e2e:bare          # compiled CLI `--bare` request shape + tool loop
bun run e2e:goal          # source query/tool/evaluator, async goal boundaries
bun run e2e:state         # task/mailbox persistence, snapshot acknowledgment
bun run e2e:startup       # MCP headersHelper trust/cwd/credential env, /cd trust persistence (tmux), UTF-8 auto-memory limits
bun run e2e:background    # query/queue/transcript pipeline + tmux/PTY replies and failure UI; requires tmux
# Manual; skip without an upstream binary
bun run verify:ports      # byte-diff pinned prompt ports vs. upstream
bun run verify:harness    # recovery/tool-loop parity vs. upstream on a scripted API; needs compile
```

## Testing

- Verify behavior with E2E tests, not new unit tests: unit tests here tend to restate implementation, and E2E runs catch real regressions. End each E2E run with a reproducible artifact: exact command, revision, inputs, observed output, exit status.
- Exception: a system that can only be tested in isolation — first list every way it could fail, then write the test.
- Keep an existing isolated test only if it catches a concrete bug E2E misses; delete ones that restate implementation or duplicate E2E coverage.

Tests live in `src/test/` mirroring `src/`; self-contained (no preload).

**`typecheck` proves little**: ~85% of non-test source carries `@ts-nocheck`, so green `tsc` covers ~15%. The agent loop is checked — `query.ts`, `QueryEngine.ts`, `tools.ts`, `services/tools/`, `utils/permissions/permissions.ts`, `services/compact/compact.ts` — against the `Message` union in `types/message.ts`. Prefer E2E evidence. `check:nocheck`'s baseline may only shrink; after removing a `@ts-nocheck`, run `node scripts/check-nocheck-ratchet.mjs --update`.

**Production bundles are minified**: mangled stack traces / `constructor.name` in `dist/main.js` are expected (`utils/errors.ts` and `classifyToolError` handle them); use `dev`/`build:dev` for real names. Production defines `NODE_ENV=production`, so `NODE_ENV === 'test'` branches and test hooks exist only from source.

**Only the compiled binary is code-split**: `compile` splits per `import()` so fast paths load only the bootstrap chunk (`dist/cli --version` ~10ms vs ~75ms). Every static import in `main.tsx` loads on every launch; dynamic ones don't.

## Feature flags — read before editing gated code

`feature('FLAG')` from `bun:bundle` is not a runtime module: `build.ts` rewrites `src/**.ts(x)` in place before bundling, replacing each call with a `true`/`false` literal for DCE (restored in a `finally`).

- Keep `feature('X')` an inline literal call — never alias, wrap, or compute the name.
- Baseline enables `build.ts`'s `defaultFeatures` (`AUTO_THEME`, `BUILTIN_EXPLORE_PLAN_AGENTS`, `AUTO_MODE`); `--feature-set=dev-full` adds `fullExperimentalFeatures`; unknown flags → `false`.
- Some flags gate modules absent from this fork. A green `build:dev:full` only proves the bundle resolves — placeholder modules must still export every name their call sites read, or the binary dies at startup/first turn; CI runs `e2e-agent-loop.mjs --entry dist/main-dev.js` on the full bundle for this. `COORDINATOR_MODE` is in neither list; its inert branches in resume/session paths are intentional. `FEATURES.md` is the authoritative audit.

## Lean vs verbose prompt

`shouldUseCompactSystemPrompt(model)` in `src/constants/systemPromptCompact.ts` picks the compact prompt head + short tool descriptions (newer models) or the long ones (older models still need them).

- Most lean-branch text is a verbatim port of the upstream binary; the reference version for each section is noted in the comments of `src/test/constants/portedPromptRegistry.ts`, and `verify:ports` diffs it. Re-verify any change to ported text.
- Intentional deviations are commented at their definition (`src/constants/systemPromptDynamicSections.ts`, `src/tools/AgentTool/prompt.ts`, `src/constants/systemPromptCompact.ts`) — keep them.
- Anything whose text depends on the gate must vary its cache key: `toolToAPISchema()` (`src/utils/api.ts`) and `resolveSystemPromptSections()` (`src/constants/systemPromptSections.ts`) memoize per session, so suffix with `:L` as upstream does, or a mid-session `/model` switch serves the wrong tier.
- Only `firstParty` is a trusted model identity. Bedrock/Vertex/Foundry and Anthropic-compatible third parties keep the verbose prompt and other first-party-only relaxations (e.g. `NOA_CLAUDE_WRITE_REQUIRE_READ`), since a configured id (inference profile, ARN, alias, proxy) proves nothing about the model. Opt in via `lean_prompt` in `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES`.
- `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1|0` forces either mode without a rebuild (bisect lean-prompt regressions).

## Architecture

Launch: `bin/noa.js → run-noa.js → dist/main.js → bootstrapCli() in src/entrypoints/cli.tsx → main() in src/main.tsx`

- `run-noa.js` — validates `launcher-config.js`, lockfile-guarded auto-rebuild of `dist/main.js` when source is newer (`CLAUDE_CODE_LAUNCHER_AUTO_REBUILD`), then imports it. It, `bin/noa.js`, `launcher-config.js`, and `build.ts` are plain JS run by Bun and must work with `dist/` stale or missing.
- `src/entrypoints/cli.tsx` — `bootstrapCli()` (exported as `main`): fast paths (`--version`, MCP subservers, bridge/daemon), then lazy-imports `main.tsx`. Keep its imports dynamic (`check:runtime` asserts `--version` never evaluates `main.tsx`). The appended bootstrap calls `bootstrapCli()` as a bare identifier, so the name must stay unique in bundle scope.
- `src/main.tsx` — `main()`, REPL + UI orchestration; pulls in most of `src/`. `dev:source` uses the same bootstrap so early flags like `--bare` apply before tool modules load.
- `src/query.ts` — `query()`, the async-generator agent loop; `src/QueryEngine.ts` wraps it (SDK stream, usage, compaction, abort/retry).
- `src/Tool.ts` (`Tool`, `ToolUseContext`, `buildTool()`) + `src/tools.ts` registry; one dir per tool in `src/tools/<Name>Tool/`. Slash commands: `src/commands.ts` + `src/commands/`.
- Subsystems: `src/services/` (api, mcp, oauth, lsp, compact, autoFix), `src/components/` + `src/hooks/` (TUI), `src/bridge/`, `src/utils/`. README has the full map.

## Multi-provider routing

Backend via `CLAUDE_CODE_USE_OPENAI`/`_BEDROCK`/`_VERTEX`/`_FOUNDRY` (default Anthropic); wiring in `src/services/api/`. Anthropic-compatible third parties (Kimi, MiniMax, DeepSeek…) use profiles in `~/.noa/provider-profiles.json` (Bearer `ANTHROPIC_AUTH_TOKEN`). Unknown OpenAI-compatible models → 128k context (`src/utils/context.ts`). Only the OpenAI shim sends `store: false`; it isn't an Anthropic Messages field. A 400 naming an optional request field is latched per provider/base URL/model in `src/services/api/requestLatches.ts` and left out on retry; a new optional top-level field heals only if listed in `OPTIONAL_ROOTS`.

## Command-surface governance

`docs/product-governance.md` is authoritative; don't claim false parity. Buckets:
- **Product-Available / baseline** (`/fork`) — supported, smoke-covered.
- **Non-baseline** — callable and stable but not core; promote only with smoke coverage.
- **Build-excluded** (`/proactive`, `/peers`, `/remote-control`, `/force-snip`, `/subscribe-pr`) — deliberately unregistered; stable `E_BUILD_EXCLUDED_*` IDs in `src/commands/buildExcluded.ts`.
- **Stub** — placeholders, kept out of runtime and baseline docs.

When changing product surface, run `check:docs` + `smoke:features` and keep `README.md`, `FEATURE_AVAILABILITY_MATRIX.md`, `docs/product-governance.md` in sync.

## Conventions

- Config lives in `~/.noa/` and project `.noa/` (e.g. `.noa/progress.md`). Resolve the user dir with `getClaudeConfigHomeDir()` (`src/utils/envUtils.ts`, honors `CLAUDE_CONFIG_DIR`), never a hardcoded `~/.noa`. Toggles prefer `NOA_CLAUDE_*`; legacy `CLAUDE_CODE_*` still accepted.
- Privacy is hardcoded: telemetry, GrowthBook remote fetch, and remote policy/settings overlays are disabled; GB gates use in-code defaults. Don't reintroduce remote-fetch or telemetry sinks.
- Commit messages must not describe work as an upstream port; history stays as-is.
- `CLAUDE.md` is tracked; `AGENTS.md`, `CLAUDE.local.md`, `*.log` are gitignored — durable rules go here.
- Stability invariants: interactive startup stays alive, `--print` works, resume/continue survive compaction, MCP startup degrades gracefully, permission boundaries hold. Failure-mode checklist: `docs/operating-guide.md`.
