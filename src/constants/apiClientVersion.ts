/**
 * The Claude Code version Noa reports to the Anthropic API.
 *
 * This is **not** Noa's own version (`MACRO.VERSION`, from package.json, shown
 * by `--version` and used by the updater, the bridge min-version checks and the
 * release-notes diff). It is a separate, narrower claim: the upstream Claude
 * Code release whose *request and response surface* this fork implements.
 *
 * The two have to be separate because the API gates model access on it. Newer
 * models are withheld from clients that predate them — a real Claude Code
 * 1.12.0 could not parse an adaptive-thinking stream or a `stop_reason:
 * "refusal"`, so serving it Fable 5.1 would break it. Reporting Noa's own
 * version answers a question nobody asked ("which fork build is this?") in a
 * field the server reads as "which protocol can you speak?", and the answer it
 * produces is wrong in the direction that costs the user working models:
 *
 *   400 invalid_request_error — Claude Code 1.12.0 does not support this model;
 *   version 2.1.251 or newer is required.
 *
 * Keep this value honest. It must name a version whose behaviour Noa actually
 * implements, and it should be raised only alongside the port work that earns
 * it — never to unlock a model whose contract is unhandled. What the current
 * value rests on, all verified against the 2.1.258 binary and covered by tests:
 * adaptive-only thinking with `budget_tokens` removed; the three distinct
 * shapes of "thinking off" (explicit `{type:'disabled'}`, omission, and models
 * that reject the explicit form); forced `tool_choice` rejection; the `refusal`
 * stop reason; native 1M context with the `[1m]` opt-in; and the per-model cost
 * tiers including cheap cache reads.
 *
 * It is deliberately *not* set above the version whose catalog was ported: a
 * higher claim would invite response shapes this fork has no reader for, which
 * is the failure mode the gate exists to prevent.
 *
 * `NOA_CLAUDE_API_CLIENT_VERSION` overrides it without a rebuild — for testing
 * a gate, or pinning lower if a future release ships a shape Noa mishandles.
 */
export const CLAUDE_CODE_COMPAT_VERSION = '2.1.258'

export function getApiClientVersion(): string {
  const override = process.env.NOA_CLAUDE_API_CLIENT_VERSION?.trim()
  return override !== undefined && override !== ''
    ? override
    : CLAUDE_CODE_COMPAT_VERSION
}
