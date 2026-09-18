/**
 * Locally queued feedback drafts.
 *
 * The model writes these through SendFeedbackTool when it notices something
 * worth reporting; `/feedback` shows the queue so the person can review, open
 * a prefilled GitHub issue, or throw the draft away. Nothing here reaches the
 * network on its own — the only egress is the browser the person opens from
 * the review dialog, which is the same path `/feedback` has always used.
 *
 * One file per draft under `<config>/feedback-drafts/`, each written
 * tmp-then-rename at mode 0600. A shared array file would have to be
 * read-modify-written on every draft, which loses the whole queue to one bad
 * write and cannot be called from two places at once; per-draft files make a
 * write independent of every other draft.
 *
 * No telemetry: this file logs failures locally and nothing else, matching the
 * project's hardcoded privacy defaults.
 */
import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { logError } from './log.js'

/** Kinds of report a draft can carry, mirroring the `/feedback` categories. */
export const FEEDBACK_DRAFT_TYPES = [
  'bug',
  'idea',
  'missing_capability',
] as const
export type FeedbackDraftType = (typeof FEEDBACK_DRAFT_TYPES)[number]

/**
 * Closed set for model-behavior reports. Absent on a draft that is purely a
 * product or tool bug with no model-behavior component.
 */
export const FEEDBACK_FAILURE_MODES = [
  'instruction_following',
  'destructive_actions',
  'code_quality',
  'repetition_and_looping',
  'model_regression',
  'overconfidence_and_hallucination',
  'context_and_memory',
  'overeager',
  'over_correction',
  'stopping_short',
  'dispute_or_decline',
  'subagent_overspawn',
  'tone_or_preachiness',
  'excessive_questions',
  'unwanted_scope',
  'other',
] as const
export type FeedbackFailureMode = (typeof FEEDBACK_FAILURE_MODES)[number]

/** What the session was doing when the issue happened. */
export const FEEDBACK_TASK_CATEGORIES = [
  'code_edit',
  'debug',
  'explain',
  'plan',
  'shell',
  'search',
  'review',
  'other',
] as const
export type FeedbackTaskCategory = (typeof FEEDBACK_TASK_CATEGORIES)[number]

export type FeedbackDraft = {
  id: string
  type: FeedbackDraftType
  title: string
  details: string
  area?: string
  failureMode?: FeedbackFailureMode
  taskCategory?: FeedbackTaskCategory
  /** ISO-8601, so a stale queue is obvious on review and TTL can be applied. */
  createdAt: string
  sessionId?: string
  /** Context a reader of the resulting issue would otherwise have to ask for. */
  cliVersion?: string
  cwd?: string
}

/**
 * Cap on the queue. Old drafts are evicted oldest-first once it is reached, so
 * a long-running session cannot grow the directory without bound and a person
 * who never runs `/feedback` never faces more than one screen of them.
 */
export const MAX_FEEDBACK_DRAFTS = 10

/** Drafts older than this are dropped on read rather than shown as current. */
export const FEEDBACK_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Size ceilings. A draft is a short report, so these are generous; they exist
 * because `details` is model-authored free text written to the config
 * directory, and nothing else bounds it.
 */
export const MAX_DRAFT_BYTES = 32_768
export const MAX_DETAILS_CHARS = 10_240
export const MAX_TITLE_CHARS = 200
export const MAX_AREA_CHARS = 64
const MAX_CWD_CHARS = 512

/** Characters allowed in `area`: a short tag, not prose. */
const AREA_DISALLOWED = /[^A-Za-z0-9.:_/@[\]-]/g

/** Filenames this module will read back; also what randomUUID produces. */
const DRAFT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Drafts are ordered by `createdAt`, which has millisecond resolution — two
 * queued in the same millisecond would tie, leaving "newest first" and
 * "evict oldest" undefined between them. Nudging each collision forward by 1ms
 * keeps the timestamps strictly increasing within a process, which is what the
 * ordering actually depends on; the drift is bounded by the number of drafts a
 * session may write and never exceeds a few milliseconds.
 */
let lastIssuedMs = 0
function nextCreatedAt(): string {
  const now = Math.max(Date.now(), lastIssuedMs + 1)
  lastIssuedMs = now
  return new Date(now).toISOString()
}

export type QueueFailureReason = 'too_large' | 'write_failed'
export type QueueResult =
  | { success: true; draft: FeedbackDraft; evicted: number }
  | { success: false; reason: QueueFailureReason }

function draftsDir(): string {
  return join(getClaudeConfigHomeDir(), 'feedback-drafts')
}

function draftPath(id: string): string {
  return join(draftsDir(), `${id}.json`)
}

/**
 * Drops control characters, then truncates by code point rather than code unit
 * so a cut never lands inside a surrogate pair. Written as a code-point filter
 * rather than a regex to keep literal control characters out of this source.
 */
function sanitizeText(value: string, maxChars: number): string {
  const kept: string[] = []
  for (const char of value) {
    const code = char.codePointAt(0)!
    const isControl = code < 0x20 || code === 0x7f
    // Tab and newline are legitimate inside `details`, which is multi-line.
    if (isControl && char !== '\t' && char !== '\n') continue
    kept.push(char)
    if (kept.length >= maxChars) break
  }
  return kept.join('')
}

/** The title as it is stored and as the transcript shows it: one clean line. */
export function sanitizeDraftTitle(value: string): string {
  return sanitizeText(value, MAX_TITLE_CHARS).replace(/[\t\n]+/g, ' ').trim()
}

function sanitizeArea(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = sanitizeText(value, MAX_AREA_CHARS)
    .trim()
    // Whitespace becomes a hyphen before the charset filter runs, so the tag
    // the model was asked to write ("bash permissions") survives as
    // "bash-permissions" rather than collapsing into "bashpermissions".
    .replace(/\s+/g, '-')
    .replace(AREA_DISALLOWED, '')
    .replace(/^-+|-+$/g, '')
  return cleaned === '' ? undefined : cleaned
}

function isFeedbackDraft(value: unknown): value is FeedbackDraft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.id === 'string' &&
    DRAFT_ID_PATTERN.test(draft.id) &&
    typeof draft.title === 'string' &&
    typeof draft.details === 'string' &&
    typeof draft.createdAt === 'string' &&
    FEEDBACK_DRAFT_TYPES.includes(draft.type as FeedbackDraftType)
  )
}

/**
 * Reads the queue, newest first, dropping anything expired or unreadable.
 *
 * Every failure mode — missing directory, unreadable file, malformed JSON, a
 * shape that does not match, a filename that disagrees with the id it carries
 * — yields fewer drafts rather than an exception: feedback is an aside, and it
 * must never take down the turn that drafts it or the dialog that reads it.
 */
export function listFeedbackDrafts(now: Date = new Date()): FeedbackDraft[] {
  const dir = draftsDir()
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir).filter(name => name.endsWith('.json'))
  } catch (error) {
    logError(error)
    return []
  }

  const drafts: FeedbackDraft[] = []
  for (const name of entries) {
    const path = join(dir, name)
    try {
      // A file bigger than the write cap was not written by this module.
      if (statSync(path).size > MAX_DRAFT_BYTES) continue
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      if (!isFeedbackDraft(parsed)) continue
      // Guards a draft being read back under someone else's name.
      if (name !== `${parsed.id}.json`) continue
      const created = Date.parse(parsed.createdAt)
      if (
        Number.isFinite(created) &&
        now.getTime() - created > FEEDBACK_DRAFT_TTL_MS
      ) {
        removeDraftFile(parsed.id)
        continue
      }
      drafts.push(parsed)
    } catch (error) {
      logError(error)
    }
  }
  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function removeDraftFile(id: string): boolean {
  if (!DRAFT_ID_PATTERN.test(id)) return false
  try {
    rmSync(draftPath(id), { force: true })
    return true
  } catch (error) {
    logError(error)
    return false
  }
}

/**
 * Writes a draft to its own file, then evicts the oldest if the queue is over
 * the cap. Returns the reason on failure so the caller can tell the model
 * whether shortening and retrying would help.
 */
export function queueFeedbackDraft(
  draft: Omit<FeedbackDraft, 'id' | 'createdAt'>,
): QueueResult {
  // `details` is the report itself, so it is rejected rather than truncated:
  // silently cutting it would file half an issue, and the caller's error text
  // promises that shortening and retrying works. Title, area and cwd are
  // incidental labels, so those are trimmed to fit.
  if (Array.from(draft.details).length > MAX_DETAILS_CHARS) {
    return { success: false, reason: 'too_large' }
  }

  const entry: FeedbackDraft = {
    ...draft,
    title: sanitizeDraftTitle(draft.title),
    details: sanitizeText(draft.details, MAX_DETAILS_CHARS),
    area: sanitizeArea(draft.area),
    cwd: draft.cwd ? sanitizeText(draft.cwd, MAX_CWD_CHARS) : undefined,
    id: randomUUID(),
    createdAt: nextCreatedAt(),
  }

  const serialized = JSON.stringify(entry, null, 2)
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_DRAFT_BYTES) {
    return { success: false, reason: 'too_large' }
  }

  const path = draftPath(entry.id)
  // tmp-then-rename: a reader never sees a half-written draft, and a crash
  // mid-write leaves the queue exactly as it was.
  const tempPath = `${path}.tmp.${process.pid}.${Date.now()}`
  try {
    mkdirSync(draftsDir(), { recursive: true, mode: 0o700 })
    // 0600: a draft quotes what the person said and what the session was doing.
    writeFileSync(tempPath, serialized, { encoding: 'utf-8', mode: 0o600 })
    renameSync(tempPath, path)
  } catch (error) {
    logError(error)
    try {
      rmSync(tempPath, { force: true })
    } catch {
      // Best effort; a stray .tmp is skipped by the *.json read filter.
    }
    return { success: false, reason: 'write_failed' }
  }

  return { success: true, draft: entry, evicted: evictOverflow() }
}

/** Drops oldest-first until the queue is back within the cap. */
function evictOverflow(): number {
  const drafts = listFeedbackDrafts()
  if (drafts.length <= MAX_FEEDBACK_DRAFTS) return 0
  // listFeedbackDrafts sorts newest first, so the tail is the oldest.
  const overflow = drafts.slice(MAX_FEEDBACK_DRAFTS)
  let evicted = 0
  for (const draft of overflow) {
    if (removeDraftFile(draft.id)) evicted++
  }
  return evicted
}

/** Drops one draft by id. Returns false when it was absent or unremovable. */
export function deleteFeedbackDraft(id: string): boolean {
  if (!DRAFT_ID_PATTERN.test(id)) return false
  if (!existsSync(draftPath(id))) return false
  return removeDraftFile(id)
}

/** Empties the queue. */
export function clearFeedbackDrafts(): boolean {
  let ok = true
  for (const draft of listFeedbackDrafts()) {
    if (!removeDraftFile(draft.id)) ok = false
  }
  return ok
}

/**
 * Renders a draft as the issue body `/feedback` prefills. Kept close to the
 * labeled-bullet shape the tool asks the model to write, so a reviewed draft
 * reads the same in the terminal and in the GitHub issue.
 */
export function formatFeedbackDraft(draft: FeedbackDraft): string {
  const meta = [
    `Type: ${draft.type}`,
    draft.area ? `Area: ${draft.area}` : null,
    draft.failureMode ? `Failure mode: ${draft.failureMode}` : null,
    draft.taskCategory ? `Task: ${draft.taskCategory}` : null,
    draft.cliVersion ? `Version: ${draft.cliVersion}` : null,
    draft.cwd ? `Cwd: ${draft.cwd}` : null,
    `Drafted: ${draft.createdAt}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
  return `${draft.title}\n\n${draft.details}\n\n---\n${meta}`
}
