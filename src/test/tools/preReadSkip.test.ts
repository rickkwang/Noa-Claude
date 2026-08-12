// @ts-nocheck
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'NOA_CLAUDE_WRITE_REQUIRE_READ',
] as const
const originalProviderEnv = Object.fromEntries(
  PROVIDER_ENV_KEYS.map(k => [k, process.env[k]]),
)

import { getEmptyToolPermissionContext } from '../../Tool.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { FileStateCache } from '../../utils/fileStateCache.js'

// The pre-read skip is only reachable when validateInput and call agree, so
// every case here drives both. A skip that only validateInput honours would
// approve the write for the user and then throw when it actually runs.
describe('overwriting a file the session never read', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    for (const k of PROVIDER_ENV_KEYS) delete process.env[k]
    dir = mkdtempSync(join(tmpdir(), 'pre-read-skip-'))
    filePath = join(dir, 'target.txt')
    process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
    for (const k of PROVIDER_ENV_KEYS) {
      const value = originalProviderEnv[k]
      if (value === undefined) delete process.env[k]
      else process.env[k] = value
    }
  })

  function makeContext(model: string, permissionPatch = {}) {
    return {
      readFileState: new FileStateCache(100, 25 * 1024 * 1024),
      dynamicSkillDirTriggers: new Set(),
      options: {
        mainLoopModel: model,
        tools: [FileReadTool, FileWriteTool, FileEditTool],
      },
      getAppState: () => ({
        toolPermissionContext: {
          ...getEmptyToolPermissionContext(),
          mode: 'default',
          additionalWorkingDirectories: new Map([[dir, true]]),
          ...permissionPatch,
        },
      }),
    }
  }

  test('a newer model may Write over it', async () => {
    writeFileSync(filePath, 'original\n')
    const context = makeContext('claude-opus-5')
    const input = { file_path: filePath, content: 'replaced\n' }

    const validation = await FileWriteTool.validateInput(input, context)
    expect(validation.result).toBe(true)

    const result = await FileWriteTool.call(input, context, undefined, {
      uuid: 'test-uuid',
    })
    expect(result.data.type).toBe('update')
    expect(await Bun.file(filePath).text()).toBe('replaced\n')
  })

  test('a newer model may Edit it', async () => {
    writeFileSync(filePath, 'alpha\nbeta\n')
    const context = makeContext('claude-opus-5')
    const input = {
      file_path: filePath,
      old_string: 'beta',
      new_string: 'BETA',
      replace_all: false,
    }

    const validation = await FileEditTool.validateInput(input, context)
    expect(validation.result).toBe(true)

    await FileEditTool.call(input, context, undefined, { uuid: 'test-uuid' })
    expect(await Bun.file(filePath).text()).toBe('alpha\nBETA\n')
  })

  test('a model still on the denylist is rejected', async () => {
    writeFileSync(filePath, 'original\n')
    const context = makeContext('claude-sonnet-4-5')

    const validation = await FileWriteTool.validateInput(
      { file_path: filePath, content: 'replaced\n' },
      context,
    )
    expect(validation.result).toBe(false)
    expect(validation.errorCode).toBe(2)
  })

  test('NOA_CLAUDE_WRITE_REQUIRE_READ restores the guard', async () => {
    writeFileSync(filePath, 'original\n')
    process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '1'
    const context = makeContext('claude-opus-5')

    const validation = await FileWriteTool.validateInput(
      { file_path: filePath, content: 'replaced\n' },
      context,
    )
    expect(validation.result).toBe(false)
  })

  test('a notebook still has to be read first', async () => {
    const notebookPath = join(dir, 'notes.ipynb')
    writeFileSync(notebookPath, '{}\n')
    const context = makeContext('claude-opus-5')

    const validation = await FileWriteTool.validateInput(
      { file_path: notebookPath, content: '{"cells":[]}\n' },
      context,
    )
    expect(validation.result).toBe(false)
    expect(validation.errorCode).toBe(2)
  })

  test('a partial read is not enough', async () => {
    writeFileSync(filePath, 'original\n')
    const context = makeContext('claude-opus-5')
    context.readFileState.set(filePath, {
      content: 'orig',
      timestamp: Date.now() + 10_000,
      offset: 0,
      limit: 1,
      isPartialView: true,
    })

    const validation = await FileWriteTool.validateInput(
      { file_path: filePath, content: 'replaced\n' },
      context,
    )
    expect(validation.result).toBe(false)
  })

  test('a file outside every working directory keeps the guard', async () => {
    writeFileSync(filePath, 'original\n')
    const context = makeContext('claude-opus-5', {
      additionalWorkingDirectories: new Map(),
    })

    const validation = await FileWriteTool.validateInput(
      { file_path: filePath, content: 'replaced\n' },
      context,
    )
    expect(validation.result).toBe(false)
  })

  test('a context without a reading tool keeps the guard', async () => {
    writeFileSync(filePath, 'original\n')
    const context = makeContext('claude-opus-5')
    context.options.tools = [FileWriteTool]

    const validation = await FileWriteTool.validateInput(
      { file_path: filePath, content: 'replaced\n' },
      context,
    )
    expect(validation.result).toBe(false)
  })
})
