import { describe, expect, test } from 'bun:test'
import * as abortControllers from '../../utils/abortController.js'

describe('createCombinedAbortController', () => {
  test('aborts when the parent turn is aborted', () => {
    const parent = new AbortController()
    const task = new AbortController()
    const createCombined = (
      abortControllers as typeof abortControllers & {
        createCombinedAbortController(
          first: AbortController,
          second: AbortController,
        ): AbortController
      }
    ).createCombinedAbortController
    expect(typeof createCombined).toBe('function')
    const combined = createCombined?.(parent, task)

    parent.abort('escape')

    expect(combined?.signal.aborted).toBe(true)
    expect(combined?.signal.reason).toBe('escape')
  })

  test('aborts when the foreground task is stopped', () => {
    const parent = new AbortController()
    const task = new AbortController()
    const createCombined = (
      abortControllers as typeof abortControllers & {
        createCombinedAbortController(
          first: AbortController,
          second: AbortController,
        ): AbortController
      }
    ).createCombinedAbortController
    const combined = createCombined?.(parent, task)

    task.abort('task-stop')

    expect(combined?.signal.aborted).toBe(true)
    expect(combined?.signal.reason).toBe('task-stop')
    expect(parent.signal.aborted).toBe(false)
  })
})
