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
 * value rests on, all verified against the upstream binary and covered by tests:
 * adaptive-only thinking with `budget_tokens` removed; the three distinct
 * shapes of "thinking off" (explicit `{type:'disabled'}`, omission, and models
 * that reject the explicit form); forced `tool_choice` rejection; the `refusal`
 * stop reason; native 1M context with the `[1m]` opt-in; and the per-model cost
 * tiers including cheap cache reads.
 *
 * Raised to 2.1.280 for Opus 5.5, which the API withholds below it. Its
 * catalog capabilities are Fable 5.1's plus `fast_mode` and its own prompt
 * bundle, all already handled; 2.1.280's stream reader adds no server event
 * or stop reason Noa lacks except `compaction_delta`, which the server only
 * sends to clients that opt into server-side compaction (Noa does not).
 *
 * Raised to 2.1.290 for Fable 5.2 and Mythos 5.2, which the API withholds
 * below it (`Claude Code 2.1.280 does not support this model; version 2.1.290
 * or newer is required`). Their request surface is Fable 5.1's, plus the
 * preserved-thinking prefix binding Noa already enforces.
 *
 * It is deliberately *not* set above the version whose catalog was ported: a
 * higher claim would invite response shapes this fork has no reader for, which
 * is the failure mode the gate exists to prevent.
 *
 * `NOA_CLAUDE_API_CLIENT_VERSION` overrides it without a rebuild — for testing
 * a gate, or pinning lower if a future release ships a shape Noa mishandles.
 */
export const CLAUDE_CODE_COMPAT_VERSION = '2.1.290'

const VERSION_RE = /^\d+\.\d+\.\d+$/

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// Raised for this process only when the API itself names the version a model
// needs, so a model launched after this build still works once.
let negotiatedVersion: string | undefined

function getConfiguredVersion(): string {
  const override = process.env.NOA_CLAUDE_API_CLIENT_VERSION?.trim()
  return override !== undefined && override !== ''
    ? override
    : CLAUDE_CODE_COMPAT_VERSION
}

export function getApiClientVersion(): string {
  const configured = getConfiguredVersion()
  return negotiatedVersion !== undefined &&
    compareVersions(negotiatedVersion, configured) > 0
    ? negotiatedVersion
    : configured
}

/**
 * Handles the API's `version X or newer is required` rejection: raises the
 * reported version to X for the rest of the process. Returns true when the
 * version changed, so the caller retries once with the new value; false when
 * the message names nothing newer, which keeps a bad answer from looping.
 */
export function negotiateApiClientVersion(message: string | undefined): boolean {
  const required = message?.match(
    /version (\d+\.\d+\.\d+) or newer is required/,
  )?.[1]
  if (
    required === undefined ||
    !VERSION_RE.test(required) ||
    compareVersions(required, getApiClientVersion()) <= 0
  ) {
    return false
  }
  negotiatedVersion = required
  return true
}

/** Test hook: forget a negotiated version. */
export function resetNegotiatedApiClientVersion(): void {
  negotiatedVersion = undefined
}
