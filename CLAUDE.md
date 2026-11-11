# CLAUDE.md

**Noa Claude** — a local-first, multi-provider coding agent (React/Ink TUI + non-interactive `--print`), reconstructed from publicly exposed Claude Code source. Toolchain is **Bun**, not npm/node. Privacy defaults are hardcoded.

## Commands

- `verify:ports` / `verify:harness` are manual and skip without an upstream binary; `verify:harness` also needs `compile`.
- `e2e:background` / `e2e:startup` need tmux; `e2e:install` needs network; `e2e:sandbox` skips where sandboxing is unsupported.
- `lint` = typecheck + docs check (no eslint). `compile` → `dist/cli`; `build` is baseline features only.

## Testing

- Verify behavior with E2E tests, not new unit tests (unit tests here tend to restate implementation). End each E2E run with a reproducible artifact: exact command, revision, inputs, observed output, exit status.
- Exception: a system testable only in isolation — first list every way it could fail, then write the test.
- Assemble credential-shaped fixtures at runtime (`['xoxb', '123…', 'abc…'].join('-')`): GitHub push protection rejects any history containing a real-token-shaped literal, even an obviously fake one.

**`typecheck` proves little**: ~85% of non-test source carries `@ts-nocheck`. Checked: `query.ts`, `QueryEngine.ts`, `tools.ts`, `services/tools/`, `utils/permissions/permissions.ts`, `services/compact/compact.ts`, against the `Message` union in `types/message.ts`. The `check:nocheck` baseline may only shrink; after removing a `@ts-nocheck`, run `node scripts/check-nocheck-ratchet.mjs --update`.

**Production bundles are minified**: mangled stack traces / `constructor.name` in `dist/main.js` are expected (`utils/errors.ts` and `classifyToolError` handle them); use `dev`/`build:dev` for real names. Production defines `NODE_ENV=production`, so `NODE_ENV === 'test'` branches and test hooks exist only from source.

Dead-code checks on `src/` exports must also scan `scripts/` and `bin/`: `scripts/check-runtime-health.mjs` imports `_*ForTesting` exports that only it uses, and deleting one breaks only `bun run check:runtime` (not `bun test` or `typecheck`).

## Where the rest lives

Path-scoped rules in `.claude/rules/` (symlinked as `.noa/rules/`) load automatically when you touch matching files; tools that don't load them should read the matching file first:

- Code gated by `feature('…')` → `docs/feature-flags.md`
- Startup, `main.tsx`, `run-noa.js`/`build.ts`/launcher → `startup.md`
- Prompt text or `toolToAPISchema` → `prompt-cache.md` (lean vs verbose: `src/constants/CLAUDE.md`)
- Provider routing → `src/services/api/CLAUDE.md`; preserved thinking → `preserved-thinking.md`
- Skill hooks, task status, transcripts, Ink `Text` → `skill-hooks.md`, `task-status.md`, `transcripts.md`, `ink-text.md`
- Writing or deleting tests (preload, isolated tests, flaky CI case) → `testing.md`; editing CI workflows → `ci.md`
- Verifying the model-capability tables against the upstream binary → `docs/upstream-binary.md`
- Directory map: README.

## Conventions

- Config lives in `~/.noa/` and project `.noa/`. Resolve the user dir with `getClaudeConfigHomeDir()` (`src/utils/envUtils.ts`, honors `CLAUDE_CONFIG_DIR`), never a hardcoded `~/.noa`. Toggles prefer `NOA_CLAUDE_*`; legacy `CLAUDE_CODE_*` still accepted.
- Privacy is hardcoded: telemetry, GrowthBook remote fetch, and remote policy/settings overlays are disabled; GB gates use in-code defaults. Don't reintroduce remote-fetch or telemetry sinks.
- Command surface: don't claim parity beyond `docs/product-governance.md` (authoritative). For product-surface changes, follow `.noa/skills/product-surface/SKILL.md`.
- Stability invariants: interactive startup stays alive, `--print` works, resume/continue survive compaction, MCP startup degrades gracefully, permission boundaries hold. Failure-mode checklist: `docs/operating-guide.md`.
- Code comments are in English, no Chinese comments; string literals used as examples (e.g. multilingual test cases) may stay in their original language. Talking to the user can still be in Chinese.
- Comments and identifiers don't name the app a design or asset was borrowed from (e.g. "as Codex does", "from the Codex bundle", bundled names like OXr/F3); write the intent and values only ("16px folder in the label's color", `glyphs.ts` not `codexIcons.ts`). Protocol syntax such as `codex-file-citation` is not a comment; keep it. Keep icons already taken from Codex rather than replacing them.

## Commit and push

- Commit messages must not describe work as an upstream port.
- 只有用户在当前请求里明确说"提交"才 git commit；做完改动后停在未提交状态，汇报并等用户决定。之前的授权不延续。
- 提交直接在当前 master 上 commit，不建 feature 分支（单人仓库，历史提交都在 master）。
- 不 push，除非用户要求。
- 工作区常有其他会话并发改动，甚至会抢先 commit。push 前必须核对 `git log origin/master..HEAD` 只包含用户本次授权推送的提交。
- commit 与 push 用 `&&` 串起来：commit 失败（如 nothing to commit）就停下来问，不要继续 push。
- 提交前看 `git status` 是否意外 ahead、目标文件是否已无 diff；有异常先报告。

**Why:** 三次事故：用户说过一次"先提交"，我把它套用到了后续任务，用户说没让提交就别提交；用户说不需要 branch，我却多建了分支；另一会话已把待推送的测试文件连同未审查改动提交为 ecbda55a，我的 commit 失败后 push 仍执行，把整条提交推上了远端。

Since 2026-11-03 a GitHub ruleset ("master requires ci-ok", id 26493676) requires the `ci-ok` aggregate job of PR Quality Gate on master. Repository admins bypass it, so direct pushes to master still work and print "Bypassed rule violations ... ci-ok". That bypass skips the gate: say so before pushing to master, and after pushing, check the ci-ok result on that commit instead of reporting the push as CI-green.

**Why:** heavy jobs skip on docs-only changes and skipped matrix jobs report under an unexpanded name, so only `ci-ok` can be the required check; per-job required checks would hang PRs.
