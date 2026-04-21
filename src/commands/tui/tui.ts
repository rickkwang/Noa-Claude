// @ts-nocheck
import { getFullscreenMode, setFullscreenMode } from '../../utils/fullscreen.js'

type LocalCommandResult = { type: 'skip' } | { type: 'compact'; compactionResult: unknown; displayText?: string } | { value: string }

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
    return { value: 'Terminal UI mode set to: default\nRestart REPL to apply: exit and run \'noa\'' }
  }

  if (arg === 'fullscreen') {
    setFullscreenMode('fullscreen')
    return { value: 'Terminal UI mode set to: fullscreen\nRestart REPL to apply: exit and run \'noa\'' }
  }

  return { value: `Invalid mode: "${arg}". Use: /tui [default | fullscreen]` }
}