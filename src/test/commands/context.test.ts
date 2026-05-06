import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'

describe('/context command', () => {
  test('marks interactive output as system transcript output', async () => {
    const source = await readFile('src/commands/context/context.tsx', 'utf8')

    expect(source).toContain("onDone(output, { display: 'system' })")
  })
})
