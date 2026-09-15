import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { BashTool } from '../../tools/BashTool/BashTool.js'
import { MalformedCommandError } from '../../utils/errors.js'
import * as permissions from '../../utils/permissions/permissions.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'
import * as toolResultStorage from '../../utils/toolResultStorage.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Decision = { behavior: string; decisionReason?: { type: string }; message?: string }

let decisions: Record<string, Decision>
let checkedModes: string[]
let ran: string[]

beforeEach(() => {
  decisions = {}
  checkedModes = []
  ran = []
  spyOn(permissions, 'hasPermissionsToUseTool').mockImplementation((async (
    _tool: unknown,
    input: { command: string },
    context: any,
  ) => {
    checkedModes.push(context.getAppState().toolPermissionContext.mode)
    return decisions[input.command] ?? { behavior: 'allow' }
  }) as any)
  spyOn(BashTool, 'call').mockImplementation((async (input: { command: string }) => {
    ran.push(input.command)
    return { data: { stdout: `out(${input.command})`, stderr: '', interrupted: false } }
  }) as any)
  spyOn(toolResultStorage, 'processToolResultBlock').mockImplementation((async (
    _tool: unknown,
    data: { stdout: string },
  ) => ({ content: data.stdout })) as any)
})

afterEach(() => {
  mock.restore()
})

function context(mode: string, extra: Record<string, unknown> = {}): any {
  return {
    getAppState: () => ({ toolPermissionContext: { mode } }),
    options: { tools: [BashTool] },
    promptShellHandOff: true,
    ...extra,
  }
}

const ASK = { behavior: 'ask', message: 'needs approval' }

describe('executeShellCommandsInPrompt permission mode', () => {
  test('checks rules as default mode while auto mode is active', async () => {
    const out = await executeShellCommandsInPrompt('Status: !`git status`', context('auto'), '/s')
    expect(checkedModes).toEqual(['default'])
    expect(out).toBe('Status: out(git status)')
  })

  test('leaves other modes as they are', async () => {
    await executeShellCommandsInPrompt('!`ls`', context('acceptEdits'), '/s')
    expect(checkedModes).toEqual(['acceptEdits'])
  })
})

describe('executeShellCommandsInPrompt hand-off', () => {
  test('hands a command no rule decides to the model in auto mode', async () => {
    decisions['git push'] = ASK
    const out = await executeShellCommandsInPrompt('Push: !`git push`', context('auto'), '/s')
    expect(out).toBe('Push: [run this first, exactly as written, and use its output: `git push`]')
    expect(ran).toEqual([])
  })

  test('treats a headless asyncAgent deny as undecided', async () => {
    decisions['make'] = { behavior: 'deny', decisionReason: { type: 'asyncAgent' } }
    const out = await executeShellCommandsInPrompt('!`make`', context('auto'), '/s')
    expect(out).toBe('[run this first, exactly as written, and use its output: `make`]')
  })

  test('fences a command containing a backtick or newline', async () => {
    decisions['echo a\necho b'] = ASK
    const out = await executeShellCommandsInPrompt('```!\necho a\necho b\n```', context('auto'), '/s')
    expect(out).toBe(
      '[run this first, exactly as written, and use its output:]\n```\necho a\necho b\n```',
    )
  })

  test('numbers several hand-offs in text order and still runs allowed commands', async () => {
    decisions['b1'] = ASK
    decisions['blk'] = ASK
    const out = await executeShellCommandsInPrompt(
      'A !`b1`\n```!\nblk\n```\nC !`ls`',
      context('auto'),
      '/s',
    )
    expect(out).toBe(
      '[Run these 2 commands first, exactly as written, and use their output where each is named below. Run them one per call, or all in one Bash call joined with &&.]\n' +
        '1. `b1`\n2. `blk`\n\n' +
        'A [output of command 1, `b1`]\n[output of command 2, `blk`]\nC out(ls)',
    )
    expect(ran).toEqual(['ls'])
  })

  test('fails the expansion when the caller did not opt in', async () => {
    decisions['git push'] = ASK
    await expect(
      executeShellCommandsInPrompt('!`git push`', context('auto', { promptShellHandOff: undefined }), '/s'),
    ).rejects.toBeInstanceOf(MalformedCommandError)
  })

  test('fails the expansion outside auto mode', async () => {
    decisions['git push'] = ASK
    await expect(
      executeShellCommandsInPrompt('!`git push`', context('default'), '/s'),
    ).rejects.toBeInstanceOf(MalformedCommandError)
  })

  test('fails the expansion when the model lacks the shell tool', async () => {
    decisions['git push'] = ASK
    await expect(
      executeShellCommandsInPrompt('!`git push`', context('auto', { options: { tools: [] } }), '/s'),
    ).rejects.toBeInstanceOf(MalformedCommandError)
  })

  test('a rule deny still fails the expansion', async () => {
    decisions['rm -rf /'] = { behavior: 'deny', decisionReason: { type: 'rule' }, message: 'denied' }
    await expect(
      executeShellCommandsInPrompt('!`rm -rf /`', context('auto'), '/s'),
    ).rejects.toBeInstanceOf(MalformedCommandError)
  })
})
