# 1-hour prompt cache

Switch it on with `NOA_CLAUDE_PROMPT_CACHE_1H` (see Runtime Toggles in the README).

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
