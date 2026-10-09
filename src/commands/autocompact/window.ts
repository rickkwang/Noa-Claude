import { isAutoCompactEnabled, resolveAutoCompactWindow, type AutoCompactWindowSource } from '../../services/compact/autoCompact.js'
import { formatTokens } from '../../utils/format.js'
import { getEffortModelKey } from '../../utils/effort.js'
import { getMarketingNameForModel } from '../../utils/model/model.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

export const MIN_WINDOW = 100_000
export const MAX_WINDOW = 1_000_000
export const STEP = 100_000

const EXPONENT = /^[+-]?(\d+(\.\d*)?|\.\d+)[eE][+-]?\d+$/
const GROUPED = /^[+-]?\d{1,3}([_,\u00A0\u202F ])\d{3}(?:\1\d{3})*$/

/**
 * Parses a window the user typed: `auto` (or reset/unset/default), a number
 * with an optional k/m suffix, or `100`–`1000` as shorthand for thousands.
 * Returns null outside 100k–1M.
 */
export function parseWindowArg(raw: string): number | 'auto' | null {
  const s = raw.trim().toLowerCase()
  if (s === 'auto' || s === 'reset' || s === 'unset' || s === 'default') {
    return 'auto'
  }
  let n: number
  if (s.endsWith('m')) {
    n = parseFloat(s) * 1_000_000
  } else if (s.endsWith('k')) {
    n = parseFloat(s) * 1_000
  } else {
    if (EXPONENT.test(s)) n = Number(s)
    else if (GROUPED.test(s)) n = parseInt(s.replace(/[_,\u00A0\u202F ]/g, ''), 10)
    else n = parseInt(s, 10)
    if (n >= 100 && n <= 1000) n *= 1000
  }
  n = Math.round(n)
  if (!Number.isFinite(n) || n < MIN_WINDOW || n > MAX_WINDOW) return null
  return n
}

export const SOURCE_LABEL: Record<AutoCompactWindowSource, string> = {
  env: 'from CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  settings: 'from settings',
  'model-default': 'default for this model',
  'unknown-model': 'default for an unrecognized model',
  auto: 'auto',
}

/**
 * Saves the window for the model (or `auto`) and returns the message upstream
 * prints: it names the setting, and says when a higher-priority override wins.
 */
export async function applyAutoCompactWindow(
  raw: string,
  model: string,
): Promise<string> {
  if (resolveAutoCompactWindow(model).source === 'env') {
    return 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting.'
  }
  const parsed = parseWindowArg(raw)
  if (parsed === null) {
    return `Couldn't parse '${raw}'. Expected 'auto' or 100k–1M tokens (e.g. 500k, 200000, or 200 as shorthand)`
  }
  const key = getEffortModelKey(model)
  const { error } = updateSettingsForSource('userSettings', current => ({
    ...current,
    modelSettings: {
      ...current.modelSettings,
      [key]: { ...current.modelSettings?.[key], autoCompactWindow: parsed },
    },
  }))
  if (error) return `Couldn't save setting: ${error.message}`

  const after = resolveAutoCompactWindow(model)
  const name = getMarketingNameForModel(key) ?? key
  const message = `Auto-compact window for ${name}`
  const savedValue = parsed === 'auto' ? undefined : parsed
  const overridden =
    (after.source === 'settings' ? after.configured : undefined) !== savedValue
  const override = `, but a higher-priority override is active (${formatTokens(after.window)} tokens)`
  if (parsed === 'auto') {
    return overridden
      ? `${message} set to auto in settings${override}`
      : `${message} set to auto`
  }
  const capped =
    !overridden && after.window < parsed
      ? ` (capped to model limit of ${formatTokens(after.window)})`
      : ''
  return `${message} set to ${formatTokens(parsed)} tokens${overridden ? override : capped}`
}

/** The header line both the dialog and the headless status print. */
export function describeAutoCompactWindow(model: string): {
  name: string
  header: string
  unchanged: string
} {
  const resolution = resolveAutoCompactWindow(model)
  // Name from the settings key, as upstream does: the [1m] suffix is not shown.
  const key = getEffortModelKey(model)
  const name = getMarketingNameForModel(key) ?? key
  const header =
    resolution.source === 'auto'
      ? 'auto'
      : `${formatTokens(resolution.configured)} tokens (${SOURCE_LABEL[resolution.source]})` +
        (resolution.configured > resolution.window
          ? ` · capped to ${formatTokens(resolution.window)} by model`
          : '')
  return { name, header, unchanged: `Auto-compact window for ${name} unchanged: ${header}` }
}

/**
 * The non-interactive status text, as upstream's `w` builds it: a header line,
 * the disabled note, two explanations, and the override warning for env or
 * settings sources.
 */
export function describeAutoCompactWindowStatus(model: string): string {
  const resolution = resolveAutoCompactWindow(model)
  const { name, header } = describeAutoCompactWindow(model)
  const lines = [`Auto-compact window for ${name}: ${header}`]
  if (!isAutoCompactEnabled()) {
    lines.push('Auto-compact is currently disabled (see /config)')
  }
  lines.push(
    "Auto-compact summarizes the conversation when context usage approaches this limit. The actual threshold is the minimum of this setting and your model's maximum context window.",
  )
  lines.push(
    'The auto setting picks a window tuned for your model and is strongly recommended for the best cost and performance.',
  )
  if (resolution.source === 'env' || resolution.source === 'settings') {
    lines.push(
      'Overriding auto may result in high token usage, especially when resuming long sessions.',
    )
  }
  return lines.join('\n')
}
