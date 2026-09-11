import { basename, resolve } from 'path'
import type {
  StatusLineCommandInput,
  StatusLineRepo,
  StatusLineVimMode,
} from '../types/statusLine.js'
import type { VimMode } from '../types/textInputTypes.js'
import { parseGitRemote } from './detectRepository.js'
import {
  getCommonDir,
  getRemoteUrlForDir,
  resolveGitDir,
} from './git/gitFilesystem.js'

/** Largest delay setTimeout accepts; bigger values fire immediately. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Grace after a rate-limit window resets before re-running the command. */
const RESET_WAKE_GRACE_MS = 1000

type StatusLineRefreshSettings = {
  refreshInterval?: number
  refreshIntervalMs?: number
}

/**
 * Periodic re-run interval in ms, or null when none is configured.
 * `refreshInterval` (seconds) is the canonical key; `refreshIntervalMs` is
 * the legacy Noa spelling and only applies when the canonical key is absent.
 */
export function getStatusLineRefreshMs(
  statusLine: StatusLineRefreshSettings | undefined,
): number | null {
  const seconds = statusLine?.refreshInterval
  let ms: number
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    ms = Math.max(1, seconds) * 1000
  } else {
    const legacy = statusLine?.refreshIntervalMs
    if (typeof legacy !== 'number' || !Number.isFinite(legacy)) return null
    ms = Math.max(1000, legacy)
  }
  return Math.min(MAX_TIMER_DELAY_MS, ms)
}

/**
 * Epoch ms of the earliest point where the input would change without any
 * user activity (a rate-limit window resetting), or null if there is none.
 */
export function getStatusLineWakeAt(
  input: Pick<StatusLineCommandInput, 'rate_limits'>,
): number | null {
  const resets = [
    input.rate_limits?.five_hour?.resets_at,
    input.rate_limits?.seven_day?.resets_at,
  ].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  return resets.length === 0 ? null : Math.min(...resets) * 1000
}

/** Delay until the wake-up for `wakeAt`, clamped to a valid timer range. */
export function getStatusLineWakeDelayMs(wakeAt: number, now: number): number {
  return Math.min(
    MAX_TIMER_DELAY_MS,
    Math.max(0, wakeAt + RESET_WAKE_GRACE_MS - now),
  )
}

// SGR color/style sequences and OSC 8 hyperlink open/close sequences.
const CARRIED_ESCAPES = /\x1b\[[\d;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g

/**
 * Split multi-line output into independently renderable lines. Each line is
 * prefixed with every SGR / OSC 8 sequence seen on earlier lines, so a color
 * or link opened on one line still applies after the split (each line is
 * truncated to the terminal width on its own).
 */
export function splitStatusLineText(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length === 1) return lines
  const out = [lines[0]!]
  let carried = ''
  for (let i = 1; i < lines.length; i++) {
    carried += (lines[i - 1]!.match(CARRIED_ESCAPES) ?? []).join('')
    out.push(carried + lines[i]!)
  }
  return out
}

export function toStatusLineVimMode(mode: VimMode | undefined): StatusLineVimMode {
  if (mode === 'VISUAL_LINE') return 'VISUAL LINE'
  return mode ?? 'INSERT'
}

/**
 * Drop windows whose reset time has passed: their utilization describes a
 * window that no longer exists until the next API response refreshes it.
 */
export function buildStatusLineRateLimits(
  raw: {
    five_hour?: { utilization: number; resets_at: number }
    seven_day?: { utilization: number; resets_at: number }
  },
  now: number,
): StatusLineCommandInput['rate_limits'] | undefined {
  const out: NonNullable<StatusLineCommandInput['rate_limits']> = {}
  for (const key of ['five_hour', 'seven_day'] as const) {
    const w = raw[key]
    if (w && w.resets_at * 1000 > now) {
      out[key] = {
        used_percentage: w.utilization * 100,
        resets_at: w.resets_at,
      }
    }
  }
  return out.five_hour || out.seven_day ? out : undefined
}

/**
 * Name of the linked git worktree containing `cwd` (the `<name>` in
 * `<common>/worktrees/<name>`), or undefined for a main checkout / non-repo.
 */
export async function getLinkedWorktreeName(
  cwd: string,
): Promise<string | undefined> {
  const gitDir = await resolveGitDir(cwd)
  if (!gitDir) return undefined
  const commonDir = await getCommonDir(gitDir)
  if (!commonDir || resolve(commonDir) === resolve(gitDir)) return undefined
  return basename(gitDir)
}

export async function getStatusLineRepo(
  cwd: string,
): Promise<StatusLineRepo | undefined> {
  const url = await getRemoteUrlForDir(cwd)
  return (url && parseGitRemote(url)) || undefined
}

export async function getStatusLineWorkspaceGit(cwd: string): Promise<{
  gitWorktree: string | undefined
  repo: StatusLineRepo | undefined
}> {
  const [gitWorktree, repo] = await Promise.all([
    getLinkedWorktreeName(cwd).catch(() => undefined),
    getStatusLineRepo(cwd).catch(() => undefined),
  ])
  return { gitWorktree, repo }
}
