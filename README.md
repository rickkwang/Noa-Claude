# Noa Claude

A local-first coding agent for software work — long sessions, resumable forks, multi-provider routing, and privacy defaults that don't require configuration.

Noa is a productized reconstruction based on publicly exposed Claude Code source, independently maintained for developers who want local control, provider flexibility, and continuity features that hold up under real daily use.

## Quick Start

Prerequisites: [Bun](https://bun.sh) and [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep` / `apt install ripgrep`) — file search is built on the system `rg` and fails with an install hint when it is missing.

Install with `curl`:

```bash
curl -fsSL https://raw.githubusercontent.com/rickkwang/Noa-Claude/v1.12.0/install.sh | bash
```

Install from a repository checkout:

```bash
git clone https://github.com/rickkwang/Noa-Claude.git && cd Noa-Claude
./install.sh
```

Run from source without installing:

```bash
bun run dev
```

Typical first session:

```bash
noa
/login
/doctor
/help
```

Then open a project and ask for real work: fix a bug, explain a subsystem, review a diff, or fork a branch of investigation with `/fork`.

## Update & Uninstall

Update (checks the latest release tag first, then re-runs the curl installer; the new build is smoke-tested and the previous install is restored if it fails):

```bash
noa update          # prompts before re-running the installer
noa update --yes    # non-interactive
```

Uninstall (removes `~/.local/bin/noa` symlink and `~/.noa/install/`, scrubs installer-created shell aliases; config is preserved):

```bash
noa uninstall
noa uninstall --purge   # ALSO removes ~/.noa (settings, plugins, history)
noa uninstall --yes     # non-interactive
```

If `~/.local/bin` is not on your `PATH`, the installer prints the line to add — `noa uninstall` will not remove it automatically.

## Core Features

The product baseline is `/fork`, `/workflows`, `/summary`, and `/share` (smoke-checked). Other listed commands are non-baseline — see [docs/product-governance.md](docs/product-governance.md).

**Sessions**
- `/fork` — Create a resumable fork of the current conversation
- `/resume` — Resume a previous conversation
- `/compact` — Summarize long conversations to preserve context
- `/session` — Show remote session URL and QR code (remote mode only)
- `/clear` — Clear the current conversation and start fresh
- `/export` — Export conversation to a file
- `/rename` — Rename the current session
- `/tag` — Tag the current session for quick lookup
- `/summary` — Generate structured session summaries
- `/share` — Export share snapshots under `.noa/shares`
- `/rewind` (alias `/checkpoint`) — Restore the code and/or conversation to a previous point
- `/goal` — Set a long-running objective that survives turns: auto-continues with turn/token limits and an optional verify command (details in [docs/operating-guide.md](docs/operating-guide.md))

**Provider routing**
- `/provider` — Switch between saved provider profiles (JSON-based, stored in `~/.noa/provider-profiles.json`)
- `/model` — Switch model or list available models
- `/login` / `/logout` — Authenticate with your Anthropic account via OAuth (Anthropic-specific)

**Agent execution**
- `/agent` — Spawn sub-agents for parallel task execution

**Verification and diagnostics**
- `/doctor` (alias `/checkup`) — Agentic health check: runs read-only diagnostics
  (install health, unused skills/MCP servers/plugins, bloated or duplicated memory
  files, slow hooks, permission tuning) and proposes fixes behind a confirmation
  gate. Costs tokens and needs a working model. For the static install-diagnostics
  screen — zero tokens, no model, no network, plain text in a terminal or a pipe —
  run `noa doctor` in a terminal.
- `/status` — Inspect runtime state, MCP, plugins, and agents
- `/cache-probe` — Diagnose API cache hit rate by comparing `cached_tokens` across identical requests
- `/usage` — View token usage for current session
- `/cost` — Estimate cost of the current conversation

**Configuration**
- `/config` — View and edit settings
- `/workflows` — Manage reusable workflows
- `/wiki init` / `/wiki status` / `/wiki ingest` — Project documentation management
- `AGENTS.md` / `CLAUDE.md` — Project-level context files

## Keyboard Shortcuts

Default bindings from `src/keybindings/defaultBindings.ts`. Some bindings (e.g. `ctrl+shift+b`) are feature-gated and absent from the default build.

| Shortcut | Action |
|----------|--------|
| `ctrl+t` | Toggle todo list |
| `ctrl+o` | Toggle transcript mode |
| `ctrl+shift+b` | Toggle brief-only view (feature-gated) |
| `ctrl+l` | Clear screen and force full redraw (recovery path) |
| `ctrl+x ctrl+e` / `ctrl+g` | Open external editor |
| `ctrl+s` | Stash chat input |
| `ctrl+r` | History search |
| `escape` | Abort current operation |
| `ctrl+c` | Cancel speculation when idle |
| `shift+enter` | Multi-line input |
| `shift+tab` | Cycle through chat modes (default / auto-accept / plan) |

## Multi-Provider Support

Noa ships first-party support for multiple backends:

| Provider | Environment | Enable |
|----------|-------------|--------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | default |
| OpenAI-compatible | `OPENAI_BASE_URL` + `OPENAI_API_KEY` | `CLAUDE_CODE_USE_OPENAI=1` |
| AWS Bedrock | `ANTHROPIC_BEDROCK_BASE_URL` + AWS credentials | `CLAUDE_CODE_USE_BEDROCK=1` |
| Google Vertex | `ANTHROPIC_VERTEX_PROJECT_ID` + region vars | `CLAUDE_CODE_USE_VERTEX=1` |
| Microsoft Foundry | `ANTHROPIC_FOUNDRY_RESOURCE` + `ANTHROPIC_FOUNDRY_API_KEY` | `CLAUDE_CODE_USE_FOUNDRY=1` |

Provider profiles enable saved configurations for providers like Kimi, MiniMax, DeepSeek, and other Anthropic-compatible endpoints using Bearer token auth (`ANTHROPIC_AUTH_TOKEN`).

**OpenAI-compatible configuration:**
- `OPENAI_BASE_URL` — API endpoint (default: `https://api.openai.com/v1`)
- `OPENAI_API_KEY` — API key
- `OPENAI_MODEL` — Model override (default: `gpt-4o`)

**AWS Bedrock:**
- `ANTHROPIC_BEDROCK_BASE_URL` — Optional custom endpoint
- `AWS_REGION` or `AWS_DEFAULT_REGION` — Region (default: `us-east-1`)
- `AWS_BEARER_TOKEN_BEDROCK` — API key auth (bypasses AWS SDK auth)

**Google Vertex:**
- `ANTHROPIC_VERTEX_PROJECT_ID` — GCP project ID
- `VERTEX_REGION_CLAUDE_*` — Per-model region override
- Auth: `GOOGLE_APPLICATION_CREDENTIALS` or ADC

**Microsoft Foundry:**
- `ANTHROPIC_FOUNDRY_RESOURCE` — Azure resource name
- `ANTHROPIC_FOUNDRY_BASE_URL` — Optional full endpoint override
- `ANTHROPIC_FOUNDRY_API_KEY` — API key auth
- Auth without key: Azure AD via `DefaultAzureCredential`

## Capability Highlights

- **Multi-Provider Support** — OpenAI-compatible, AWS Bedrock, Google Vertex, Microsoft Foundry, and Anthropic's first-party API.
- **Sub-Agent Orchestration** — Assign different models to different agents via `settings.json` (`agentModels`, `agentRouting`).
- **Checkpoints** — `/rewind` restores both code and conversation state to a previous point, not just the chat transcript.
- **Long-running Goals** — `/goal` keeps an objective alive across turns with an evaluator loop, auto-continue limits, token budgets, and an optional shell verify command.
- **MCP Tool Compaction** — MCP tool results (`mcp__<server>__<tool>`) are always compactable, often cutting token use on MCP-heavy sessions.
- **128k Fallback** — Unknown OpenAI-compatible models use a conservative 128k context window to prevent compact threshold underestimation.
- **Auto-fix Hook** — After file edits, automatically run configurable lint/test commands (configured in `settings.json` under `autoFix`).
- **Cache-probe** — `/cache-probe` command to diagnose API cache hit rate.
- **SSRF Protection** — URL resolution validated against IPv4/IPv6 private ranges before outbound HTTP requests.
- **TUI Mode** — `/tui` switches between default and fullscreen (no-flicker) terminal layout.
- **PR Intent Scan** — CI checks PR added lines for suspicious links/download patterns and fails on high-severity findings.
- **Privacy** — see the [Privacy](#privacy) section below.

## Architecture

```
Entry → QueryEngine → Agent Loop → Tools / Services / State
```

| Subsystem | Path | Purpose |
|-----------|------|---------|
| Commands | `src/commands/` | Slash commands (see `docs/product-governance.md` for baseline / non-baseline split) |
| Tools | `src/tools/` | Tool implementations (file, shell, web, tasks, MCP, computer) |
| Components | `src/components/` | React TUI components |
| Hooks | `src/hooks/` | React state and side-effect hooks |
| Bridge | `src/bridge/` | Remote execution and session bridging |
| Services | `src/services/` | Backend services (API, MCP, OAuth, LSP, analytics, autoFix) |
| Utils | `src/utils/` | Shared utilities (git, auth, file, session, ssrf) |

## Build Commands

| Command | Output |
|---------|--------|
| `bun run dev` | Run directly from source |
| `bun run build` | Production JS bundle to `dist/main.js` |
| `bun run build:dev` | Dev build |
| `bun run build:dev:full` | Dev build + 52 experimental features |
| `bun run compile` | Standalone binary at `dist/cli` |

All builds require [Bun](https://bun.sh).

## Runtime Toggles

- `NOA_CLAUDE_NO_FLICKER=1` — Enable fullscreen anti-flicker layout
- `NOA_CLAUDE_DISABLE_MOUSE=1` — Fullscreen layout with mouse tracking off
- `NOA_CLAUDE_DISABLE_MOUSE_CLICKS=1` — Mouse tracking on, clicks ignored
- `CLAUDE_CODE_HIDE_CWD=1` — Hide cwd from status bar
- `DISABLE_UPDATES=1` — Disable automatic update checks
- `NOA_CLAUDE_STREAMING_TOOL_EXECUTION=1` — Opt in to streaming tool execution (tools start while the model response is still streaming; experimental, off by default)
- `NOA_CLAUDE_MAX_CONCURRENT_AGENTS=N` — Cap concurrent background agents (default 20; `0` disables the cap)
- `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1|0` — Force the compact (`1`) or long (`0`) system prompt instead of letting the model decide. See [System prompt length](#system-prompt-length)
- `NOA_CLAUDE_NEW_INIT=1` — Opt `/init` in to the interview-style setup flow (existing-file branch, proposal review, optional skills/hooks) instead of the single-shot prompt
- `NOA_CLAUDE_PROMPT_CACHE_1H=1|0|<patterns>` — Opt in to the 1-hour prompt-cache TTL. Off by default, and it should stay off unless your rhythm is genuinely interrupted. See [1-hour prompt cache](#1-hour-prompt-cache)

Legacy `CLAUDE_CODE_*` names are still accepted for compatibility; `NOA_CLAUDE_*` is preferred.

## 1-hour prompt cache

Prompt-cache entries live 5 minutes by default. The API also offers a 1-hour TTL, which writes at **2x** input instead of **1.25x** — you pay more per write in exchange for surviving longer gaps between turns.

Upstream gates this on a GrowthBook allowlist. GrowthBook is hard-disabled here and both of its override paths are additionally internal-only, so off Bedrock the 1-hour TTL could never fire. `NOA_CLAUDE_PROMPT_CACHE_1H` makes the lever reachable without reintroducing a remote-config dependency:

```bash
export NOA_CLAUDE_PROMPT_CACHE_1H=1                        # main thread + SDK
export NOA_CLAUDE_PROMPT_CACHE_1H='repl_main_thread*,agent:*'   # explicit query sources
export NOA_CLAUDE_PROMPT_CACHE_1H=0                        # hard off, outranks ENABLE_PROMPT_CACHING_1H_BEDROCK
```

A bare `1` covers `repl_main_thread*` and `sdk` only. Subagents and forked side-queries run back-to-back inside a single turn, so a 1-hour write there is pure surcharge on a read that would have hit the 5-minute entry anyway; add `agent:*` explicitly if you want it.

**When it pays.** Because every write gets 1.6x more expensive, the switch only wins when more than **~37.5% of your cache-write volume** follows a gap longer than five minutes — that is the break-even, not a rule of thumb. Note the unit is write *volume*, not request count: the requests that follow a long gap rewrite far more than the ones inside a tool loop, so counting requests understates it. Measured over this repository's own session transcripts that share was 2.6%, i.e. enabling it would have cost about 1.56x the write spend. It pays for a genuinely interrupted rhythm — ask, leave for half an hour, come back to the same session — not for continuous work.

`/doctor` reports which branch fired (`enabled_env`, `disabled_env`, `allowlist_miss`, …). `DISABLE_PROMPT_CACHING=1` still wins over all of it.

## System prompt length

Newer Claude models (Opus 5, Fable 5/5.1, Mythos 5/5.1, and later) are trained on most of what a long system prompt spells out, so they get a compact prompt head and short tool descriptions. The replaced static head is roughly 90% shorter; total request savings vary with session-specific guidance and the active tool set. Older models (Sonnet, Haiku, Opus 4.x, Claude 3.x) keep the long version, which they still need. The choice is automatic; nothing to configure.

**One case needs opting in.** The model id alone decides this, so it only works when that id is trustworthy. On customer-run Bedrock, Vertex or Foundry — and on Anthropic-compatible third-party endpoints — a configured id can be an inference profile, a custom ARN, a cross-region alias, or a proxy serving something else entirely, so those deployments keep the long prompt by default even when the id looks like a current Claude model.

If you know your deployment genuinely serves one, opt in by declaring the capability alongside the pin:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL='us.anthropic.claude-opus-5-v1:0'
export ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES='lean_prompt'
```

`ANTHROPIC_DEFAULT_FABLE_MODEL`, `_OPUS_MODEL`, `_SONNET_MODEL`, `_HAIKU_MODEL`, and `ANTHROPIC_CUSTOM_MODEL_OPTION` each have the same capability pair. The `[1m]` context-window suffix is ignored when matching, so pinning either form covers both.

A second capability, `opus_5_prompt_bundle`, selects the companion sections that travel with the compact head (delivering-work, corrections, the shorter action-caution wording, one Bash bullet). It is deliberately not implied by `lean_prompt`: upstream declares it for Opus 5 only, so Fable 5/5.1, Opus 4.8 and Mythos 5/5.1 take the compact head *without* those sections. Declare it only if your pin genuinely serves Opus 5:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES='lean_prompt,opus_5_prompt_bundle'
```

First-party models need no configuration either way. For a pinned third-party model, the declaration is authoritative — a pin that lists `lean_prompt` alone gets the compact head without the bundle, even if the id looks like Opus 5, on the same reasoning that makes the pin necessary in the first place. The same rule covers EAP-looking ids and the Fable/Mythos companion section: third-party routes do not inherit those behaviors from the model name alone.

Advanced deployments that deliberately preserve Claude Code's model-name trust semantics can set `NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY=upstream`. In that mode EAP suffixes and built-in Opus/Fable/Mythos capability facts apply on third-party routes exactly as they do upstream. The default remains conservative.

To force the choice either way — for example to check whether a regression is prompt-related — set `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1` (compact) or `=0` (long).

## Privacy

Hardcoded privacy defaults — no configuration needed:

- All telemetry paths hard-disabled
- GrowthBook remote fetch hard-disabled
- Remote policy overlays hard-disabled
- Remote managed-settings overlay hard-disabled
- OpenAI-compatible requests send `store: false` to opt out of provider-side retention; Bedrock/Vertex/Foundry and Anthropic-compatible endpoints have no such field (the Anthropic Messages API does not define `store`)
- In-product help / docs links point to the project's own docs repo (e.g. `PRODUCT_MCP_URL`); not fetched by telemetry.

## Verification

```bash
bun run compile && ./dist/cli --version  # Compile and verify binary
bun run typecheck                        # Type check
bun test                                # Run all tests
bun test <path>                          # Run a single test file
```

Default local maintenance checks:

```bash
bun run check:runtime                    # Runtime health check
bun run smoke:features                   # Feature surface smoke
bun run smoke:engine                     # Engine smoke (no live API)
bun run scan:pr-intent                   # Block suspicious PR links
```

Release candidate provider check:

```bash
bun run smoke:engine:live                # Live provider smoke (needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN)
```

## Engineering Bar

Core stability signals treated as non-negotiable:

- Interactive startup stays alive
- `--print` stays usable for non-interactive coding
- Resume/continue survive compaction and transcript recovery
- MCP startup degrades gracefully instead of blocking
- Tool orchestration preserves permission boundaries and retry safety
- Remote/session plumbing keeps trust, auth, and reconnect explicit
- SSRF protection validates all outbound URLs against private address ranges

See [docs/operating-guide.md](docs/operating-guide.md) for runtime, session, worktree, and agent documentation. See [docs/product-governance.md](docs/product-governance.md) for command surface governance.

## License

This repository is a reconstruction based on publicly exposed source code. The original Claude Code source is the property of Anthropic.

- Not an official Anthropic release or supported product
- Independently maintained — this project does not actively track or sync upstream Claude Code source changes
- Anthropic, Claude, and Claude Code are trademarks of their respective owners
