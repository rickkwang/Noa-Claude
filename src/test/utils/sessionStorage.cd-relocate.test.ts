import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionId, setCwdState, setOriginalCwd } from '../../bootstrap/state.js'
import {
  getProjectDir,
  getTranscriptPath,
  relocateSessionTranscript,
  resetProjectForTesting,
  setSessionFileForTesting,
} from '../../utils/sessionStorage.js'

// relocateSessionTranscript powers /cd's full transcript move: the session's
// <id>.jsonl and its <id>/ sidecar follow originalCwd to the new project dir so
// `--resume` from there lists the session. These guard the move, the
// missing-source case, and the no-op case. CLAUDE_CONFIG_DIR is sandboxed and
// every working dir is a unique tmpdir (getProjectDir memoizes by arg, so fresh
// args avoid stale cache across the per-test config dir).
describe('relocateSessionTranscript (/cd transcript move)', () => {
  let configDir: string
  let workDirs: string[] = []

  const mkWork = (tag: string): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `noa-cd-${tag}-`)))
    workDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    configDir = realpathSync(mkdtempSync(join(tmpdir(), 'noa-cd-cfg-')))
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetProjectForTesting()
  })

  afterEach(() => {
    resetProjectForTesting()
    rmSync(configDir, { recursive: true, force: true })
    for (const dir of workDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    workDirs = []
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  })

  test('moves the transcript + sidecar to the new project dir and repoints', async () => {
    const oldWork = mkWork('old')
    setOriginalCwd(oldWork)
    setCwdState(oldWork)
    const sessionId = getSessionId()
    const oldProj = getProjectDir(oldWork)
    mkdirSync(oldProj, { recursive: true })
    const oldJsonl = join(oldProj, `${sessionId}.jsonl`)
    writeFileSync(oldJsonl, '{"type":"user","text":"keepme"}\n', { mode: 0o600 })
    const oldSidecar = join(oldProj, sessionId)
    mkdirSync(join(oldSidecar, 'session-memory'), { recursive: true })
    writeFileSync(join(oldSidecar, 'session-memory', 'note.md'), 'sidecar-data')
    setSessionFileForTesting(oldJsonl)

    // Simulate /cd: originalCwd moves first, then the transcript relocates.
    const newWork = mkWork('new')
    setOriginalCwd(newWork)
    setCwdState(newWork)
    await relocateSessionTranscript()

    const newProj = getProjectDir(newWork)
    const newJsonl = join(newProj, `${sessionId}.jsonl`)
    expect(existsSync(oldJsonl)).toBe(false)
    expect(existsSync(newJsonl)).toBe(true)
    expect(readFileSync(newJsonl, 'utf8')).toContain('keepme')
    // Writer's repointed sessionFile and the path derivation agree.
    expect(getTranscriptPath()).toBe(newJsonl)
    expect(
      existsSync(join(newProj, sessionId, 'session-memory', 'note.md')),
    ).toBe(true)
    expect(existsSync(oldSidecar)).toBe(false)
  })

  test('missing source file is non-fatal — repoints without throwing', async () => {
    const oldWork = mkWork('old')
    setOriginalCwd(oldWork)
    setCwdState(oldWork)
    const sessionId = getSessionId()
    // sessionFile is set but the file is intentionally never created.
    setSessionFileForTesting(join(getProjectDir(oldWork), `${sessionId}.jsonl`))

    const newWork = mkWork('new')
    setOriginalCwd(newWork)
    setCwdState(newWork)
    await expect(relocateSessionTranscript()).resolves.toBeUndefined()
    expect(getTranscriptPath()).toBe(
      join(getProjectDir(newWork), `${sessionId}.jsonl`),
    )
  })

  test('no-op when already at the destination', async () => {
    const work = mkWork('same')
    setOriginalCwd(work)
    setCwdState(work)
    const sessionId = getSessionId()
    const proj = getProjectDir(work)
    mkdirSync(proj, { recursive: true })
    const jsonl = join(proj, `${sessionId}.jsonl`)
    writeFileSync(jsonl, '{"type":"user","text":"x"}\n')
    setSessionFileForTesting(jsonl)

    await relocateSessionTranscript()
    expect(existsSync(jsonl)).toBe(true)
    expect(getTranscriptPath()).toBe(jsonl)
  })
})
