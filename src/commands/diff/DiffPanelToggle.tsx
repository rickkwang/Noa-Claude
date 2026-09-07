/**
 * Headless bridge from `/diff` to the diff sidebar.
 *
 * The toggle needs React context (app state, notifications), so the command
 * mounts this, it flips the panel on its first effect, and immediately reports
 * done — nothing is ever rendered.
 */
import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { useToggleDiffPanel } from '../../components/diff/DiffPanel.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

type Props = {
  onDone: LocalJSXCommandOnDone
}

export function DiffPanelToggle({ onDone }: Props): React.ReactNode {
  const toggle = useToggleDiffPanel()
  // `toggle`'s identity changes with the tab it just flipped, so the effect
  // would otherwise re-run and flip straight back. Latest-value ref + a
  // mount-only effect: fire exactly once, whatever re-renders happen around it.
  const latest = useRef(toggle)
  latest.current = toggle

  useEffect(() => {
    latest.current()
    onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  return null
}
