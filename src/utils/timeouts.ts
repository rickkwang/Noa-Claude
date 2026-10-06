// @ts-nocheck
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { isEnvTruthy } from './envUtils.js'

// Constants for timeout values
const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
const MAX_TIMEOUT_MS = 600_000 // 10 minutes
export const DEFAULT_BACKGROUND_TIMEOUT_MS = 1_800_000 // 30 minutes
const MAX_BACKGROUND_TIMEOUT_FLOOR_MS = 7_200_000 // 2 hours
// setTimeout clamps anything larger to 1ms and fires immediately.
const MAX_TIMER_DELAY_MS = 2_147_483_647

type EnvLike = Record<string, string | undefined>

/**
 * Get the default timeout for bash operations in milliseconds
 * Checks BASH_DEFAULT_TIMEOUT_MS environment variable or returns 2 minutes default
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getDefaultBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_DEFAULT_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_TIMEOUT_MS
}

/**
 * Get the maximum timeout for bash operations in milliseconds
 * Checks BASH_MAX_TIMEOUT_MS environment variable or returns 10 minutes default
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getMaxBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_MAX_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      // Ensure max is at least as large as default
      return Math.max(parsed, getDefaultBashTimeoutMs(env))
    }
  }
  // Always ensure max is at least as large as default
  return Math.max(MAX_TIMEOUT_MS, getDefaultBashTimeoutMs(env))
}

/**
 * Whether a command started with `run_in_background` is stopped once it has
 * run for its background time limit.
 *
 * Only in non-interactive sessions: there nobody watches the task list, so a
 * hung background command would leave the model waiting for a notification
 * that never arrives. Interactively the user sees and can stop the task, and
 * long-lived commands like dev servers are expected to outlive any limit.
 */
export function isBackgroundDeadlineEnabled(): boolean {
  return (
    getIsNonInteractiveSession() &&
    !isEnvTruthy(process.env.NOA_CLAUDE_DISABLE_BACKGROUND_DEADLINE)
  )
}

export function getMaxBackgroundTimeoutMs(env: EnvLike = process.env): number {
  return Math.min(
    Math.max(MAX_BACKGROUND_TIMEOUT_FLOOR_MS, getMaxBashTimeoutMs(env)),
    MAX_TIMER_DELAY_MS,
  )
}

/**
 * With `run_in_background`, `timeout` is the background time limit rather than
 * the foreground one: the default is 30 minutes (or the foreground default,
 * if that is larger) and the ceiling 2 hours (or the foreground ceiling).
 */
export function resolveBackgroundTimeoutMs(timeout?: number): number {
  const requested =
    typeof timeout === 'number' && timeout > 0
      ? timeout
      : Math.max(DEFAULT_BACKGROUND_TIMEOUT_MS, getDefaultBashTimeoutMs())
  return Math.min(requested, getMaxBackgroundTimeoutMs())
}
