import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { call } from '../../commands/pause-memory/pause-memory.js'
import { getUserContext } from '../../context.js'
import { getMemoryFiles } from '../../utils/claudemd.js'
import {
  isAutoMemoryEnabled,
  isAutoMemoryPausedForSession,
  setAutoMemoryPausedForSession,
} from '../../memdir/paths.js'
import type { LocalJSXCommandContext } from '../../types/command.js'

const context = {} as LocalJSXCommandContext

async function run(args: string): Promise<string> {
  const result = await call(args, context)
  return result.type === 'text' ? result.value : ''
}

describe('/pause-memory', () => {
  let originalDisable: string | undefined

  beforeEach(() => {
    originalDisable = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    setAutoMemoryPausedForSession(false)
  })

  afterEach(() => {
    setAutoMemoryPausedForSession(false)
    if (originalDisable === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    } else {
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = originalDisable
    }
  })

  test('no argument toggles the session pause', async () => {
    expect(await run('')).toContain('Auto-memory paused')
    expect(isAutoMemoryPausedForSession()).toBe(true)
    expect(isAutoMemoryEnabled()).toBe(false)

    expect(await run('')).toContain('Auto-memory resumed')
    expect(isAutoMemoryPausedForSession()).toBe(false)
  })

  test('explicit pause/resume are idempotent', async () => {
    await run('pause')
    expect(await run('pause')).toContain('already paused')
    await run('resume')
    expect(await run('resume')).toContain('already running')
  })

  test('resuming cannot override an env-level disable', async () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    await run('pause')
    expect(await run('resume')).toContain('stays off')
    expect(isAutoMemoryPausedForSession()).toBe(false)
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('rejects unknown arguments without changing state', async () => {
    expect(await run('sometimes')).toContain('Unknown argument')
    expect(isAutoMemoryPausedForSession()).toBe(false)
  })

  test('drops the memdir scan cache, but keeps the prompt-prefix cache', async () => {
    // getMemoryFiles reads the memdir entrypoint behind the same gate — that
    // scan must go. getUserContext must NOT: its output is messages[0], the
    // head of the API prompt-cache prefix, and clearing it turns the whole
    // conversation into cache_creation next turn (utils/attachments.ts has
    // the regression guard). Production calls getMemoryFiles() with no args,
    // so the lodash key is undefined. Primed by hand so the test does not
    // shell out to git.
    const primed = Promise.resolve([])
    getMemoryFiles.cache?.set(undefined, primed)
    getUserContext.cache?.set(undefined, Promise.resolve({}))

    await run('pause')

    expect(getMemoryFiles.cache?.has(undefined)).toBeFalsy()
    expect(getUserContext.cache?.has(undefined)).toBe(true)
  })
})
