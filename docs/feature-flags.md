# Feature flags

Read before editing code gated by `feature(...)`.


`feature('FLAG')` from `bun:bundle` is not a runtime module: `build.ts` rewrites `src/**.ts(x)` in place before bundling, replacing each call with a `true`/`false` literal for DCE (restored in a `finally`).

- Keep `feature('X')` an inline literal call — never alias, wrap, or compute the name.
- Baseline enables `build.ts`'s `defaultFeatures`; `--feature-set=dev-full` adds `fullExperimentalFeatures`; unknown flags → `false`.
- Some flags gate modules absent from this fork. A green `build:dev:full` only proves the bundle resolves — placeholder modules must still export every name their call sites read, or the binary dies at startup/first turn (CI runs `e2e-agent-loop.mjs --entry dist/main-dev.js` for this). `COORDINATOR_MODE` is in neither list; its inert branches in resume/session paths are intentional. `FEATURES.md` is the authoritative audit.

