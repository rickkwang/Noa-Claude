// @ts-nocheck
import { getSettingsForSource } from '../../utils/settings/settings.js'

export interface AutoFixConfig {
  enabled: boolean
  lint?: string
  test?: string
  maxRetries: number
  timeout: number
}

const DEFAULT_MAX_RETRIES = 3
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
    maxRetries: autoFix.maxRetries ?? DEFAULT_MAX_RETRIES,
    timeout: autoFix.timeout ?? DEFAULT_TIMEOUT,
  }
}
