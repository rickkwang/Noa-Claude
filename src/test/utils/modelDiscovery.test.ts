import { afterEach, describe, expect, test } from 'bun:test'
import axios from 'axios'
import { discoverProviderModelNames } from '../../utils/model/openaiModelDiscovery.js'

const originalGet = axios.get

afterEach(() => {
  axios.get = originalGet
})

describe('discoverProviderModelNames', () => {
  test('fetches OpenAI-compatible models from the base /models endpoint', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    axios.get = (async (url: string, config?: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: config?.headers ?? {} })
      return {
        data: {
          data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1' }, { id: 'gpt-4o' }],
        },
      }
    }) as typeof axios.get

    await expect(
      discoverProviderModelNames({
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
      }),
    ).resolves.toEqual(['gpt-4.1', 'gpt-4o'])
    expect(requests[0]).toEqual({
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: 'Bearer sk-test' },
    })
  })

  test('uses Gemini API key header for Gemini OpenAI-compatible discovery', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    axios.get = (async (url: string, config?: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: config?.headers ?? {} })
      return { data: { data: [{ id: 'gemini-2.5-pro' }] } }
    }) as typeof axios.get

    await expect(
      discoverProviderModelNames({
        type: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
      }),
    ).resolves.toEqual(['gemini-2.5-pro'])
    expect(requests[0]?.headers).toEqual({ 'x-goog-api-key': 'AIza-test' })
  })

  test('discovers Moonshot China models through the OpenAI-compatible endpoint', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    axios.get = (async (url: string, config?: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: config?.headers ?? {} })
      return { data: { data: [{ id: 'kimi-k2.6' }] } }
    }) as typeof axios.get

    await expect(
      discoverProviderModelNames({
        type: 'moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'sk-moonshot-test',
      }),
    ).resolves.toEqual(['kimi-k2.6'])
    expect(requests[0]).toEqual({
      url: 'https://api.moonshot.cn/v1/models',
      headers: { Authorization: 'Bearer sk-moonshot-test' },
    })
  })

  test('uses Bearer auth for Anthropic-compatible Kimi and MiniMax discovery', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    axios.get = (async (url: string, config?: { headers?: Record<string, string> }) => {
      requests.push({ url, headers: config?.headers ?? {} })
      return {
        data: {
          data: [
            {
              id: url.includes('minimaxi') ? 'MiniMax-M2.5' : 'kimi-for- coding',
            },
          ],
        },
      }
    }) as typeof axios.get

    await expect(
      discoverProviderModelNames({
        type: 'kimi',
        baseUrl: 'https://api.kimi.com/coding',
        apiKey: 'moonshot-test',
      }),
    ).resolves.toEqual(['kimi-for-coding'])
    expect(requests[0]).toEqual({
      url: 'https://api.kimi.com/coding/v1/models',
      headers: {
        Authorization: 'Bearer moonshot-test',
        'anthropic-version': '2023-06-01',
      },
    })

    await expect(
      discoverProviderModelNames({
        type: 'minimax',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        apiKey: 'minimax-test',
      }),
    ).resolves.toEqual(['MiniMax-M2.5'])
    expect(requests[1]).toEqual({
      url: 'https://api.minimaxi.com/anthropic/v1/models',
      headers: {
        Authorization: 'Bearer minimax-test',
        'anthropic-version': '2023-06-01',
      },
    })
  })

  test('falls back to the stable Kimi Code model id when discovery is unavailable', async () => {
    axios.get = (async () => {
      throw new Error('not found')
    }) as typeof axios.get

    await expect(
      discoverProviderModelNames({
        type: 'kimi',
        baseUrl: 'https://api.kimi.com/coding',
        apiKey: 'moonshot-test',
      }),
    ).resolves.toEqual(['kimi-for-coding'])
  })

  test('falls back to Ollama tags when OpenAI model discovery is unavailable', async () => {
    const urls: string[] = []
    axios.get = (async (url: string) => {
      urls.push(url)
      if (url.endsWith('/models')) {
        throw new Error('not found')
      }
      return {
        data: {
          models: [{ name: 'llama3' }, { name: 'qwen2.5-coder' }],
        },
      }
    }) as typeof axios.get

    await expect(
      discoverProviderModelNames({
        type: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
      }),
    ).resolves.toEqual(['llama3', 'qwen2.5-coder'])
    expect(urls).toEqual(['http://localhost:11434/api/tags'])
  })
})
