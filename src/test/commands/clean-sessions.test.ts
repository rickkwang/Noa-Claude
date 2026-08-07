import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  getOriginalCwd,
  getSessionId,
  setOriginalCwd,
} from '../../bootstrap/state.js'
import { getProjectDir } from '../../utils/sessionStoragePortable.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

type CallFn = LocalJSXCommandCall
let call: CallFn

const originalCwd = getOriginalCwd()
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const tempDirs: string[] = []
let projectDir = ''

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const userLine = (text: string) =>
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })

async function writeSession(
  name: string,
  firstPrompt: string,
  extra?: string,
  opts: { fresh?: boolean } = {},
): Promise<string> {
  const path = join(projectDir, `${name}.jsonl`)
  await writeFile(path, userLine(firstPrompt) + '\n' + (extra ? extra + '\n' : ''))
  if (!opts.fresh) {
    // Fixtures are history, not active sessions: backdate past the
    // recently-modified protection window.
    const past = new Date(Date.now() - ONE_DAY_MS)
    await utimes(path, past, past)
  }
  return path
}

async function writeSidecar(name: string, bytes: number): Promise<string> {
  const dir = join(projectDir, name, 'tool-results')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'blob-1')
  await writeFile(file, 'x'.repeat(bytes))
  return dir
}

async function run(args: string): Promise<string> {
  let result = ''
  await call((value: string | undefined) => {
    result = value ?? ''
  }, {} as Parameters<CallFn>[1], args)
  return result
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'clean-sessions-test-'))
  tempDirs.push(root)
  const project = join(root, 'project')
  await mkdir(project, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = join(root, 'config')
  setOriginalCwd(project)
  projectDir = getProjectDir(project)
  await mkdir(projectDir, { recursive: true })
  // Imported lazily so React/Ink deps load only after env isolation is set up.
  ;({ call } = await import('../../commands/clean-sessions/clean-sessions.js'))
})

afterEach(async () => {
  setOriginalCwd(originalCwd)
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('argument validation', () => {
  test('rejects unknown arguments', async () => {
    expect(await run('--trivial-olny')).toContain(
      'Unknown argument(s): --trivial-olny',
    )
  })

  test('typo in --trivial-only does not silently downgrade protection', async () => {
    const trivial = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm --trivial-olny')
    expect(result).toContain('Unknown argument(s)')
    expect(existsSync(trivial)).toBe(true)
  })

  test('--max-bytes is case-insensitive like the other flags', async () => {
    const result = await run('--MAX-BYTES=1024')
    expect(result).not.toContain('Unknown argument(s)')
  })

  test('unreadable --max-bytes value is rejected, not silently defaulted', async () => {
    const trivial = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm --trivial-only --max-bytes=abc')
    expect(result).toContain('Invalid --max-bytes value: abc')
    expect(existsSync(trivial)).toBe(true)
  })
})

describe('bulk delete gate', () => {
  test('delete --confirm without --trivial-only refuses and deletes nothing', async () => {
    const session = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm')
    expect(result).toContain('Bulk delete requires --trivial-only')
    expect(existsSync(session)).toBe(true)
  })

  test('delete --confirm --trivial-only removes trivial-prompt sessions', async () => {
    const trivial = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain('Deleted: 1/1')
    expect(existsSync(trivial)).toBe(false)
  })

  test('non-trivial sessions survive bulk delete (interactive-only path)', async () => {
    const normal = await writeSession(
      randomUUID(),
      'how do I configure retries in production',
    )
    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain('Remaining matches: 0')
    expect(existsSync(normal)).toBe(true)
  })

  test('audit output caps the listing at 200 but keeps counts accurate', async () => {
    const total = 205
    for (let i = 0; i < total; i++) {
      await writeSession(randomUUID(), 'ping')
    }
    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain(`Deleted: ${total}/${total}`)
    expect(result).toContain(`... ${total - 200} more not shown`)
  })
})

describe('trivial classification', () => {
  test('user-renamed customTitle is protective, not deletion evidence', async () => {
    const renamed = await writeSession(
      randomUUID(),
      'explain the compaction retry semantics in detail',
      JSON.stringify({ type: 'summary', customTitle: 'Test' }),
    )
    await run('delete --confirm --trivial-only')
    expect(existsSync(renamed)).toBe(true)
  })

  test('aiTitle is protective too', async () => {
    const aiTitled = await writeSession(
      randomUUID(),
      'walk me through the oauth token refresh flow',
      JSON.stringify({ type: 'summary', aiTitle: 'Hello' }),
    )
    await run('delete --confirm --trivial-only')
    expect(existsSync(aiTitled)).toBe(true)
  })

  test('triviality falls back to lastPrompt when no title exists', async () => {
    const trivial = await writeSession(
      randomUUID(),
      'explain the compaction retry semantics in detail',
      JSON.stringify({ type: 'user', lastPrompt: 'ok' }),
    )
    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain('Deleted: 1/1')
    expect(existsSync(trivial)).toBe(false)
  })
})

describe('current session protection', () => {
  test('the running session transcript is never deleted', async () => {
    const own = await writeSession(getSessionId(), 'ping')
    const other = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain('Deleted: 1/1')
    expect(existsSync(own)).toBe(true)
    expect(existsSync(other)).toBe(false)
  })

  test('current session is excluded under --all scope too', async () => {
    const own = await writeSession(getSessionId(), 'ping')
    const result = await run('delete --confirm --trivial-only --all')
    expect(result).toContain('No matching sessions found.')
    expect(existsSync(own)).toBe(true)
  })
})

describe('recently-modified protection', () => {
  test('fresh sessions are skipped and reported, old ones are deleted', async () => {
    const fresh = await writeSession(randomUUID(), 'ping', undefined, {
      fresh: true,
    })
    const old = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain('Deleted: 1/1')
    expect(result).toContain(
      'Skipped (modified in the last 10m, possibly active): 1',
    )
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(old)).toBe(false)
  })
})

describe('sidecar handling', () => {
  test('sidecar dir is deleted together with its transcript', async () => {
    const name = randomUUID()
    const session = await writeSession(name, 'ping')
    const sidecar = await writeSidecar(name, 1024)
    await run('delete --confirm --trivial-only')
    expect(existsSync(session)).toBe(false)
    expect(existsSync(join(projectDir, name))).toBe(false)
    expect(existsSync(sidecar)).toBe(false)
  })

  test('footprint includes sidecar: small jsonl + big sidecar misses the bucket', async () => {
    const small = randomUUID()
    await writeSession(small, 'ping')
    await writeSidecar(small, 100 * 1024)
    const big = randomUUID()
    const bigSession = await writeSession(big, 'ping')
    await writeSidecar(big, 300 * 1024)

    const result = await run('delete --confirm --trivial-only')
    expect(result).toContain('Deleted: 1/1')
    expect(existsSync(join(projectDir, small))).toBe(false)
    expect(existsSync(bigSession)).toBe(true)
    expect(existsSync(join(projectDir, big))).toBe(true)
  })
})

describe('bulk size gate', () => {
  test('--include-large is rejected in bulk mode', async () => {
    const session = await writeSession(randomUUID(), 'ping')
    const result = await run('delete --confirm --trivial-only --include-large')
    expect(result).toContain('Bulk delete is limited to the default size bucket')
    expect(existsSync(session)).toBe(true)
  })

  test('oversized --max-bytes is rejected in bulk mode', async () => {
    const session = await writeSession(randomUUID(), 'ping')
    const result = await run(
      'delete --confirm --trivial-only --max-bytes=10485760',
    )
    expect(result).toContain('Bulk delete is limited to the default size bucket')
    expect(existsSync(session)).toBe(true)
  })
})

describe('delete reporting', () => {
  test('per-file failures are reported, not swallowed', async () => {
    const session = await writeSession(randomUUID(), 'ping')
    chmodSync(projectDir, 0o555)
    try {
      const result = await run('delete --confirm --trivial-only')
      expect(result).toContain('Failed: 1')
      expect(result).toContain(session)
      expect(existsSync(session)).toBe(true)
    } finally {
      chmodSync(projectDir, 0o755)
    }
  })

  test('sidecar failure after transcript delete reports deleted, not failed', async () => {
    const name = randomUUID()
    const session = await writeSession(name, 'ping')
    const sidecarDir = join(projectDir, name)
    await writeSidecar(name, 1024)
    chmodSync(sidecarDir, 0o555)
    try {
      const result = await run('delete --confirm --trivial-only')
      expect(result).toContain('Deleted: 1/1')
      expect(result).toContain('Failed: 1')
      expect(result).toContain(sidecarDir)
      expect(existsSync(session)).toBe(false)
    } finally {
      chmodSync(sidecarDir, 0o755)
    }
  })

  test('candidates are listed largest-first', async () => {
    const small = randomUUID()
    await writeSession(small, 'ping')
    const bigger = randomUUID()
    await writeSession(bigger, 'test')
    await writeSidecar(bigger, 100 * 1024)

    const result = await run('delete --confirm --trivial-only')
    const biggerIdx = result.indexOf(`${bigger}.jsonl`)
    const smallIdx = result.indexOf(`${small}.jsonl`)
    expect(biggerIdx).toBeGreaterThanOrEqual(0)
    expect(smallIdx).toBeGreaterThanOrEqual(0)
    expect(biggerIdx).toBeLessThan(smallIdx)
  })
})
