import * as React from 'react'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  // In fullscreen inside a git repo, `/diff` is a sidebar toggle. Everywhere
  // else — plain scrollback, no repo — there is no column to give a sidebar, so
  // it stays the modal dialog (which also covers per-turn diffs).
  const { diffPanelIsPreferred } = await import(
    '../../utils/diffPanelState.js'
  )
  if (diffPanelIsPreferred()) {
    const { DiffPanelToggle } = await import('./DiffPanelToggle.js')
    return <DiffPanelToggle onDone={onDone} />
  }
  const { DiffDialog } = await import('../../components/diff/DiffDialog.js')
  return <DiffDialog messages={context.messages} onDone={onDone} />
}
