// @ts-nocheck
// Loads the raw tip entries out of a spinnerTipsOverride.tipsFile — the
// governance question of *which settings source may even name a tipsFile*
// lives in tipRegistry.ts; this module only handles turning a path string
// into a validated array of tip entries (or null, logging why it bailed).
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import { getErrnoCode, isENOENT } from 'src/utils/errors.js'
import { getFsImplementation, safeResolvePath } from 'src/utils/fsOperations.js'
import { logForDebugging } from 'src/utils/debug.js'

// Ceiling on how big a tipsFile we'll read. Upstream Claude Code's own limit
// isn't recoverable from string extraction (the number itself isn't a
// string literal), so this is noa's own choice: comfortably fits a few
// hundred tips without letting a mistakenly-pointed path (a multi-MB log
// file, say) stall spinner startup reading it off a slow disk.
const TIPS_FILE_MAX_BYTES = 256 * 1024

// Ceiling on how many tips one file may contribute. The byte cap alone
// doesn't bound this — 95KB of short strings is ~12k tips, and every one of
// them is normalized and sorted on each turn. Generous next to the ~40
// built-ins while keeping the per-turn cost flat.
//
// Inline `tips` arrays are deliberately *not* capped: those are hand-authored
// in a settings file the author is looking at, while a tipsFile is an external
// artifact that may be generated, shipped by an admin, or pointed at by
// mistake. Truncation here is logged rather than silent.
const TIPS_FILE_MAX_ENTRIES = 200

export type RawTipEntry =
  | string
  | {
      id?: unknown
      text?: unknown
      cooldownSessions?: unknown
      priority?: unknown
    }

// getRelevantTips runs once per turn, so an uncached loader would statSync +
// readFileSync + JSON.parse on the spinner's hot path every time. Cache the
// parsed result against the file's identity (path + mtime + size) so a turn
// costs one statSync unless the file actually changed — and an admin editing
// the tips file still sees it picked up without restarting the session.
type TipsFileCacheEntry = {
  mtimeMs: number
  size: number
  tips: RawTipEntry[] | null
}
const tipsFileCache = new Map<string, TipsFileCacheEntry>()

// Absolute or ~/-prefixed only — matches upstream's rule and sidesteps
// "relative to what?" (cwd? the settings file's own directory?) ambiguity
// for a path that may come from managed/enterprise settings.
function resolveTipsFilePath(rawPath: string): string | null {
  const trimmed = rawPath.trim()
  if (!trimmed) return null
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(1))
  }
  if (isAbsolute(trimmed)) return trimmed
  return null
}

/**
 * Reads and shallow-validates a spinnerTipsOverride.tipsFile. Returns the
 * raw tip entries (still unvalidated at the individual-tip level — that's
 * normalizeCustomTipEntries's job) on success, or null if the file should
 * be treated as "no file tips loaded" (missing, wrong shape, too big, not a
 * local regular file, etc). Every rejection reason is logged via
 * logForDebugging so a misconfigured tipsFile isn't silently inert.
 */
export function loadTipsFile(rawPath: unknown): RawTipEntry[] | null {
  // Unvalidated settings reach here (see the Array.isArray note in
  // tipRegistry's normalizeCustomTipEntries) — a non-string tipsFile is a
  // config mistake, not a crash.
  if (typeof rawPath !== 'string') {
    logForDebugging(
      'spinnerTipsOverride.tipsFile must be a string path; ignoring it',
      { level: 'warn' },
    )
    return null
  }
  // Block UNC / network paths (\\server\share, //server/share) before any
  // filesystem access — same rule safeResolvePath uses to avoid DNS/SMB
  // traffic during path resolution. Trim first: leading whitespace would
  // otherwise slip a UNC path past this check and into isAbsolute(), which
  // accepts it on Windows.
  const trimmedPath = rawPath.trim()
  if (trimmedPath.startsWith('//') || trimmedPath.startsWith('\\\\')) {
    logForDebugging(
      'spinnerTipsOverride.tipsFile must be a local path, not a network (UNC) path; ignoring it',
      { level: 'warn' },
    )
    return null
  }

  const resolved = resolveTipsFilePath(trimmedPath)
  if (!resolved) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile must be an absolute or ~/ path (got "${rawPath}"); ignoring it`,
      { level: 'warn' },
    )
    return null
  }

  const fs = getFsImplementation()
  const { resolvedPath } = safeResolvePath(fs, resolved)

  let stats
  try {
    stats = fs.statSync(resolvedPath)
  } catch (error) {
    if (isENOENT(error)) {
      logForDebugging(
        `spinnerTipsOverride.tipsFile ${resolvedPath} does not exist; no file tips loaded`,
        { level: 'info' },
      )
    } else {
      logForDebugging(
        `spinnerTipsOverride.tipsFile ${resolvedPath} could not be read: ${getErrnoCode(error) ?? error}`,
        { level: 'warn' },
      )
    }
    return null
  }

  if (!stats.isFile()) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile ${resolvedPath} is not a regular file; ignoring it`,
      { level: 'warn' },
    )
    return null
  }

  if (stats.size > TIPS_FILE_MAX_BYTES) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile ${resolvedPath} is larger than ${TIPS_FILE_MAX_BYTES} bytes; ignoring it`,
      { level: 'warn' },
    )
    return null
  }

  // Serve the cached parse when the file hasn't changed since we read it.
  // Negative results (bad JSON, wrong shape) are cached too, so a malformed
  // file isn't re-read and re-warned on every turn.
  const cached = tipsFileCache.get(resolvedPath)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.tips
  }
  const remember = (tips: RawTipEntry[] | null): RawTipEntry[] | null => {
    tipsFileCache.set(resolvedPath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      tips,
    })
    return tips
  }

  let raw: string
  try {
    raw = fs.readFileSync(resolvedPath, { encoding: 'utf8' })
  } catch (error) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile ${resolvedPath} could not be read: ${getErrnoCode(error) ?? error}`,
      { level: 'warn' },
    )
    return null
  }

  let parsed: unknown
  try {
    // Strip a UTF-8 BOM: JSON.parse rejects it, and it's what a Windows admin
    // gets by default from Notepad/PowerShell redirection.
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  } catch {
    logForDebugging(
      `spinnerTipsOverride.tipsFile ${resolvedPath} must be a JSON array of tips (or {"tips": [...]}); ignoring it`,
      { level: 'warn' },
    )
    return remember(null)
  }

  const tips = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { tips?: unknown }).tips)
      ? (parsed as { tips: unknown[] }).tips
      : null

  if (!tips) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile ${resolvedPath} must be a JSON array of tips (or {"tips": [...]}); ignoring it`,
      { level: 'warn' },
    )
    return remember(null)
  }

  if (tips.length > TIPS_FILE_MAX_ENTRIES) {
    logForDebugging(
      `spinnerTipsOverride.tipsFile ${resolvedPath} has ${tips.length} tips; only the first ${TIPS_FILE_MAX_ENTRIES} are used`,
      { level: 'warn' },
    )
  }

  return remember(tips.slice(0, TIPS_FILE_MAX_ENTRIES) as RawTipEntry[])
}
