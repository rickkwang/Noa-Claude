# Release Notes

## 1.15.0

- The settings panel now supports the mouse in fullscreen: the wheel scrolls without dragging the selection, clicking selects a row or changes its value, and the hovered row shows a pointer
- `/btw` keeps a session history of side questions — browse with ⇧←/→ or `[`/`]`, copy an answer with `c`, clear with `x` — and a bare `/btw` reopens the last answer
- Added `/output-style`, `/reload-skills`, and `/pause-memory` commands; `/stats` is now its own command that opens the Stats tab instead of being a `/usage` alias
- Auto mode's classifier now receives a real `git status --porcelain` line (counts only) for commands that can destroy uncommitted work, instead of presuming the tree state (`NOA_CLAUDE_AUTO_MODE_GIT_STATUS=0` disables)
- The turn duration line now shows when the turn finished — "Churned for 3m 15s · done 9:44 PM" — with weekday or date for older resumed turns
- Collapsed teammate messages are now clickable in fullscreen, and the per-row verbose toggle reveals the body
- `kimi-for-coding` realigned with K2.8 Preview (reasoning_effort low/high/max, 1M context); `kimi-for-coding-highspeed` remains K2.7 Code HighSpeed
- Bypass permissions mode no longer silently runs catastrophic removals (`rm -rf /`, `~`, or the working directory and its ancestors); removals hidden in subshells, command groups, and substitutions are now scanned too
- Bash path validation now covers files read through options of `grep`/`egrep`/`fgrep`/`rg`, `awk`, `jq`, `git diff`/`grep`, and `sed`, plus input files of `fmt`, `tac`, `rev`, `fold`, `expand`, `comm`, `cmp`, `pr`, `numfmt`, `tsort`, and `man -l`
- A matching Bash allow rule can now approve in-workspace writes (`tee out.txt`, `mkdir build`) outside acceptEdits mode; `rm`/`rmdir` now ask before removing a working directory or one of its parents
- The stream idle watchdog is now on by default, so a silently dropped connection aborts and recovers through the non-streaming fallback instead of freezing the spinner (5-minute floor, `CLAUDE_STREAM_IDLE_TIMEOUT_MS` raises it)
- Aborting a hung stream now wakes a read stalled on a silent OpenAI-compatible response body
- Reactive compaction re-arms across stop-hook turn boundaries, so hook-driven sessions recover from more than one context overflow per chain
- A leading `!` typed in shell mode is no longer swallowed by the mode-switch or history-restore paths
- Japanese, Chinese, and Korean prompt suggestions are no longer dropped by the word-count and meta-text filters, and CJK response labels are stripped
- Large image pastes no longer hang the prompt: the compiled binary falls back to macOS `sips`, unreadable images become text notes, and clipboard handling is hardened
- A failing `apiKeyHelper` is now surfaced as a row in `/status`, and 401/403 errors point there (inlined under `--print`)
- `/btw` answers that fabricate tool-call markup now carry a notice that nothing ran, and synthetic notices stay out of history
- PDF attachments show "page count unknown" instead of a size-derived page-count guess when `pdfinfo` fails
- The `ctrl+o` transcript renders every thinking block, and click-to-expand covers older `!` bash output and folded tool errors with CJK-aware truncation
- Auto mode: inline `!`cmd` shell commands from skills and slash commands are checked against permission rules instead of the classifier; the report text background agents hand back is now reviewed; safeguard-refusal messages no longer suggest workarounds; the external-code rule keys off where the code came from, not how it was launched
- Removed the duplicate space between spinner glyph and message, and dropped seven spinner tips whose triggers are dead in this fork
- `/release-notes` now matches upstream behavior: a single-column version picker that appends the selected notes to the transcript
- Progress ticks no longer re-derive the whole conversation — a tick at 25k messages costs 0.68ms instead of 6.2ms and leaves row objects intact for memoization
- The Ink renderer fast-paths printable-ASCII line painting and caches horizontal clip slices, cutting cold paint of a syntax-highlighted screen from ~1.31ms to ~0.58ms per frame

## 1.14.0

- `/diff` now opens a live-updating diff sidebar in fullscreen instead of a modal, with three bases (`session`, `uncommitted`, `branch`) cycled via `ctrl+x b`
- The `/plugin` menu now applies plugin changes automatically by queuing `/reload-plugins` when the menu closes, instead of requiring a manual reload
- The statusline command's JSON input gains `workspace.repo`, `workspace.git_worktree`, `thinking`, `fast_mode`, and `pr` fields, and refresh is now event-driven via `statusLine.refreshInterval`
- File writes are now verified against the on-disk file size after writing, so silently truncated writes on network/cloud-sync drives are detected instead of reported as success
- Fixed sandboxed commands ignoring permission rules whose paths contain parentheses
- Fixed backgrounding a foreground agent restarting it from scratch instead of continuing the in-flight run
- Fixed a race where releasing one agent's run could free a different agent's reserved id and delete its worktree
- Fixed foreground agents not releasing their personality name on exit, eventually exhausting the name pool
- Fixed the thread goal being silently dropped on resume after a compaction boundary
- Fixed a failed or vetoed `/summarize` throwing an unhandled rejection instead of reporting the error
- Fixed a plugin declaring `outputStyles` failing to suppress the default `output-styles/` directory
- Fixed a previewed `sed -i` edit being able to overwrite changes made after the preview was computed
- Fixed scroll boxes losing their viewport height when a sibling above them re-rendered
- Fixed restored trailing notes coming back in an unstable order when resuming a conversation that ended in compaction
- Fixed a compaction summary leaking the model's drafting scratchpad when it mentioned `<summary>` tags
- Fixed the hard context limit following the `/autocompact` window instead of the model's real context window
- Compaction now retries on `--fallback-model` when the primary model is overloaded
- Fixed the startup banner rendering a trailing overflow character on logo lines
- Reactive compaction (compact-and-retry on prompt-too-long or media-too-large errors) now ships in the baseline build and is on by default
- Compaction summaries now include an "All User Messages" section listing every user message in order
- Post-compact file restores, plans, invoked skills, and delta announcements are now written to the transcript so resume can replay them
- A PreCompact hook returning `{"decision": "block"}` now actually stops the compaction instead of being treated as guidance
- Keystrokes now get a temporary 4ms frame interval instead of waiting on the normal 16ms render throttle
- Transcripts with many Bash calls render faster due to memoized search/read classification
- Agent progress updates are now throttled to one store write per 100ms per task

## 1.13.0

- Registered Fable 5.1 as its own model (`claude-fable-5-1`), taking over the `fable` alias, with forced tool use disabled, a cheaper $0.25/Mtok cache-read tier, and updated display names.
- Added `NOA_CLAUDE_PROMPT_CACHE_1H` to opt into the 1-hour prompt-cache TTL locally, since GrowthBook's allowlist for it is permanently empty in this fork (off by default; `/doctor` reports which branch fired).
- Replaced the hardcoded per-provider model defaults with an `ALIAS_DEFAULTS` table matching upstream's alias table (Bedrock/Vertex now default to current Opus, Foundry pins Opus 4.6, cloud Sonnet defaults to 4.5, Fable defaults to 5.1).
- Fixed Fable 5's third-party fallback suggestion to point at Opus 5 instead of Opus 4.8.
- Restored Opus 5 as an option in the third-party `/model` picker alongside Opus 4.1/4.8/4.8-1M.
- Corrected the internal justification for Opus 5's third-party context window (native `[1m]` opt-in only, unlike Sonnet 5).
- Fixed Noa reporting its own fork version to the Anthropic API, which caused `claude_code_version_too_old` errors on new models; added a separate `CLAUDE_CODE_COMPAT_VERSION` and `NOA_CLAUDE_API_CLIENT_VERSION` override.
- Gave Fable 5.1 and Mythos 5.1 their own prompt bundle (`fable_5_1_prompt_bundle`) instead of serving them Fable 5's prompt.
- Safeguard refusals on Fable 5.1 / Opus 5 now suggest falling back to Opus 4.8 instead of Sonnet.
- Fixed canonicalization incorrectly collapsing `claude-fable-5-1` into `claude-fable-5`.
- Fable 5.1 / Mythos 5.1 requests now set `prefix_mismatch_behavior: drop_block` so an edited conversation prefix degrades instead of 400ing on preserved thinking blocks.
- `/provider` can now switch back to the Anthropic subscription directly from a stored OAuth account, without requiring `/login`.
- Output styles without their own precedence clause now get an appended "these rules win" statement over the general tone section.
- Data-retention 400s on Fable/Mythos now name the actual workspace setting to change instead of falling through to the generic bug-report flow.
- Redesigned the startup banner with a compact 3-line ASCII logo, reducing vertical space used.
- The prompt caret now renders as the terminal's native cursor instead of a reverse-video block (`NOA_CLAUDE_NATIVE_CURSOR=0` restores the old behavior).
- The animation clock now backs off its tick rate under sustained rendering load instead of stuttering.
- Synchronized-output terminal support is now probed live via DECRQM instead of guessed from `TERM`/`TMUX`.
- Added an offline usage/cost profiler for past sessions under `scripts/`.
- Fixed side queries 400ing on the Fable family when thinking is turned off, by omitting the `thinking` parameter instead of sending `{type: 'disabled'}`.
- Fixed the auto-mode classifier exhausting its token budget on always-on-thinking models, causing safe commands to be misclassified as unparseable.
- Fixed Bedrock inference-profile matching incorrectly matching a `.1` release via substring (e.g. `claude-fable-5` matching `claude-fable-5-1`).
- Reverted a 1.12.0 change that serialized write-capable subagents; parallel subagents now run concurrently again.
- Added an enforced worktree isolation boundary: `Write`, `Edit`, and `NotebookEdit` now refuse absolute paths that resolve out of an isolated agent's `cwd` override back into the shared checkout.
- Fixed resumed agents not reporting when their custom system prompt fell back to the default.
- Fixed `/provider`'s Anthropic row being hidden whenever a third-party profile was active, the exact state it's meant to let you exit.
- Fixed a 400 caused by checking prompt-cache scope against the pre-merge tool set instead of the final merged set (e.g. with WebSearch enabled).
- Non-interactive (`--print`) sessions now get an explicit note that a denied `ask` permission can never be approved, instead of a bare "requires approval" message.
- Fixed AutoFix timeout feedback reporting the literal string "true" instead of the real configured timeout.
- Hook errors (bad matcher patterns, PreToolUse execution failures) are now logged instead of failing silently.
- Fixed long tool-heavy turns leaving blank space in the viewport by budgeting the visible range by rendered-item count instead of message index.
- Corrected six transcription errors in upstream-ported prompt sections that had been digest-pinned but never byte-verified.
- Refreshed the PowerShell tool description port to fix outdated encoding claims and restore dropped sections.
- Fixed `sideQuery` sending `temperature` to models that reject sampling params (Opus 4.7+, Opus 5, Fable, Mythos, Sonnet 5).
- Hardened stdin handling for terminal edge cases: unterminated paste buffers, slow-link SGR mouse reports, and runaway CSI/escape/OSC sequences.
- Fixed several third-party/OpenAI-compatible provider issues: streaming id handling, `reasoning_content` conversion, model id catalogue lookup for separator-carrying ids, env restoration on profile deactivation, `settings.json` permission hardening, tool-choice translation, request timeouts, and haiku-tier side-query model pinning across all 15 provider types.
- Aligned the task-list surface with upstream 2.1.251: `TaskListV2` now caps `maxDisplay` at 5, and `TaskUpdate`'s prompt wording is restored.
- Fixed failed agent spawn reservations leaking a slot instead of being rolled back.
- Fixed a "Maximum update depth exceeded" crash from oscillating viewport visibility.
- Replaced the "unclear request" guidance that invited guessing a target from the current directory with a definition of an identifiable target and an instruction to ask instead.
- Dropped several dated or self-contradicting prompting patterns (TeamCreate's "use proactively" language, a contradictory autonomous-work narration instruction, redundant PowerShell preamble text, and a redundant EnterPlanMode example block).

## 1.12.0

- Third-party provider profiles (Kimi, MiniMax, etc.) now expose the endpoint's own model catalogue in the `/model` picker instead of four Claude-shaped rows pinned to one default, with per-model effort levels, context window, and output limits declared from platform docs.
- A profile-written `ANTHROPIC_MODEL` no longer outranks a `/model` choice on restart.
- Write-capable subagents (general-purpose, custom, unknown types) no longer run concurrently in the same directory, preventing them from overwriting each other's edits; read-only built-ins (Explore, Plan), worktree-isolated agents, and background spawns remain concurrent.
- A custom agent named "Explore" or "Plan" no longer bypasses the write-serialization check by shadowing the built-in name.
- A subagent that errors mid-run now marks its result `[PARTIAL]` instead of returning partial output as if complete.
- An agent whose custom system prompt fails to build now marks its result `[WARN]` instead of silently falling back to the generic prompt.
- Effort is now clamped whenever thinking is explicitly disabled on any model (previously only Opus 5), fixing 400 errors on Sonnet 5 at `xhigh`/`max` effort.
- A carried-over `effort` value from `CLAUDE_CODE_EXTRA_BODY` no longer 400s models that don't accept the `effort` parameter.
- Advisor now supports current models (Opus 4.7/4.8/5, Sonnet 5, Fable 5) via a capability-rank table instead of a frozen two-entry allowlist, and rejects an advisor weaker than its advisee.
- Sonnet 4.6's output ceiling is corrected to 128k (was incorrectly capped at 64k).
- Sonnet 5's $2/$10 rate is now recorded with no expiry (was set to revert to $3/$15 on 2026-09-01).
- `--task-budget` now validates client-side against the API's 20,000 minimum and reports invalid values with `InvalidArgumentError` instead of a fatal stack trace.
- Fast mode no longer offers Opus 4.7, matching its removal from the API.
- WebSearch now sends the `web_search_20260209` tool type on models that support dynamic filtering.

## 1.11.0

- `spinnerTipsOverride` tips entries can now be objects (`{id, text, cooldownSessions?, priority?}`) in addition to plain strings, plus a `tipsFile` path and a `label` prefix, aligned with upstream 2.1.247.
- Clawd now plays a skip entrance animation (hop in, land with a poof) on startup; reduced-motion and non-fullscreen environments still get the static Clawd.
- `noa login` over SSH or in a container now offers a paste-back URL and prompt instead of hanging until the 15-minute timeout.
- `noa auth status` no longer mislabels third-party provider sessions (Anthropic-compatible Bearer tokens, OpenAI-profile sessions) as OAuth or claude.ai subscriptions.
- OAuth credential mutations across processes are now serialized on a dedicated lockfile instead of sharing the config-directory lock.
- Provider profile files are now written with `0600` permissions, and updating a profile no longer erases stored `apiKeys` or leaves a stale key after an endpoint change.
- Non-printable-ASCII characters are now rejected from stored credentials.
- The OpenAI-compatible shim now sends `store: false` (configurable via `CLAUDE_CODE_OPENAI_DISABLE_STORE`), and no longer forwards an Anthropic Bearer token to OpenAI-compatible routes.
- A malformed provider profile no longer crashes startup as an unhandled rejection.
- `noa doctor` now prints a plain-text report in piped/non-TTY contexts instead of throwing "Raw mode is not supported"; checks that fail to run are now listed instead of silently omitted.
- `noa doctor`'s piped path no longer prunes stale update locks as a side effect of a read-only report.
- The curl installer and `noa update` now resolve the newest published GitHub Release at runtime instead of installing from `master`, with `NOA_INSTALL_REF` to pin a version, `NOA_INSTALL_REPO_TARBALL_URL` as a mirror, and `NOA_INSTALL_EXPECTED_SHA256` to verify the tarball.
- The installer refuses to overwrite a `noa` binary it doesn't own and smoke-tests the new build before deleting the backup, restoring the previous install on failure.
- `noa update` now checks the latest published release first and warns instead of blindly reinstalling when the current version is non-semver or GitHub is unreachable.

## 1.10.0

- Proactive and Concise output styles ported from upstream 2.1.237, including per-style one-line reminders attached to the `output_style` system-prompt section.
- The launcher now routes providers based on an explicit `launcherProvider` marker in global config instead of unconditionally overwriting `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` with this fork's MiniMax default; `ANTHROPIC_AUTH_TOKEN` without an explicit `ANTHROPIC_BASE_URL` is now a config error.
- `bun run compile` produces working binaries again; a minification ordering bug previously caused "Cannot access 'X' before initialization" on first use.
- `ANTHROPIC_AUTH_TOKEN` is now accepted as a valid CI credential alongside `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`.
- Caller-supplied `ANTHROPIC_API_KEY` and related env vars are no longer deleted when no provider profile is active.
- Mid-session output-style switches via `/config` now take effect immediately instead of continuing to serve the first turn's cached prompt section.
- The compact spinner no longer gets recolored amber during compaction, matching upstream's blue spinner color.
- Clawd's glyphs are realigned with upstream 2.1.241 (eye field, look-right animation, arm and feet rendering).
- Startup is about 100ms faster (0.39s → 0.28s) via a second identifier-minifying pass on the production bundle, a static top-level import, and removing a recursive `src/` stat on every launch.
- `/rewind` and `/goal` are now registered as implemented non-baseline commands in governance docs and the command surface.

## 1.9.1

- The Bash tool's output size watchdog now arms from process construction instead of only in background mode, capping foreground runaway output.
- `BashTool` timeouts are now clamped through a shared resolver, rejecting `0`, `NaN`, and negative values instead of passing a model-supplied value straight through.
- `BashTool` now surfaces `ShellCommand`'s synthetic stderr messages (timeouts, size-cap kills, spawn failures) instead of showing a bare exit code.
- Output from a failed command is now persisted before the throw instead of being lost.
- `sleep <n>` commands are now correctly detected for auto-backgrounding on timeout (previously only a bare `sleep` matched); as a result, `sleep 300` is now killed at the timeout instead of silently backgrounded.
- Compaction that itself overflows now retries as a partial compaction with a computed pivot instead of failing outright, with a last-resort head-truncation fallback.
- `shouldAutoCompact` now detects and logs when the fixed prompt prefix alone exceeds the threshold, since summarizing messages can't shrink that part.
- Restored four upstream loop-safety mechanisms: a cap on consecutive blocking stop-hook continues (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, default 8), a turn cap for interactive sessions (`CLAUDE_CODE_MAX_TURNS`), an end-of-turn thrashing guard for repeated autocompact-threshold refills, and a fix for duplicate tool re-execution on a failed-stream fallback.
- Removed a false claim that context is unlimited when compaction is disabled; session guidance now supersedes it correctly.
- Fixed cache staleness bugs where `resolveSystemPromptSections()`/`toolToAPISchema()` could write stale values back after `clearAllCaches()`, and where model-dependent prompt sections weren't keyed by model, both causing stale text to persist after a reload or `/model` switch.
- `/loop` self-rescheduling is now capped at 24 iterations/24 hours via a single-use token, preventing a forged or replayed chain.
- Tool results can no longer plant instructions that get swept into the compacted summary and re-attributed as genuine user constraints.
- `RemoteTrigger` actions are now reachable by the auto-mode classifier instead of falling through to an unconditional allow.
- A discarded streaming tool executor no longer leaves the "tools running" state stuck for the rest of the session.

## 1.9.0

- Auto mode now uses upstream 2.1.233's unified XML classifier template with `hard_deny` rules, settings-deny sanitization, and session-identity blocks.
- `/cost` now reports session auto-mode classifier counters (calls, latency, outcome breakdown, escalation rate, token totals).
- `/login` now repeats the `CLAUDE_CODE_OAUTH_TOKEN` override warning after a successful login.
- MCP OAuth adds a `MCP_OAUTH_REDIRECT_HOST` setting to opt into `127.0.0.1` redirects for strict authorization servers (default remains `localhost`).
- Sandbox approved-domain rules now correctly bracket IPv6 hosts (`[::1]:443`); `noa doctor` and `/sandbox` flag existing unbracketed entries. Bumps `@anthropic-ai/sandbox-runtime` to 0.0.71.
- Clipboard and dragged-in image pastes no longer stall the event loop (async file reads instead of sync).
- Re-pasting the same text as a collapsed `[Pasted text #N]` now expands it inline, with a footer hint.
- Fullscreen mode now deletes a fully-selected input span with a single Backspace/Delete.
- WebFetch now rejects private-range and link-local addresses (e.g. `169.254.169.254`) even when `settings.skipWebFetchPreflight` is enabled.
- Background agents are now capped by `NOA_CLAUDE_MAX_CONCURRENT_AGENTS` (default 20, 0 disables), enforced at spawn and auto-backgrounding.
- Foreground-to-background agent continuation no longer re-runs `SubagentStart` hooks and skill preload a second time.
- The copy toast now counts grapheme clusters instead of UTF-16 code units, fixing incorrect character counts for emoji.
- Copying via OSC 52 now warns on VS Code 1.123/1.124, which corrupt non-ASCII text on that path.
- The auto-mode classifier transcript is now sanitized against injection (tag defanging, control-character stripping) so a user message can no longer forge a turn or escape its wrapper.
- `AskUserQuestion` answers now reach the classifier as user turns instead of being dropped.
- Unparseable classifier responses are now re-sampled (bounded by attempt count and timeout) instead of denying on one bad sample.
- A safeguard content refusal is now distinguished from a malformed response and excluded from the consecutive-denial counter.
- Safeguard refusal denials now include actionable guidance instead of a bare, unhelpful reason.

## 1.8.0

- Write and Edit may now overwrite a file the session never read, matching upstream 2.1.228 (first-party known models only; `NOA_CLAUDE_WRITE_REQUIRE_READ` restores the guard, and it stays on for untrusted model identities).
- Slash-menu fuzzy-match highlighting now uses grapheme-aware ranges instead of a raw UTF-16 slice, fixing incorrect highlights on emoji and accented characters; matches are now shown in bold instead of by recoloring.
- Non-interactive sessions now receive upstream's autonomy guidance telling the model to stop asking permission for reversible work and finish the turn rather than promise it.
- A failed macOS `security` (keychain) call is no longer cached as an empty keychain, which previously made all MCP servers' OAuth tokens appear to fail authentication at once.
- `security` invocations are now time-bounded (10s), and the keychain account now resolves consistently through `getUsername()` everywhere.
- `/clean-sessions` bulk delete no longer removes the running session's transcript or anything modified in the last 10 minutes; unknown flags and invalid `--max-bytes` values are now rejected instead of silently falling back to defaults.
- `cleanup-data` no longer wipes an entire custom memory directory; only files the memory system actually manages (`MEMORY.md`, `logs/`, `team/`, typed `.md` files) are removed.
- Two ported prompt sections (`AUTONOMY_SECTION`, `anti_verbosity` fable branch) had their collapsed paragraph breaks restored to match upstream 2.1.226 byte-for-byte.
- The always-on individual-memory prompt section is reduced from 7216 to 914 characters, matching upstream 2.1.226's more compact wording without dropping any eval-backed instruction.

## 1.7.1

- Fullscreen scrollback now retains the full pre-compaction history across repeated compactions instead of trimming to the most recent interval, matching upstream 2.1.224.
- Edits and writes to a file whose mtime moved (Windows sync/AV, linter rewrites) no longer force a re-read when the content still matches, matching upstream 2.1.224's stale-read fallback.
- Diffs (`/diff`, single-file diffs, `/issue`, `/share`, ultrareview) are now taken against raw git blobs with `--no-ext-diff --no-textconv`, so a configured external diff or textconv filter can no longer corrupt them.
- The Stats panel now counts cache read/write tokens in addition to input/output, matching upstream 2.1.221 and correcting a severe undercount on cache-heavy sessions.
- Sandbox network-outbound denials are now recorded and reach the model in `<sandbox_violations>`; bumps `@anthropic-ai/sandbox-runtime` to 0.0.70 and adds a Linux violation monitor.
- Auto mode permission checks now reuse one cached conversation prefix by default (`NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE=0` disables), matching upstream 2.1.221; permission mode is now re-checked after every classifier call instead of only queued ones.
- Emoji autocomplete aliases are aligned with upstream 2.1.221 via a shared apply path.
- The lean prompt's output-visibility bullet ("Command output is displayed to you, not reliably to the user.") is now shown for every lean-prompt model instead of being gated, matching upstream 2.1.224.

## 1.7.0

- Custom themes: user themes from `<config>/themes/*.json`, plugin-provided themes, `/theme` picker rows, ctrl+e edit, and a theme editor, ported from upstream 2.1.220.
- Lean system prompt and tool descriptions for newer lean-trained models, cutting default tool descriptions from 33.4k to 6.6k characters and the static prompt head from 13.9k to 2.1k; older models keep the verbose text.
- `/init` interview realigned with upstream 2.1.220, including a Phase 0 check for an existing project instruction file and a "Let Noa Claude decide" fast path (behind `NOA_CLAUDE_NEW_INIT`, default off).
- The launcher now resolves config directories at run time instead of baking the build machine's home path into `dist/main.js`.
- `--bare` mode no longer deletes a caller-supplied `ANTHROPIC_API_KEY`, correctly reports a Bearer `ANTHROPIC_AUTH_TOKEN` as logged in, and strips provider-routing keys from settings.json's `env` block.
- Concurrent sessions writing `settings.json` at the same time no longer clobber each other's changes (cross-process lock); migrates the legacy `tuiMode` key to `tui`.
- Selecting Auto permission mode in Default mode no longer snaps back to Manual.
- Customer-run Bedrock, Vertex, and Foundry model identities are no longer treated as trusted for the lean prompt and keep the verbose prompt unless a capability override opts in.
- `cache-probe` now uses a per-run nonce so it can't hit a long-TTL provider cache, and correctly normalizes `[1m]`-suffixed model ids.
- Settings panel alignment fixes: weekly-limit bars show a reset date, Stats/Status spacing and footer hints track focus, and the Config Model row renders through `modelDisplayString`.
- Default permission mode is renamed to Manual, matching upstream 2.1.220; `manual` is accepted as an alias for `default` in settings.json and `--permission-mode`.
- `/extra-usage` is renamed to `/usage-credits` (old command stays registered as a hidden alias; `DISABLE_EXTRA_USAGE_COMMAND` env var keeps its name).

## 1.6.1

- Added Claude Opus 5 as the first-party Opus default: 1M native context (default and max), 128K max output, thinking on by default; fast mode pricing is model-aware ($5/$25 standard, $10/$50 fast). Third-party backends still default to Opus 4.8.
- Added an opt-in auto-mode classifier queue (`NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE`) that serializes concurrent tool-permission classifier calls per agent instead of firing them in parallel.
- Fixed a resume crash on transcripts with missing or malformed attachment payloads; they are now dropped with a warning instead of throwing.
- Fixed prompt history loss on write failure: `immediateFlushHistory` now removes entries only after a successful disk write and keeps failed entries queued for retry.
- Fixed the third-party Opus fallback chain skipping Opus 4.5; it now falls through 5 → 4.8 → 4.7 → 4.6 → 4.5 → 4.1.
- Fixed model migration notifications hardcoding version numbers ("Opus 4.6"/"Sonnet 4.6") instead of resolving the actual migrated family at notification time.
- Fixed `/model` 1M-unavailable messages and default-model descriptions to drop hardcoded version strings and match current upstream wording.

## 1.6.0

- Added auto permission mode (`shift+tab`) behind the `AUTO_MODE` flag, replacing the always-off `TRANSCRIPT_CLASSIFIER` gate, with its own classifier prompt/permissions template and model gating.
- Added a probe-once classifier fallback that determines once per session whether the default-Sonnet route works for non-Sonnet/Haiku main models, instead of re-probing every call.
- Made Sonnet 5 the recommended default model across pickers and refusal-message suggestions, with introductory pricing through 2026-08-31.
- Converted `/doctor` into a prompt-driven agentic health check that runs read-only diagnostics and proposes gated fixes.
- Added a persisted `/autocompact` command for setting `autoCompactWindow` (`auto | 500k | 1m | 200000 | 200`).
- Added opt-in precomputed and reactive compaction that can skip the compact API round-trip and retry in place when a turn comes back prompt-too-long.
- Added session-wide caps of 200 subagent spawns and 200 WebSearch calls per session, resetting on `/clear`.
- Fixed forged `<system-reminder>` tag injection from untrusted content (memory files, hook stdout, cloned repo CLAUDE.md) by escaping such tags.
- Fixed Mythos 5 missing thinking/context/structured-output capabilities that caused silent degradation.
- Fixed `StreamingToolExecutor` concurrency to match `runTools`' concurrency limit instead of starting all safe tool calls at once.
- Fixed the request-too-large message to reference the actual 32MB API request ceiling and suggest `/compact`.
- Fixed provider-switch cache invalidation to clear the model-string cache and classifier probe state.
- Hardened the compact chain: precompute restricted to the main conversation, lifecycle/cleanup gaps closed, and reactive-compact outcome messages mapped to distinct reasons.
- Removed the bundled `claude-api` skill.

## 1.5.0

- Added Claude Sonnet 5 model support, including cost tracking and thinking/context handling.
- Added live file-path autocomplete in bash mode.
- Added a `/cd` command to change the session's working directory without restarting the session.
- Added programmatic animation sequences and particle effects to the startup logo.
- Fixed effort slider theming to use semantic theme tokens instead of hardcoded colors; `xhigh` now gets a shimmer effect; Speed/Intelligence labels renamed to Faster/Smarter.
- Fixed hook matcher to require an exact match on hyphenated identifiers instead of a prefix match.
- Fixed the logo banner to match terminal width and fixed dim-color bleed in feed titles.
- Fixed Ghostty spinner alignment to match upstream behavior.
- Fixed diff/code tab rendering to convert leading tabs to spaces.
- Fixed daily stats to bucket and display by local day instead of UTC.
- Fixed the structured-outputs model allowlist to align with Opus 4.7/4.8; Opus now defaults to a 1M context window.
- Removed the native `ComputerTool` and computer-use feature surface.

## 1.4.0

- Added keep-tail auto-compact: auto-compaction now preserves a verbatim recent tail (including in-flight tool chains) instead of replacing the whole conversation with a summary, controlled via `CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL` (default on).
- Added compact safety-constraint preservation so the compact prompt instructs the model to keep user-set safety/destructive-action constraints verbatim through summarization.
- Fixed query loop recovery: stop-hook output-style suffix matching, duplicate goal-continuation prompt injection, double withheld errors on prompt-too-long, `max_output_tokens` cap reset on retry, and `QueryDeps` merge overwriting production deps with `undefined`.
- Fixed microcompact to also clear large Write/Edit input strings (≥1000 chars), preventing write-heavy sessions from retaining duplicate on-disk content.
- Fixed `--feature=REACTIVE_COMPACT` builds failing to resolve by adding a `services/compact/reactiveCompact.ts` stub.
- Fixed provider profile API keys to pass CJK/whitespace denylist normalization before becoming Bearer tokens.
- Fixed `countTokensWithBedrock` silently degrading to rough estimation on adaptive-thinking-only models (Opus 4.7/4.8, Fable 5).
- Fixed fire-and-forget promise rejections in `recordTranscript` and stop-hook executions to log with context via `.catch(logError)`.
- Fixed an unhandled rejection in `useLogMessages.ts`'s enqueueWrite promise.
- Fixed `remoteSkillState.ts` to match the stub contract expected by `query/transitions.ts`.
- Removed dead `kimi-for-coding` display branches from `model.ts`; Kimi model ids now render as-is.

## 1.3.7

- Added Fable 5 model support, including cost tracking, thinking configuration, and context-window upgrade logic.
- Added size-triggered microcompact with configurable thresholds and a "tokens freed" notice.
- Added a reactive `/config` toggle for away-summary return recaps, persisted across sessions.
- Added stable historical-figure display names and consistent colors for Explore/Plan worker subagents.
- Fixed the streaming tool execution gate being unconditionally off; it can now be enabled with `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1`.
- Fixed `StreamingToolExecutor.discard()` to abort in-flight tools on fallback, preventing double-execution; context modifiers from concurrency-safe tools are now applied in block order.
- Fixed query loop handling: warns on withheld `max_output_tokens` errors, consumes `pendingToolUseSummary` before early returns, avoids mutating shared options on model fallback, and injects the goal prompt before the messages snapshot.
- Fixed WebSearch/WebFetch to load unconditionally instead of being deferred, removing a silent-unavailability race.
- Fixed WebFetch permissions so deny/ask rules take priority over preapproved hosts, matching is case-insensitive, and Windows `~\` paths resolve correctly.
- Fixed `.noa/project.md` and `.noa/CLAUDE.md` to load consistently across all onboarding and query paths; removed the legacy `.claude-agent/project.md` fallback.
- Fixed the OpenAI-compatible shim to stop assuming first-party Anthropic endpoints.
- Fixed away-summary recap behavior to align with official Claude Code 2.1.165 semantics.

## 1.3.6

- Fixed OpenAI-compatible streaming requests to send `stream_options: { include_usage: true }`, restoring cost/token tracking that previously reported zero for streamed responses (opt out via `CLAUDE_CODE_OPENAI_DISABLE_STREAM_USAGE`).
- Fixed OpenAI-compatible tool schemas 400ing under strict mode by defaulting tools to non-strict; strict mode is now opt-in via `CLAUDE_CODE_OPENAI_STRICT_TOOLS` with fully recursive schema normalization.

## 1.3.5

- Fixed the 3P Opus default fallback (Bedrock/Vertex/Foundry → previous-gen Opus) that 1.3.4 had dropped, restoring upstream behavior; Bedrock Opus 4.7/4.8 ids also picked up the missing `us.` CRIS prefix.
- Fixed the bundled `claude-api` skill shipping empty doc files; all 41 reference docs are now populated, and a Bun `.md` loader bug in `build.ts`/`bunfig.toml` is fixed so skill imports receive raw markdown.
- Fixed compact summary `direction` labeling: full-compact paths now stamp `direction: 'up_to'`, and the inverted display label is corrected.
- Fixed partial compaction to scope summarization to the recent tail via a `targetMessageCount` parameter.
- Fixed direct resume handling: removed a fall-through to custom-title search after a UUID-lookup miss, dropped the count from the `multipleMatches` error, added `stopAfterDistinctMatches` short-circuiting, wrapped `shouldShowResumeSummaryGate` in `try/catch`, and populated `fileSize` for the session picker.

## 1.3.4

- Added `--max-turns N` and `--verify "<cmd>"` flags to `/goal` and `/goal replace`; the verify command runs automatically after each eligible turn and a non-zero exit blocks completion.
- Enabled built-in Explore/Plan subagents by default for all build profiles.
- Redesigned the startup banner with a new 8-line block-font ASCII logo, rounded corners, content-driven width, and an inline `/provider` hint.
- Fixed single-file `grep`/`egrep`/`fgrep` targets to register as "read", so a follow-up `Edit`/`Write` no longer needs an explicit `Read` first.
- Fixed background agent tasks permanently occupying the coordinator panel when the worktree probe threw, by adding safe worktree helpers and a fallback `failed` notification.
- Fixed `/compact` session recovery to better handle malformed snapshots and interrupted streams.
- Fixed empty compact summary blocks appearing in transcript output.
- Fixed stale thinking-block signatures causing 400s on replay: `/compact` strips thinking before summarization, `/resume` strips thinking during deserialization, and empty-signature blocks are dropped during API normalization.
- Fixed provider switching hardening across beta flag handling, model remapping, and WebSearch provider checks.
- Fixed Opus 4.7+ thinking defaults (`display: 'summarized'`) to avoid streaming empty thinking blocks; Opus 4.8 now defaults to `high` effort; Sonnet 4.6 max output corrected from 128k to 64k.
- Fixed redundant `getUserContext.cache.clear` calls, since `postCompactCleanup()` already handles it.

## 1.3.3

- Added Claude Opus 4.8 model support.
- Added opt-in OpenAI-compatible `reasoning_effort` translation via `CLAUDE_CODE_OPENAI_REASONING_EFFORT` (clamped to `xhigh`); added Bedrock 4.7/4.8 effort allowlist.
- Hid the pre-compact preserved tail from the main view after full-compact; `ctrl+o` transcript still shows everything.
- Removed the incremental full-compact checkpointing path added in 1.3.2 in favor of a simpler single-pass full-history rewrite.
- Fixed Opus 4.7+ 400 errors on `temperature`/`top_p`/`top_k` by skipping sampling params for `opus-4-7` and `opus-4-8`.
- Fixed `/provider` success messages and dismissed-modal transcript entries leaking into model context by using `display: 'skip'` with a transient notification.
- Fixed a partial-compact duplicate-UUID collision in fullscreen rendering via per-base-key dedup counters.
- Fixed MCP tool input schemas with top-level `oneOf`/`anyOf`/`allOf` or missing `type` being rejected by the API; `normalizeToolInputSchema` now flattens composition keywords and defaults the type to `object`.
- Fixed `scope: "global"` system-prompt cache gating to cover any non-deferred tool, not just MCP tools.
- Fixed compact summary ordering to place `summaryMessages` after `boundaryMarker` and before preserved content.
- Fixed subagent worktree creation leaking the personality name on failure, and corrected `daVinci` to `DaVinci` in the worker name pool.
- Updated the default model health check to Opus 4.8; Bedrock 3P effort now defaults to `xhigh`.

## 1.3.2

- Full compaction now preserves a recent original-message tail and incrementally updates the prior checkpoint instead of re-summarizing the same history each time.
- Fixed compact cancel UX so manual compact, auto-compact, and message-selector summarize flows treat `Esc`/abort as cancellation instead of surfacing generic error states.
- Fixed highlight loading and session title fallback paths that could trigger hook-order issues or malformed titles.
- Fixed compact progress UI cues so compaction is visibly distinct from regular request activity.
- Fixed launcher version display so `noa` shows a stable user-facing version instead of a stale dev bundle suffix.
- Fixed session-memory compaction to run `PreCompact` and `PostCompact` hooks and label the boundary marker with the actual trigger (`manual` vs `auto`) instead of always writing `auto`.

## 1.3.1

- Generic worker subagents now get stable display names from a deterministic historical-figure pool, with consistent color assignment across the UI.
- Fixed `bun run dev` and bundled startup from trying to resolve a missing `@ant/claude-for-chrome-mcp` package as if it were required.
- Fixed `Claude in Chrome` auto-enable logic so the feature is not advertised or wired up when the optional MCP package is absent.

## 1.3.0

- Added a curl-installer distribution pipeline (`curl -fsSL https://noa.ai/install.sh | bash`) with atomic swap and rollback, compatible with Homebrew, WinGet, and apt/dnf.
- Added an `xhigh` speed/intelligence effort level for Opus 4.7.
- Auto-dream lock stamp now moves to post-success and adds model downshift and a session cap for resource-bound environments.
- Fixed Windows cross-project resume producing a PowerShell-incompatible `cd` command.
- Fixed spinner and elapsed-time disappearing after terminal resize or window refocus.
- Fixed skill list overflowing tab bounds inside the margin box.
- Fixed prompt suggestions not responding to mouse hover/click.
- Fixed a provider command race condition and a missing error message for third-party users.
- Fixed computer-use chat workflows taking routine screenshots; now prefers keyboard-driven search-selection in WeChat and similar apps.
- Fixed auto-compact entering an infinite loop when the collapse threshold reaches zero.
- Fixed prompt-cache attaching a dynamic attribution header to `systemHash`.
- Fixed subagent resume losing cwd context and compact rollback leaving orphaned state.
- Fixed a sync/async write race in sessionStorage transcript writes.
- Fixed release notes sidebar layout rebalancing.

## 1.2.0

- Replaced the Anthropic MCP-based desktop control path with a native macOS Computer Use implementation built on `open`, AppleScript, `cliclick`, `screencapture`, `pbcopy`, and `pbpaste`.
- GUI actions now require the intended app to be opened or activated first, with frontmost-app guards to keep follow-up actions anchored to the right window.
- Search-driven interactions now treat contact/item selection and message entry as separate phases, requiring `Return` after search results before typing the next payload.
- Common app names, localized names, and bundle ids are normalized so WeChat, Weixin, 微信, and similar variants resolve consistently.
- Fixed focus drift after app switching by reactivating the target app before foreground actions when needed.
- Fixed `menu_click` so real menu-path failures are no longer hidden by alias retries.
- Fixed retry behavior so a failed GUI flow restarts from app activation instead of assuming the previous app state is still valid.
- Fixed log path matching for normalized project paths, including Windows drive letters.

## 1.1.0

- Goals now automatically continue up to 5 turns when the evaluator determines work remains, scoring progress each turn.
- Goal state now tracks `autoContinueTurns`, `maxAutoContinueTurns`, `lastEvaluatorReason`, `completedAt`, and `stopReason`.
- Added a Haiku-based goal evaluator that scores goal progress from conversation context via a JSON schema output.
- Fixed coordinator task panel visibility filtering.
- Fixed `decideGoalEvaluatorAction` to return `exhausted` when the auto-continue turn limit is reached instead of incorrectly calling the evaluator.
- Fixed context truncation in `buildGoalEvaluatorContext` to be tail-first (preserving latest evidence) instead of head-last.

## 1.0.9

- Added a Sessions view to view, select, and kill active agent sessions from the agents menu.
- The `agents` command now displays active sessions alongside configured agents.
- Added an `xhigh` effort level option for Opus 4.7+ models.
- Fixed emoji highlighting using incorrect UTF-16 code unit boundaries — now uses grapheme boundaries for proper multi-grapheme emoji handling.
- Fixed multi-image paste so each image correctly captures its own undo state.
- Fixed dark theme hyperlink color (blue → cyan) for better accessibility on dark terminals.
- Fixed symlink path resolution with a fallback for broken symlinks in settings detection.
- Fixed marketplace key resolution to match by source when the settings key differs from the manifest name.

## 1.0.8

- Increased the slash-command overlay's visible items from 5 to 12 for a more browsable fullscreen experience.
- Refactored system prompt generation to extract core execution guards into a dedicated section, ensuring these constraints are always present regardless of output style configuration.
- Removed the automatic scroll repin behavior when typing into an empty prompt, reducing interruption while reading long output.
- Fixed ink viewport resize behavior to preserve scrollback in default (non-alt-screen) mode.

## 1.0.7

- Fixed MCP tool results that return both `content` and `structuredContent` so visible blocks are preserved instead of being replaced by JSON.
- Fixed normal worktree creation to base new worktrees on local `HEAD`, preserving unpushed commits.
- Fixed npm plugin cache updates so unpinned packages refresh on explicit update and semver ranges compare correctly against cached versions.
- Fixed `/context` output so the transcript stays visible without being added to model-visible message history.
- Fixed MCP URL policy matching for mixed-case schemes and hosts.
- Fixed parallel Bash execution so read-only Bash failures no longer cancel unrelated read-only siblings.

## 1.0.6

- Fixed the release notes panel sometimes not appearing after upgrade because `lastReleaseNotesSeen` was written before the async changelog cache had loaded.
- Fixed release notes panel flicker on startup by reading `hasReleaseNotes` once via lazy initialization instead of re-evaluating each render.
- Fixed `/release-notes` so Enter expands the selected entry instead of immediately dismissing the panel.
- Fixed `/release-notes` expanded view to stay within a fixed viewport and scroll instead of overflowing the terminal.

## 1.0.5

- Exposed `bypass permissions` to local users.
- Improved trust handling so the home directory can be trusted without leaking that trust to child directories.
- Fixed fullscreen exit cleanup so residual screen artifacts no longer linger after leaving `/tui fullscreen`.
- Fixed onboarding and trust dialogs so setup screens render and dismiss more consistently.
- Fixed Bedrock `application-inference-profile` requests for Opus 4.7 by resolving the backing model before thinking/effort capability checks.
- Fixed `thinking.type.enabled is not supported` 400 errors on Bedrock Opus 4.7 inference profiles.

## 1.0.4

- Added an `xhigh` effort level for Opus 4.7+ models.
- Added support for GitLab and Bitbucket PR URLs in addition to GitHub.
- Added `CLAUDE_CODE_HIDE_CWD` and `DISABLE_UPDATES` environment variables.
- Added a `duration_ms` field to PostToolUse hooks with a corrected timeout default.
- Exposed effort level and thinking state to the statusline.
- Added vim visual and visual-line modes.
- Added automatic terminal theme detection (light/dark).
- Improved the skills menu with better invocation guidance.
- Fixed branch fork copying dangling `tool_use` entries from compacted/snip-removed transcript entries.
- Fixed malformed hooks in `settings.json` causing the entire config to be rejected — invalid hooks are now filtered out gracefully.
- Fixed `is_error` flag being lost when PostToolUse hooks replace non-MCP tool output.
- Fixed PostToolUse hooks' `updatedMCPToolOutput` field to work for all tools instead of only MCP tools.
- Fixed a resume race condition, UI lock, and fragile error classification.
- Fixed compact to distinguish exhaustion, error, and `media_unstrippable` failure messages.
- Fixed a wiki infinite loop by removing message state from a `useEffect` dependency array.
- Fixed C++ and C# file extension aliases in the Write tool.
- Fixed rename error logging and memory error messages.
- Fixed session atomic branch writes and tag cleanup.
- Fixed feedback submission routing to GitHub Issues instead of the Anthropic API.
- Fixed the export dialog using deprecated `writeFileSync` — now uses async `writeFile`.
- Fixed the startup banner using sync FS calls — now uses `fs/promises`.
- Fixed the feedback survey transcript sharing to no longer POST to Anthropic.
- Fixed startup prefetches to be gated on `isFirstPartyAnthropicBaseUrl`.
- Fixed privacy by removing Anthropic URLs and internal-only references.
- Fixed effort slider `Ctrl+C` handling to properly exit through the global exit path.
- Fixed `noa claude` prompt and model chain alignment.
- Fixed Opus 4.7 compatibility issues and updated hardcoded models.
- Fixed the fullscreen pill and teammate snapshot.

## 1.0.3

- Fixed plan mode state inconsistency: `/plan open` and `/plan <description>` now work regardless of current mode.
- Fixed MCP OAuth error handling when the auth server returns non-JSON (captive portals, proxy auth pages).
- Fixed Windows CRLF paste handling in prompt input.
- Improved command suggestion highlighting in autocomplete.

## 1.0.2

- Unified `/status`, `/config`, `/usage`, and `/stats` onto a new status panel, with corrected tab navigation and layout.
- Fixed banner/provider refresh so gradient banner content updates correctly after `/login` and provider switches in default TUI mode.
- Improved model resolution after auth changes so provider-backed defaults are picked up consistently.

## 1.0.1

- Added a `/tui` command to toggle between default and fullscreen (no-flicker) terminal UI mode.
- Fixed `CondensedLogo` never showing — the simplified mascot layout now correctly displays after onboarding and release notes are complete.
- Fixed `/tui` env var priority — `NOA_CLAUDE_NO_FLICKER` now correctly overrides persistent `tuiMode` settings.
- Rebranded user-facing strings from Claude Code to Noa Claude.

## 1.0.0

- Unified the standalone build and compile chain.
- Added global startup banner modes and removed project-level overrides.
- Switched default release notes to a local bundled source.
