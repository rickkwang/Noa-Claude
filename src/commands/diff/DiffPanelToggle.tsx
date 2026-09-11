/**
 * Headless bridge from `/diff` to the diff sidebar.
 *
 * The toggle needs React context (app state, terminal size), so the command
 * mounts this, it flips the panel on its first effect, and immediately reports
 * done — nothing is ever rendered, and a successful toggle leaves no transcript
 * entry.
 */
import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { useSetReplTab } from '../../components/diff/DiffPanel.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  diffPanelOpenBlocker,
  type ReplTab,
  toggleReplTab,
} from '../../utils/diffPanelState.js'

type Props = {
  onDone: LocalJSXCommandOnDone
}

const selectReplTab = (state: AppState): ReplTab => state.replTab

export function DiffPanelToggle({ onDone }: Props): React.ReactNode {
  const replTab = useAppState(selectReplTab) as ReplTab
  const setReplTab = useSetReplTab()
  const { columns } = useTerminalSize()
  // The flip changes `replTab`, which re-renders this before the command
  // unmounts it; the guard keeps that render from flipping straight back.
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    const blocker = replTab === 'diff' ? null : diffPanelOpenBlocker(columns)
    if (blocker !== null) {
      onDone(blocker, { display: 'system' })
      return
    }
    toggleReplTab(replTab, setReplTab)
    onDone(undefined, { display: 'skip' })
  }, [replTab, columns, setReplTab, onDone])

  return null
}
