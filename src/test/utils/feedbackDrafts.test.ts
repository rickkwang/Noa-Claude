import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearFeedbackDrafts,
  deleteFeedbackDraft,
  FEEDBACK_DRAFT_TTL_MS,
  formatFeedbackDraft,
  listFeedbackDrafts,
  MAX_AREA_CHARS,
  MAX_DETAILS_CHARS,
  MAX_FEEDBACK_DRAFTS,
  MAX_TITLE_CHARS,
  queueFeedbackDraft,
} from '../../utils/feedbackDrafts.js'

let configDir: string
let previousConfigDir: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'noa-feedback-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  rmSync(configDir, { recursive: true, force: true })
})

const draftsDir = () => join(configDir, 'feedback-drafts')
const draft = (title: string) =>
  ({ type: 'bug', title, details: 'What happened: x' }) as const

function queueOrThrow(input: Parameters<typeof queueFeedbackDraft>[0]) {
  const result = queueFeedbackDraft(input)
  if (!result.success) throw new Error(`queue failed: ${result.reason}`)
  return result.draft
}

describe('feedback draft queue', () => {
  test('starts empty and round-trips a draft', () => {
    expect(listFeedbackDrafts()).toEqual([])
    const queued = queueOrThrow(draft('first'))
    const drafts = listFeedbackDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.title).toBe('first')
    expect(drafts[0]!.id).toBe(queued.id)
  })

  // One file per draft is what lets the tool claim concurrency safety.
  test('writes one 0600 file per draft, named for its id', () => {
    const a = queueOrThrow(draft('a'))
    const b = queueOrThrow(draft('b'))
    const files = readdirSync(draftsDir()).sort()
    expect(files).toEqual([`${a.id}.json`, `${b.id}.json`].sort())
    expect(statSync(join(draftsDir(), `${a.id}.json`)).mode & 0o777).toBe(0o600)
  })

  test('leaves no temp files behind', () => {
    queueOrThrow(draft('a'))
    expect(readdirSync(draftsDir()).some(f => f.includes('.tmp.'))).toBe(false)
  })

  test('returns newest first', () => {
    queueOrThrow(draft('older'))
    queueOrThrow(draft('newer'))
    const titles = listFeedbackDrafts().map(d => d.title)
    expect(titles[0]).toBe('newer')
  })

  test('keeps optional fields only when supplied', () => {
    queueOrThrow({
      ...draft('tagged'),
      area: 'bash-permissions',
      failureMode: 'instruction_following',
      taskCategory: 'review',
    })
    const [stored] = listFeedbackDrafts()
    expect(stored!.area).toBe('bash-permissions')
    expect(stored!.failureMode).toBe('instruction_following')
    queueOrThrow(draft('bare'))
    const bare = listFeedbackDrafts().find(d => d.title === 'bare')!
    expect(bare.area).toBeUndefined()
    expect(bare.failureMode).toBeUndefined()
  })

  test('evicts oldest first once the cap is reached', () => {
    for (let i = 0; i < MAX_FEEDBACK_DRAFTS + 3; i++) {
      queueOrThrow(draft(`draft-${i}`))
    }
    const titles = listFeedbackDrafts().map(d => d.title)
    expect(titles).toHaveLength(MAX_FEEDBACK_DRAFTS)
    expect(titles).toContain(`draft-${MAX_FEEDBACK_DRAFTS + 2}`)
    expect(titles).not.toContain('draft-0')
    // Eviction removes the file, not just the listing.
    expect(readdirSync(draftsDir())).toHaveLength(MAX_FEEDBACK_DRAFTS)
  })

  test('deletes by id and reports whether anything was removed', () => {
    const a = queueOrThrow(draft('a'))
    queueOrThrow(draft('b'))
    expect(deleteFeedbackDraft(a.id)).toBe(true)
    expect(listFeedbackDrafts().map(d => d.title)).toEqual(['b'])
    expect(deleteFeedbackDraft(a.id)).toBe(false)
    expect(deleteFeedbackDraft('not-a-real-id')).toBe(false)
    // A traversal attempt must not reach outside the drafts directory.
    expect(deleteFeedbackDraft('../../settings')).toBe(false)
  })

  test('clear empties the queue', () => {
    queueOrThrow(draft('a'))
    expect(clearFeedbackDrafts()).toBe(true)
    expect(listFeedbackDrafts()).toEqual([])
  })
})

describe('size limits', () => {
  test('refuses a draft too large to serialize', () => {
    const result = queueFeedbackDraft({
      ...draft('huge'),
      details: 'x'.repeat(200_000),
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('too_large')
    expect(listFeedbackDrafts()).toEqual([])
  })

  // details is the report, so it is rejected rather than half-filed.
  test('rejects over-long details instead of truncating them', () => {
    const result = queueFeedbackDraft({
      ...draft('long'),
      details: 'D'.repeat(MAX_DETAILS_CHARS + 1),
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('too_large')
  })

  test('accepts details exactly at the limit', () => {
    const stored = queueOrThrow({ ...draft('edge'), details: 'D'.repeat(MAX_DETAILS_CHARS) })
    expect(Array.from(stored.details)).toHaveLength(MAX_DETAILS_CHARS)
  })

  // Title and area are incidental labels, so those are trimmed to fit.
  test('truncates title and area rather than rejecting them', () => {
    const stored = queueOrThrow({
      type: 'bug',
      title: 'T'.repeat(MAX_TITLE_CHARS + 50),
      details: 'd',
      area: 'a'.repeat(MAX_AREA_CHARS + 50),
    })
    expect(Array.from(stored.title)).toHaveLength(MAX_TITLE_CHARS)
    expect(Array.from(stored.area!)).toHaveLength(MAX_AREA_CHARS)
  })

  // Escapes, not literal control bytes: a raw 0x07 in this source is the kind
  // of thing an editor or a codemod silently eats, which would leave the test
  // passing while asserting nothing.
  test('strips control characters but keeps tabs and newlines in details', () => {
    const stored = queueOrThrow({
      type: 'bug',
      title: 'clean\u0007 title\u0000',
      details: 'line one\nline\ttwo\u0007',
    })
    expect(stored.title).toBe('clean title')
    expect(stored.details).toBe('line one\nline\ttwo')
  })

  test('flattens a multi-line title to one line', () => {
    expect(queueOrThrow({ ...draft('x'), title: 'line one\nline two' }).title).toBe(
      'line one line two',
    )
  })

  test('reduces area to a readable tag and drops it when nothing survives', () => {
    // Spaces become hyphens so the tag the prompt asks for stays legible.
    expect(queueOrThrow({ ...draft('a'), area: 'bash permissions!' }).area).toBe(
      'bash-permissions',
    )
    expect(queueOrThrow({ ...draft('b'), area: '  /resume  ' }).area).toBe('/resume')
    expect(queueOrThrow({ ...draft('c'), area: '你好' }).area).toBeUndefined()
    expect(queueOrThrow({ ...draft('d'), area: '   ' }).area).toBeUndefined()
  })
})

describe('resilience', () => {
  // The queue is an aside. A corrupt file must degrade to "fewer drafts",
  // never throw into the turn that drafts or the /feedback dialog that reads.
  test.each([
    ['malformed JSON', 'bad.json', '{ not json'],
    ['a JSON array rather than an object', 'arr.json', '[1,2]'],
    ['an entry missing required fields', 'x.json', '{"id":"x"}'],
    [
      'an entry with an unknown type',
      '11111111-1111-1111-1111-111111111111.json',
      '{"id":"11111111-1111-1111-1111-111111111111","type":"rant","title":"t","details":"d","createdAt":"2026-01-01T00:00:00.000Z"}',
    ],
    [
      'a filename that disagrees with the id inside',
      '22222222-2222-2222-2222-222222222222.json',
      '{"id":"33333333-3333-3333-3333-333333333333","type":"bug","title":"t","details":"d","createdAt":"2026-01-01T00:00:00.000Z"}',
    ],
  ])('skips %s', (_label, name, contents) => {
    mkdirSync(draftsDir(), { recursive: true })
    writeFileSync(join(draftsDir(), name), contents)
    expect(listFeedbackDrafts()).toEqual([])
  })

  test('keeps the good drafts alongside a corrupt one', () => {
    queueOrThrow(draft('kept'))
    writeFileSync(join(draftsDir(), 'junk.json'), '{ not json')
    expect(listFeedbackDrafts().map(d => d.title)).toEqual(['kept'])
  })

  test('ignores a non-json file in the directory', () => {
    queueOrThrow(draft('kept'))
    writeFileSync(join(draftsDir(), 'notes.txt'), 'hello')
    expect(listFeedbackDrafts()).toHaveLength(1)
  })
})

describe('expiry', () => {
  test('drops and deletes drafts past the TTL', () => {
    const kept = queueOrThrow(draft('fresh'))
    const future = new Date(Date.now() + FEEDBACK_DRAFT_TTL_MS + 60_000)
    expect(listFeedbackDrafts(future)).toEqual([])
    expect(readdirSync(draftsDir())).not.toContain(`${kept.id}.json`)
  })

  test('keeps a draft that is only just inside the TTL', () => {
    queueOrThrow(draft('fresh'))
    const almost = new Date(Date.now() + FEEDBACK_DRAFT_TTL_MS - 60_000)
    expect(listFeedbackDrafts(almost)).toHaveLength(1)
  })
})

describe('formatFeedbackDraft', () => {
  test('leads with the title and body, then the metadata block', () => {
    const queued = queueOrThrow({
      type: 'bug',
      title: 'Something broke',
      details: '**What happened:** it broke',
      area: '/resume',
      failureMode: 'stopping_short',
      taskCategory: 'debug',
      cliVersion: '1.15.0',
      cwd: '/tmp/project',
    })
    const body = formatFeedbackDraft(queued)
    expect(body.startsWith('Something broke\n\n**What happened:** it broke')).toBe(true)
    expect(body).toContain('Type: bug')
    expect(body).toContain('Area: /resume')
    expect(body).toContain('Failure mode: stopping_short')
    expect(body).toContain('Task: debug')
    expect(body).toContain('Version: 1.15.0')
    expect(body).toContain('Cwd: /tmp/project')
    expect(body).toContain(`Drafted: ${queued.createdAt}`)
  })

  test('omits metadata lines for fields that were left blank', () => {
    const body = formatFeedbackDraft(queueOrThrow(draft('bare')))
    expect(body).not.toContain('Area:')
    expect(body).not.toContain('Failure mode:')
    expect(body).not.toContain('Task:')
  })
})
