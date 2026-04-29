import React from 'react'
import { readdir, rm, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { Select } from '../../components/CustomSelect/select.js'
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
type CleanupChoice = 'yes' | 'no' | 'tell'

type Args = {
  mode: Mode
  scope: Scope
  confirm: boolean
  includeLarge: boolean
  trivialOnly: boolean
  maxBytes: number
}

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
  const maxArg = parts.find(part => part.startsWith('--max-bytes='))
  if (maxArg) {
    const parsed = Number(maxArg.split('=')[1])
    if (Number.isFinite(parsed) && parsed > 0) maxBytes = parsed
  }

  return { mode, scope, confirm, includeLarge, trivialOnly, maxBytes }
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

async function findCandidates(args: Args): Promise<Candidate[]> {
  const files = await listSessionFiles(args)
  const candidates: Candidate[] = []

  for (const file of files) {
    const candidate = await inspectFile(file, args)
    if (candidate) candidates.push(candidate)
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

function CleanupPrompt({
  args,
  onDone,
}: {
  args: Args
  onDone: Parameters<LocalJSXCommandCall>[0]
}): React.ReactNode {
  const isInsideModal = useIsInsideModal()
  const [loading, setLoading] = React.useState(true)
  const [deleting, setDeleting] = React.useState(false)
  const [candidates, setCandidates] = React.useState<Candidate[]>([])
  const [tellInstruction, setTellInstruction] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    findCandidates(args).then(result => {
      if (cancelled) return
      setCandidates(result)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [args])

  React.useEffect(() => {
    if (!loading && candidates.length === 0) {
      onDone(formatResult(candidates, args))
    }
  }, [loading, candidates, args, onDone])

  if (loading) {
    return (
      <Box>
        <Spinner />
        <Text> Scanning Noa sessions...</Text>
      </Box>
    )
  }

  if (deleting) {
    return (
      <Box>
        <Spinner />
        <Text> Deleting matched sessions...</Text>
      </Box>
    )
  }

  if (candidates.length === 0) return null

  const visibleCandidates = isInsideModal
    ? MODAL_VISIBLE_CANDIDATES
    : COLLAPSED_VISIBLE_CANDIDATES
  const preview = candidates.slice(0, visibleCandidates)
  const hiddenBelow = Math.max(0, candidates.length - preview.length)
  const handleCancel = () => onDone('Session cleanup cancelled.')

  return (
    <Dialog
      title="Noa session cleanup"
      subtitle={
        <>
          Matched {candidates.length} session
          {candidates.length === 1 ? '' : 's'} under{' '}
          {args.includeLarge ? 'all sizes' : formatFileSize(args.maxBytes)}.
        </>
      }
      onCancel={handleCancel}
      color="suggestion"
    >
      <Box flexDirection="column">
        <Box flexDirection="column">
          {preview.map(candidate => (
            <Text key={candidate.path} dimColor={true}>
              - {candidate.title} · {formatFileSize(candidate.size)} ·{' '}
              {candidate.project}
            </Text>
          ))}
          {hiddenBelow > 0 ? (
            <Text dimColor={true}>... {hiddenBelow} more</Text>
          ) : null}
        </Box>
        <Select
          options={[
            {
              value: 'yes',
              label: 'Yes, delete matched sessions',
            },
            {
              value: 'no',
              label: 'No, leave unchanged',
            },
            {
              type: 'input',
              value: 'tell',
              label: 'Tell agent what to do',
              placeholder: 'e.g. only delete ping sessions',
              onChange: (value: string) => setTellInstruction(value),
              showLabelWithValue: true,
              labelValueSeparator: ': ',
            },
          ]}
          visibleOptionCount={3}
          onCancel={handleCancel}
          onChange={async (value: CleanupChoice) => {
            if (value === 'no') {
              onDone('Session cleanup cancelled.')
              return
            }
            if (value === 'tell') {
              const instruction = tellInstruction.trim()
              onDone('Session cleanup paused for your instruction.', {
                nextInput: instruction || 'Only delete ',
                submitNextInput: Boolean(instruction),
              })
              return
            }
            setDeleting(true)
            const deleted = await deleteCandidates(candidates)
            const remainingCandidates = await findCandidates(args)
            onDone(
              [
                `Deleted: ${deleted.length}/${candidates.length}`,
                `Remaining matches: ${remainingCandidates.length}`,
              ].join('\n'),
            )
          }}
        />
      </Box>
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
