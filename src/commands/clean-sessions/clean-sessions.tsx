import React from 'react'
import { readdir, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { Select } from '../../components/CustomSelect/select.js'
import { SelectMulti } from '../../components/CustomSelect/SelectMulti.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Spinner } from '../../components/Spinner.js'
import { useIsInsideModal } from '../../context/modalContext.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { formatFileSize } from '../../utils/format.js'
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

function parseArgs(raw: string): Args {
  const parts = raw
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)

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
  const maxArg = parts.find(part => part.startsWith('--max-bytes='))
  if (maxArg) {
    const parsed = Number(maxArg.split('=')[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      maxBytes = parsed
      userPickedSize = true
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
  if (args.scope === 'current') {
    return listTopLevelSessionFiles(getProjectDir(getOriginalCwd()))
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
  return perProject.flat()
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
  const isTrivialTitle = TRIVIAL_RE.test(title)
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
      ? `${customTitle ? 'title' : lastPrompt ? 'last prompt' : 'first prompt'} is trivial`
      : `small session under ${formatFileSize(args.maxBytes)}`,
  }
}

async function inspectFile(path: string, args: Args): Promise<Candidate | null> {
  let info
  try {
    info = await stat(path)
  } catch {
    return null
  }
  if (!args.includeLarge && info.size > args.maxBytes) return null

  const { head, tail } = await readHeadAndTail(
    path,
    info.size,
    Buffer.alloc(64 * 1024),
  )
  const classified = classifySession(head, tail, info.size, args)
  if (!classified) return null

  return {
    path,
    project: basename(dirname(path)),
    title: classified.title,
    reason: classified.reason,
    size: info.size,
    modified: info.mtime,
  }
}

const INSPECT_CONCURRENCY = 32

async function findCandidates(args: Args): Promise<Candidate[]> {
  const files = await listSessionFiles(args)
  const candidates: Candidate[] = []

  for (let i = 0; i < files.length; i += INSPECT_CONCURRENCY) {
    const chunk = files.slice(i, i + INSPECT_CONCURRENCY)
    const results = await Promise.all(
      chunk.map(file => inspectFile(file, args)),
    )
    for (const candidate of results) {
      if (candidate) candidates.push(candidate)
    }
  }

  return candidates.sort(
    (a, b) =>
      b.modified.getTime() - a.modified.getTime() || a.path.localeCompare(b.path),
  )
}

async function deleteCandidates(candidates: Candidate[]): Promise<string[]> {
  const deleted: string[] = []
  for (const candidate of candidates) {
    try {
      await rm(candidate.path, { force: true })
      deleted.push(candidate.path)
    } catch {
      // Continue with the rest and report the final count.
    }
  }
  return deleted
}

function formatResult(candidates: Candidate[], args: Args): string {
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
  for (const candidate of candidates.slice(0, 200)) {
    lines.push(
      `- ${candidate.title} | ${formatFileSize(candidate.size)} | ${candidate.project} | ${candidate.reason}`,
    )
    lines.push(`  ${candidate.path}`)
  }
  if (candidates.length > 200) {
    lines.push(`... ${candidates.length - 200} more not shown`)
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
  const [selectedCount, setSelectedCount] = React.useState(0)
  const [emptyMessage, setEmptyMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (stage !== 'scanning') return
    let cancelled = false
    findCandidates(args).then(result => {
      if (cancelled) return
      const sorted = [...result].sort((a, b) => b.size - a.size)
      setCandidates(sorted)
      if (sorted.length === 0) {
        // If user didn't pick a bucket interactively, exit. Otherwise loop
        // back so they can try a different bucket without re-running.
        if (initialArgs.userPickedSize) {
          onDone(formatResult(sorted, args))
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
          {candidates.length} · selected {selectedCount}. Space to toggle, Enter
          to delete.
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
          const deleted = await deleteCandidates(selected)
          onDone(
            [
              `Deleted: ${deleted.length}/${selected.length}`,
              `Matched in scan: ${candidates.length} (${sizeLabel}, ${describeScope(args.scope)})`,
            ].join('\n'),
          )
        }}
      />
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, rawArgs) => {
  const args = parseArgs(rawArgs || '')

  if (args.mode === 'delete' && args.confirm) {
    const before = await findCandidates(args)
    const deleted = await deleteCandidates(before)
    const after = await findCandidates(args)
    onDone(
      [
        formatResult(before, args),
        '',
        `Deleted: ${deleted.length}/${before.length}`,
        `Remaining matches: ${after.length}`,
      ].join('\n'),
    )
    return null
  }

  return <CleanupPrompt args={args} onDone={onDone} />
}
