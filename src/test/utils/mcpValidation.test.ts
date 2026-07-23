import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  getMaxMcpOutputTokens,
  truncateMcpContent,
} from '../../utils/mcpValidation.js'

const TRUNCATION_MARKER = 'OUTPUT TRUNCATED'

describe('truncateMcpContent — string correctness', () => {
  test('truncates an over-long string to the char cap and appends the marker', async () => {
    const maxChars = getMaxMcpOutputTokens() * 4
    const src = 'A'.repeat(maxChars + 5000)

    const out = (await truncateMcpContent(src)) as string

    // Body before the appended message is exactly the char-capped prefix,
    // preserved byte-for-byte through the detach round-trip.
    expect(out.slice(0, maxChars)).toBe('A'.repeat(maxChars))
    expect(out.length).toBeGreaterThan(maxChars)
    expect(out).toContain(TRUNCATION_MARKER)
  })

  test('preserves multibyte (CJK) content across the detach copy', async () => {
    const maxChars = getMaxMcpOutputTokens() * 4
    // CJK chars are BMP (single UTF-16 units) so the cap never splits a
    // surrogate pair; the Buffer round-trip must reproduce them exactly.
    const src = '你好世界'.repeat(Math.ceil((maxChars + 1000) / 4))

    const out = (await truncateMcpContent(src)) as string

    expect(out.slice(0, maxChars)).toBe(src.slice(0, maxChars))
    expect(out).toContain(TRUNCATION_MARKER)
  })

  test('leaves a short string untouched apart from the appended marker', async () => {
    const src = 'short output'

    const out = (await truncateMcpContent(src)) as string

    expect(out.startsWith(src)).toBe(true)
    expect(out).toContain(TRUNCATION_MARKER)
  })
})

describe('truncateMcpContent — content-block correctness', () => {
  test('truncates an over-long text block and appends a marker block', async () => {
    const maxChars = getMaxMcpOutputTokens() * 4
    const blocks: ContentBlockParam[] = [
      { type: 'text', text: 'B'.repeat(maxChars + 5000) },
    ]

    const out = (await truncateMcpContent(blocks)) as ContentBlockParam[]

    expect(Array.isArray(out)).toBe(true)
    const first = out[0]
    expect(first?.type).toBe('text')
    expect((first as { text: string }).text).toBe('B'.repeat(maxChars))
    // Trailing block carries the truncation marker.
    const last = out[out.length - 1]
    expect((last as { text: string }).text).toContain(TRUNCATION_MARKER)
  })
})

// Memory-retention regression guard. Runs a subprocess that holds 20 truncated
// results derived from 25MB sources (500MB pinned if truncation retains the
// parent string). With the detachString fix heapUsed stays ~135MB; a regression
// to a bare `.slice()` pushes it to ~480MB. Threshold sits between the two.
// See mcpTruncationMemory.fixture.ts for the mechanism.
describe('truncateMcpContent — memory retention', () => {
  const HEAP_LIMIT_MB = 300

  test(
    'does not retain the full source string after truncation',
    () => {
      const fixture = join(import.meta.dir, 'mcpTruncationMemory.fixture.ts')
      const proc = Bun.spawnSync(['bun', 'run', fixture], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      expect(proc.success).toBe(true)
      const stdout = proc.stdout.toString().trim()
      const lastLine = stdout.split('\n').filter(Boolean).pop() ?? '{}'
      const result = JSON.parse(lastLine) as {
        heapUsedMB: number
        retainedMB: number
      }

      // Sanity: the fixture really did build multi-hundred-MB of sources.
      expect(result.retainedMB).toBeGreaterThanOrEqual(400)
      // The fix: heap stays far below the pinned-source size.
      expect(result.heapUsedMB).toBeLessThan(HEAP_LIMIT_MB)
    },
    30_000,
  )
})
