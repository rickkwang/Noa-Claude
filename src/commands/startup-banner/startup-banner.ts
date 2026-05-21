// @ts-nocheck
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { PRODUCT_PROJECT_DIR } from '../../utils/productPaths.js'
import { logDebugDiagnosticWarn } from '../../utils/debugDiagnostics.js'
import {
  normalizeStartupBannerMode,
  STARTUP_BANNER_MODES,
  STARTUP_BANNER_SETTINGS_FILENAME,
  type StartupBannerMode,
} from '../../utils/startupBannerMode.js'

function getSettingsPath(): string {
  return join(getClaudeConfigHomeDir(), STARTUP_BANNER_SETTINGS_FILENAME)
}

async function readCurrentMode(): Promise<StartupBannerMode | null> {
  const path = getSettingsPath()
  try {
    const data = JSON.parse(await readFile(path, 'utf-8'))
    return normalizeStartupBannerMode(data.mode)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    logDebugDiagnosticWarn(
      'startup-banner-command',
      'failed to parse startup banner settings',
      error,
    )
  }
  return null
}

async function writeMode(mode: StartupBannerMode): Promise<void> {
  const dir = getClaudeConfigHomeDir()
  const path = getSettingsPath()
  await mkdir(dir, { recursive: true })
  await writeFile(path, JSON.stringify({ mode }, null, 2), 'utf-8')
}

function cycleMode(current: StartupBannerMode | null): StartupBannerMode {
  if (!current) return 'claude'
  const idx = STARTUP_BANNER_MODES.indexOf(current)
  return STARTUP_BANNER_MODES[(idx + 1) % STARTUP_BANNER_MODES.length]
}

export const call = async (args: string, context?: { setAppState?: (updater: (prev: any) => any) => void }): Promise<{ type: 'text'; value: string }> => {
  try {
    const arg = args?.trim().toLowerCase() ?? ''

    if (arg && !STARTUP_BANNER_MODES.includes(arg as StartupBannerMode)) {
      return {
        type: 'text',
        value: `Invalid mode: ${arg}\nValid modes: ${STARTUP_BANNER_MODES.join(', ')}`,
      }
    }

    const current = await readCurrentMode()

    let newMode: StartupBannerMode
    if (arg && STARTUP_BANNER_MODES.includes(arg as StartupBannerMode)) {
      newMode = arg as StartupBannerMode
    } else {
      newMode = cycleMode(current)
    }

    await writeMode(newMode)
    context?.setAppState?.(prev => ({
      ...prev,
      authVersion: prev.authVersion + 1,
    }))

    let message: string
    message =
      newMode === 'claude'
        ? 'Startup banner: Noa gradient logo'
        : 'Startup banner: Noa logo'

    const projectPath = join(getOriginalCwd(), PRODUCT_PROJECT_DIR, STARTUP_BANNER_SETTINGS_FILENAME)
    const globalPath = getSettingsPath()
    if (existsSync(projectPath) && projectPath !== globalPath) {
      message += `\nNote: project override detected at ${projectPath}. It is ignored; startup banner now uses global config at ${globalPath}.`
    }

    return { type: 'text', value: message }
  } catch (e) {
    return { type: 'text', value: `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
