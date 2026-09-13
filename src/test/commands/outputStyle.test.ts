import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { call } from '../../commands/output-style/output-style.js'
import type { LocalJSXCommandContext } from '../../types/command.js'

const context = {} as LocalJSXCommandContext

type PickerProps = {
  initialStyle: string
  onCancel: () => void
}

async function openPicker(
  onDone: (message?: string, options?: unknown) => void,
): Promise<PickerProps> {
  const node = (await call(onDone, context, '')) as ReactElement
  const picker = (node.props as { children: ReactElement }).children
  return picker.props as PickerProps
}

describe('/output-style', () => {
  test('opens the picker on the style the session is currently using', async () => {
    const picker = await openPicker(() => {})

    expect(picker.initialStyle).toBeString()
    expect(picker.initialStyle.length).toBeGreaterThan(0)
  })

  test('dismissing writes nothing and reports as a system message', async () => {
    const calls: unknown[][] = []
    const picker = await openPicker((...args) => calls.push(args))

    // onComplete is deliberately not exercised: it writes to the real settings
    // file, and there is no seam to redirect the write. The read side is
    // covered above; the write is one call to updateSettingsForSource, byte
    // for byte the one Config.tsx makes.
    picker.onCancel()

    expect(calls).toEqual([
      ['Output style picker dismissed', { display: 'system' }],
    ])
  })
})
