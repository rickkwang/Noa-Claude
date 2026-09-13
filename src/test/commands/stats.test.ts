import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { call } from '../../commands/stats/stats.js'
import type { LocalJSXCommandContext } from '../../types/command.js'

describe('/stats', () => {
  test('opens the usage dashboard on the Stats tab', async () => {
    const node = (await call(
      () => {},
      {} as LocalJSXCommandContext,
      '',
    )) as ReactElement
    expect((node.props as { defaultTab: string }).defaultTab).toBe('Stats')
  })
})
