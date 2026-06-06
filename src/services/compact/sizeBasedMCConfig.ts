/**
 * Provider-neutral, env-driven config for size-based microcompact.
 *
 * Unlike timeBasedMCConfig (GrowthBook-gated, defaults off), this is
 * local-first: it gives every user — on any provider — incremental
 * tool-result clearing once the conversation grows past a fraction of the
 * model's effective context window.
 *
 * Why it's needed: the time-based trigger only fires after a wall-clock pause
 * (the server cache has expired anyway). An active, uninterrupted session
 * never pauses, so it would otherwise get no relief until the blocking full
 * compact. The cached-microcompact path that handled the size dimension is
 * Anthropic-internal (USER_TYPE === 'ant') and a no-op in external builds, so
 * size-driven clearing is missing for normal users. This fills that gap with a
 * purely client-side mechanism — no API beta, no GrowthBook, no Anthropic
 * backend.
 */
export type SizeBasedMCConfig = {
  /** Master switch. Defaults on; set CLAUDE_CODE_SIZE_MICROCOMPACT=0 to disable. */
  enabled: boolean
  /**
   * Trigger when estimated tokens exceed this fraction of the effective
   * context window. Kept below the auto-compact threshold (~93% of effective)
   * so this fires first and defers — or avoids — the blocking full compact.
   */
  triggerFraction: number
  /** Keep this many most-recent compactable tool results; older ones are cleared. */
  keepRecent: number
}

const DEFAULTS: SizeBasedMCConfig = {
  enabled: true,
  triggerFraction: 0.85,
  keepRecent: 8,
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off'
}

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getSizeBasedMCConfig(): SizeBasedMCConfig {
  const enabled = parseBoolEnv(
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT,
    DEFAULTS.enabled,
  )

  // Percent override, 1–100. Anything out of range falls back to the default.
  const pctRaw = process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT
  const pct = pctRaw !== undefined ? Number(pctRaw) : NaN
  const triggerFraction =
    Number.isFinite(pct) && pct > 0 && pct <= 100
      ? pct / 100
      : DEFAULTS.triggerFraction

  const keepRecent = parsePositiveIntEnv(
    process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP,
    DEFAULTS.keepRecent,
  )

  return { enabled, triggerFraction, keepRecent }
}

/**
 * Pure numeric trigger decision. Caller is responsible for the orthogonal
 * gating (main-thread querySource, etc.).
 */
export function shouldSizeTrigger(
  estimatedTokens: number,
  effectiveWindow: number,
  config: SizeBasedMCConfig,
): boolean {
  if (!config.enabled) return false
  if (!(effectiveWindow > 0)) return false
  return estimatedTokens >= Math.floor(effectiveWindow * config.triggerFraction)
}
