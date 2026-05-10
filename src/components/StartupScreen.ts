/**
 * Startup banner mode resolver.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { logDebugDiagnosticWarn } from '../utils/debugDiagnostics.js'
import {
  normalizeStartupBannerMode,
  STARTUP_BANNER_SETTINGS_FILENAME,
} from '../utils/startupBannerMode.js'

export function getStartupBannerMode(): string | null {
  // Env var takes precedence
  if (process.env.STARTUP_BANNER) {
    const envMode = normalizeStartupBannerMode(process.env.STARTUP_BANNER)
    if (envMode) return envMode
  }
  // Read startup banner mode from the global config file.
  try {
    const settingsPath = join(getClaudeConfigHomeDir(), STARTUP_BANNER_SETTINGS_FILENAME)
    if (existsSync(settingsPath)) {
      const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      return normalizeStartupBannerMode(data.mode)
    }
  } catch (error) {
    logDebugDiagnosticWarn(
      'startup-banner',
      'failed to read startup banner settings',
      error,
    )
  }
  return null
}
