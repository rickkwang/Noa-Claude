import { describe, expect, test } from 'bun:test'
import { SessionsWebSocket } from './SessionsWebSocket.js'

const MAX_RECONNECT_ATTEMPTS = 5

class FakeWebSocket {
  private listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor(_url: string, _options?: unknown) {}

  addEventListener(event: string, cb: (event?: unknown) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(cb)
    this.listeners.set(event, list)
  }

  emit(event: string, payload?: unknown): void {
    const list = this.listeners.get(event) ?? []
    for (const cb of list) {
      cb(payload)
    }
  }

  close(): void {}
  send(_data: string): void {}
  ping(): void {}
}

describe('SessionsWebSocket reconnect behavior', () => {
  test('stops reconnecting on repeated handshake 1006 after budget exhaustion', () => {
    let onCloseCalls = 0
    let reconnectSchedules = 0
    const socket = new SessionsWebSocket(
      'session-id',
      'org-id',
      () => 'token',
      {
        onMessage: () => {},
        onClose: () => {
          onCloseCalls++
        },
      },
    ) as any

    socket.scheduleReconnect = () => {
      reconnectSchedules++
    }

    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      socket.state = 'connecting'
      socket.handleClose(1006)
    }
    expect(reconnectSchedules).toBe(MAX_RECONNECT_ATTEMPTS)
    expect(onCloseCalls).toBe(0)

    socket.state = 'connecting'
    socket.handleClose(1006)
    expect(reconnectSchedules).toBe(MAX_RECONNECT_ATTEMPTS)
    expect(onCloseCalls).toBe(1)
  })

  test('resets handshake reconnect attempts after successful open', async () => {
    const originalWebSocket = globalThis.WebSocket
    let connectedCalls = 0

    ;(globalThis as any).WebSocket = FakeWebSocket as unknown as typeof WebSocket

    try {
      const socket = new SessionsWebSocket(
        'session-id',
        'org-id',
        () => 'token',
        {
          onMessage: () => {},
          onConnected: () => {
            connectedCalls++
          },
        },
      ) as any

      socket.handshakeReconnectAttempts = 4
      socket.reconnectAttempts = 3
      socket.sessionNotFoundRetries = 2

      await socket.connect()
      expect(socket.ws).not.toBeNull()
      ;(socket.ws as FakeWebSocket).emit('open')

      expect(socket.handshakeReconnectAttempts).toBe(0)
      expect(socket.reconnectAttempts).toBe(0)
      expect(socket.sessionNotFoundRetries).toBe(0)
      expect(connectedCalls).toBe(1)
    } finally {
      globalThis.WebSocket = originalWebSocket
    }
  })

  test('uses connected reconnect budget and closes when exhausted', () => {
    let onCloseCalls = 0
    let reconnectSchedules = 0
    const socket = new SessionsWebSocket(
      'session-id',
      'org-id',
      () => 'token',
      {
        onMessage: () => {},
        onClose: () => {
          onCloseCalls++
        },
      },
    ) as any

    socket.scheduleReconnect = () => {
      reconnectSchedules++
    }

    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      socket.state = 'connected'
      socket.handleClose(1006)
    }
    expect(reconnectSchedules).toBe(MAX_RECONNECT_ATTEMPTS)
    expect(onCloseCalls).toBe(0)

    socket.state = 'connected'
    socket.handleClose(1006)
    expect(reconnectSchedules).toBe(MAX_RECONNECT_ATTEMPTS)
    expect(onCloseCalls).toBe(1)
  })
})
