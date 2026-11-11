---
paths:
  - "src/main.tsx"
  - "src/entrypoints/**"
  - "run-noa.js"
  - "bin/noa.js"
  - "launcher-config.js"
  - "build.ts"
---

# Startup and bundling

**Only the compiled binary is code-split** per `import()`, so fast paths load only the bootstrap chunk (`dist/cli --version` ~10ms vs ~75ms). Every static import in `main.tsx` loads on every launch.

- `run-noa.js` — validates `launcher-config.js`, lockfile-guarded auto-rebuild of `dist/main.js` when source is newer (`CLAUDE_CODE_LAUNCHER_AUTO_REBUILD`), then imports it. It, `bin/noa.js`, `launcher-config.js`, and `build.ts` are plain JS run by Bun and must work with `dist/` stale or missing.
- `src/entrypoints/cli.tsx` — `bootstrapCli()` (exported as `main`): fast paths (`--version`, MCP subservers, bridge/daemon), then lazy-imports `main.tsx`. Keep its imports dynamic (`check:runtime` asserts `--version` never evaluates `main.tsx`). The appended bootstrap calls `bootstrapCli()` as a bare identifier, so the name must stay unique in bundle scope. `dev:source` uses the same bootstrap.
