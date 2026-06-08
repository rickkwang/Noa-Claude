import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getNearestProjectInstructionFilePath,
  getProjectInstructionFilePath,
  hasAgentsMd,
  hasClaudeMdOnly,
} from '../../utils/projectInstructions.js'

let tmpRoot: string | undefined

function makeProject(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'noa-project-instructions-'))
  return tmpRoot
}

function write(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'instructions')
}

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = undefined
  }
})

describe('project instruction helpers', () => {
  test('uses the same Noa-scoped priority as project memory paths', () => {
    const project = makeProject()
    write(join(project, '.noa', 'AGENTS.md'))
    write(join(project, 'AGENTS.md'))
    write(join(project, '.noa', 'CLAUDE.md'))
    write(join(project, 'CLAUDE.md'))

    expect(getProjectInstructionFilePath(project)).toBe(
      join(project, '.noa', 'AGENTS.md'),
    )
    expect(hasAgentsMd(project)).toBe(true)
    expect(hasClaudeMdOnly(project)).toBe(false)
  })

  test('reports CLAUDE only when AGENTS candidates are absent', () => {
    const project = makeProject()
    write(join(project, '.noa', 'CLAUDE.md'))
    write(join(project, 'CLAUDE.md'))

    expect(getProjectInstructionFilePath(project)).toBe(
      join(project, '.noa', 'CLAUDE.md'),
    )
    expect(hasAgentsMd(project)).toBe(false)
    expect(hasClaudeMdOnly(project)).toBe(true)
  })

  test('searches ancestors without considering .claude/CLAUDE.md', () => {
    const project = makeProject()
    const nested = join(project, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    write(join(project, '.claude', 'CLAUDE.md'))
    write(join(project, 'AGENTS.md'))

    expect(getNearestProjectInstructionFilePath(nested)).toBe(
      join(project, 'AGENTS.md'),
    )
  })
})
