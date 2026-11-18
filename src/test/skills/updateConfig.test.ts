import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getBundledSkills } from '../../skills/bundledSkills.js'
import { registerUpdateConfigSkill } from '../../skills/bundled/updateConfig.js'

describe('update-config bundled skill', () => {
  test('emits compact All Settings summary and extracts per-key schema files', async () => {
    const existing = getBundledSkills().find(s => s.name === 'update-config')
    if (!existing) registerUpdateConfigSkill()
    const skill = getBundledSkills().find(s => s.name === 'update-config')
    expect(skill).toBeDefined()
    expect(skill?.type).toBe('prompt')
    if (skill?.type !== 'prompt') return

    const blocks = await skill.getPromptForCommand('', {} as never)
    const text = blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    expect(text).toContain('## All Settings')
    expect(text).toContain('schema/<key>.json')
    expect(text).not.toContain('## Full Settings JSON Schema')
    expect(text.length).toBeLessThan(30_000)

    const match = text.match(/^Base directory for this skill: (.+)$/m)
    expect(match).not.toBeNull()
    const baseDir = match![1]!
    const permissionsFile = join(baseDir, 'schema', 'permissions.json')
    const attributionFile = join(baseDir, 'schema', 'attribution.json')
    expect(existsSync(permissionsFile)).toBe(true)
    expect(existsSync(attributionFile)).toBe(true)
    expect(() => JSON.parse(readFileSync(permissionsFile, 'utf8'))).not.toThrow()
    const attribution = JSON.parse(readFileSync(attributionFile, 'utf8'))
    expect(attribution.type).toBe('object')
  })
})
