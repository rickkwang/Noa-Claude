import { describe, expect, test } from 'bun:test'
import {
  cacheToObject,
  createFileStateCacheWithSizeLimit,
  restoreCacheFromObject,
} from '../../utils/fileStateCache.js'

describe('restoreCacheFromObject', () => {
  test('repopulates an empty cache from a snapshot', () => {
    const cache = createFileStateCacheWithSizeLimit(100)
    cache.set('/a.txt', { content: 'A', timestamp: 1, offset: undefined, limit: undefined })
    cache.set('/b.txt', { content: 'B', timestamp: 2, offset: undefined, limit: undefined })
    const snapshot = cacheToObject(cache)

    cache.clear()
    expect(cache.size).toBe(0)

    restoreCacheFromObject(cache, snapshot)

    expect(cache.size).toBe(2)
    expect(cache.get('/a.txt')?.content).toBe('A')
    expect(cache.get('/b.txt')?.content).toBe('B')
  })

  test('overwrites existing entries', () => {
    const cache = createFileStateCacheWithSizeLimit(100)
    cache.set('/a.txt', { content: 'original', timestamp: 1, offset: undefined, limit: undefined })
    const snapshot = cacheToObject(cache)
    cache.set('/a.txt', { content: 'mutated', timestamp: 2, offset: undefined, limit: undefined })

    restoreCacheFromObject(cache, snapshot)

    expect(cache.get('/a.txt')?.content).toBe('original')
  })
})
