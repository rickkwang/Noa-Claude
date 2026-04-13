// @ts-nocheck
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'

type StartupBannerMode = 'openclaude' | 'official' | 'both'

const VALID_MODES: StartupBannerMode[] = ['openclaude', 'official', 'both']
const SETTINGS_FILENAME = 'startup-banner.json'

function getSettingsPath(): string {
  return join(getOriginalCwd(), '.claude-agent', SETTINGS_FILENAME)
}

function readCurrentMode(): StartupBannerMode | null {
  const path = getSettingsPath()
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (VALID_MODES.includes(data.mode)) {
      return data.mode
    }
  } catch {}
  return null
}

function writeMode(mode: StartupBannerMode): void {
  const dir = join(getOriginalCwd(), '.claude-agent')
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
  if (!current) return 'openclaude'
  const idx = VALID_MODES.indexOf(current)
  return VALID_MODES[(idx + 1) % VALID_MODES.length]
}

export const call = async (args: string): Promise<{ type: 'text'; value: string }> => {
  try {
    const arg = args?.trim().toLowerCase() ?? ''

    if (arg && !VALID_MODES.includes(arg as StartupBannerMode)) {
      return {
        type: 'text',
        value: `Invalid mode: ${arg}\nValid modes: ${VALID_MODES.join(', ')}`,
      }
    }

    const current = readCurrentMode()

    let newMode: StartupBannerMode
    if (arg && VALID_MODES.includes(arg as StartupBannerMode)) {
      newMode = arg as StartupBannerMode
    } else {
      newMode = cycleMode(current)
    }

    writeMode(newMode)

    let message: string
    if (newMode === 'openclaude') {
      message = 'Startup banner: OpenClaude gradient logo (shown before WelcomeV2)'
    } else if (newMode === 'both') {
      message = 'Startup banner: Both OpenClaude logo and WelcomeV2 will be shown'
    } else {
      message = 'Startup banner: Official WelcomeV2 only (no gradient logo)'
    }

    return { type: 'text', value: message }
  } catch (e) {
    return { type: 'text', value: `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
