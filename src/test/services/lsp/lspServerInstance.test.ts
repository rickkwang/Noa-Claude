import { describe, expect, mock, test } from 'bun:test'

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void }
const deferred = (): Deferred => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let crashHandler: ((e: Error) => void) | undefined
let startGate: Deferred = deferred()
let initGate: Deferred = deferred()
let stopCalls = 0
let stopGate: Deferred = deferred()
stopGate.resolve()

mock.module('../../../services/lsp/LSPClient.js', () => ({
  createLSPClient: (_name: string, onCrash?: (e: Error) => void) => {
    crashHandler = onCrash
    return {
      start: async () => { await startGate.promise },
      initialize: async () => { await initGate.promise },
      stop: async () => { stopCalls++; await stopGate.promise },
      isInitialized: true,
    }
  },
}))

const { createLSPServerInstance } = await import('../../../services/lsp/LSPServerInstance.js')
const config = { command: 'fake', args: [], scope: 'dynamic', source: 'test' } as any

describe('LSPServerInstance lifecycle transitions', () => {
  test('happy path: stopped -> starting -> running -> stopping -> stopped', async () => {
    startGate = deferred(); initGate = deferred()
    const s = createLSPServerInstance('a', config)
    startGate.resolve(); initGate.resolve()
    await s.start()
    expect(s.state).toBe('running')
    await s.stop()
    expect(s.state).toBe('stopped')
  })

  test('start() while stopping throws and does not touch state', async () => {
    startGate = deferred(); initGate = deferred()
    const s = createLSPServerInstance('b', config)
    startGate.resolve(); initGate.resolve()
    stopGate = deferred()
    await s.start()
    const stopping = s.stop()
    expect(s.state).toBe('stopping')
    await expect(s.start()).rejects.toThrow(/is stopping/)
    expect(s.state).toBe('stopping')
    stopGate.resolve()
    await stopping
    expect(s.state).toBe('stopped')
  })

  test('stop() during startup: start rejects, final state is stopped, never running', async () => {
    startGate = deferred(); initGate = deferred()
    const s = createLSPServerInstance('c', config)
    const starting = s.start()
    expect(s.state).toBe('starting')
    const stopping = s.stop()
    expect(s.state).toBe('stopping')
    startGate.resolve(); initGate.resolve()
    await expect(starting).rejects.toThrow(/stopped during startup/)
    await stopping
    expect(s.state).toBe('stopped')
  })

  test('crash while stopped is ignored; crash while running -> error, then restart works', async () => {
    startGate = deferred(); initGate = deferred()
    const s = createLSPServerInstance('d', config)
    crashHandler?.(new Error('late'))
    expect(s.state).toBe('stopped')
    startGate.resolve(); initGate.resolve()
    await s.start()
    crashHandler?.(new Error('boom'))
    expect(s.state).toBe('error')
    expect(s.lastError?.message).toBe('boom')
    await s.start()
    expect(s.state).toBe('running')
  })

  test('failed initialize -> error', async () => {
    startGate = deferred(); initGate = deferred()
    const s = createLSPServerInstance('e', config)
    startGate.resolve()
    initGate.reject(new Error('init failed'))
    await expect(s.start()).rejects.toThrow('init failed')
    expect(s.state).toBe('error')
  })
})
