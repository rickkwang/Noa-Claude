import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { clearFocusModePromptSection } from '../../utils/focusView.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

const NEEDS_FULLSCREEN = 'Focus view needs the fullscreen renderer. Run /tui fullscreen to switch.'

function setFocusView(context: ToolUseContext & LocalJSXCommandContext, on: boolean): void {
  saveGlobalConfig(current => (current.briefTranscript === on ? current : { ...current, briefTranscript: on }))
  context.setAppState(prev => (prev.briefTranscript === on ? prev : { ...prev, briefTranscript: on }))
  clearFocusModePromptSection()
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const arg = args.trim().toLowerCase()
  if (arg !== '' && arg !== 'on' && arg !== 'off') {
    onDone(`Unknown argument "${arg}". Use: /focus [on|off]`, { display: 'system' })
    return null
  }
  const viewMode = getInitialSettings().viewMode
  if (viewMode) {
    onDone(
      `Focus view is set by "viewMode": "${viewMode}" in settings.json — remove it there to use /focus.`,
      { display: 'system' },
    )
    return null
  }
  const isOn = context.getAppState().briefTranscript
  if (!isFullscreenEnvEnabled()) {
    if (isOn) {
      setFocusView(context, false)
      onDone(`Focus view disabled. ${NEEDS_FULLSCREEN}`, { display: 'system' })
    } else {
      onDone(NEEDS_FULLSCREEN, { display: 'system' })
    }
    return null
  }
  const next = arg === '' ? !isOn : arg === 'on'
  setFocusView(context, next)
  onDone(next ? 'Focus view enabled' : 'Focus view disabled', { display: 'system' })
  return null
}
