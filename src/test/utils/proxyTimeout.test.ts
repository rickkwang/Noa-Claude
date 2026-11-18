import { describe, expect, test } from 'bun:test'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { withProxyConnectTimeout } from '../../utils/proxy.js'

describe('withProxyConnectTimeout', () => {
  test('aborts stalled connect and throws ETIMEDOUT', async () => {
    const agent = new HttpsProxyAgent('http://127.0.0.1:8888')
    agent.connect = async () =>
      new Promise((_, reject) => {
        const signal = agent.connectOpts?.signal
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    withProxyConnectTimeout(agent, 25)
    await expect(agent.connect({} as never, {} as never)).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    })
  })

  test('resolves normally when connect finishes before timeout', async () => {
    const agent = new HttpsProxyAgent('http://127.0.0.1:8888')
    const sentinel = { ok: true }
    agent.connect = async () => sentinel as never

    withProxyConnectTimeout(agent, 500)
    const res = await agent.connect({} as never, {} as never)
    expect(res).toBe(sentinel as never)
  })
})
