import { describe, expect, test } from 'bun:test'
import { createChildAbortController } from '../../utils/abortController.js'

// Covers the wiring AgentTool uses for a foreground agent: the run's controller
// is a child of the foreground TASK controller, and the parent turn's signal is
// attached separately so backgrounding can detach it (AgentTool.tsx call()).
describe('createChildAbortController', () => {
  test('aborts when the parent is aborted, and propagates the reason', () => {
    const task = new AbortController()
    const child = createChildAbortController(task)

    task.abort('task-stop')

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('task-stop')
  })

  test('aborts immediately when the parent is already aborted', () => {
    const task = new AbortController()
    task.abort('task-stop')

    const child = createChildAbortController(task)

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('task-stop')
  })

  test('aborting the child leaves the parent running', () => {
    const task = new AbortController()
    const child = createChildAbortController(task)

    child.abort('agent-done')

    expect(child.signal.reason).toBe('agent-done')
    expect(task.signal.aborted).toBe(false)
  })

  test('siblings are independent', () => {
    const task = new AbortController()
    const first = createChildAbortController(task)
    const second = createChildAbortController(task)

    first.abort('one')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)

    task.abort('task-stop')

    expect(second.signal.aborted).toBe(true)
    expect(second.signal.reason).toBe('task-stop')
    // Already aborted from its own source — the parent must not overwrite it.
    expect(first.signal.reason).toBe('one')
  })

  test('a detachable parent listener stops propagating once removed', () => {
    // Mirrors AgentTool's backgrounding handoff: the run keeps following the
    // task controller but stops following the parent turn (so ESC on the main
    // thread no longer kills a backgrounded agent).
    const task = new AbortController()
    const parentTurn = new AbortController()
    const child = createChildAbortController(task)
    const abortFromParent = () => child.abort(parentTurn.signal.reason)
    parentTurn.signal.addEventListener('abort', abortFromParent, { once: true })

    parentTurn.signal.removeEventListener('abort', abortFromParent)
    parentTurn.abort('escape')

    expect(child.signal.aborted).toBe(false)

    task.abort('task-stop')

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('task-stop')
  })
})
