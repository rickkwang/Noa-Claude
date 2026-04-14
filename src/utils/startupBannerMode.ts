export type StartupBannerMode = 'claude' | 'clawd'

export const STARTUP_BANNER_SETTINGS_FILENAME = 'startup-banner.json'
export const STARTUP_BANNER_MODES: StartupBannerMode[] = ['claude', 'clawd']

export function normalizeStartupBannerMode(mode: unknown): StartupBannerMode | null {
  if (mode === 'claude' || mode === 'clawd') return mode
  if (mode === 'openclaude' || mode === 'both') return 'claude'
  if (mode === 'official') return 'clawd'
  return null
}
