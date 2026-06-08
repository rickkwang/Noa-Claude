import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getPreferredProjectMemoryFilePath,
  getProjectMemoryFileCandidates,
} from '../../utils/productPaths.js'

let tmpRoot: string | undefined

function makeProject(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'noa-product-paths-'))
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

describe('project memory path selection', () => {
  test('loads one project instruction file per directory using AGENTS before CLAUDE', () => {
    const project = makeProject()
    write(join(project, '.noa', 'AGENTS.md'))
    write(join(project, '.noa', 'CLAUDE.md'))
    write(join(project, 'AGENTS.md'))
    write(join(project, 'CLAUDE.md'))

    expect(getProjectMemoryFileCandidates(project)).toEqual([
      join(project, '.noa', 'AGENTS.md'),
    ])
  })

  test('falls back to root AGENTS before any CLAUDE file', () => {
    const project = makeProject()
    write(join(project, 'AGENTS.md'))
    write(join(project, '.noa', 'CLAUDE.md'))
    write(join(project, 'CLAUDE.md'))

    expect(getProjectMemoryFileCandidates(project)).toEqual([
      join(project, 'AGENTS.md'),
    ])
  })

  test('uses Noa-scoped CLAUDE before root CLAUDE when AGENTS is absent', () => {
    const project = makeProject()
    write(join(project, '.noa', 'CLAUDE.md'))
    write(join(project, 'CLAUDE.md'))

    expect(getProjectMemoryFileCandidates(project)).toEqual([
      join(project, '.noa', 'CLAUDE.md'),
    ])
  })

  test('does not include legacy .claude/CLAUDE.md as a project candidate', () => {
    const project = makeProject()
    write(join(project, '.claude', 'CLAUDE.md'))

    expect(getProjectMemoryFileCandidates(project)).toEqual([
      join(project, 'AGENTS.md'),
    ])
  })

  test('preferred project memory searches ancestors with the same priority', () => {
    const project = makeProject()
    const nested = join(project, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    write(join(project, '.noa', 'AGENTS.md'))

    expect(getPreferredProjectMemoryFilePath(nested)).toBe(
      join(project, '.noa', 'AGENTS.md'),
    )
  })
})
