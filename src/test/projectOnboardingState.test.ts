import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { getSteps } from '../projectOnboardingState.js'
import { runWithCwdOverride } from '../utils/cwd.js'

let tmpRoot: string | undefined

function makeProject(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'noa-project-onboarding-'))
  return tmpRoot
}

function write(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'instructions')
}

function claudemdStep(project: string) {
  return runWithCwdOverride(project, () =>
    getSteps().find(step => step.key === 'claudemd'),
  )
}

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = undefined
  }
})

describe('project onboarding state', () => {
  test('treats .noa/AGENTS.md as project instructions', () => {
    const project = makeProject()
    write(join(project, '.noa', 'AGENTS.md'))

    expect(claudemdStep(project)?.isComplete).toBe(true)
  })

  test('does not treat .claude/CLAUDE.md as Noa project instructions', () => {
    const project = makeProject()
    write(join(project, '.claude', 'CLAUDE.md'))

    expect(claudemdStep(project)?.isComplete).toBe(false)
  })

  test('does not inherit parent project instructions', () => {
    const parent = makeProject()
    const child = join(parent, 'child')
    mkdirSync(child, { recursive: true })
    write(join(parent, 'AGENTS.md'))

    expect(claudemdStep(child)?.isComplete).toBe(false)
  })
})
