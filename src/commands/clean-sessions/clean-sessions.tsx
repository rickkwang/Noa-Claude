import React from 'react'
import { readdir, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import { Select } from '../../components/CustomSelect/select.js'
import { SelectMulti } from '../../components/CustomSelect/SelectMulti.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Spinner } from '../../components/Spinner.js'
import { useIsInsideModal } from '../../context/modalContext.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { formatFileSize } from '../../utils/format.js'
import { dirSize } from '../../utils/fsOperations.js'
import {
  extractFirstPromptFromHead,
  extractLastJsonStringField,
  getProjectDir,
  readHeadAndTail,
  validateUuid,
} from '../../utils/sessionStoragePortable.js'

type Mode = 'scan' | 'delete'
type Scope = 'all' | 'current'

type Args = {
  mode: Mode
  scope: Scope
  confirm: boolean
  includeLarge: boolean
  trivialOnly: boolean
  maxBytes: number
  userPickedSize: boolean
}

type SizeBucket = {
  label: string
  maxBytes: number
}

const SIZE_BUCKETS: SizeBucket[] = [
  { label: '≤ 256K', maxBytes: 256 * 1024 },
  { label: '≤ 512K', maxBytes: 512 * 1024 },
  { label: '≤ 1MB', maxBytes: 1024 * 1024 },
  { label: '≤ 10MB', maxBytes: 10 * 1024 * 1024 },
  { label: '≤ 50MB', maxBytes: 50 * 1024 * 1024 },
  { label: '≤ 100MB', maxBytes: 100 * 1024 * 1024 },
  { label: 'No limit', maxBytes: Number.POSITIVE_INFINITY },
]

type Candidate = {
  path: string
  project: string
  title: string
  reason: string
  size: number
  modified: Date
}

const DEFAULT_MAX_BYTES = 256 * 1024
const COLLAPSED_VISIBLE_CANDIDATES = 12
const MODAL_VISIBLE_CANDIDATES = 8
const TRIVIAL_RE = /^(?:ping|test|hello|hi|ok|clear|\/clear|\/usage|usage)$/i
// Sessions written to within this window may belong to another running
// instance — treat them as active and skip them.
const RECENTLY_MODIFIED_WINDOW_MS = 10 * 60 * 1000

const ALLOWED_ARGS = new Set([
  'delete',
  'clean',
  'scan',
  '--all',
  'all',
  '--confirm',
  '--yes',
  '--include-large',
  '--trivial-only',
])

function argError(error: string): Args & { error: string } {
  return {
    error,
    mode: 'scan',
    scope: 'current',
    confirm: false,
    includeLarge: false,
    trivialOnly: false,
    maxBytes: DEFAULT_MAX_BYTES,
    userPickedSize: false,
  }
}

function parseArgs(raw: string): Args & { error?: string } {
  const parts = raw
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)

  const unknown = parts.filter(
    part =>
      !ALLOWED_ARGS.has(part.toLowerCase()) &&
      !part.toLowerCase().startsWith('--max-bytes='),
  )
  if (unknown.length > 0) {
    return argError(
      `Unknown argument(s): ${unknown.join(', ')}\nUsage: /clean-sessions [delete] [--all] [--trivial-only] [--include-large] [--max-bytes=N] [--confirm|--yes]`,
    )
  }

  const lower = parts.map(part => part.toLowerCase())
  const mode: Mode =
    lower.includes('delete') || lower.includes('clean') ? 'delete' : 'scan'
  const scope: Scope =
    lower.includes('--all') || lower.includes('all') ? 'all' : 'current'
  const confirm = lower.includes('--confirm') || lower.includes('--yes')
  const includeLarge = lower.includes('--include-large')
  const trivialOnly = lower.includes('--trivial-only')

  let maxBytes = DEFAULT_MAX_BYTES
  let userPickedSize = false
  const maxArg = parts.find(part =>
    part.toLowerCase().startsWith('--max-bytes='),
  )
  if (maxArg) {
    const value = maxArg.split('=')[1]
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      maxBytes = parsed
      userPickedSize = true
    } else {
      // An unreadable size must not silently fall back to the default
      // bucket — same no-silent-downgrade rule as unknown flags.
      return argError(
        `Invalid --max-bytes value: ${value} (expected a positive number of bytes)`,
      )
    }
  }
  if (includeLarge || trivialOnly) {
    userPickedSize = true
  }

  return {
    mode,
    scope,
    confirm,
    includeLarge,
    trivialOnly,
    maxBytes,
    userPickedSize,
  }
}

async function listTopLevelSessionFiles(projectDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .filter(entry => validateUuid(entry.name.slice(0, -6)))
    .map(entry => join(projectDir, entry.name))
}

async function listSessionFiles(args: Args): Promise<string[]> {
  // Never touch the running session's own transcript — deleting it would
  // orphan the live session's resume/continue path.
  const ownTranscript = `${getSessionId()}.jsonl`
  const notOwn = (paths: string[]) =>
    paths.filter(path => basename(path) !== ownTranscript)

  if (args.scope === 'current') {
    return notOwn(await listTopLevelSessionFiles(getProjectDir(getOriginalCwd())))
  }

  const projectsRoot = join(getClaudeConfigHomeDir(), 'projects')
  let entries
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const perProject = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(entry => listTopLevelSessionFiles(join(projectsRoot, entry.name))),
  )
  return notOwn(perProject.flat())
}

function readTextFromUserEntry(line: string): string {
  try {
    const entry = JSON.parse(line)
    if (entry?.type !== 'user') return ''
    if (entry?.isMeta || entry?.isCompactSummary) return ''

    const content = entry.message?.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''

    return content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
  } catch {
    return ''
  }
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function classifySession(
  head: string,
  tail: string,
  size: number,
  args: Args,
): {
  title: string
  reason: string
} | null {
  const customTitle =
    extractLastJsonStringField(tail, 'customTitle') ||
    extractLastJsonStringField(head, 'customTitle') ||
    extractLastJsonStringField(tail, 'aiTitle') ||
    extractLastJsonStringField(head, 'aiTitle') ||
    ''
  const lastPrompt = extractLastJsonStringField(tail, 'lastPrompt') || ''
  const firstPrompt = extractFirstPromptFromHead(head)

  const title = normalizeTitle(customTitle || lastPrompt || firstPrompt)
  if (!title) return null
  if (!args.includeLarge && size > args.maxBytes) return null
  // Triviality is judged from the raw prompts only. An explicit title
  // (user-renamed or AI-generated) is a keep signal, not deletion evidence:
  // a session renamed "Test" is not a ping session.
  const promptText = normalizeTitle(lastPrompt || firstPrompt)
  const isTrivialTitle = !customTitle && TRIVIAL_RE.test(promptText)
  if (args.trivialOnly && !isTrivialTitle) return null

  const meaningfulUserTexts: string[] = []
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) {
      continue
    }
    const text = normalizeTitle(readTextFromUserEntry(line))
    if (!text) continue
    if (text.startsWith('<') || text.includes('<command-name>')) continue
    meaningfulUserTexts.push(text)
    if (meaningfulUserTexts.length > 2) break
  }

  return {
    title,
    reason: isTrivialTitle
      ? `${lastPrompt ? 'last prompt' : 'first prompt'} is trivial`
      : `small session under ${formatFileSize(args.maxBytes)}`,
  }
}

async function inspectFile(
  path: string,
  args: Args,
  buf: Buffer,
): Promise<Candidate | 'recent' | null> {
  let info
  try {
    info = await stat(path)
  } catch {
    return null
  }
  if (Date.now() - info.mtime.getTime() < RECENTLY_MODIFIED_WINDOW_MS) {
    return 'recent'
  }
  // The sidecar dir only adds bytes, so a jsonl already over the bucket is
  // out without walking the sidecar tree.
  if (!args.includeLarge && info.size > args.maxBytes) return null
  // Footprint includes the session's sidecar dir (<uuid>/, tool results
  // etc.) — the .jsonl alone understates what cleanup reclaims.
  const sidecarSize = await dirSize(path.slice(0, -'.jsonl'.length))
  const size = info.size + sidecarSize
  if (!args.includeLarge && size > args.maxBytes) return null

  const { head, tail } = await readHeadAndTail(path, info.size, buf)
  const classified = classifySession(head, tail, size, args)
  if (!classified) return null

  return {
    path,
    project: basename(dirname(path)),
    title: classified.title,
    reason: classified.reason,
    size,
    modified: info.mtime,
  }
}

const INSPECT_CONCURRENCY = 32

type ScanResult = {
  candidates: Candidate[]
  skippedRecent: number
}

async function findCandidates(args: Args): Promise<ScanResult> {
  const files = await listSessionFiles(args)
  const candidates: Candidate[] = []
  let skippedRecent = 0
  // One read buffer per worker slot, reused across chunks.
  const buffers = Array.from({ length: INSPECT_CONCURRENCY }, () =>
    Buffer.alloc(64 * 1024),
  )

  for (let i = 0; i < files.length; i += INSPECT_CONCURRENCY) {
    const chunk = files.slice(i, i + INSPECT_CONCURRENCY)
    const results = await Promise.all(
      chunk.map((file, j) => inspectFile(file, args, buffers[j]!)),
    )
    for (const result of results) {
      if (result === 'recent') skippedRecent += 1
      else if (result) candidates.push(result)
    }
  }

  candidates.sort(
    (a, b) => b.size - a.size || a.path.localeCompare(b.path),
  )
  return { candidates, skippedRecent }
}

type DeleteOutcome = {
  deleted: string[]
  failed: { path: string; error: string }[]
}

async function deleteCandidates(candidates: Candidate[]): Promise<DeleteOutcome> {
  const deleted: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const candidate of candidates) {
    try {
      await rm(candidate.path, { force: true })
    } catch (err) {
      failed.push({
        path: candidate.path,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    deleted.push(candidate.path)
    // Sidecar dir (<uuid>/, tool results etc.) goes with its transcript. A
    // sidecar failure must not misreport the already-deleted transcript.
    const sidecar = candidate.path.slice(0, -'.jsonl'.length)
    try {
      await rm(sidecar, { recursive: true, force: true })
    } catch (err) {
      failed.push({
        path: sidecar,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { deleted, failed }
}

function formatResult(
  candidates: Candidate[],
  args: Args,
  maxListed = 200,
): string {
  const scopeLabel =
    args.scope === 'current'
      ? `current project (${getProjectDir(getOriginalCwd())})`
      : `all Noa projects (${join(getClaudeConfigHomeDir(), 'projects')})`

  const lines = [
    'Noa session cleanup',
    `Scope: ${scopeLabel}`,
    `Matched: ${candidates.length}`,
    '',
  ]

  if (candidates.length === 0) {
    lines.push('No matching sessions found.')
    return lines.join('\n')
  }

  lines.push('Candidates:')
  for (const candidate of candidates.slice(0, maxListed)) {
    lines.push(
      `- ${candidate.title} | ${formatFileSize(candidate.size)} | ${candidate.project} | ${candidate.reason}`,
    )
    lines.push(`  ${candidate.path}`)
  }
  if (candidates.length > maxListed) {
    lines.push(`... ${candidates.length - maxListed} more not shown`)
  }
  return lines.join('\n')
}

type Stage = 'bucket' | 'scanning' | 'pick' | 'deleting'

const MAX_LABEL_CHARS = 80
const MAX_TITLE_CHARS = 50

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + '…'
}

function formatAge(modified: Date, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - modified.getTime())
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}

function formatCandidateLabel(candidate: Candidate, scope: Scope): string {
  const size = formatFileSize(candidate.size)
  const age = formatAge(candidate.modified)
  const title = truncate(candidate.title, MAX_TITLE_CHARS)
  if (scope === 'current') {
    return truncate(`${size} · ${age} · ${title}`, MAX_LABEL_CHARS)
  }
  // scope === 'all': keep project for disambiguation, but shorten it.
  const project = truncate(candidate.project.replace(/^-+/, ''), 24)
  return truncate(`${size} · ${age} · ${title} · ${project}`, MAX_LABEL_CHARS)
}

function describeScope(scope: Scope): string {
  return scope === 'current' ? 'current project' : 'all projects'
}

function CleanupPrompt({
  args: initialArgs,
  onDone,
}: {
  args: Args
  onDone: Parameters<LocalJSXCommandCall>[0]
}): React.ReactNode {
  const isInsideModal = useIsInsideModal()
  const [args, setArgs] = React.useState<Args>(initialArgs)
  const [stage, setStage] = React.useState<Stage>(
    initialArgs.userPickedSize ? 'scanning' : 'bucket',
  )
  const [candidates, setCandidates] = React.useState<Candidate[]>([])
  const [skippedRecent, setSkippedRecent] = React.useState(0)
  const [selectedCount, setSelectedCount] = React.useState(0)
  const [emptyMessage, setEmptyMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (stage !== 'scanning') return
    let cancelled = false
    findCandidates(args).then(({ candidates, skippedRecent }) => {
      if (cancelled) return
      setCandidates(candidates)
      setSkippedRecent(skippedRecent)
      if (candidates.length === 0) {
        // If user didn't pick a bucket interactively, exit. Otherwise loop
        // back so they can try a different bucket without re-running.
        if (initialArgs.userPickedSize) {
          onDone(formatResult(candidates, args))
          return
        }
        const sizeLabel = args.includeLarge
          ? 'no size limit'
          : `≤ ${formatFileSize(args.maxBytes)}`
        setEmptyMessage(
          `No sessions matched ${sizeLabel} in ${describeScope(args.scope)}. Pick a different bucket.`,
        )
        setStage('bucket')
        return
      }
      setEmptyMessage(null)
      setStage('pick')
    })
    return () => {
      cancelled = true
    }
  }, [stage, args, onDone, initialArgs.userPickedSize])

  const handleCancel = () => onDone('Session cleanup cancelled.')

  if (stage === 'bucket') {
    return (
      <Dialog
        title="Noa session cleanup"
        subtitle={
          <>
            {emptyMessage ?? `Pick a size bucket to scan in ${describeScope(args.scope)}.`}
          </>
        }
        onCancel={handleCancel}
        color="suggestion"
      >
        <Select
          options={SIZE_BUCKETS.map(bucket => ({
            value: String(bucket.maxBytes),
            label: bucket.label,
          }))}
          visibleOptionCount={SIZE_BUCKETS.length}
          onCancel={handleCancel}
          onChange={(value: string) => {
            const maxBytes = Number(value)
            const includeLarge = !Number.isFinite(maxBytes)
            setArgs({ ...args, maxBytes, includeLarge })
            setEmptyMessage(null)
            setStage('scanning')
          }}
        />
      </Dialog>
    )
  }

  if (stage === 'scanning') {
    return (
      <Box>
        <Spinner />
        <Text> Scanning Noa sessions...</Text>
      </Box>
    )
  }

  if (stage === 'deleting') {
    return (
      <Box>
        <Spinner />
        <Text> Deleting selected sessions...</Text>
      </Box>
    )
  }

  // stage === 'pick'
  if (candidates.length === 0) return null

  const visibleCandidates = isInsideModal
    ? MODAL_VISIBLE_CANDIDATES
    : COLLAPSED_VISIBLE_CANDIDATES
  const sizeLabel = args.includeLarge
    ? 'all sizes'
    : `≤ ${formatFileSize(args.maxBytes)}`

  return (
    <Dialog
      title="Noa session cleanup"
      subtitle={
        <>
          {describeScope(args.scope)} · {sizeLabel} · matched{' '}
          {candidates.length}
          {skippedRecent > 0
            ? ` · ${skippedRecent} recently-modified skipped`
            : ''}{' '}
          · selected {selectedCount}. Space to toggle, Enter to delete.
        </>
      }
      onCancel={handleCancel}
      color="suggestion"
    >
      <SelectMulti
        options={candidates.map(candidate => ({
          value: candidate.path,
          label: formatCandidateLabel(candidate, args.scope),
        }))}
        defaultValue={[]}
        visibleOptionCount={visibleCandidates}
        hideIndexes={true}
        onCancel={handleCancel}
        onChange={(values: string[]) => setSelectedCount(values.length)}
        onSubmit={async (selectedPaths: string[]) => {
          if (selectedPaths.length === 0) {
            onDone('Session cleanup cancelled (no sessions selected).')
            return
          }
          const selected = candidates.filter(c =>
            selectedPaths.includes(c.path),
          )
          setStage('deleting')
          const { deleted, failed } = await deleteCandidates(selected)
          const lines = [
            `Deleted: ${deleted.length}/${selected.length}`,
            `Matched in scan: ${candidates.length} (${sizeLabel}, ${describeScope(args.scope)})`,
          ]
          if (failed.length > 0) {
            lines.push(`Failed: ${failed.length}`)
            for (const f of failed) lines.push(`  ${f.path}: ${f.error}`)
          }
          onDone(lines.join('\n'))
        }}
      />
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, rawArgs) => {
  const args = parseArgs(rawArgs || '')
  if (args.error) {
    onDone(args.error)
    return null
  }

  if (args.mode === 'delete' && args.confirm) {
    // Bulk deletion skips the interactive picker, so restrict it to the
    // strongest signal (trivial prompts). Anything else must go through the
    // interactive multi-select where a human reviews each candidate.
    if (!args.trivialOnly) {
      onDone(
        'Bulk delete requires --trivial-only so only trivial-prompt sessions are removed.\n' +
          'Usage: /clean-sessions delete --trivial-only [--all] --confirm (or --yes)\n' +
          'To delete other sessions, run /clean-sessions and pick them interactively.',
      )
      return null
    }
    // No size widening in bulk mode: large sessions deserve human review.
    if (args.includeLarge || args.maxBytes > DEFAULT_MAX_BYTES) {
      onDone(
        `Bulk delete is limited to the default size bucket (≤ ${formatFileSize(DEFAULT_MAX_BYTES)}).\n` +
          'To delete larger sessions, run /clean-sessions and pick them interactively.',
      )
      return null
    }
    const before = await findCandidates(args)
    const { deleted, failed } = await deleteCandidates(before.candidates)
    const after = await findCandidates(args)
    const lines = [
      formatResult(before.candidates, args),
      '',
      `Deleted: ${deleted.length}/${before.candidates.length}`,
      `Remaining matches: ${after.candidates.length}`,
    ]
    if (before.skippedRecent > 0) {
      lines.push(
        `Skipped (modified in the last 10m, possibly active): ${before.skippedRecent}`,
      )
    }
    if (failed.length > 0) {
      lines.push(`Failed: ${failed.length}`)
      for (const f of failed) lines.push(`  ${f.path}: ${f.error}`)
    }
    onDone(lines.join('\n'))
    return null
  }

  return <CleanupPrompt args={args} onDone={onDone} />
}
