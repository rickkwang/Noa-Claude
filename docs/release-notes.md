# Release Notes

## Unreleased

### New Features

- **Fable 5.1 model support** — registered as its own model (`claude-fable-5-1`) rather than folded into Fable 5, since the two differ in ways that are silent when confused. It takes over the `fable` alias and the picker's Fable row; Fable 5 stays selectable by id. What is new relative to Fable 5: **forced tool use is gone** — `tool_choice` of type `any`/`tool` returns a 400, so `modelRejectsForcedToolChoice()` gates it and the permission explainer (the one forced-tool call site) falls back to `auto` plus an instruction naming the tool; **cache reads are $0.25/Mtok** rather than $1, a separate cost tier so `/cost` doesn't over-report by 4× on cached prefixes; and the display/marketing names read "Fable 5.1". Everything the two generations share — adaptive-only thinking with an omitted `thinking` param when thinking is off (an explicit `{type:'disabled'}` 400s on both), rejected sampling params, the full `low`…`max` effort range, structured outputs, native 1M context, the lean prompt head with fable mitigations, advisor rank 5 — is inherited, and now pinned by tests rather than by substring luck. Mythos 5.1 gets the same prompt gates, advisor rank, and forced-tool-choice rule by name. Fast mode stays Opus-only and Priority Tier is unsupported on this tier, so neither needed a change.
- **`NOA_CLAUDE_PROMPT_CACHE_1H` — the 1-hour prompt-cache TTL is reachable again** — `should1hCacheTTL` gates on a GrowthBook allowlist, and GrowthBook is hard-disabled in this fork (its two override paths are additionally `USER_TYPE === 'ant'`-only), so the allowlist was permanently empty: off Bedrock the long TTL could not fire at all. The new env var restores the lever locally — a bare `1` for the main thread and SDK, a comma-separated query-source list for finer control, or `0` as a hard off that outranks `ENABLE_PROMPT_CACHING_1H_BEDROCK`. It is deliberately **off by default and documented as usually not worth turning on**: a 1h write bills at 2x input against the 5-minute entry's 1.25x, so it only pays when more than ~37.5% of cache-write *volume* follows a gap longer than five minutes. Measured over this repo's own transcripts that share is 2.6% (the requests after a long gap do write ~11x more than in-loop ones, but there are almost none of them), which would have cost ~1.56x the write spend — so the README states the break-even rather than recommending the flag. A bare `1` deliberately excludes `agent:*`: subagents run back-to-back inside a turn and would take the 2x write with no long gap to survive. `/doctor` reports which branch fired.
- **Canonicalization no longer collapses a `.1` generation into its predecessor** — `firstPartyNameToCanonical` matched `claude-fable-5` first, so `claude-fable-5-1` canonicalized to `claude-fable-5` and inherited its pricing, display name, and advisor row. The specific check now runs first, for both Fable and Mythos.

### Bug Fixes

- **Bedrock inference-profile matching prefers the exact generation** — profiles were resolved with a plain substring search, and a needle is a prefix of the next `.1` release (`claude-fable-5` matches `us.anthropic.claude-fable-5-1`), so an account with both profiles enabled could silently pin the wrong model. `findFirstMatch` now skips a match whose needle is followed by another `-<digit>` version segment, falling back to any substring match so an unexpected profile shape still resolves rather than dropping to the hardcoded id.

- **Parallel subagents run in parallel again (reverts a 1.12.0 change)** — 1.12.0 made the Agent tool's `isConcurrencySafe` conditional so that write-capable subagents serialized. The intent was sound but the layer was wrong, and the cost landed on the common case: a batch of `general-purpose` or custom agents in one message was split into single-tool batches, so the second agent was not initialized until the first had finished — indistinguishable from asking one question at a time, which is the entire point of subagents. The scheduler also cannot deliver what the gate promised: it only sees foreground siblings within one turn, so background, worktree-isolated, and forked agents overlapped regardless. Colliding file edits are already caught where they happen (read-before-write plus the mtime check in FileEdit/FileWrite), which is both narrower and more accurate than serializing every agent. `isConcurrencySafe` is unconditionally `true` again, and the tool-agnostic `(input, context)` plumbing added for the resolved-agent lookup is withdrawn with it — no implementation needs the context. Shell writes from parallel agents sharing a cwd remain an accepted boundary, now stated as such at the definition. Note this also restores agreement with the Agent tool's own prompt, which instructs the model to emit parallel agents in a single message — during 1.12.0 the prompt and the scheduler contradicted each other. Verified against an upstream 2.1.251 binary: its Agent tool is likewise `isConcurrencySafe(){return!0}` with no agent-type, isolation, or shadowing branch, and its batch partitioner and concurrency cap match ours line for line — the 1.12.0 gate was a local invention, not a port. Upstream does guard writes, but at the write site rather than the scheduler — a path-based check in Write/Edit/NotebookEdit `validateInput`, plus a separate one on the Bash working directory. Both are about *worktree isolation* (refusing to let an isolated agent reach back into the shared checkout, or an unisolated background session write it at all), not about two unisolated agents racing in a shared cwd — that case is unguarded upstream as well. Porting the isolation guard is worthwhile and orthogonal to this revert; it is done in the next entry.
- **`isolation: "worktree"` is now an enforced boundary, not just a starting directory** — an isolated agent (or one given an explicit `cwd`) runs under a cwd override, but an override only redirects *relative* paths: an absolute path naming the parent checkout still wrote straight through it, so the isolation the caller asked for came apart with no sign. With parallel agents that is precisely the lost update the worktree was meant to prevent. `Write` and `Edit` now refuse a path that resolves out of the override and back into the shared checkout, naming the worktree so the agent can retarget. Ported from upstream 2.1.251's guard, minus the parts that are load-bearing only there: its unisolated-background-session branch gates on a session kind this fork has no equivalent of, and its symlink-dot-segment, UNC/`/net`, and case-spelling diagnostics are edge-platform paths we have no users for. The check keys on the cwd override specifically rather than on `getCwd() !== getOriginalCwd()` — a plain `cd` in the shell moves the cwd too, and reading that as a boundary would refuse ordinary writes for the rest of the session. It is also deliberately one-directional: writes *outside* the checkout (e.g. `/tmp`) stay allowed, since they cannot cause a lost update in the repo and blocking them would make this a sandbox, which it is not. Three things review caught before this shipped, all now pinned by tests: the check follows the **symlink chain** (`getPathsForPermissionCheck`, the same resolution the permission layer uses) rather than comparing the spelling it was handed — a symlink inside the worktree pointing at the checkout reads as contained by a textual test, so one `ln -s` would have retired the guard entirely; the shared checkout is **snapshotted when the override is established** rather than read at check time, because `/cd` and `EnterWorktree` both call `setOriginalCwd` and would otherwise move a concurrent agent's boundary out from under it (failing open); and `NotebookEdit` is guarded alongside Write and Edit, which upstream also does and which we had missed. **Not covered:** a shell command that `cd`s out of the worktree within a single invocation. Catching that needs command parsing, and upstream does not attempt it either — its Bash guard checks the resolved working directory, which under our override is the worktree by construction.
- **Dropped the module-level active-agent snapshot** — the cache in `loadAgentsDir` existed only to let `isConcurrencySafe` resolve agents synchronously, and needed a carve-out to survive `/clear` without going stale. With its one consumer gone, the global mutable state goes too; `getActiveAgentsFromList` is a pure function again.

### Tests

- The 1h-TTL opt-in is pinned in `src/test/utils/promptCache1hEnv.test.ts`: unset stays a fall-through (not a disable), a bare `1` resolves to main-thread/SDK only and does not match `agent:*`, an explicit `0` is a hard off that beats the Bedrock env var, the legacy `CLAUDE_CODE_` name still resolves with `NOA_CLAUDE_` winning, and `DISABLE_PROMPT_CACHING` still outranks the whole thing.
- Fable 5.1's surface is pinned in `src/test/utils/fable51.test.ts`: separate canonicalization and marketing names from Fable 5, the forced-tool-choice rejection (with Fable 5 / Opus 5 asserted as *not* rejecting), the inherited thinking/effort/1M facts, the cheaper cache-read tier next to Fable 5's, and the Bedrock profile disambiguation in both directions.
- The subagent concurrency-matrix unit test is replaced by end-to-end coverage asserting the property that actually matters: two foreground agents emitted in one message both start before either completes. Both dispatch paths are pinned (`runTools` and `StreamingToolExecutor`), since only one runs per turn and a single test would leave half the surface unguarded. The fixtures delegate to the real `AgentTool.isConcurrencySafe` rather than restating `true`, so a regression in the production predicate fails the tests.
- `checkWorktreeEscape` is pinned on both sides of the boundary — worktree paths and out-of-checkout scratch paths allowed, shared-checkout and traversal paths refused — including the containment ordering (worktrees live *inside* the checkout at `.noa/worktrees/`, so the worktree test has to run first) and the plain-`cd` false positive that motivated keying on the override.

## 1.12.0

### New Features

- **Third-party provider profiles now carry the endpoint's own model catalogue** — an Anthropic-compatible endpoint (Kimi, MiniMax, …) reports provider `firstParty` because no `CLAUDE_CODE_USE_*` flag is set, so resolvers that only recognise Claude ids saw no useful catalogue: the model picker rendered four Claude-shaped rows all pinned to the profile's single default, `/model` offered no way to switch, effort capped at "not supported", and context collapsed to the 200k fallback. The endpoint's model list now flows through the profile env and replaces the picker rows, with per-model effort levels, context window, and output limits declared from platform docs (Kimi: K3 low/high/max at 1M context with a 128k default completion ceiling; K2.7 Code documented as taking no `reasoning_effort`). Only documented values are declared — over-reporting a context window overflows the request. Also fixed along the way: a profile-written `ANTHROPIC_MODEL` no longer outranks a `/model` choice on restart.

### Bug Fixes

- **Write-capable subagents no longer run concurrently in the same directory** — the Agent tool's `isConcurrencySafe` was unconditionally `true`, so a batch of parallel subagents sharing the parent's cwd could overwrite each other's edits mid-flight with no error surfaced. Read-only built-ins (Explore, Plan), worktree-isolated agents, and background spawns stay concurrent; general-purpose, custom, and unknown agent types now serialize. Two bypasses found in review are closed with it: a custom agent *named* "Explore"/"Plan" (custom sources shadow built-ins in the active-agent list) no longer passes the read-only check — the scheduler now verifies the resolved agent, not the input string — and the check reads a cache that every active-agent update path refreshes, so it can't lag behind `/model`-adjacent state. Background agents sharing cwd remain an explicitly accepted boundary: they detach from the scheduler by design, and closing that needs task-level write tracking, which is deliberately out of scope here.
- **Subagent silent failures are now marked in the result** — a sync agent that errored mid-run previously returned its partial output as if complete; it now carries a `[PARTIAL]` marker naming the error. An agent whose custom system prompt fails to build previously ran on the generic fallback prompt with no sign of it; the result now carries a `[WARN]` marker, driven by the actual fallback site inside `runAgent` (so a successful internal retry no longer false-alarms, and the worktree/cwd path — where the prompt is built inside `runAgent` — no longer stays silent).
- **Effort is clamped whenever thinking is explicitly disabled, on any model** — the API rejects effort above `high` alongside `thinking: {type: 'disabled'}`, but the clamp was scoped to Opus 5. The rule is a property of the request shape, not one model: Sonnet 5 is the other model that needs an explicit disable (omitting the param leaves adaptive thinking on), so "thinking off at xhigh/max" on Sonnet 5 was taking a 400. The predicate now keys on the effort alone, and the downgrade is logged since it overrides a user-chosen effort.
- **A carried-over `effort` no longer 400s models without the parameter** — `output_config` is seeded from `CLAUDE_CODE_EXTRA_BODY`, so it could arrive carrying an `effort` set for a different model; sending it to a model with no effort parameter fails the whole request. The guard now strips it at the seeding site rather than skipping over it (deleting from the merged copy alone could empty it, skip the conditional spread, and ship the unstripped original anyway).
- **Advisor works on current models, and rejects invalid pairings** — `modelSupportsAdvisor`/`isValidAdvisorModel` were the same two-entry allowlist frozen at the 4.6 generation, so advisor was simply unavailable on Opus 4.7/4.8/5, Sonnet 5, and Fable 5. Both are replaced by a rank table mirroring the capability data: a model needs a rank to use an advisor, rank ≥ 2 to be one, and a pair is valid only when the advisor ranks at or above the base — an advisor weaker than its advisee is rejected by the API and previously nothing checked for it. The startup `--advisor` check hard-errors; a mid-session `/model` switch to something stronger than the advisor skips the advisor with a log rather than failing the turn.
- **Sonnet 4.6's output ceiling is 128k, not 64k** — the ceiling was set from a prose reading of the models overview; the capability table gives `{default: 32000, upper: 128000}`, and only the ceiling that `--max-output-tokens` clamps against moves (the 32k default is unchanged). Coverage now pins the whole ladder so the next generation is compared against the table, not re-derived from prose.
- **Sonnet 5's $2/$10 rate has no expiry** — the tier was misread as introductory and given a 2026-09-01 cliff back to $3/$15; the capability table carries it as a plain entry with no expiry field. Left alone, `/cost`, the stats cache, and the model picker would all have started over-reporting Sonnet 5 spend by 50% on September 1st.
- **`--task-budget` enforces the API minimum and reports bad input cleanly** — the API rejects `task_budget.total` below 20,000 with a 400, but the flag only checked for a positive integer, so a too-small budget failed remotely; it now validates client-side. The same parser also threw a plain `Error`, which commander doesn't recognise as user-input failure — every invalid value surfaced as a fatal with a minified stack trace; it now uses `InvalidArgumentError` like the neighbouring `--effort`.
- **Fast mode no longer offers Opus 4.7** — upstream removed fast mode for 4.7, so `speed: "fast"` on it now returns an error; keeping it in the allowlist sent a parameter the API rejects whenever a user picked 4.7 with fast mode on.
- **WebSearch sends the dynamic-filtering tool type where supported** — the tool sent `web_search_20250305` unconditionally, so models accepting the `web_search_20260209` variant never got it. Selection is an allowlist (an unknown tool type is a hard 400; the basic variant merely forgoes dynamic filtering), and both the schema build and the request now derive the tool type from the one model that will actually serve the search — previously a Haiku-experiment request could have been shaped by the main loop model it never reaches.

### Chores

- Corrected a stale comment claiming third-party providers "lag firstParty on new Opus releases" — the real reason third-party defaults trail is that Noa cannot recover from a default not enabled on the caller's account (no 400-strip-retry classifier, no third-party fallback chain), so stale-conservative is the safer direction. A wrong stated reason is how the next person talks themselves into the risky change.

### Tests

- New coverage pins the subagent concurrency rules (read-only built-ins concurrent; write-capable, custom, and shadowing agents serial; worktree/background concurrent) and the prompt-fallback reporting contract (the marker callback fires exactly when the custom prompt build throws and the default is used). The `configureEffortParams` tests no longer depend on the developer's shell: an exported `ANTHROPIC_BASE_URL` or provider flag flips first-party detection off and failed two tests unrelated to the code under test, so the provider env is cleared per test and restored after.

## 1.11.0

### New Features

- **`spinnerTipsOverride` aligned with upstream 2.1.247** — tips entries can now be objects (`{id, text, cooldownSessions?, priority?}`) alongside plain strings, plus `tipsFile` (an absolute or `~/` path to a JSON array or `{"tips": [...]}`) and `label` (a prefix rendered before the tips declared alongside it), with behavior recovered from the string constants in an installed upstream binary. This release adds the source governance upstream's literals don't evidence: project/local settings ship inside a shared repo, so they may only contribute plain strings — object entries, `tipsFile`, and `label` are honored from user/managed/flag settings only, and a `tipsFile` named by *remote* managed settings is refused outright (a repo must not point a collaborator's CLI at an arbitrary local file, or brand its tips as an admin notice). `tipsFile` loading validates in six steps (UNC/network path, path form, regular file, 256KB size cap, JSON shape, existence) and caches against path+mtime+size, since an uncached loader put stat+read+parse on the spinner's once-per-turn hot path. Tip text and label share one spinner line, so both are Unicode-sanitized before reaching the terminal. `cooldownSessions` is now enforced for custom tips (previously stored and ignored), `priority` breaks ties among never-shown tips, `excludeDefault` gates on whether custom tips were *configured* rather than how many are eligible right now, and cooldown history is namespaced (`org-tip:<id>`, `org-tip:file:<id>`) instead of index-derived ids that shifted whenever the array was reordered.
- **Clawd skip entrance animation on startup** — the existing-but-unused `skip` sequence (hop in from off-screen left, land with a poof) is now wired into the startup logos. Reduced-motion users and non-fullscreen environments still get the static Clawd.

### Bug Fixes

- **Auth and provider transitions hardened** — several fixes along the login/status/refresh chain. `noa login` over SSH or from a container previously had no path to completion: the localhost callback only closes the loop when the browser runs on the same host, and the CLI flow never offered the paste-back URL, leaving the flow to time out after 15 minutes; a TTY stdin now gets the manual URL and a paste prompt (state compared unconditionally — a pasted `code#state` with a mismatched state previously surfaced as an opaque token-exchange failure). `noa auth status` mislabeled third-party routes: `isUsing3PServices()` covers only the env-flag cloud gateways, so an Anthropic-compatible profile's Bearer token was reported as `oauth_token`, and an OpenAI-profile session could report itself as a claude.ai subscriber; the checks now key off `isDirectFirstParty()`/`openaiCompatible`. OAuth credential mutations across processes are serialized on a dedicated `.auth-transition` lockfile (canonicalized parent, so path aliases can't bypass it) instead of sharing the config-directory lock. Provider profiles: the file is now written `0600` (older world-readable files are narrowed on the next mutation), keys explicitly set to `undefined` no longer erase stored `apiKeys` on update, changing a profile's endpoint drops its stored key, and non-printable-ASCII characters are rejected from credentials. The OpenAI-compatible shim now sends `store: false` (opt out of provider-side retention; `CLAUDE_CODE_OPENAI_DISABLE_STORE` for endpoints that reject the field), and the Anthropic client no longer refreshes or copies an Anthropic Bearer into shim headers on OpenAI-compatible routes. A malformed provider profile no longer crashes startup as an unhandled rejection.
- **`noa doctor` is a plain-text report that works in a pipe** — the terminal subcommand rendered an Ink screen, which needs a TTY: piped or in CI it threw "Raw mode is not supported" and printed a stack trace instead of the diagnostics, while still exiting 0 — silently useless in exactly the scripted and paste-into-an-issue contexts people reach for when something is broken. Interactively it also blocked on a keypress for no reason (leftover from when this was an in-session screen). One renderer now serves every context, and every source the screen read has a plain module entry point, so the text path is not a reduced version — the single thing given up is MCP tool-schema context cost, which needs live MCP connections (spawning every stdio server in project config just to be looked at would have made "only run this in directories you trust" a precondition for a diagnostic); the report says so and points at `/context`. A collector that throws is named in a "Checks that could not run" section and counted like any other issue — a diagnostic that silently omits a check it could not run reports a clean bill of health it did not earn. The piped path also no longer prunes stale update locks the way the screen did: a read-only report should not mutate state as a side effect.
- **Curl installer and `noa update` safety** — installs previously landed on whatever `master` currently was. The installer now resolves the newest *published GitHub Release* at runtime (semver max over strict `vX.Y.Z` release tags — not the raw tags list, which also carries imported upstream Claude Code refs like `v2.1.x` that were never Noa releases; `/releases/latest` is unusable because GitHub defines it by creation date), with `NOA_INSTALL_REF` to pin, `NOA_INSTALL_REPO_TARBALL_URL` as a mirror escape hatch, and a bundled `FALLBACK_REF` when the API is unreachable. `NOA_INSTALL_EXPECTED_SHA256` pins the exact tarball bytes, aborting before extraction on mismatch. The installer refuses to clobber a `noa` binary in `~/.local/bin` that does not belong to this installation (checked before the expensive build; `NOA_INSTALL_FORCE_SYMLINK=1` overrides), and smoke-tests the swapped-in build (`noa --version`, with user auth env unset) before deleting the backup — a build that exits 0 can still produce a runtime that fails to start, and a failed smoke test now restores the previous install. `noa update` checks the latest published release first: already-current installs are told so (with the repair reinstall command), non-semver current versions and unreachable GitHub proceed with a warning instead of a blind reinstall.

### Chores

- **Release checklist added to product governance** — covering the version bump, README install-URL tag sync (now pinned to the release tag instead of a moving `master` ref), `install.sh` `FALLBACK_REF` bump, and tag/release verification. `NOA_CURL_INSTALL_COMMAND` stays on master intentionally so `noa update` keeps fetching the latest installer.

### Tests

- New coverage for the tips subsystem: the six `tipsFile` loader rejections, per-source trust rules, label injection, cooldown/priority ordering, and eight malformed-settings shapes that previously threw (settings schema is `safeParse`d whole-file, so normalization treats every field as untrusted — a throw would surface as an unhandled rejection once per turn). Plus coverage for the installer script (ref resolution, checksum, binary-conflict refusal, smoke-test rollback) and latest-release version comparison, and for the auth/provider fixes (manual auth-code flow, transition lock, profile credential normalization).

## 1.10.0

### New Features

- **Proactive and Concise output styles ported from upstream 2.1.237** — both style prompts and their one-line reminders are verbatim transcriptions diffed byte-for-byte against the installed upstream binary, digest-pinned in tests and registered in `verify:ports`. With them comes `turnReminder`, new machinery: a non-default style's one-liner now rides on the per-turn `output_style` attachment ("<Name> output style is active. <reminder>"), read off the attachment only — never off the built-in config, so a custom style file shadowing a built-in name can't get the built-in one-liner injected under its own prompt. Styles without a reminder (Explanatory, Learning) keep the previous generic sentence.
- **The launcher routes by an explicit provider marker** — this fork ships MiniMax as its product default and previously applied that default unconditionally, overwriting `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` on every start, so an Anthropic login held only for the current process. The routing decision is now persisted as `launcherProvider` in the global config (written after credentials actually persist, reset on logout; unknown values are a hard config error), and the launcher applies product defaults only when the marker is not `'anthropic'`. Installs predating the marker keep their authenticated route via `oauthAccount` presence until the next login/logout. Consequences: `ANTHROPIC_AUTH_TOKEN` without an explicit `ANTHROPIC_BASE_URL` is now an error (a Bearer credential intended for another host was previously sent to MiniMax by default); login/logout run under a config-dir lock and provider-profiles.json mutations under a file lock; third-party profile deactivation is transactional and moves into the shared installer so the headless SDK login path gets it too.

### Bug Fixes

- **`bun run compile` emits working binaries again** — feeding the minified bundle back through `compile: true` mis-hoisted a binding and the binary died on the first real command with "Cannot access 'X' before initialization". The compile pass now stages a pre-minify copy and minifies inside it, which also enables Bun bytecode caching (0.28s → 0.12s launch). The build fails loudly when the `.jsc` step errors (bun#15528 reports success anyway) and warns when a plain build leaves `dist/cli` stale; it also throws instead of `process.exit` so the feature-flag rewrite always restores the source tree.
- **`ANTHROPIC_AUTH_TOKEN` accepted as a CI credential** — under CI, the API-key guard threw unless `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` was set, ignoring the Bearer token third-party providers authenticate with, so any CI run using one died before its first request (including our own live smoke). It now satisfies the requirement the same way the OAuth token does.
- **Caller env preserved when no provider profile is active** — `applyActiveProviderProfileEnv` deleted `ANTHROPIC_API_KEY` and friends unconditionally, even with no profiles configured; under `CI=true` the auth guard then threw before `--print` request handling. Only keys whose value matches what a previous profile application persisted are stripped now.
- **Mid-session output-style switches actually take effect** — the `output_style` system-prompt section was memoized under a bare name living until `/clear` or `/compact`, so switching styles via `/config` kept serving the first turn's section — and when the first turn ran on `default` that section is null, so the model got a per-turn reminder announcing a style whose guidelines were never sent. The section is now keyed by style name (a deliberate departure; upstream keys it bare and carries the same gap). Also: built-in style classification used `in`, which walks the prototype chain, so a custom style named `toString.md` was treated as built-in; now `Object.hasOwn`, as upstream does.
- **Compact spinner no longer recolored amber** — upstream never recolors at `compact_start` (the blue pair set at `hooks_start` stays until `compact_end`), and the amber override pointed body and shimmer at the same `warning` key, flattening the shimmer sweep to a no-op.
- **Clawd glyphs aligned with upstream 2.1.241** — 6-wide eye field with an empty r1R, look-right shifts eyes inside the field instead of swapping chars, arms-up uses the asymmetric ▄ right arm, and the standard-terminal feet row is ▝▝ ▝▝ (Noa had copied the Apple Terminal variant). The noa-only wave poses are re-expressed in the same segment scheme; animation sequences unchanged.

### Changed

- **~100ms faster startup** — profiling `noa -h` (0.39s vs upstream's 0.11s) put ~110ms in JSC pre-parsing the 25MB bundle, with top-level evaluation spread flat across 2055 modules (largest single module 5.4ms — no hotspot to lazy-load). The production bundle now gets a second, identifier-minifying pass (25MB → 12.7MB, ~55ms; whitespace-only minification buys nothing measurable — the win is in the identifier table). It runs after the USER_TYPE patch rather than as `minify: true` on the first build, because the minifier would constant-fold `"external" === 'ant'` before the patch could rewrite it. Dev builds stay unminified; the runtime already expects mangled names. The launcher also stopped recursively stat'ing the whole `src/` tree on every start (~13ms), and `main.tsx`'s only top-level await became a static import — a precondition for a bytecode-cached build later. Result: 0.39s → 0.28s.
- **`/rewind` and `/goal` registered as implemented non-baseline commands** — both shipped but were untracked by governance, a documentation-drift risk. Registration only: entries in `surfaceStatus.ts`, matrix/governance rows, README listing, and a smoke-features check that non-baseline commands stay discoverable. Baseline boundary unchanged.

### Chores

- **CI `@ts-nocheck` ratchet** — 1818/2029 non-test source files carry `@ts-nocheck`, so `tsc --noEmit` covers ~10% of the tree. Any PR that introduces a new unchecked file now fails with the offending paths listed; the baseline stores the full file list so swap-one-out-add-one-in is still caught. Tighten with `--update` as cleanup lands.
- **CI hardening** — quality gates are hermetic and complete: clean Linux smoke runners supported, ripgrep installed on the live smoke runner, fail-fast with retry on the apt install step, and a dummy API key for the quality-guard check.

### Tests

- MiniMax defaults smoke check now actually runs (it previously didn't); the prompt budget render is isolated from project config; `mcpContextBudget` tests no longer hardcode `/private/tmp`; the new output-style fixes are covered by tests verified to fail against the pre-fix code, plus a roster tripwire that fails if a future style is added without updating the retry allowlist.

## 1.9.1

### Bug Fixes

- **Five defects along the Bash tool's real call chain** — the output size watchdog was armed only inside `ShellCommand.background()`, leaving the entire foreground window (2 minutes by default) uncapped; in file mode the child writes straight to the output fd with no JS in the loop, so a runaway writer fills the disk long before the timeout fires. It now arms from construction and can kill a running command. `BashTool` used `timeout || default` raw — the schema only *describes* its ceiling in prose, so a model-supplied 10-hour value became a 10-hour foreground budget; it is clamped through `resolveTimeoutMs()`, which also rejects `0`/`NaN`/negatives (a negative delay fires `setTimeout` immediately). `BashTool` never read `ExecResult.stderr`, which in file mode is not the command's stderr but the only carrier for `ShellCommand`'s synthetic messages — timeouts, size-cap kills, and pre-spawn `EMFILE`/`EAGAIN`/`ENOENT` failures — so the model saw a bare "Exit code 143". Large output from a *failed* command was persisted after the throw, losing the tail in exactly the case where the tail matters. And the auto-background guard compared `parts[0]` against a whole-subcommand split, so only a bare `sleep` ever matched and every real `sleep <n>` was auto-backgrounded on timeout. **Behavior changes worth knowing**: `sleep 300` is now killed at the timeout (with a clear message) instead of being backgrounded, and a timeout above the advertised maximum is now actually clamped.
- **Compaction recovers instead of failing when the summarize request itself overflows** — a full compaction that came back prompt-too-long had no retry path. It now re-runs as a partial compaction with a pivot sized from the reported overflow (parsed across the Anthropic/Vertex/Bedrock error shapes, falling back to halving when no gap is parseable) and snapped to preserve API invariants, with a genuine last-resort head-truncation round whose marker names the transcript so the dropped turns remain findable. Microcompact learned to write to-be-cleared content to disk and substitute pointers, deliberately without a preview — a preview would defeat the clearing. Separately, `shouldAutoCompact` now names a failure it previously only suffered: when the *fixed* prefix (system prompt, tool schemas, userContext — usually a large MCP tool set) clears the threshold on its own, every compaction succeeds and the next turn re-triggers, because summarizing messages cannot shrink the part that is actually too big. The log now says what to go turn off.
- **Four loop-safety mechanisms restored from upstream 2.1.220/2.1.233** — dropped during the original reconstruction, verified against the shipped darwin-arm64 binaries. `stop_hook_active` is only advisory input to the hook process, so a hook that always blocks looped the turn forever; consecutive blocking continues are now counted and force-end the turn past `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (default 8). Interactive REPL sessions had no turn cap at all, now backstopped by `CLAUDE_CODE_MAX_TURNS` (an explicit `--max-turns` or SDK option still wins). Context refilling past the autocompact threshold within 3 turns, 3 times running, now ends the turn with upstream's thrashing message instead of paying a summary call every few turns forever. And when a failed stream had already yielded tool_use blocks, the non-streaming fallback re-issued them and re-ran the same tools; it now continues with the partial response, which also fixes a duplicate-`tool_result` 400 on the `model_error` path.
- **Context claims the harness cannot honor, and the caches that served them stale** — `# System` promised "your conversation is not limited by the context window", which is false in any session that disabled compaction (`DISABLE_COMPACT`, `DISABLE_AUTO_COMPACT`, `autoCompactEnabled`); it is dropped as a duplicate, since `CONTEXT_MANAGEMENT_SECTION` ships unconditionally and already carries both halves. When compaction is off, session guidance now supersedes that section by name rather than contradicting it. Alongside: `resolveSystemPromptSections()` and `toolToAPISchema()` both awaited inside their compute and then wrote back unconditionally, so a `clearAllCaches()` landing mid-render restored the stale value into the cache it had just emptied — making `/reload-plugins` nondeterministically ineffective; both writes are now generation-guarded. `env_info_simple` and `frc` embed the model but were keyed without it, so a mid-session `/model` switch kept serving the previous model's text. Dynamic `/loop` self-rescheduling was unbounded and is now capped at 24 iterations / 24 hours through a single-use opaque token with issued→scheduled→consumed transitions, so a chain cannot be forged, replayed, or reused. The verbose prompt head compresses 24,053 → 17,615 characters (-27%) with every pinned upstream phrase still rendering.
- **Tool results can no longer plant instructions in the compacted summary** — the standing-instruction harvest widened what the compact summarizer collects as user intent, but the attribution guard only excluded fake user turns embedded in assistant messages. Tool results ride in user-role messages while carrying attacker-controllable data (MCP responses, fetched pages), so instructions planted there could be swept into the summary and re-attributed as genuine user constraints on every subsequent compaction.
- **`RemoteTrigger` is reachable by classifier review in auto mode** — it had no `checkPermissions` override, so it fell through to `buildTool()`'s default unconditional allow. Because `hasPermissionsToUseTool` short-circuits on an allow result before the auto-mode classifier block runs, its create/update/run actions were not merely skipping the interactive dialog — they were skipping the classifier entirely. Ports upstream 2.1.233's gate: `auto` routes to passthrough, every other mode keeps the prior behavior.
- **A discarded streaming executor no longer pins the "tools running" state** — `StreamingToolExecutor.discard()` abandoned the in-progress marks it had taken. The only path that clears them returns early once discarded, and the fallback retry re-requests the turn and comes back with new `tool_use_id`s, so the old ids were never seen again and the REPL kept rendering tools as running for the rest of the session. Clearing alone was not enough: each tool's `promise.finally` re-enters `processQueue()`, which did not check `discarded` and would start a queued tool, re-adding a mark nothing would clear — `executeTool()` now bails out at the top, making good on `discard()`'s own doc comment that queued tools will not start. The same shape in `toolOrchestration` (cleanup as a trailing statement, skipped when a consumer stops pulling) moves into `finally`.

### Chores

- **277 dead exports, 6 orphan modules, and 4 unused barrel re-export sets removed** across four staged batches: 29 `*ForTesting`/`_reset*` hooks that came over during the upstream port without the tests that used them, 23 barrel re-exports every consumer already reached past, 28 unused types (six of them duplicate declarations whose same-named twin is the one actually consumed), and 197 exported declarations across 145 files plus `FlashingChar`, `MonitorTool`, `WorkflowTool/constants`, `contextAnalysis`, `peerAddress` and `withResolvers`. Also fixes 9 doc comments naming now-deleted functions — most consequentially `teamMemPaths.ts`, which pointed write validation at a function that no longer existed. Because 135 of the 139 touched files carry `@ts-nocheck`, `tsc` alone proves little here; a separate pass re-ran the checker with `@ts-nocheck` stripped from exactly those files and found zero "cannot find name" diagnostics.
- **The loop parser's side effect is named** — `parseLoopArgs` consumed the chain token from the registry, so a second call on the same arguments silently killed the chain. Renamed to `parseAndConsumeLoopArgs` with its one-call-per-dispatch contract documented, and a `withLoopState` helper wrapping five provably-identity returns was folded away. No behavior change.
- README corrections: `build:dev:full` enables 52 experimental flags, not ~70, and `NOA_CLAUDE_MAX_CONCURRENT_AGENTS` (shipped in 1.9.0) is now listed under Runtime Toggles.

### Tests

- **First coverage for the Bash tool** — it previously had none: nothing in `src/test` touched `BashTool`, `Shell`, `ShellCommand`, `TaskOutput` or the permission modules, so for the subsystem that is both the main side-effect surface and the main security boundary, `bun test` gave no signal at all. 30 cases across three files drive real processes through the real stack (the only stand-in is a ~20 line fake `ToolUseContext`): foreground and background size-cap kills, timeout kills and their stderr message, auto-background handoff, abort-kill versus the deliberate no-kill on `interrupt`, exit-code mapping, timeout clamping, the sleep guard, and persisted-output paths on both success and failure. Each case was verified to fail against the pre-fix code. Not covered: the permission layer (`bashToolHasPermission` is 894 lines over a 2.6k-line dependency tree) and `PowerShellTool` end to end.
- **First coverage for the tool result budget** — `toolResultStorage.ts` carries the prompt-cache stability rules for tool results and had no direct test, and its failure mode is a silent cache miss: nothing errors, the turn just costs more. 27 cases pin the invariants the comments claim — a result left unreplaced is never replaced later, a replacement re-applies byte-identically and is not re-reported, tagged content is skipped even by a state that has never seen it, same-id assistant fragments do not split a budget group, skipped tools freeze rather than persist, and reconstruction freezes every candidate while restoring stored replacements verbatim. Every assertion was checked by mutation: breaking frozen partitioning, group flushing, the size clamp, `skipToolNames`, the gap-fill guard, or the already-compacted check each fails a test.
- Prompt-size assertions gained floors (14,000 / 14,000 / 11,000 against measured 17,615 / 17,569 / 12,429). They previously asserted only upper bounds, so a head that lost a whole section would have read as a compression win.

## 1.9.0

### New Features

- **Auto mode ports upstream 2.1.233's unified classifier template** — drops the legacy tool_use classifier for the two-stage XML path and unifies on the external permissions template: `hard_deny` rules, `"$defaults"` splicing, a settings-deny anti-circumvention block, a session-identity block, and `<category>` verdict parsing. Settings deny rules are sanitized before entering the classifier prompt (`projectSettings` loads them without a trust gate), and CCR now honors `defaultMode: "auto"`.
- **`/cost` reports session auto-mode classifier counters** — calls, latency, outcome breakdown (allowed/blocked/unavailable), stage-2 escalation rate, re-sample count, and token totals for the session, folded in at the one call site every classifier request passes through. Renders nothing when auto mode never ran; in-memory only, reset with the cost totals.
- **`/login` repeats the `CLAUDE_CODE_OAUTH_TOKEN` override warning after success** — ported from upstream 2.1.229. By the time login completes the entry warning has scrolled behind the browser round-trip, so a bare "Login successful" used to read as "you are now on the new account". Wording is adapted: unlike upstream, this fork does not clear the env token during login, so the token keeps winning the auth header and the message says so instead of claiming a switch that would be false.
- **MCP OAuth gains a `MCP_OAUTH_REDIRECT_HOST` escape hatch** — `localhost` stays the default (byte-identical to upstream 2.1.231, which reverted its own `127.0.0.1` experiment after it broke pre-registered OAuth clients like Slack), but a strict authorization server that only allows loopback IP redirect URIs under RFC 8252 can now opt into `127.0.0.1` without breaking the default path. The accepted values are a closed set — an arbitrary host would be an exfiltration vector for the auth code, and `[::1]` is excluded because the callback listener only binds IPv4 loopback.
- **Sandbox approvals bracket IPv6 hosts in approved domain rules** — unbracketed multi-colon entries (`::1:443`) were read by the sandbox matcher as one addressless host with no port split and silently never matched. `noa doctor` and the `/sandbox` panel now flag existing unbracketed entries too. Bumps `@anthropic-ai/sandbox-runtime` to 0.0.71 for the bracket-aware pattern parser.
- **Clipboard and dragged-in image pastes no longer stall the event loop** — aligning with Claude Code 2.1.232: screenshot and drag-in reads switch from a sync file read to an async one, removing an unbounded stall on large pastes or slow filesystems. Re-pasting the same text as a collapsed `[Pasted text #N]` now expands it inline (100k cap), with a footer hint, mirroring upstream's armed-paste state machine.
- **Fullscreen mode deletes a selected input span with one Backspace/Delete** — mirrors Claude Code 2.1.232: with a text selection lying fully inside the prompt input, Backspace/Delete removes the whole span in one keystroke (undoable, cursor lands at the deletion start). Selections spanning into the transcript, empty ranges, and modal-overlay states fall through to normal editing unchanged.

### Bug Fixes

- **WebFetch rejects private-range and link-local addresses even with the domain-blocklist preflight disabled** — `validateURL`'s only internal-network filter was a hostname-shape check that every literal IP passes (`169.254.169.254`, `10.0.0.1`, `127.0.0.1` all "have a dot"). The default configuration was protected by a preflight call to `api.anthropic.com`, but `settings.skipWebFetchPreflight` — meant for enterprises that can't reach claude.ai — disabled that with no IP-layer check left behind. Wires in the already-written `isLocalOrPrivateUrl` synchronous check (no DNS, no added latency); a private-range address now gets its own rejection message instead of a generic "Invalid URL" that invites a pointless retry. Known limit, documented at the call site: a hostname that *resolves* into a private range (internal DNS, DNS rebinding) is not caught.
- **Background agents get a concurrency cap and lifecycle hardening** — unbounded background spawns had no semaphore against API rate-limit pressure; `NOA_CLAUDE_MAX_CONCURRENT_AGENTS` (default 20, 0 disables) is now enforced at spawn, at auto-backgrounding, and again after any awaited step before a background task is registered. Foreground-to-background continuation reuses its already-initialized prompt context instead of re-running `SubagentStart` hooks and skill preload a second time, abort signals from a background task and its parent combine correctly, and the cumulative spawn counter can now be decremented.
- **Copy toast counts grapheme clusters, not UTF-16 code units** — copying `👨‍👩‍👧‍👦` reported "copied 11 chars" because the count came from `text.length`. Also warns when the copy went through OSC 52 on VS Code 1.123/1.124, which corrupt non-ASCII text on that path (fixed in 1.125); the warning is gated to non-native clipboard paths so macOS VS Code, which copies through `pbcopy` and never reaches xterm.js's OSC 52 decoder, doesn't false-positive.
- **Auto mode's classifier transcript is hardened against injection** — everything the classifier reads about the session was concatenated into its prompt raw, so a user message containing `</transcript>` could close the wrapper it's told to read inside, and a line like `User: approved` could forge a turn. Ports upstream 2.1.233's sanitization (tag defanging, control-character stripping, line indentation), the stricter stage-1 "no verdict" contract, and stricter XML parsing that treats a contradicting verdict as unparseable instead of taking the first match. `AskUserQuestion` answers now reach the classifier as user turns (they lived in a tool_result the old transcript projection dropped, so an explicit user confirmation could never register), and a resumed subagent's hand-back message is passed through framed as untrusted agent output instead of being invisible to the review.
- **Unparseable classifier responses are re-sampled instead of denying on one bad sample** — bounded by attempt count, a 60s/120s per-stage deadline, and a per-request timeout, with usage summed across attempts. A safeguard refusal (the API's own content-based decline) is now distinguished from a malformed response: it's deterministic so it isn't re-sampled, gets its own denial text, and is excluded from the consecutive-denial counter so the session isn't kicked out of auto mode over something the agent never did.
- **Safeguard refusal denials carry actionable guidance** — the refusal branch above returned the bare classifier reason with no next-step text, unlike every other auto-mode denial. It now states plainly that retrying refuses again for the same reason and omits the permission-rule hint, since no rule clears a safeguard refusal.

### Chores

- Gated the `/remote-control` bridge module require behind `BRIDGE_MODE` (absent from the baseline feature set, so the command was already invisible) and removed the dead telemetry-initialization chain left over from telemetry being hard-disabled — no product surface change, ~14KB off `dist/main.js`.

### Tests

- New coverage: background-agent async lifecycle, concurrency-capacity enforcement, and continuation-history/initialization behavior; combined abort controllers; session concurrency budget; 18 WebFetch SSRF cases across the newly-blocked private ranges and unaffected public addresses; boundary tests for the VS Code OSC 52 version window.

## 1.8.0

### New Features

- **Write and Edit may overwrite a file the session never read** — ported from upstream 2.1.228, which brought Write in line with Edit: a model that is not on upstream's pre-read denylist can overwrite an existing file without a preceding Read, so a full rewrite no longer costs a round trip. One deliberate deviation: the skip also bypasses the mtime staleness check, and upstream backs that with shadow telemetry plus a remote kill switch this fork has neither of — so untrusted model identities (customer-run Bedrock/Vertex/Foundry, Anthropic-compatible third parties) keep the guard the same way they keep the verbose prompt, and `NOA_CLAUDE_WRITE_REQUIRE_READ` stands in for the missing gate. First-party known models behave exactly as upstream does. Partial reads, notebooks, files outside every working directory, and contexts with no reading tool all keep the guard. Both prompt variants are pinned by digest, and `verify:ports` checks all four against the upstream binary.
- **Slash-menu matches are highlighted by range, not by slicing** — ports the range-based matcher upstream introduced between 2.1.220 (this fork's baseline) and 2.1.224. The old renderer sliced at the first UTF-16 `indexOf` hit, which could cut inside a grapheme cluster (searching 👨 in `/ship-👨‍👩‍👧-it` split one glyph across two nodes; "cafe" against a decomposed "café" dropped the combining accent) and highlighted nothing at all on rows the Fuse fuzzy filter had put on screen. Ranges widen to cluster boundaries via `Intl.Segmenter` and merge; a subsequence fallback mirrors the search that selected the row, with `contiguousOnly` for descriptions so a sentence doesn't come back as three isolated letters. Matched runs are now distinguished by **bold** rather than by recoloring, leaving "suggestion" blue to mean only "this row is selected" — on selected rows the old highlight was invisible by construction, painting the match in the row's own color. Deviates from upstream by lowercasing the query itself instead of assuming the caller did, since `matchedPrefix` is public and a mixed-case caller would silently get no highlighting anywhere.
- **Non-interactive sessions get upstream's autonomy guidance** — ports 2.1.226's `autonomy_append`, which tells the model to stop asking permission for reversible work and to finish the turn rather than promise it. Upstream gates it on the model alone (`fable_5_mitigations`); this fork adds a second condition — the session must also be non-interactive — because the text asserts the user "is not watching in real time and cannot answer questions mid-task", which is simply false in the TUI and would suppress questions the model ought to ask. The section name carries a `:fable` suffix so a mid-session `/model` switch busts the memoized value.

### Bug Fixes

- **A failed `security` call is no longer recorded as an empty keychain** — a transient failure and a genuinely empty keychain both collapsed to null, and the async read cached that null for its full 30s TTL. Every MCP server's OAuth token lives in one credentials blob, so a single spawn hiccup made all of them answer 401 at once, which reads as "auth never completed". Exit codes are now classified: 0/44/36 are answers and may be cached; a SIGTERM'd timeout or a missing binary are not, and serve the stale value while leaving the cache untouched. Alongside it: every `security` invocation is bounded (10s for reads/writes/deletes — deliberately above upstream's 2s, because 19 of 22 update sites do `read() || {}` and write the result straight back, so a read that wrongly reports "empty" feeds a blob-clobbering write); the sync-read failure cooldown is widened so a wedged keychain can't freeze the event loop during MCP startup; both prefetch slots are guarded by a generation captured at spawn so a `/login` mid-prefetch isn't undone; a timed-out write reports as transient instead of demoting credentials to plaintext; the keychain account resolves through `getUsername()` everywhere (the legacy read and delete interpolated an unquoted shell `-a $USER` while the write did not, making the entry write-only); and `saveApiKey()` no longer sets `savedToKeychain` regardless of the write's result. Not fixed and load-bearing: `fallbackStorage.read()` still hands `{}` to callers on a transient failure, so the read-modify-write clobber this narrows is not closed.
- **`/clean-sessions` deletion safety rails** — bulk `delete --confirm` could remove any session under the requested size bucket with no human in the loop, and a typo'd flag silently downgraded that protection. The running session's own transcript and anything modified in the last 10 minutes are now never touched; unknown flags and unreadable `--max-bytes` values are rejected instead of falling back to the default bucket; bulk delete is gated behind `--trivial-only` and the default bucket, with anything wider going through the interactive picker; an explicit title is treated as a keep signal rather than deletion evidence; the `<uuid>/` sidecar is deleted with its transcript and counted toward the session's footprint, so a small `.jsonl` with a large sidecar stops passing as a small session; and per-file failures are reported rather than swallowed.
- **`cleanup-data` no longer wipes custom memory directories wholesale** — a user-configured `autoMemoryDirectory` (or Cowork override) was deleted recursively, taking unrelated files with it, and every top-level `.md` was treated as memory-system-managed so a hand-written `notes.md` went with the topic files. Only entries the memory system manages are removed now — `MEMORY.md`, `logs/`, `team/`, `.consolidate-lock`, and `.md` files whose frontmatter carries a valid `type:` — with everything else kept and listed. Default-location dirs still go wholesale. Also: the custom-location label is based on `getMemoryBaseDir()` so `REMOTE_MEMORY_DIR` setups aren't mislabeled, and targets are `lstat`ed so symlinks report honestly instead of inflating the reclaimed size.
- **Two ported prompt sections regained their paragraph breaks** — `AUTONOMY_SECTION` (3 breaks) and the `anti_verbosity` fable branch (6 breaks) had shipped with their blank lines collapsed to single newlines, and both digests were pinned to the collapsed text — so the integrity check certified the deviation instead of catching it. A digest is computed from whatever is already in the file and cannot tell a faithful transcription from a confident wrong one; both are now byte-identical to the 2.1.226 binary.

### Changed

- **The always-on memory prompt is a third of its former size** — the individual-memory prompt spent 7216 characters on four `<description>` essays and eight worked dialogues to say what upstream 2.1.226 says in one line per type. That section is replaced by a 914-character compact form and "## Memory and other forms of persistence" folds into the opening sentence, taking the whole prompt to 4915 characters. Everything with an eval result behind it is untouched — the shortening is a size decision, not a reversal of one. One instruction did not survive ("if your approach changes, update the plan rather than saving a memory"), following upstream, whose compact variant drops the persistence guidance outright. `TYPES_SECTION_INDIVIDUAL` stays exported and unchanged for the one-shot extraction classifier, which has to carry its own examples.

### Tests

- **`bun run verify:ports`** — diffs every pinned lean-prompt port against a real upstream binary, closing the gap a digest cannot cover. Deliberately outside `bun test` and `check:quality` since it needs a binary no CI runner has; without one it reports skipped and exits 0.
- `scripts/*.ts` is now inside the typecheck scope — `include` was `["src/**/*", "*.ts"]`, whose second pattern is root-level only, so the one TypeScript file under `scripts/` was never checked.
- New coverage: 32 keychain tests over exit-code classification, cache poisoning, cooldown windows, prefetch invalidation and account resolution, plus two source invariants in `check-runtime-health.mjs`; every `/clean-sessions` rail; `cleanup-data` arg rejection, preview gating, scope semantics, selective deletion and symlink handling; the pre-read skip end to end through both `validateInput` and `call`; and 12 matcher cases for grapheme-aligned ranges. The slash-menu renderer's color and weight decisions remain unverified — that component has no render harness in the tree.

## 1.7.1

### New Features

- **Fullscreen scrollback retains the full pre-compaction history** — aligning with upstream 2.1.224: repeated compactions no longer trim scrollback to the most recent compact interval; the entire pre-compaction history stays scrollable across any number of compactions. Because suffix-preserving compactions (auto keep-tail, session-memory) re-yield the kept tail after the boundary, the boundary handler now collects the previous boundary's original copies when the next boundary arrives, so no interval ever shows double.

### Bug Fixes

- **Edits that still apply cleanly no longer force a re-read** — ported from upstream 2.1.224 (`tengu_edit_tool_stale_read`): when a file's mtime moved past the last read but `old_string` still identifies a unique, unambiguous target in the current on-disk content, the edit goes through; ambiguity still rejects. FileWrite's validateInput gains the same content-compare fallback, so mtime false positives (Windows sync/AV, byte-identical linter rewrites) no longer force a re-read either.
- **Diffs are taken against raw git blobs** — aligning with upstream 2.1.222: the workspace hunks behind `/diff`, the single-file diff for file edits in web sessions, the `/issue` and `/share` state capture, and the ultrareview precondition check now pass `--no-ext-diff --no-textconv`. A configured `diff.external` made git replace the unified diff with the external program's stdout (parsing to zero hunks), and a textconv filter rewrote hunks so line numbers drifted out of sync with disk. The status-line counters deliberately keep polling without the flags, as upstream does.
- **The Stats panel counts cache tokens** — aligning with upstream 2.1.221: Total tokens summed input + output only, understating cache-heavy sessions severalfold (on a local all-time cache the figure goes from 1.6b to 4.1b, and the model ranking changes). Totals, sort keys, per-model percentages and the per-day chart now run through input + output + cache read + cache write, with a new breakdown line under the stat grid, a per-model "Cache: N read · N write" row, and a B unit on the chart's Y axis. Stale cached day buckets are rebuilt from on-disk transcripts via a `DAILY_MODEL_TOKENS_VERSION` marker. The book-comparison factoid deliberately stays on input + output and is reworded to say why.
- **Sandbox network violations now reach the model** — `@anthropic-ai/sandbox-runtime` 0.0.51 → 0.0.70: network-outbound denies were never recorded into the violation store, so `<sandbox_violations>` only ever carried macOS filesystem denies. The bump records network denies with a reason string and adds a Linux violation monitor giving filesystem-deny parity with macOS.

### Changed

- **Auto mode permission checks reuse one cached conversation prefix** — aligning with upstream 2.1.221, which made three previously gated mechanisms unconditional. The classifier queue introduced opt-in in 1.6.1 is now **on by default** (`NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE=0` forces it off): concurrent classifier calls can't read each other's cache writes, so serializing is what lets a parallel tool batch share one prefix instead of each paying a cache write. Alongside it, the classifier now sees the turn's earlier tool uses appended after the conversation, and pins its transcript block boundaries by splitting out already-classified tool uses — both keep the shared prefix byte-identical across the batch — plus a second cache breakpoint at the end of the transcript. Permission mode is now re-checked after **every** classifier call rather than only queued ones, short-circuited by a mode/auto-active snapshot, and a mode change now re-prompts with the original verdict instead of a rewritten one that could swallow the prompt. (Documented under 1.7.0 in error; the change landed after that tag.)
- **Emoji autocomplete aligned with upstream 2.1.221** — the alias layer (`thumbsup`/`thumbs_up`/`love`/`celebrate`/`hundred`/`plus_one`/`minus_one`/`thumbsdown`/`thumbs_down`) merges into a prototype-safe Map lookup, and accepts route through the shared `applyTriggerSuggestion` (glyph from displayText, trailing space, cursor past it) with the enabled-check re-run at accept time, replacing a bespoke apply path. Documented deviations stay: curated base table instead of the full emojilib dump, `emoji-` id prefix, no telemetry.
- **The lean prompt's output-visibility bullet is ungated** — aligning with upstream 2.1.224, which dropped the `tengu_marl_cormorant` gate so every lean-prompt model gets "- Command output is displayed to you, not reliably to the user." The now-dead `:nb` bit is dropped from the tool-schema cache key (`action_caution` keeps its own; its text still varies).

## 1.7.0

### New Features

- **Custom themes** — ported from upstream Claude Code 2.1.220: user themes from `<config>/themes/*.json`, plugin-provided themes (`<plugin>:<slug>` namespaced), selected via `custom:<slug>` settings refs. Adds the `/theme` picker rows, ctrl+e edit, and a theme editor (name → color tokens → value flow). Palette consumers now render through `useResolvedTheme()` so overrides apply. The upstream safe-mode gate is intentionally omitted (no safe-mode concept in this fork).
- **Lean system prompt and tool descriptions** — a single gate, `shouldUseCompactSystemPrompt()`, drives a compact prompt head and per-tool lean descriptions for newer lean-trained models; older models keep the verbose text. Prompt text is ported verbatim from the upstream binary and pinned by digest tests. Measured on the default tool set: tool descriptions 33.4k → 6.6k chars, static head 13.9k → 2.1k. Also restores sections the fork was missing in every mode: `context_management`, pronoun guidance, act-don't-rederive, plus lean-gated Delivering work and Corrections. The verbose head is realigned with upstream's six-section shape.
- **`/init` interview realigned with upstream 2.1.220** — Phase 0 now probes for an existing project instruction file and branches into review-and-improve / leave-it / start-fresh; Q1 gains a "Let Noa Claude decide" fast path; Q2 becomes a hint rather than a hard filter; Phases 4–7 gate on the approved proposal. The gate is now reachable: it moved from a build flag that baseline builds always folded to false to an env-only switch (`NOA_CLAUDE_NEW_INIT`, legacy `CLAUDE_CODE_NEW_INIT`), still default-off.

### Bug Fixes

- **Launcher resolves config dirs at run time, not build time** — the emitted bootstrap no longer bakes the build machine's absolute home path into `dist/main.js` or overwrites a caller-supplied `CLAUDE_CONFIG_DIR`, so distributed builds resolve `~/.noa` for the user running them. Home resolution falls back to `os.homedir()` (fixing a relative `.noa` being created in the cwd when `HOME` is unset) and exits with a config error when nothing can be resolved.
- **`--bare` mode hardening** — three fixes: it no longer deletes the caller's provider env (an explicitly supplied `ANTHROPIC_API_KEY` was being erased before the client was created); a Bearer `ANTHROPIC_AUTH_TOKEN` (how third-party providers like Kimi authenticate) is now reported as logged in instead of source `none`; and provider-routing keys in the `env` block of user/global settings.json are stripped so an active provider profile can't silently re-enter a bare session. `/provider` under `--bare` now reports the selection takes effect next session.
- **Concurrent sessions clobbering settings.json** — `updateSettingsForSource` now holds a cross-process lock around a fresh read-modify-write, fixing the intermittent fullscreen-mode loss when two sessions wrote at once. Also adopts the upstream `tui` settings key, migrating off the legacy `tuiMode` on write.
- **Auto permission mode was unselectable** — selecting Auto in Default permission mode snapped straight back to Manual: a fork-specific divergence mapped `auto` onto `default` during round-trip. Both halves are restored to upstream, and the rest of the panel is aligned (wording, layout, a new Worktree base ref row, removal of a redundant picker gate).
- **Model identity and capability matching** — customer-run Bedrock, Vertex and Foundry are no longer treated as trusted model identities for the lean prompt (a configured model id proves nothing about the model behind it); they keep the verbose prompt unless a `lean_prompt` capability override opts in. The `[1m]` suffix is now ignored when matching a capability override, so the 1M-context variant of a pinned model can opt in. Session caches for tool schemas and prompt sections now key on the lean/verbose tier, so a mid-session `/model` switch no longer serves the previous tier's text.
- **`cache-probe` reliability for third-party providers** — a per-run nonce guarantees the cold call misses long-TTL provider caches, read/creation cache tokens are split, and `[1m]`-suffixed model ids are normalized so the suffix no longer leaks to the API. The `/effort` message drops a redundant description and the effort notification folds in place.
- **Settings panel alignment with upstream** — the Usage weekly-limit bars show a date when the reset is days out ("Resets Aug 3, 5pm" instead of a bare time), the bar column no longer gets squeezed, Status/Stats spacing and the Stats footer key hint now track focus, the Settings dialog drops its oversized title/subtitle header while restoring the small "Settings" tab-bar label, and the Config Model row resolves through `modelDisplayString` instead of rendering raw stored values like `sonnet[1m]`.

### Changed

- **Default permission mode renamed to Manual** — aligning with upstream 2.1.220: the status line and Shift+Tab cycle now show a named Manual mode (⏸, gray) alongside Plan / Accept edits / Auto. `manual` is accepted as an alias for `default` in settings.json's `defaultMode` and `--permission-mode`.
- **`/extra-usage` renamed to `/usage-credits`** — with copy updated from "extra usage" to "usage credits" across all call sites (rate-limit upsells, API error hints, tips, the `/model` billing suffix). `/extra-usage` stays registered but hidden as an alias, and the `DISABLE_EXTRA_USAGE_COMMAND` env var keeps its name.

### Tests

- The suite is now hermetic against ambient provider env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_*_MODEL`, …) so a developer shell with an active provider profile can't flip tests to branches they never set up.
- The ported lean prompt strings are pinned by digest tests against accidental edits; the verbose head's section shape, gates, and tone rules are pinned by a contract test.
- Coverage added for the launcher env bootstrap (executing the emitted code with controlled env), the `--bare` settings-env strip, the ghost-provider-profile guard, and the settings-write lock.

## 1.6.1

### New Features

- **Claude Opus 5** — added as the first-party Opus default: 1M native context (default and maximum), 128K max output, thinking on by default (turning it off requires an explicit disable, and is only accepted at effort `high` or below — higher efforts are lowered rather than failing the request). Pricing is $5/$25 standard and $10/$50 in fast mode, so fast-mode tier selection is now model-aware. Third-party backends still default to Opus 4.8 and reach Opus 5 only by explicit pin.
- **Auto-mode classifier queue** (opt-in, default-off) — a per-agent FIFO serializer so concurrent tool checks no longer fan out parallel classifier API calls. Enable via `NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE` or the config flag. After dequeue, permission mode is re-validated and falls back to deny/ask if it changed while queued.

### Bug Fixes

- **Resume crash on malformed attachments** — a transcript with a missing or malformed attachment payload crashed resume during attachment migration. Malformed payloads are now validated and dropped (with a warning that the transcript is partially corrupt) instead of throwing.
- **Prompt history lost on write failure** — `immediateFlushHistory` cleared pending entries before the disk write, so a failed append silently dropped those prompts. Entries are now removed only after a successful write and stay queued for retry, with the Esc-rewind-during-write race guarded so a rewound entry isn't resurrected from disk.
- **Third-party Opus fallback chain** — skipped Opus 4.5 entirely (4.6 jumped straight to 4.1); now falls through 5 → 4.8 → 4.7 → 4.6 → 4.5 → 4.1.
- **Model migration notifications** — hardcoded "Opus 4.6"/"Sonnet 4.6" while the migrations write bare family aliases, telling users they'd been moved to a version they hadn't. Now resolved at notification time.
- **Stale model strings** — `/model` 1M-unavailable messages no longer name a version (matching upstream, which names only the family), and default-model descriptions use the current "Best for everyday, complex tasks" wording.

## 1.6.0

### New Features

- **Auto permission mode (shift+tab)** — the previously-mirrored YOLO/transcript classifier subsystem is now live behind a dedicated `AUTO_MODE` flag (shipped enabled in baseline builds), replacing the always-false `TRANSCRIPT_CLASSIFIER` gate. Includes an original (non-Anthropic) classifier system prompt and permissions template, upstream 2.1.210 model gate alignment (denylist instead of allowlist), and classifier request-shape alignment (two-stage XML classifier, temperature, retry count), plus a local customization swapping `auto`/`bypass` order in the shift+tab cycle.
- **Probe-once classifier fallback** — when the main loop model can't self-classify (outside the trusted Sonnet/Haiku families), the first classifier call determines whether the default-Sonnet route works and remembers the verdict for the rest of the session instead of re-probing on every call.
- **Sonnet 5 default** — now the recommended default model across pickers and refusal-message suggestions, with time-boxed introductory pricing ($2/$10 per Mtok through 2026-08-31, then $3/$15) and refactored provider-aware fallbacks (teammate model, refusal suggestions).
- **`/doctor` agentic health-check** — converted from a static screen dispatch into a prompt-driven command that runs read-only diagnostics (install health, unused extensions, memory bloat, slow hooks, context cost, permission-mode tuning) and proposes gated fixes.
- **`/autocompact` command** — persisted `autoCompactWindow` setting (`auto | 500k | 1m | 200000 | 200`), previously only configurable via env var.
- **Precomputed & reactive compaction** (opt-in, default-off) — background summary arming to skip the compact API round-trip, and a real reactive-compact implementation that compacts in place and retries when a turn comes back prompt-too-long.
- **Session-wide safety caps** — subagent spawns and WebSearch calls now cap at 200/session, resetting on `/clear`.

### Bug Fixes

- **Forged system-reminder tag injection** — untrusted content (memory files, hook stdout, a cloned repo's CLAUDE.md) could previously forge `<system-reminder>` block boundaries; now escaped.
- **Mythos 5 capability gaps** — completed thinking/context/structured-output allowlists to match Fable 5 (was silently degrading: rejected sampling params sent, empty thinking-UI blocks, context caps incorrectly capped).
- **StreamingToolExecutor concurrency cap** — now matches `runTools`' concurrency limit, instead of starting all concurrent-safe tool calls at once.
- **Request-too-large message** — corrected to reference the actual 32MB API request ceiling (was reporting the 20MB per-PDF encoding target), and now suggests `/compact`.
- **Provider-switch cache invalidation** — clears the model-string cache and classifier probe state on provider switch, preventing stale verdicts from a prior route.
- **Compact chain hardening** — precompute slot restricted to the main conversation (was leaking across subagents), lifecycle/cleanup gaps closed, and reactive-compact outcome messages now map to their distinct user-facing reasons.

### Removed

- **Bundled `claude-api` skill** — deregistered and deleted (~250KB of per-language reference docs).

### Refactors

- `docs/release-notes.md` restored as the single source of truth for release notes (a stray root `CHANGELOG.md` reintroduced in error is removed).
- `precomputedCompact.ts` de-suppressed from `@ts-nocheck`.

## 1.5.0

### New Features

- **Claude Sonnet 5 model support** — full model registration, cost tracking, and thinking/context handling for the new Sonnet 5 family.
- **Live file-path autocomplete in bash mode** — file paths are now suggested and completed live while typing shell commands.
- **`/cd` command** — moves the session's working directory without restarting the session.
- **Logo animation sequences** — programmatic animation sequences and particle effects added to the startup logo.

### Bug Fixes

- **Effort slider theming** — slider labels for low/medium/high now use semantic theme tokens (`warning`/`success`/`permission`) instead of hardcoded ansi colors, so they adapt to the active theme; `xhigh` gets a dedicated shimmer effect; Speed/Intelligence labels renamed to Faster/Smarter.
- **Hook matcher exact-match** — hyphenated matcher identifiers in hooks now require an exact match instead of a prefix match.
- **Logo banner width** — banner now matches terminal width; fixed dim-color bleed in feed titles.
- **Ghostty spinner alignment** — spinner rendering aligned with upstream Claude Code behavior.
- **Diff/code tab rendering** — leading tabs are now converted to spaces when rendering code and diffs.
- **Local-day stats bucketing** — daily stats now bucket and display by local day instead of UTC.
- **Structured-outputs model allowlist** — aligned with Opus 4.7/4.8; Opus now defaults to a 1M context window.
- **Permission mode fallback** — removed a redundant result fallback in `initialPermissionModeFromCLI`.
- **TUI ratchet viewport** — fixed a feedback loop that could break the ratchet viewport.

### Removed

- **Computer-use feature** — removed the native `ComputerTool` and associated computer-use feature surface.

### Refactors

- Centralized progress types and tightened `Tool` typechecking.
- Cleaned up Noa marketplace and launcher naming.
- Isolated provider environment state in prompt tests to prevent cross-test pollution.

## 1.4.0

### New Features

- **Keep-tail auto-compact** — auto-compaction now preserves a verbatim recent tail instead of replacing the entire conversation with a summary. A pivot is chosen so that older history is summarized while the most recent messages (including in-flight tool chains) remain intact. Falls back to full compaction when the window is too small, the tail would exceed threshold headroom, or the conversation is already re-compacting in a chain. Controlled via `CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL` (default on).
- **Compact safety-constraint preservation** — the compact prompt now explicitly instructs the model to preserve verbatim any safety or destructive-action constraints the user set (sensitive files, forbidden operations, secret handling) so they survive summarization.

### Refactors

- **Query loop harness extracted** — `query.ts` refactored into `query/transitions.ts` (state machine), `query/deps.ts` (dependency injection), `query/config.ts`, `query/tokenBudget.ts`, and `query/stopHooks.ts`. All `@ts-nocheck` annotations removed from the query directory; phantom types (`ToolUseSummaryMessage`, `StreamEvent`, `RequestStartEvent`, `TombstoneMessage`, `StopHookInfo`) now formally defined. Stop hooks are injectable via `QueryDeps` for testability.
- **Dead-code cleanup (13 upstream-only flags)** — removed never-buildable branches for `BG_SESSIONS`, `COORDINATOR_MODE`, `DIRECT_CONNECT`, `FORK_SUBAGENT`, `KAIROS_GITHUB_WEBHOOKS`, `MCP_SKILLS`, `MONITOR_TOOL`, `REVIEW_ARTIFACT`, `SSH_REMOTE`, `TEMPLATES`, `TRANSCRIPT_CLASSIFIER`, `UDS_INBOX`, `WORKFLOW_SCRIPTS`. Added no-op stubs for `HISTORY_SNIP`, `KAIROS`, `TERMINAL_PANEL`, and `EXPERIMENTAL_SKILL_SEARCH` so the dev-full profile bundles cleanly. `FEATURES.md` updated with removal audit.
- **Vestigial sourcemap cleanup** — stripped 12MB of stale inline sourcemaps from 531 source files (leftover from prior bundle reconstruction, mapping to obsolete positions). Tracked source size reduced from ~16.8MB to ~4.7MB for these files; no runtime or build effect.

### Bug Fixes

- **Query loop recovery hardened** — five fixes from harness review:
  1. `stopHooks` snapshot now respects `startsWith` output-style suffixes so `/btw` and styled paths read fresh params.
  2. Goal continuation prompt deduplicated: gated on `state.transition === undefined` instead of `turnCount === 1`, preventing duplicate injection on recovery re-entries.
  3. Prompt-too-long re-yield now tracks `lastAssistantWithheld` so dev-full builds no longer emit withheld errors twice.
  4. `max_output_tokens` recovery carries the escalated 64k cap through retries instead of resetting to the capped default.
  5. `QueryDeps` merge filters explicit `undefined` before spreading, preventing sparse partials from overwriting production deps.
- **Microcompact input clearing** — `clearOldToolResults` now also replaces large Write/Edit input strings (≥1000 chars) with a marker, preventing write-heavy sessions from retaining duplicate on-disk content that dwarfed actual tool results.
- **Reactive compact stub** — added `services/compact/reactiveCompact.ts` no-op stub so `--feature=REACTIVE_COMPACT` builds no longer fail with "Could not resolve".
- **Provider profile credential validation** — API keys now pass CJK/whitespace denylist normalization before becoming Bearer tokens, preventing malformed credentials from reaching the wire.
- **Bedrock count_tokens adaptive thinking** — `countTokensWithBedrock` now branches on `modelSupportsAdaptiveThinking` for Opus 4.7/4.8 and Fable 5, fixing silent degradation to rough estimation when `budget_tokens` was rejected on adaptive-only models.
- **Fire-and-forget promise rejection handling** — `recordTranscript` (3x in `QueryEngine.ts`) and stop-hook executions (`executePromptSuggestion`, `executeExtractMemories`, `executeAutoDream`) now attach `.catch(logError)` instead of relying solely on the global `unhandledRejection` net. Failed transcript writes log with context instead of surfacing as anonymous `tengu_unhandled_rejection`.
- **Transcript logging rejection handling** — `useLogMessages.ts` enqueueWrite promise now catches rejections, preventing unhandled rejections from the logging pipeline.
- **Remote skill stub contract** — corrected `remoteSkillState.ts` to match the expected stub contract used by `query/transitions.ts`.
- **Kimi model display cleanup** — removed dead `kimi-for-coding` display branches from `model.ts`; display now renders the raw id with no marketing name.

### Tests

- **Query loop recovery tests** — 5 loop-level recovery tests via `QueryDeps` injection: `max_output_tokens` withhold+resume, limit exhaustion, model fallback without mutating caller options, empty assistant turn, maxTurns. Regression guard: recovery limit 3→0 turns 2 tests red.
- **Stop-hook loop tests** — coverage for both stop-hook paths: `stop_hook_blocking` feeds the error back to the model and the second round receives `stop_hook_active=true`; `preventContinuation` ends the turn with the `stop_hook_prevented` terminal.
- **Microcompact tests** — expanded coverage for large Write/Edit input clearing and tokens-saved accounting.
- **Reactive compact tests** — stub contract verification.
- **Auto-compact tests** — 172 lines covering tail pivot selection, tool-chain boundary snap, environment flag disable, small window, threshold headroom, and re-compaction chain fallback.
- **Compact partial tests** — 72 lines covering `getPartialCompactMessagesToSummarize` direction behavior and auto partial failure notification suppression.
- **Provider profile tests** — 63 lines covering credential validation and denylist behavior.
- **Kimi display tests** — repinned to passthrough behavior after display branch removal.

## 1.3.7

### New Features

- **Fable 5 model support** — added full model registration, cost tracking, thinking configuration, context-window upgrade logic, and beta-flag handling for the new Fable 5 model family.
- **Size-triggered microcompact** — compaction now triggers automatically when the conversation exceeds a token-size threshold, with configurable thresholds and a visible "tokens freed" notice. `summarizeMetadata` includes a density budget anchor for more consistent summary quality.
- **Away-summary `/config` toggle** — return recaps can now be enabled or disabled reactively from the settings panel, with state persisted across sessions.
- **Explore/Plan agent personality names** — worker subagents in Explore and Plan modes now get stable display names from the historical-figure pool, with consistent color assignment across the UI.

### Refactors

- **Compact token savings normalized** — compact and away-summary token accounting unified so both paths report savings consistently. SDK schema updated to expose the normalized field.
- **Size-based microcompact tightened** — post-review adjustments to the size-triggered microcompact path: threshold calculation hardened, test coverage expanded.
- **Legacy path cleanup** — removed remaining `.claude-agent` path references from skills, PowerShell validation, IDE detection, secure storage, and error strings. All onboarding and project-instruction loading now uses `.noa` consistently.
- **Dead code removal** — dropped `getVersionChangelog` from `build.ts`, removed stale `AWAY_SUMMARY` feature-flag entries from `FEATURES.md` and build audit, deleted root `CHANGELOG.md` (release notes live in `docs/release-notes.md`).

### Bug Fixes

- **Streaming tool execution opt-in** — the streaming tool execution gate was unconditionally false (GrowthBook hard-disabled). The default is now explicit and can be enabled with `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1`.
- **Streaming tool execution recovery** — `StreamingToolExecutor.discard()` now aborts in-flight tools to prevent double-execution on fallback; the abort listener excludes `'streaming_fallback'` so the turn can retry instead of dying. Context modifiers from concurrency-safe tools are now applied in block order (previously silently dropped), matching `runTools` behavior.
- **Query loop hardening** — yields a warning when a `max_output_tokens` error is withheld but tool execution continues; consumes `pendingToolUseSummary` before `blocking_limit`/`model_error` early returns; copies `toolUseContext` instead of mutating shared options on model fallback; injects the goal prompt before the `toolUseContext.messages` snapshot so tools see the injected prompt.
- **WebSearch/WebFetch always loaded** — removed deferred-loading guards so both tools are available unconditionally, eliminating the silent-unavailability race.
- **WebFetch permissions** — deny/ask rules now take priority over preapproved hosts; matching is case-insensitive; Windows `~\` home paths are resolved correctly before permission checks.
- **Noa project instruction loading** — `.noa/project.md` and `.noa/CLAUDE.md` now load consistently across all onboarding and query paths; legacy `.claude-agent/project.md` fallback removed.
- **OpenAI-compatible shim provider-safe** — the shim no longer assumes first-party Anthropic endpoints; provider detection and capability checks are now provider-agnostic.
- **Away-summary alignment** — recap behavior realigned with official Claude Code 2.1.165 semantics.
- **README** — clarified that this is an independent project, not an active upstream fork.

## 1.3.6

### Bug Fixes

- **OpenAI-compatible streaming usage recovered** — the OpenAI shim never asked for token usage on streamed turns, so OpenAI (and every OpenAI-compatible provider) omitted the trailing usage chunk and cost/token tracking reported zero for streamed responses. Streaming requests now send `stream_options: { include_usage: true }`; the existing usage-only-chunk handling picks the numbers up unchanged. The rare endpoint that rejects the field can opt out with `CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE`.
- **OpenAI-compatible tool schemas no longer 400 under strict mode** — the shim hardcoded `strict: true` on every tool but only normalized the top-level `required`, so any tool with a nested optional field (`SendMessage`, and most MCP-server tools) produced a schema OpenAI/Azure reject with a 400. Tools are now sent non-strict by default, which preserves honest optionality across all providers and removes the side-effect of forcing top-level optional params to be required. Strict mode is available as an opt-in OpenAI/Azure reliability tweak via `CLAUDE_CODE_OPENAI_STRICT_TOOLS`, and its normalization is now fully recursive (every nested object, array item, and `anyOf`/`oneOf`/`allOf` branch gets `required` = all keys + `additionalProperties: false`, with strict-unsupported `$schema`/`$id` keys stripped).

## 1.3.5

### Bug Fixes

- **3P Opus default realigned with upstream** — 1.3.4 dropped the Bedrock/Vertex/Foundry → previous-gen Opus fallback so all providers defaulted to Opus 4.8. Upstream Claude Code still ships that fallback (`if provider !== firstParty return opus47`), so this release restores it. Sonnet/Haiku already match upstream and are unchanged. Bedrock Opus 4.7/4.8 IDs also picked up the missing `us.` CRIS prefix. Users who want Opus 4.8 on 3P can still set `ANTHROPIC_DEFAULT_OPUS_MODEL`.
- **`/claude-api` bundled skill populated** — the `claude-api` skill shipped with empty doc files, so `/claude-api` produced no usable content. All 41 reference docs are now populated to match upstream; the `migrate` and `managed-agents-onboard` flows resolve their references. Lazy file delivery keeps the runtime footprint at ~140KB per invocation instead of ~360KB. Fixed the underlying Bun `.md` loader bug in `build.ts` and `bunfig.toml` so skill imports receive raw markdown text instead of HTML.
- **Compact summary direction labeling** — full-compact paths were not stamping the `direction` field, so `isStaleFullCompactSummary` and the display ternary both relied on the undefined default. The display label was also inverted, so legacy summaries rendered as "from this point" even though full-compact is semantically "up to this point". Both full-compact paths now stamp `direction: 'up_to'`; the display ternary only special-cases `'from'`.
- **Partial compact scoped to the recent tail** — partial compaction now passes a `targetMessageCount` parameter so only the recent original-message tail is summarized, and the prompt carries a "Recent-message boundary" instruction. `formatCompactSummary` is hardened to extract the `<summary>` block before stripping `<analysis>`, so the latter can tolerate attributes without breaking the former.
- **Direct resume handling tightened** — no more fall-through to a custom title search after a UUID lookup misses; the `multipleMatches` error no longer reports a count; custom-title searches use `stopAfterDistinctMatches` to short-circuit; `shouldShowResumeSummaryGate` is wrapped in `try/catch` so a malformed stored goal never blocks resume; `getSessionLogFileInfo` populates `fileSize` for the picker; `ResumeSummaryGate` accepts a `backLabel` prop. `searchSessionsByCustomTitle` is split into focused helpers.

### Refactors

- **Custom title match helpers** — `searchSessionsByCustomTitle` is split into `filterCustomTitleMatches`, `addCustomTitleMatch`, `finalizeCustomTitleMatches`, and `normalizeCustomTitle` so each step is independently testable and the main path reads as a small composition.

## 1.3.4

### New Features

- **`/goal` auto-verification** — `/goal` and `/goal replace` now accept `--max-turns N` and `--verify "<cmd>"` flags. When a verify command is set, it runs automatically after each eligible turn; a non-zero exit blocks goal completion regardless of the evaluator's verdict. Model-requested completion stays pending until both verify passes and the evaluator approves. Verify state is preserved across session restore.
- **Built-in Explore/Plan subagents enabled by default** — `BUILTIN_EXPLORE_PLAN_AGENTS` now ships on for all build profiles. The GrowthBook A/B gate is hard-disabled in this build, so the feature is unconditional.
- **Startup banner redesigned** — new 8-line block-font ASCII logo, rounded box corners, content-driven width, inline `/provider` hint, and refined info row ordering. The endpoint row is back; the minimum width is now 64.
- **Single-file grep read registration** — `grep` / `egrep` / `fgrep` commands targeting a single file now register that file as "read", so a follow-up `Edit`/`Write` no longer needs an explicit `Read` first. Aligns with upstream Claude Code.

### Refactors

- **Compact prompts streamlined** — near-duplicate analysis instructions were merged into a parameterized helper, shared sections extracted into a constant, the summary section count was reduced from 9 to 8, an explicit `<summary>` tag instruction was added, and a density budget anchor was added. Net result: ~35% fewer prompt tokens per compact call with the same information fidelity.
- **`execFileNoThrow` converted to async/await** — prerequisite for the new awaitable goal-verify path; uses execa's `cancelSignal` API.
- **Goal state flag parsing** — ad-hoc parsing replaced with a typed `GoalFlagError` union, centralized error messages, and shared `GOAL_OPTIONS_USAGE` help text.
- **Command-surface cleanup** — removed stale build-excluded entries (`/agents-platform`, `/torch`) and stub entries (`/onboarding`, `/env`) that no longer have a backing file. Verified zero string-literal references remain.

### Bug Fixes

- **Agent worktree notification guarantee** — background agent tasks could permanently occupy the coordinator panel when the worktree probe threw, because the throw skipped `enqueueAgentNotification` and `evictTerminalTask` is gated on `notified: true`. Added `safeWorktreeResult` / `safeCleanupWorktree` helpers and a finally-block safety net that emits a minimal `failed` notification if all normal dispatch paths were skipped. The handoff classifier and the worktree probe now run in parallel.
- **Compact context recovery hardened** — `/compact` session recovery strengthened against malformed snapshots and interrupted streams, covering both interactive and auto-compact paths.
- **Empty compact summary blocks** — prevented empty transcript blocks from appearing in compact summary output.
- **Invalid thinking signature stripping** — thinking block signatures are bound to the API key/context that produced them; mid-session model/provider switches and interrupted streams could persist stale signatures that failed with a 400 on replay. Three replay paths are now closed: `/compact` strips all thinking before summarization (lossless since thinking is disabled there), `/resume` strips all thinking in `deserializeMessagesWithInterruptDetection`, and `filterInvalidSignatureThinkingBlocks` drops empty-signature blocks at any position in API normalization.
- **Provider gating tightened** — first-party and third-party provider switching hardened across beta flag handling, model remapping, and WebSearch tool provider checks.
- **Model adaptation for Opus 4.8** — Opus 4.7+ thinking defaults to `display: 'summarized'` in adaptive mode to avoid streaming empty thinking blocks; Opus 4.8 defaults to `high` effort (per the official models overview), with `xhigh` remaining opt-in; Sonnet 4.6 max output corrected from 128k to 64k (128k/300k is Batches-only).
- **Compact cache cleanup** — removed redundant `getUserContext.cache.clear` calls from three sites; `postCompactCleanup()` already handles this internally.

### Docs

- **README** — fixed commands, shortcuts, and governance info.
- **Operating guide** — documented the new `--max-turns` and `--verify` flags and auto-run verify behavior.
- **FEATURES.md** — added `BUILTIN_EXPLORE_PLAN_AGENTS` (default-on) and audit entries for `DUMP_SYSTEM_PROMPT` and `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED`.

## 1.3.3

### New Features

- **Claude Opus 4.8** — added support for the new flagship model.
- **OpenAI-compatible `reasoning_effort` translation** — opt-in via `CLAUDE_CODE_OPENAI_REASONING_EFFORT`; maps effort level to OpenAI's top-level `reasoning_effort` field. Max is clamped to `xhigh` (no OpenAI equivalent). Bedrock 4.7/4.8 effort allowlist also added.
- **Hide pre-compact tail from main view** — full-compact preserved tail no longer renders alongside its source summary; transcript (`ctrl+o`) still shows everything for inspection.

### Refactors

- **Drop incremental full-compact path** — the incremental checkpointing added in 1.3.2 is removed in favor of a simpler full-history rewrite. Edge cases (UUID collisions, summary ordering, stale-tail visibility) had accumulated; the cost was not paying off in practice. `compactConversation` now summarizes the whole post-boundary history in one pass.
- **Shared memory-file detection in compact** — centralized the JSONL memory-file detection helper so both compact paths and the session-memory path agree on the boundary.

### Bug Fixes

- Fixed `Opus 4.7+` 400s on `temperature` / `top_p` / `top_k` — those models removed sampling params; `verifyApiKey` and `queryModel` now skip `temperature` for `opus-4-7` and `opus-4-8`.
- Fixed `/provider` success string and dismissed-modal transcript entries leaking into the model context — both routes now use `display: 'skip'` plus a transient notification, since `SystemLocalCommandMessage` is wrapped as a user message by `normalizeMessagesForAPI` and shipped to the API.
- Fixed partial-compact duplicate-UUID collision in fullscreen rendering via per-base-key dedup counters.
- Fixed MCP tool input schemas that the Anthropic API rejects (top-level `oneOf` / `anyOf` / `allOf` or missing `type`) — `normalizeToolInputSchema` flattens composition keywords and defaults the type to `object`.
- Fixed `scope: "global"` system-prompt cache gating — broadened from "MCP tools only" to "any non-deferred tool", so built-in-tool-only requests no longer hit the 400.
- Fixed compact summary ordering — the post-compact message list now places `summaryMessages` after `boundaryMarker` and before any preserved content, matching the documented invariant.
- Fixed subagent worktree creation leaking the personality name on failure; corrected `daVinci` → `DaVinci` in the worker name pool.
- Updated default model health check to `Opus 4.8`; Bedrock 3P effort now defaults to `xhigh` via the provider allowlist.

### Chores

- Cleaned up review-flagged doc debt and a stale comment in `processSlashCommand.tsx` that contradicted the unconditional-skip code path.
- Updated launcher release notes to match the new compact behavior.

## 1.3.2

### New Features

- **Incremental compaction checkpoints** — full compaction now preserves a recent original-message tail and incrementally updates the prior checkpoint instead of repeatedly re-summarizing the same history.

### Refactors

- **Launcher and bundle hygiene** — `noa` now uses bundled metadata for compatibility checks, keeps mtime-based source rebuilds behind `CLAUDE_CODE_LAUNCHER_AUTO_REBUILD=1`, and rebuild watching ignores non-bundle paths.
- **Command surface cleanup** — removed dead build-excluded command registrations and the stale stub source directories they depended on.

### Bug Fixes

- Fixed compact cancel UX so manual compact, auto-compact, and message-selector summarize flows treat `Esc`/abort as cancellation instead of surfacing generic error states.
- Fixed highlight loading and session title fallback paths that could trigger hook-order issues or malformed titles.
- Fixed compact progress UI cues so compaction is visibly distinct from regular request activity.
- Fixed launcher version display so `noa` shows a stable user-facing version instead of a stale dev bundle suffix.
- Fixed session-memory compaction to run `PreCompact` and `PostCompact` hooks and to label the boundary marker with the actual trigger (`manual` vs `auto`). Previously the fast path bypassed both hooks and always wrote `auto`. Users with heavy `PreCompact` hooks will see the hook latency on every auto-compact attempt now, including ones that previously skipped it.

## 1.3.1

### New Features

- **Worker personality names** — generic worker subagents now get stable display names from a deterministic historical-figure pool, with color assignment that stays consistent across the UI.

### Refactors

- **React runtime deduplication** — build output now resolves `react`, `react-dom`, and `react-reconciler` through a single physical path so the bundled app does not carry duplicate React runtimes.
- **Claude in Chrome optional dependency handling** — startup now treats `@ant/claude-for-chrome-mcp` as truly optional and avoids auto-enabling the feature when the package is unavailable.

### Bug Fixes

- Fixed `bun run dev` and bundled startup from trying to resolve a missing `@ant/claude-for-chrome-mcp` package as if it were required.
- Fixed `Claude in Chrome` auto-enable logic so the feature does not get advertised or wired up when the optional MCP package is absent.

## 1.3.0

### New Features

- **Complete curl-installer distribution pipeline** — native install/uninstall/update chain via `curl -fsSL https://noa.ai/install.sh | bash` with atomic swap and rollback, compatible with Homebrew, WinGet, and apt/dnf.
- **Opus 4.7 xhigh effort level** — new xhigh speed/intelligence tier for Opus 4.7, removing the per-level capability gate and delegating clamping to runtime.
- **Auto-dream hardening** — lock stamp moved to post-success; adds model downshift and session cap for resource-bound environments.

### Refactors

- **Global rebrand** — all `.claude-agent` config paths, startup banners, and mode aliases renamed to `.noa` / `Noa` / `noa` / `Noa Claude` across the entire codebase.
- **Onboarding simplification** — drop redundant lodash memoize wrapper; drop sticky completion flag (derive from cwd state instead).
- **Provider profile cleanup** — `ENABLE_TOOL_SEARCH` removed from managed env keys.

### Bug Fixes

- Fixed Windows cross-project resume producing a PowerShell-incompatible `cd` command.
- Fixed spinner and elapsed-time disappearing after terminal resize or window refocus.
- Fixed skill list overflowing tab bounds inside margin box (constrained height + wrap).
- Fixed prompt suggestions not responding to mouse hover/click.
- Fixed provider command race condition and error message missing for third-party users.
- Fixed computer-use chat workflows taking routine screenshots; now prefers keyboard-driven search-selection in WeChat and similar apps.
- Fixed auto-compact entering infinite loop when collapse threshold reaches zero.
- Fixed prompt-cache attaching dynamic attribution header to `systemHash` (stripped).
- Fixed subagent resume losing cwd context and compact rollback leaving orphaned state.
- Fixed sync/async write race in sessionStorage transcript writes.
- Fixed release-notes sidebar layout rebalancing.

### Chores

- README rewritten to 172 lines with feature-first structure, keyboard shortcuts, agent execution guidance, and complete session commands.

## 1.2.0

### New Features

- **Native macOS Computer Use** — replaced the Anthropic MCP-based desktop control path with a self-contained macOS implementation built on `open`, AppleScript, `cliclick`, `screencapture`, `pbcopy`, and `pbpaste`.
- **App-first workflow** — GUI actions now require the intended app to be opened or activated first, with frontmost-app guards to keep follow-up actions anchored to the right window.
- **Search confirmation flow** — search-driven interactions now treat contact/item selection and message entry as separate phases, requiring `Return` after search results before typing the next payload.
- **App identity aliases** — common app names, localized names, and bundle ids are normalized so WeChat, Weixin, 微信, and similar variants resolve consistently.

### Refactors

- **Desktop control hardening** — coordinate actions now require a fresh screenshot context and invalidate cached coordinates after mouse actions, reducing stale-click failures.
- **Clipboard-backed typing** — non-ASCII and long text are routed through clipboard paste with clipboard restoration to avoid corruption from key synthesis.
- **AppleScript gating** — low-risk `open location` calls pass through while destructive AppleScript verbs still trigger approval.

### Bug Fixes

- Fixed focus drift after app switching by reactivating the target app before foreground actions when needed.
- Fixed `menu_click` so real menu-path failures are no longer hidden by alias retries.
- Fixed retry behavior so a failed GUI flow restarts from app activation instead of assuming the previous app state is still valid.
- Fixed log path matching for normalized project paths, including Windows drive letters.

### Chores

- Removed legacy computer-use MCP wrappers, cleanup helpers, and dead stub commands.
- Updated prompt guidance and regression coverage for the new computer-use flow.

## 1.1.0

### New Features

- **Goal evaluator-driven auto-continue** — goals now automatically continue up to 5 turns when the evaluator determines work remains. Each turn the evaluator scores goal progress and decides whether to keep going.
- **Richer goal state** — goals now track `autoContinueTurns`, `maxAutoContinueTurns`, `lastEvaluatorReason`, `completedAt`, and `stopReason` for better visibility into goal lifecycle.
- **Goal evaluator Haiku integration** — `evaluateGoalCompletion()` queries Haiku with a conservative prompt and JSON schema output to score goal progress from conversation context.
- **Centralized goal notice formatting** — `goalNotices.ts` consolidates all goal lifecycle message templates (`formatGoalCompleteNotice`, `formatGoalBudgetReachedNotice`, `formatGoalPausedNotice`, etc.) for consistent user-facing output.
- **Goal audit logging** — `goalAudit.ts` emits structured debug logs for all goal state transitions (start, success, failure, auto-continue, paused, budget-limited).

### Refactors

- **Sessions tab removed** — agents UI cleaned up: removed `SessionsView`, `SessionDetail`, `SessionRow`, and `useSessionPolling`. AgentsList and AgentsMenu simplified.
- **Build system migrated** — build script refactored from `Bun.spawn` CLI to `Bun.build()` API with a stub plugin for optional modules (`@ant/claude-for-chrome-mcp`, `@anthropic-ai/sandbox-runtime`) and feature-flag preprocessing.
- **Tree connector visual refresh** — replaced `⎿` (U+23BF) with `└─` box-drawing character across all UI prefix gutters for cleaner terminal aesthetics.

### Bug Fixes

- Fixed coordinator task panel visibility filtering.
- Fixed `decideGoalEvaluatorAction` to return `exhausted` when auto-continue turn limit is reached (instead of incorrectly calling the evaluator).
- Fixed context truncation in `buildGoalEvaluatorContext` to tail-first (preserving latest evidence) instead of head-last.

### Chores

- Added `node-forge`, `@pondwader/socks5-server` as transitive dependencies via `@anthropic-ai/sandbox-runtime`.
- Added `@anthropic-ai/vertex-sdk` for Vertex AI integration.

## 1.0.9

### New Features

- Added Sessions view — view, select, and kill active agent sessions directly from the agents menu.
- CLI `agents` command now displays active sessions alongside configured agents.

### Bug Fixes

- Fixed emoji highlighting using incorrect UTF-16 code unit boundaries — now uses Intl.Segmenter grapheme boundaries for proper multi-grapheme emoji handling.
- Fixed multi-image paste so each image correctly captures its own undo state using synchronous ref writes.
- Fixed dark theme hyperlink color (blue → cyan) for better accessibility on dark terminals.
- Fixed symlink path resolution by adding safeRealpath fallback for broken symlinks in settings detection.
- Fixed marketplace key resolution to match by source when settings key differs from manifest name.

### Chores

- Added `xhigh` effort level option for Opus 4.7+ models.
- GradientBanner now correctly passes displayModelLabel to provider detection.

## 1.0.8

### New Features

- Increased slash-command overlay visible items from 5 to 12 for a more browsable fullscreen experience.

### Bug Fixes

- Refactored system prompt generation to extract core execution guards into a dedicated section, ensuring these constraints are always present regardless of output style configuration.
- Removed the automatic scroll repin behavior when typing into an empty prompt, reducing interruption while reading long output.
- Fixed ink viewport resize behavior to preserve scrollback in default (non-alt-screen) mode.

### Chores

- Added `.claude-agent/settings.local.json` to `.gitignore`.

## 1.0.7

### Bug Fixes

- Fixed MCP tool results that return both `content` and `structuredContent` so visible blocks are preserved instead of being replaced by JSON.
- Fixed normal worktree creation to base new worktrees on local `HEAD`, preserving unpushed commits.
- Fixed npm plugin cache updates so unpinned packages refresh on explicit update and semver ranges are compared against cached versions correctly.
- Fixed `/context` output so the transcript stays visible without being added to the model-visible message history.
- Fixed MCP URL policy matching for mixed-case schemes and hosts.
- Fixed parallel Bash execution so read-only Bash failures no longer cancel unrelated read-only siblings.

### Chores

- Added regression coverage for the MCP, worktree, plugin cache, `/context`, policy matching, and streaming executor fixes.

## 1.0.6

### Bug Fixes

- Fixed release notes panel sometimes not appearing after upgrade because `lastReleaseNotesSeen` was written before the async changelog cache had loaded.
- Fixed release notes panel flicker on startup by reading `hasReleaseNotes` once via lazy initialization instead of re-evaluating each render.
- Fixed `/release-notes` so Enter expands the selected entry instead of immediately dismissing the panel.
- Fixed `/release-notes` expanded view to stay within a fixed viewport and scroll instead of overflowing the terminal.

### Chores

- Added regression coverage for the synchronous release notes accessor's bundled-changelog fallback.

## 1.0.5

### New Features

- Exposed `bypass permissions` to local users.
- Improved trust handling so the home directory can be trusted without leaking that trust to child directories.

### Bug Fixes

- Fixed fullscreen exit cleanup so residual screen artifacts no longer linger after leaving `/tui fullscreen`.
- Fixed onboarding and trust dialogs so setup screens render and dismiss more consistently.
- Fixed Bedrock `application-inference-profile` requests for Opus 4.7 by resolving the backing model before thinking/effort capability checks.
- Fixed `thinking.type.enabled is not supported` 400s on Bedrock Opus 4.7 inference profiles.

### Chores

- Added runtime coverage for the Bedrock Opus 4.7 thinking path and home-directory trust inheritance.

## 1.0.4

### New Features

- Added `xhigh` effort level for Opus 4.7+ models.
- Added support for GitLab and Bitbucket PR URLs in addition to GitHub.
- Added `CLAUDE_CODE_HIDE_CWD` and `DISABLE_UPDATES` environment variables.
- Added `duration_ms` field to PostToolUse hooks with corrected timeout default.
- Exposed effort level and thinking state to the statusline.
- Added vim visual and visual-line modes.
- Implemented automatic terminal theme detection (light/dark).
- Improved skills menu with better invocation guidance.

### Bug Fixes

- Fixed branch fork copying dangling `tool_use` entries from compacted/snip-removed transcript entries.
- Fixed malformed hooks in `settings.json` causing entire config to be rejected — now gracefully filters invalid hooks.
- Fixed `is_error` flag being lost when PostToolUse hooks replace non-MCP tool output.
- Fixed PostToolUse hooks `updatedMCPToolOutput` field to work for all tools (was MCP-only).
- Fixed resume race condition, UI lock, and fragile error classification.
- Fixed compact distinguished exhaustion, error, and `media_unstrippable` failure messages.
- Fixed wiki infinite loop by removing message state from `useEffect` dependencies.
- Fixed C++ and C# file extension aliases in the Write tool.
- Fixed rename error logging and memory error messages.
- Fixed session atomic branch writes and tag cleanup.
- Fixed feedback submission routing to GitHub Issues instead of Anthropic API.
- Fixed export dialog using deprecated `writeFileSync` — now uses async `writeFile`.
- Fixed startup banner using sync FS calls — now uses `fs/promises`.
- Fixed feedback survey transcript sharing to no longer POST to Anthropic.
- Fixed startup prefetches to be gated on `isFirstPartyAnthropicBaseUrl`.
- Fixed privacy by removing Anthropic URLs and internal-only references.
- Fixed effort slider Ctrl+C handling to properly exit through global exit path.
- Fixed `noa claude` prompt and model chain alignment.
- Fixed Opus 4.7 compatibility issues and updated hardcoded models.
- Fixed fullscreen pill and teammate snapshot.
- Fixed path references and dev-experience improvements.

### Chores

- Unified Noa Claude branding across the codebase.
- Removed dead JS stubs and converged source stubs to TypeScript.
- Restored gated runtime contracts.
- Updated README with dev commands, env vars, and expanded command list.

## 1.0.3

- Fixed plan mode state inconsistency: `/plan open` and `/plan <description>` now work regardless of current mode.
- Fixed MCP OAuth error handling when auth server returns non-JSON (captive portals, proxy auth pages).
- Fixed Windows CRLF paste handling in prompt input.
- Improved command suggestion highlighting in autocomplete.
- Refactored SkillsMenu to standard React patterns (removed React compiler runtime dependency).

## 1.0.2

- Unified `/status`, `/config`, `/usage`, and `/stats` onto the new status panel, with corrected tab navigation and layout.
- Fixed banner/provider refresh so clawd and gradient banner content updates correctly after `/login` and provider switches in default TUI mode.
- Improved model resolution after auth changes so provider-backed defaults are picked up consistently.

## 1.0.1

- Added `/tui` command to toggle between default and fullscreen (no-flicker) terminal UI mode.
- Fixed CondensedLogo never showing — the simplified mascot layout now correctly displays after onboarding and release notes are complete.
- Fixed `/tui` env var priority — `NOA_CLAUDE_NO_FLICKER` now correctly overrides persistent `tuiMode` settings.
- Rebranded user-facing strings from Claude Code to Noa Claude.

## 1.0.0

- Unified the standalone build and compile chain.
- Added global startup banner modes and removed project-level overrides.
- Switched default release notes to a local bundled source.
- Consolidated the default help surface onto repository documentation.
