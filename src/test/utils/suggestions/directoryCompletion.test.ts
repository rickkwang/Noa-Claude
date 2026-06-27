import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearPathCache,
  getPathCompletions,
  isPathLikeToken,
} from '../../../utils/suggestions/directoryCompletion.js'

// Contract relied on by the live shell-path autocomplete (bash `!` mode):
// the apply logic replaces the path word with `displayText`, expecting a
// trailing '/' on directories (so drilling in works) and a bare name on files.
describe('getPathCompletions (bash-path live completion contract)', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'noa-pathcomp-'))
    mkdirSync(join(base, 'components'))
    mkdirSync(join(base, 'commands'))
    writeFileSync(join(base, 'config.ts'), '')
    writeFileSync(join(base, 'readme.md'), '')
    clearPathCache()
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    clearPathCache()
  })

  test('directories get a trailing slash in displayText, files do not', async () => {
    const results = await getPathCompletions('c', { basePath: base })
    const byId = Object.fromEntries(results.map(r => [r.id, r]))

    expect(byId['components']?.displayText).toBe('components/')
    expect(byId['components']?.metadata).toEqual({ type: 'directory' })
    expect(byId['commands']?.displayText).toBe('commands/')

    expect(byId['config.ts']?.displayText).toBe('config.ts')
    expect(byId['config.ts']?.metadata).toEqual({ type: 'file' })
  })

  test('directories sort before files', async () => {
    const results = await getPathCompletions('', { basePath: base })
    const types = results.map(r => (r.metadata as { type: string }).type)
    const firstFile = types.indexOf('file')
    const lastDir = types.lastIndexOf('directory')
    expect(lastDir).toBeLessThan(firstFile)
  })

  test('relative prefix preserves the directory portion in id/displayText', async () => {
    mkdirSync(join(base, 'components', 'inner'))
    clearPathCache()
    const results = await getPathCompletions('components/i', { basePath: base })
    expect(results.map(r => r.id)).toContain('components/inner')
    expect(results.find(r => r.id === 'components/inner')?.displayText).toBe(
      'components/inner/',
    )
  })

  test('isPathLikeToken matches the prefixes the bash-path block keys on', () => {
    expect(isPathLikeToken('./src')).toBe(true)
    expect(isPathLikeToken('/etc')).toBe(true)
    expect(isPathLikeToken('~/x')).toBe(true)
    expect(isPathLikeToken('../up')).toBe(true)
    // bare word is not path-like on its own — the bash block also accepts
    // tokens containing '/', which is why `src/foo` still completes.
    expect(isPathLikeToken('src')).toBe(false)
  })
})
