// @ts-nocheck
import { validateBoundedIntEnvVar } from '../envValidation.js'
import { getInitialSettings } from '../settings/settings.js'

export const BASH_MAX_OUTPUT_UPPER_LIMIT = 150_000
export const BASH_MAX_OUTPUT_DEFAULT = 30_000
const BASH_OUTPUT_SETTING_MIN = 4_000
const BASH_OUTPUT_SETTING_MAX = 128_000

// bashOutputMaxChars from settings, clamped; undefined when unset
function getBashOutputMaxCharsSetting(): number | undefined {
  const value = getInitialSettings().bashOutputMaxChars
  if (value === undefined) return undefined
  return Math.min(
    Math.max(value, BASH_OUTPUT_SETTING_MIN),
    BASH_OUTPUT_SETTING_MAX,
  )
}

// Inline output cap: the setting wins, then BASH_MAX_OUTPUT_LENGTH
export function getMaxOutputLength(): number {
  const fromSetting = getBashOutputMaxCharsSetting()
  if (fromSetting !== undefined) return fromSetting
  const result = validateBoundedIntEnvVar(
    'BASH_MAX_OUTPUT_LENGTH',
    process.env.BASH_MAX_OUTPUT_LENGTH,
    BASH_MAX_OUTPUT_DEFAULT,
    BASH_MAX_OUTPUT_UPPER_LIMIT,
  )
  return result.effective
}

// Persistence threshold: only the setting moves it; BASH_MAX_OUTPUT_LENGTH
// sizes the inline cap alone
export function getBashPersistenceThreshold(): number {
  return getBashOutputMaxCharsSetting() ?? BASH_MAX_OUTPUT_DEFAULT
}
