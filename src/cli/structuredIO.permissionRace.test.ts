import { describe, expect, test } from 'bun:test'
import {
  _runPermissionRequestRaceForTesting,
  StructuredIO,
} from './structuredIO.js'

describe('structuredIO permission race', () => {
  test('when SDK resolves first, hook side is aborted and parent signal stays active', async () => {
    const hookAbortController = new AbortController()
    const parentAbortController = new AbortController()
    let hookSawAbort = false

    const hookPromise = new Promise(resolve => {
      hookAbortController.signal.addEventListener(
        'abort',
        () => {
          hookSawAbort = true
          resolve(undefined)
        },
        { once: true },
      )
    })

    const sdkPromise = Promise.resolve({
      behavior: 'allow',
      updatedInput: { ok: true },
      toolUseID: 'tool-1',
    })

    const result = await _runPermissionRequestRaceForTesting(
      hookPromise as Promise<any>,
      sdkPromise as Promise<any>,
      hookAbortController,
      { toolName: 'Bash', toolUseID: 'tool-1' },
    )

    expect(result.winner).toBe('sdk')
    expect(hookAbortController.signal.aborted).toBe(true)
    expect(hookSawAbort).toBe(true)
    expect(parentAbortController.signal.aborted).toBe(false)
  })

  test('when hook denies first, SDK side is aborted and race returns hook decision', async () => {
    const hookAbortController = new AbortController()
    let sdkSawAbort = false

    const sdkPromise = new Promise((resolve, reject) => {
      hookAbortController.signal.addEventListener(
        'abort',
        () => {
          sdkSawAbort = true
          reject(new Error('sdk aborted'))
        },
        { once: true },
      )
      setTimeout(() => {
        resolve({
          behavior: 'allow',
          updatedInput: { late: true },
          toolUseID: 'tool-2',
        })
      }, 50)
    })

    const hookDecision = {
      behavior: 'deny',
      message: 'Denied by hook',
      decisionReason: {
        type: 'hook',
        hookName: 'PermissionRequest',
      },
    }
    const result = await _runPermissionRequestRaceForTesting(
      Promise.resolve(hookDecision as any),
      sdkPromise as Promise<any>,
      hookAbortController,
      { toolName: 'Bash', toolUseID: 'tool-2' },
    )

    expect(result.winner).toBe('hook')
    if (result.winner === 'hook') {
      expect(result.decision.behavior).toBe('deny')
    }
    expect(sdkSawAbort).toBe(true)
    expect(hookAbortController.signal.aborted).toBe(true)
  })

  test('createCanUseTool does not abort parent controller on SDK-allow path', async () => {
    const io = new StructuredIO(
      (async function* () {})(),
      false,
    ) as unknown as {
      createCanUseTool: (
        onPermissionPrompt?: (details: unknown) => void,
      ) => (...args: Array<unknown>) => Promise<any>
      sendRequest: (...args: Array<unknown>) => Promise<unknown>
    }

    io.sendRequest = async () => ({
      behavior: 'allow',
      updatedInput: {},
      toolUseID: 'tool-3',
    })

    const canUseTool = io.createCanUseTool()
    const parentAbortController = new AbortController()
    const toolUseContext = {
      abortController: parentAbortController,
      agentId: 'agent-1',
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
      }),
      setAppState: () => {},
    }
    const tool = {
      name: 'Bash',
      userFacingName: () => 'Bash',
      getActivityDescription: () => 'Run shell command',
      getToolUseSummary: () => 'Run shell command',
    }
    const forceDecision = {
      behavior: 'ask',
      suggestions: [],
      blockedPath: undefined,
      decisionReason: { type: 'mode' },
    }

    const result = await canUseTool(
      tool,
      { command: 'echo hello' },
      toolUseContext,
      { role: 'assistant', content: [] },
      'tool-3',
      forceDecision,
    )

    expect(result.behavior).toBe('allow')
    expect(parentAbortController.signal.aborted).toBe(false)
  })
})
