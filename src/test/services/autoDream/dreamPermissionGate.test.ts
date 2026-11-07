import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  createDreamCanUseTool,
  dreamEntrypointBlocked,
  findDreamWriteBlockRule,
} from '../../../services/autoDream/autoDream.js'
import { setAutoMemoryPausedForSession } from '../../../memdir/paths.js'
import { BashTool } from '../../../tools/BashTool/BashTool.js'
import { FileReadTool } from '../../../tools/FileReadTool/FileReadTool.js'

const MEMORY_ROOT = '/mem/root'

function contextWithDeny(rules: string[]) {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysDenyRules: { userSettings: rules },
  }
}

describe('findDreamWriteBlockRule', () => {
  test('blocks when Edit or Write is denied as a whole tool', () => {
    expect(
      findDreamWriteBlockRule(contextWithDeny(['Edit']), MEMORY_ROOT),
    ).not.toBeNull()
    expect(
      findDreamWriteBlockRule(contextWithDeny(['Write']), MEMORY_ROOT),
    ).not.toBeNull()
  })

  test('blocks when the memory directory is denied by path', () => {
    expect(
      findDreamWriteBlockRule(
        contextWithDeny([`Edit(//${MEMORY_ROOT.slice(1)}/**)`]),
        MEMORY_ROOT,
      ),
    ).not.toBeNull()
  })

  test('ignores rules for unrelated paths and no rules at all', () => {
    expect(
      findDreamWriteBlockRule(
        contextWithDeny(['Edit(//elsewhere/**)']),
        MEMORY_ROOT,
      ),
    ).toBeNull()
    expect(
      findDreamWriteBlockRule(getEmptyToolPermissionContext(), MEMORY_ROOT),
    ).toBeNull()
  })
})

describe('dreamEntrypointBlocked', () => {
  test('blocks SDK and headless entrypoints only', () => {
    expect(dreamEntrypointBlocked('sdk-cli')).toBe(true)
    expect(dreamEntrypointBlocked('sdk-ts')).toBe(true)
    expect(dreamEntrypointBlocked('cli')).toBe(false)
    expect(dreamEntrypointBlocked(undefined)).toBe(false)
  })
})

describe('createDreamCanUseTool', () => {
  const memoryRoot = '/mem/root'
  const toolUseContext = {
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
  }
  const input = { file_path: `${memoryRoot}/a.md` }

  test('allows a read-only call when no hook asked', async () => {
    const canUseTool = createDreamCanUseTool(memoryRoot, toolUseContext)
    const decision = await canUseTool(FileReadTool, input, toolUseContext)
    expect(decision.behavior).toBe('allow')
  })

  test('denies calls made after memory is paused mid-run', async () => {
    const canUseTool = createDreamCanUseTool(memoryRoot, toolUseContext)
    setAutoMemoryPausedForSession(true)
    try {
      const paused = await canUseTool(FileReadTool, input, toolUseContext)
      expect(paused.behavior).toBe('deny')
      expect(paused.decisionReason).toEqual({
        type: 'other',
        reason: 'memory_paused',
      })
    } finally {
      setAutoMemoryPausedForSession(false)
    }
    const resumed = await canUseTool(FileReadTool, input, toolUseContext)
    expect(resumed.behavior).toBe('allow')
  })

  test('denies a call a PreToolUse hook asked about', async () => {
    const canUseTool = createDreamCanUseTool(memoryRoot, toolUseContext)
    const decision = await canUseTool(
      FileReadTool,
      input,
      toolUseContext,
      undefined,
      'tool-1',
      { behavior: 'ask', message: 'confirm?' },
    )
    expect(decision.behavior).toBe('deny')
    expect(decision.decisionReason).toEqual({
      type: 'other',
      reason: 'hook_ask',
    })
  })
})

describe('createDreamCanUseTool permission details', () => {
  const memoryRoot = '/mem/root'
  const ctxFor = (perm: object) => ({
    getAppState: () => ({ toolPermissionContext: perm }),
  })

  test('applies deny rules to the rewritten rm command that will run', async () => {
    const perm = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { userSettings: ['Bash(rm -f:*)'] },
    }
    const toolUseContext = ctxFor(perm)
    const canUseTool = createDreamCanUseTool(memoryRoot, toolUseContext)
    const decision = await canUseTool(BashTool, { command: 'rm a.md' }, toolUseContext)
    expect(decision.behavior).toBe('deny')
  })

  test('returns the rewritten absolute-path rm as the executed input', async () => {
    const toolUseContext = ctxFor(getEmptyToolPermissionContext())
    const canUseTool = createDreamCanUseTool(memoryRoot, toolUseContext)
    const decision = await canUseTool(BashTool, { command: 'rm a.md' }, toolUseContext)
    expect(decision).toMatchObject({
      behavior: 'allow',
      updatedInput: { command: "rm -f -- '/mem/root/a.md'" },
    })
  })

  test('blocks reads outside the allowed roots only when the user set the flag', async () => {
    const blocking = ctxFor({
      ...getEmptyToolPermissionContext(),
      blockReadsOutsideWorkingDirectories: true,
    })
    const open = ctxFor(getEmptyToolPermissionContext())
    const blockedCanUse = createDreamCanUseTool(memoryRoot, blocking)
    const openCanUse = createDreamCanUseTool(memoryRoot, open)

    const outside = await blockedCanUse(FileReadTool, { file_path: '/etc/hosts' }, blocking)
    expect(outside.behavior).toBe('deny')
    expect(outside.decisionReason).toEqual({ type: 'other', reason: 'read_block' })

    const inMemory = await blockedCanUse(FileReadTool, { file_path: `${memoryRoot}/a.md` }, blocking)
    expect(inMemory.behavior).toBe('allow')

    const unblocked = await openCanUse(FileReadTool, { file_path: '/etc/hosts' }, open)
    expect(unblocked.behavior).toBe('allow')
  })
})
