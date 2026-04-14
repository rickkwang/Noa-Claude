# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript source. Key areas include `src/commands/` for slash commands, `src/components/` for UI, `src/services/` for runtime integrations, `src/bridge/` for remote/session plumbing, and `src/constants/` for shared values.
- `bin/` contains the CLI entrypoints.
- `scripts/` holds validation and smoke checks such as `check-runtime-health.mjs` and `smoke-engineering.mjs`.
- `docs/` holds local product docs used by the default help and release-note flows.
- `build.ts` is the main build/compile script.

## Build, Test, and Development Commands
- `bun run dev` starts the local launcher for interactive development.
- `bun run build` bundles the app into `dist/main.js`.
- `bun run compile` produces the bundled app plus the standalone `dist/cli` binary.
- `bun run typecheck` runs the TypeScript compiler with no emit.
- `bun run check:docs` validates repository docs consistency.
- `bun run check:runtime` runs runtime health checks.
- `bun run smoke:engine` runs the engineering smoke suite; `bun run smoke:engine:live` enables live provider checks.

## Coding Style & Naming Conventions
- Use the existing TypeScript/React style in the repo: 2-space indentation, semicolons, single quotes, and ESM imports.
- Keep filenames aligned with feature areas, for example `src/commands/release-notes/release-notes.ts` or `src/components/HelpV2/HelpV2.tsx`.
- Prefer small shared constants in `src/constants/` instead of repeating URLs, labels, or mode names.

## Testing Guidelines
- There is no single unit-test runner; validation is primarily through `typecheck`, `check:docs`, `check:runtime`, and the smoke scripts.
- When changing command behavior or startup flows, run at least `bun run typecheck`, `bun run build`, and `bun run check:runtime`.
- For release-note, banner, or default-help changes, also run `bun run compile` and `bun run smoke:engine`.

## Commit & Pull Request Guidelines
- Commit messages are short, imperative, and prefixed by type, for example: `chore: isolate default help and release notes`.
- Keep PRs focused on one behavior area. Include a short summary, the commands you ran, and screenshots only when UI changes are involved.

## Security & Configuration Tips
- Do not reintroduce default-path dependencies on external docs or changelog URLs unless they are explicitly optional.
- Prefer repository-local docs for default help surfaces and bundled release-note content for offline-safe behavior.
