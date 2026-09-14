import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

/**
 * Floor, not just a default: a CLAUDE_STREAM_IDLE_TIMEOUT_MS below it is
 * ignored. Long enough that a slow high-effort thinking block isn't mistaken
 * for a dead connection, so no separate thinking window is needed.
 */
export const STREAM_IDLE_TIMEOUT_FLOOR_MS = 300_000

/**
 * On unless explicitly set falsy. Without it a silently dropped connection
 * leaves the spinner running forever, so an unrecognized value keeps it on.
 */
export function isStreamWatchdogEnabled(
  env: string | undefined = process.env.CLAUDE_ENABLE_STREAM_WATCHDOG,
): boolean {
  return !isEnvDefinedFalsy(env)
}

export function getStreamIdleTimeoutMs(
  env: string | undefined = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS,
): number {
  const parsed = Number(env)
  return Math.max(
    Number.isFinite(parsed) ? parsed : 0,
    STREAM_IDLE_TIMEOUT_FLOOR_MS,
  )
}
