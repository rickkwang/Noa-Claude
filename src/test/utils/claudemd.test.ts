import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { isMemoryFilePath } from '../../utils/claudemd.js'

let tmpRoot: string | undefined
const originalCwd = getOriginalCwd()

function makeProject(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'noa-claudemd-'))
  const project = join(tmpRoot, 'project')
  mkdirSync(project, { recursive: true })
  setOriginalCwd(project)
  return project
}

function write(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'instructions')
}

afterEach(() => {
  setOriginalCwd(originalCwd)
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = undefined
  }
})

describe('isMemoryFilePath', () => {
  test('treats only the selected Noa AGENTS.md as memory', () => {
    const project = makeProject()
    const noaAgents = join(project, '.noa', 'AGENTS.md')
    const rootAgents = join(project, 'AGENTS.md')
    write(noaAgents)
    write(rootAgents)

    expect(isMemoryFilePath(noaAgents)).toBe(true)
    expect(isMemoryFilePath(rootAgents)).toBe(false)
  })

  test('treats root AGENTS.md as memory when it is selected', () => {
    const project = makeProject()
    const rootAgents = join(project, 'AGENTS.md')
    write(rootAgents)

    expect(isMemoryFilePath(rootAgents)).toBe(true)
  })

  test('does not treat project-external AGENTS.md as Noa memory', () => {
    const project = makeProject()
    const externalAgents = join(dirname(project), 'external', 'AGENTS.md')
    write(externalAgents)

    expect(isMemoryFilePath(externalAgents)).toBe(false)
  })

  test('keeps historical CLAUDE.md memory matching', () => {
    const project = makeProject()
    const externalClaude = join(dirname(project), 'external', 'CLAUDE.md')
    write(externalClaude)

    expect(isMemoryFilePath(externalClaude)).toBe(true)
  })
})
