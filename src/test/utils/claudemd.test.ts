import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import {
  getMemoryFilesForNestedDirectory,
  isMemoryFilePath,
  MAX_MEMORY_CHARACTER_COUNT,
} from '../../utils/claudemd.js'

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

describe('nested memory size limit', () => {
  test('loads only the start of an oversized nested CLAUDE.md', async () => {
    const project = makeProject()
    const nested = join(project, 'nested')
    const memoryPath = join(nested, 'CLAUDE.md')
    const rawContent = `start-marker\n${'x'.repeat(MAX_MEMORY_CHARACTER_COUNT)}\nend-marker`
    mkdirSync(nested, { recursive: true })
    writeFileSync(memoryPath, rawContent)

    const files = await getMemoryFilesForNestedDirectory(
      nested,
      join(nested, 'file.ts'),
      new Set(),
    )
    const memory = files.find(file => file.path === memoryPath)

    expect(memory?.content.length).toBeLessThanOrEqual(
      MAX_MEMORY_CHARACTER_COUNT + 300,
    )
    expect(memory?.content.startsWith('start-marker')).toBe(true)
    expect(memory?.content).not.toContain('end-marker')
    expect(memory?.content).toContain('Only the start of this file is shown')
    expect(memory?.contentDiffersFromDisk).toBe(true)
    expect(memory?.rawContent).toBe(rawContent)
  })
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
