// @ts-nocheck
import { getSettingsForSource } from '../../utils/settings/settings.js'

export interface AutoFixConfig {
  enabled: boolean
  lint?: string
  test?: string
  timeout: number
}

const DEFAULT_TIMEOUT = 30000

export function getAutoFixConfig(): AutoFixConfig | null {
  const settings = getSettingsForSource('userSettings')
  const autoFix = settings?.autoFix

  if (!autoFix || !autoFix.enabled) {
    return null
  }

  return {
    enabled: true,
    lint: autoFix.lint,
    test: autoFix.test,
    timeout: autoFix.timeout ?? DEFAULT_TIMEOUT,
  }
}
