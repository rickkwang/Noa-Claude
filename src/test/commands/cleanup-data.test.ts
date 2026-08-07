import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../../commands/cleanup-data/cleanup-data.js'
import { getProjectRoot, setProjectRoot } from '../../bootstrap/state.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import type { LocalJSXCommandContext } from '../../types/command.js'

const originalProjectRoot = getProjectRoot()
const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_COWORK_MEMORY_PATH_OVERRIDE:
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE,
  CLAUDE_CODE_REMOTE_MEMORY_DIR: process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
}
const tempDirs: string[] = []

async function makeTempProject(): Promise<{
  root: string
  project: string
  config: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-data-test-'))
  tempDirs.push(root)
  const project = join(root, 'project')
  const config = join(root, 'config')
  await mkdir(project, { recursive: true })
  await mkdir(config, { recursive: true })
  setProjectRoot(project)
  process.env.CLAUDE_CONFIG_DIR = config
  getAutoMemPath.cache?.clear?.()
  return { root, project, config }
}

async function run(args: string): Promise<string> {
  const result = await call(args, {} as LocalJSXCommandContext)
  if (result.type !== 'text') throw new Error('expected text result')
  return result.value
}

afterEach(async () => {
  setProjectRoot(originalProjectRoot)
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  getAutoMemPath.cache?.clear?.()
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('argument validation', () => {
  test('rejects unknown arguments', async () => {
    expect(await run('bogus')).toContain('Unknown argument(s): bogus')
  })

  test('rejects --confirm without an explicit scope', async () => {
    expect(await run('--confirm')).toContain(
      'Confirm requires an explicit scope',
    )
  })

  test('rejects conflicting scopes', async () => {
    expect(await run('project all')).toContain('Choose one cleanup scope')
  })
})

describe('preview vs confirm gating', () => {
  test('preview lists targets without deleting anything', async () => {
    const { root, project } = await makeTempProject()
    const mem = join(root, 'mem')
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = mem
    getAutoMemPath.cache?.clear?.()
    await mkdir(mem, { recursive: true })
    await writeFile(join(mem, 'MEMORY.md'), '# mem')
    await mkdir(join(project, '.noa', 'shares'), { recursive: true })
    await writeFile(join(project, '.noa', 'progress.md'), 'progress')

    const preview = await run('project')
    expect(preview).toContain('Will delete')
    expect(preview).toContain('Run /cleanup-data project --confirm to execute.')

    expect(existsSync(join(mem, 'MEMORY.md'))).toBe(true)
    expect(existsSync(join(project, '.noa', 'shares'))).toBe(true)
    expect(existsSync(join(project, '.noa', 'progress.md'))).toBe(true)
  })
})

describe('scope semantics', () => {
  test('project scope keeps global history; all scope deletes it', async () => {
    const { config } = await makeTempProject()
    const history = join(config, 'history.jsonl')
    await writeFile(history, '{}\n')

    await run('project --confirm')
    expect(existsSync(history)).toBe(true)

    await run('all --confirm')
    expect(existsSync(history)).toBe(false)
  })
})

describe('memory dir deletion', () => {
  test('custom-location dir: only known memory entries are deleted', async () => {
    const { root } = await makeTempProject()
    const mem = join(root, 'mem')
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = mem
    getAutoMemPath.cache?.clear?.()
    await mkdir(join(mem, 'logs', '2026', '08'), { recursive: true })
    await mkdir(join(mem, 'pics'), { recursive: true })
    await writeFile(join(mem, 'MEMORY.md'), '# mem')
    await writeFile(join(mem, 'user_role.md'), 'topic')
    await writeFile(join(mem, 'logs', '2026', '08', '2026-08-07.md'), 'log')
    await writeFile(join(mem, 'keepme.txt'), 'do not delete')

    const preview = await run('project')
    expect(preview).toContain('custom location')
    expect(preview).toContain('Keeping 2 unrecognized item(s)')

    const done = await run('project --confirm')
    expect(done).toContain('Cleanup complete')
    expect(done).toContain('Kept 2 unrecognized item(s)')

    expect(existsSync(mem)).toBe(true)
    expect(existsSync(join(mem, 'MEMORY.md'))).toBe(false)
    expect(existsSync(join(mem, 'user_role.md'))).toBe(false)
    expect(existsSync(join(mem, 'logs'))).toBe(false)
    expect(existsSync(join(mem, 'keepme.txt'))).toBe(true)
    expect(existsSync(join(mem, 'pics'))).toBe(true)
  })

  test('custom-location dir with no memory entries is left untouched', async () => {
    const { root } = await makeTempProject()
    const mem = join(root, 'mem')
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = mem
    getAutoMemPath.cache?.clear?.()
    await mkdir(mem, { recursive: true })
    await writeFile(join(mem, 'keepme.txt'), 'do not delete')

    const done = await run('project --confirm')
    expect(done).toContain('Kept 1 unrecognized item(s)')
    expect(done).toContain('Deleted: 0/1')
    expect(existsSync(join(mem, 'keepme.txt'))).toBe(true)
  })

  test('default-location dir is deleted wholesale', async () => {
    await makeTempProject()
    const mem = getAutoMemPath().replace(/[\\/]+$/, '')
    await mkdir(mem, { recursive: true })
    await writeFile(join(mem, 'MEMORY.md'), '# mem')
    await writeFile(join(mem, 'keepme.txt'), 'user file')

    const preview = await run('project')
    expect(preview).toContain('Project auto-memory')
    expect(preview).not.toContain('custom location')

    await run('project --confirm')
    expect(existsSync(mem)).toBe(false)
  })

  test('REMOTE_MEMORY_DIR default resolution is not treated as custom', async () => {
    const { root } = await makeTempProject()
    process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = join(root, 'remote')
    getAutoMemPath.cache?.clear?.()
    const mem = getAutoMemPath().replace(/[\\/]+$/, '')
    await mkdir(mem, { recursive: true })
    await writeFile(join(mem, 'MEMORY.md'), '# mem')
    await writeFile(join(mem, 'keepme.txt'), 'user file')

    const preview = await run('project')
    expect(preview).not.toContain('custom location')

    await run('project --confirm')
    expect(existsSync(mem)).toBe(false)
  })
})

describe('symlink handling', () => {
  test('symlinked shares dir: only the link is removed', async () => {
    const { root, project } = await makeTempProject()
    const real = join(root, 'real-shares')
    await mkdir(real, { recursive: true })
    await writeFile(join(real, 'snap.json'), '{}')
    await mkdir(join(project, '.noa'), { recursive: true })
    await symlink(real, join(project, '.noa', 'shares'))

    const preview = await run('project')
    expect(preview).toContain('only the link will be removed')

    await run('project --confirm')
    expect(existsSync(join(project, '.noa', 'shares'))).toBe(false)
    expect(existsSync(join(real, 'snap.json'))).toBe(true)
  })
})
