// @ts-nocheck
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  normalizeStartupBannerMode,
  STARTUP_BANNER_MODES,
  STARTUP_BANNER_SETTINGS_FILENAME,
  type StartupBannerMode,
} from '../../utils/startupBannerMode.js'

function getSettingsPath(): string {
  return join(getClaudeConfigHomeDir(), STARTUP_BANNER_SETTINGS_FILENAME)
}

function readCurrentMode(): StartupBannerMode | null {
  const path = getSettingsPath()
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return normalizeStartupBannerMode(data.mode)
  } catch {}
  return null
}

function writeMode(mode: StartupBannerMode): void {
  const dir = getClaudeConfigHomeDir()
  const path = getSettingsPath()

  // Ensure directory exists
  try {
    if (!existsSync(dir)) {
      const { mkdirSync } = require('fs')
      mkdirSync(dir, { recursive: true })
    }
  } catch {}

  writeFileSync(path, JSON.stringify({ mode }, null, 2), 'utf-8')
}

function cycleMode(current: StartupBannerMode | null): StartupBannerMode {
  if (!current) return 'claude'
  const idx = STARTUP_BANNER_MODES.indexOf(current)
  return STARTUP_BANNER_MODES[(idx + 1) % STARTUP_BANNER_MODES.length]
}

export const call = async (args: string): Promise<{ type: 'text'; value: string }> => {
  try {
    const arg = args?.trim().toLowerCase() ?? ''

    if (arg && !STARTUP_BANNER_MODES.includes(arg as StartupBannerMode)) {
      return {
        type: 'text',
        value: `Invalid mode: ${arg}\nValid modes: ${STARTUP_BANNER_MODES.join(', ')}`,
      }
    }

    const current = readCurrentMode()

    let newMode: StartupBannerMode
    if (arg && STARTUP_BANNER_MODES.includes(arg as StartupBannerMode)) {
      newMode = arg as StartupBannerMode
    } else {
      newMode = cycleMode(current)
    }

    writeMode(newMode)

    let message: string
    message =
      newMode === 'claude'
        ? 'Startup banner: Claude gradient logo'
        : 'Startup banner: Clawd official logo'

    const legacyPath = join(getOriginalCwd(), '.claude-agent', STARTUP_BANNER_SETTINGS_FILENAME)
    const globalPath = getSettingsPath()
    if (existsSync(legacyPath) && legacyPath !== globalPath) {
      message += `\nNote: legacy project override detected at ${legacyPath}. It is ignored; startup banner now uses global config at ${globalPath}.`
    }

    return { type: 'text', value: message }
  } catch (e) {
    return { type: 'text', value: `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
