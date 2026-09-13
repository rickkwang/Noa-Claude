import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSystemPromptSectionCache,
  setSystemPromptSectionCacheEntry,
} from '../../bootstrap/state.js'
import { call } from '../../commands/reload-skills/reload-skills.js'
import { getSkillDirCommands } from '../../skills/loadSkillsDir.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import { getCwd, runWithCwdOverride } from '../../utils/cwd.js'
import { skillChangeDetector } from '../../utils/skills/skillChangeDetector.js'

const context = {} as LocalJSXCommandContext

describe('skillChangeDetector.reloadNow', () => {
  test('notifies subscribers, and stops once unsubscribed', () => {
    let calls = 0
    const unsubscribe = skillChangeDetector.subscribe(() => {
      calls++
    })

    skillChangeDetector.reloadNow()
    expect(calls).toBe(1)

    unsubscribe()
    skillChangeDetector.reloadNow()
    expect(calls).toBe(1)
  })

  test('drops the memoized skill scan so the next read hits disk', async () => {
    const cwd = getCwd()
    const cached = getSkillDirCommands(cwd)
    await cached
    expect(getSkillDirCommands(cwd)).toBe(cached)

    skillChangeDetector.reloadNow()
    expect(getSkillDirCommands(cwd)).not.toBe(cached)
  })
})

describe('/reload-skills', () => {
  // A project the watcher never saw: getWatchablePaths() only registers
  // directories that existed when the session started, which is the case this
  // command exists for.
  const project = mkdtempSync(join(tmpdir(), 'reload-skills-'))
  const skillsDir = join(project, '.noa', 'skills')

  function writeSkill(name: string, description: string): void {
    mkdirSync(join(skillsDir, name), { recursive: true })
    writeFileSync(
      join(skillsDir, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n${name} body\n`,
    )
  }

  function run(): Promise<string> {
    return runWithCwdOverride(project, () => call('', context)).then(result =>
      result.type === 'text' ? result.value : '',
    )
  }

  afterAll(() => {
    rmSync(project, { recursive: true, force: true })
  })

  test('picks up a skill created after the session started', async () => {
    writeSkill('alpha', 'Alpha fixture skill')
    expect(await run()).toContain('no changes on disk')

    writeSkill('beta', 'Beta fixture skill')
    expect(await run()).toContain('+1/~0/-0')

    expect(await run()).toContain('no changes on disk')
  })

  test('counts an edited skill as changed, and a deleted one as removed', async () => {
    writeSkill('beta', 'Beta fixture skill, reworded')
    expect(await run()).toContain('+0/~1/-0')

    rmSync(join(skillsDir, 'beta'), { recursive: true, force: true })
    expect(await run()).toContain('+0/~0/-1')
  })

  test('clears the rendered system-prompt sections', async () => {
    // session_guidance's text depends on the skill list but its cache key
    // does not — without this clear a session that started with no skills
    // keeps a prompt that never mentions them.
    setSystemPromptSectionCacheEntry('session_guidance', 'rendered')
    expect(getSystemPromptSectionCache().has('session_guidance')).toBe(true)

    await run()

    expect(getSystemPromptSectionCache().has('session_guidance')).toBe(false)
  })
})
