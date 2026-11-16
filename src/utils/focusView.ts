import { getIsNonInteractiveSession, getSystemPromptSectionCache } from '../bootstrap/state.js'
import { getGlobalConfig } from './config.js'
import { getInitialSettings, getSettingsForSource } from './settings/settings.js'

/**
 * Focus view: the transcript shows each turn as the prompt, one summary row
 * for the work in between, and the final response. A `viewMode` setting wins
 * over the `/focus` toggle stored in global config.
 */
export function isFocusViewOn(): boolean {
  const viewMode = getInitialSettings().viewMode
  return viewMode ? viewMode === 'focus' : (getGlobalConfig().briefTranscript ?? false)
}

/** Whether the system prompt tells the model the user only sees final messages. */
export function isFocusModePromptOn(): boolean {
  if (getIsNonInteractiveSession()) {
    return getSettingsForSource('flagSettings')?.viewMode === 'focus'
  }
  return isFocusViewOn()
}

/** Drop the memoized focus section so the next request re-reads the toggle. */
export function clearFocusModePromptSection(): void {
  const cache = getSystemPromptSectionCache()
  cache.delete('focus_mode')
  cache.delete('focus_mode:L')
}
