// @ts-nocheck
import { getFullscreenMode, setFullscreenMode } from '../../utils/fullscreen.js'
import { createSignal } from '../../utils/signal.js'

type LocalCommandResult = { type: 'skip' } | { type: 'compact'; compactionResult: unknown; displayText?: string } | { value: string }

let lastExplicitTuiMode: 'default' | 'fullscreen' | undefined =
  getFullscreenMode() === 'fullscreen' ? 'fullscreen' : 'default'
let fullscreenNoticeTrigger = 0
const fullscreenNoticeChanged = createSignal()

export function getFullscreenNoticeTrigger(): number {
  return fullscreenNoticeTrigger
}

export const subscribeToFullscreenNoticeTrigger = fullscreenNoticeChanged.subscribe

export const call = (args: string): LocalCommandResult => {
  const mode = getFullscreenMode()
  const arg = args.trim().toLowerCase()

  if (!arg || arg === 'status') {
    const autoHint = ' (auto-detected based on environment and user type)'
    const envHint = mode === 'auto' ? autoHint : ` (explicit mode: ${mode})`
    return { value: `Terminal UI mode: ${mode}${envHint}` }
  }

  if (arg === 'default') {
    setFullscreenMode('default')
    lastExplicitTuiMode = 'default'
    return { value: 'Terminal UI mode set to: default (applied to current session)' }
  }

  if (arg === 'fullscreen') {
    const shouldShowHint = lastExplicitTuiMode !== 'fullscreen'
    setFullscreenMode('fullscreen')
    lastExplicitTuiMode = 'fullscreen'
    if (shouldShowHint) {
      fullscreenNoticeTrigger += 1
      fullscreenNoticeChanged.emit()
    }
    return { value: 'Terminal UI mode set to: fullscreen (applied to current session)' }
  }

  return { value: `Invalid mode: "${arg}". Use: /tui [default | fullscreen]` }
}
