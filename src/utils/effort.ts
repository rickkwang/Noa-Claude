// @ts-nocheck
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialSettings } from './settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './model/providers.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { getCanonicalName } from './model/model.js'
import {
  getAntModelOverrideConfig,
  resolveAntModel,
} from './model/antModels.js'
import { isEnvTruthy } from './envUtils.js'
import type { EffortLevel } from 'src/entrypoints/sdk/runtimeTypes.js'

export type { EffortLevel }

export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly EffortLevel[]

export type EffortValue = EffortLevel | number

const BASE_EFFORT_LEVELS = ['low', 'medium', 'high'] as const
const EFFORT_LEVEL_RANK: Record<EffortLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports the effort parameter.
export function modelSupportsEffort(model: string): boolean {
  return getSupportedEffortLevelsForModel(model).length > 0
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports 'max' effort.
// Per API docs, 'max' is Opus 4.6+ for public models — other models return an error.
export function modelSupportsMaxEffort(model: string): boolean {
  return getSupportedEffortLevelsForModel(model).includes('max')
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports 'xhigh' effort.
// Per API docs, 'xhigh' is Opus 4.7+ only — earlier models return an error.
export function modelSupportsXhighEffort(model: string): boolean {
  return getSupportedEffortLevelsForModel(model).includes('xhigh')
}

export function getSupportedEffortLevelsForModel(
  model: string,
): EffortLevel[] {
  if (isEnvTruthy(process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT)) {
    return [...EFFORT_LEVELS]
  }

  if (process.env.USER_TYPE === 'ant' && resolveAntModel(model)) {
    return [...EFFORT_LEVELS]
  }

  const thirdPartyLevels = getThirdPartyEffortLevels(model)
  if (thirdPartyLevels !== undefined) {
    return thirdPartyLevels
  }

  const provider = getAPIProvider()
  const directFirstParty =
    provider === 'firstParty' && isFirstPartyAnthropicBaseUrl()
  if (!directFirstParty && provider !== 'foundry') {
    return []
  }

  const canonical = getCanonicalName(model).toLowerCase()
  const raw = model.toLowerCase()
  const modelKey = `${canonical} ${raw}`

  if (modelKey.includes('mythos')) {
    return ['low', 'medium', 'high', 'max']
  }
  if (modelKey.includes('opus-4-7')) {
    return ['low', 'medium', 'high', 'xhigh', 'max']
  }
  if (
    modelKey.includes('opus-4-6') ||
    modelKey.includes('sonnet-4-6')
  ) {
    return ['low', 'medium', 'high', 'max']
  }
  if (modelKey.includes('opus-4-5')) {
    return ['low', 'medium', 'high']
  }
  return []
}

function getThirdPartyEffortLevels(model: string): EffortLevel[] | undefined {
  const supportsEffort = get3PModelCapabilityOverride(model, 'effort')
  const supportsMax = get3PModelCapabilityOverride(model, 'max_effort')
  const supportsXhigh = get3PModelCapabilityOverride(model, 'xhigh_effort')

  if (
    supportsEffort === undefined &&
    supportsMax === undefined &&
    supportsXhigh === undefined
  ) {
    return undefined
  }

  if (!supportsEffort && !supportsMax && !supportsXhigh) {
    return []
  }

  const levels: EffortLevel[] = [...BASE_EFFORT_LEVELS]
  if (supportsXhigh) levels.push('xhigh')
  if (supportsMax) levels.push('max')
  return levels
}

function clampEffortToSupportedLevels(
  requested: EffortLevel,
  supportedLevels: EffortLevel[],
): EffortLevel | undefined {
  if (supportedLevels.includes(requested)) {
    return requested
  }
  const requestedRank = EFFORT_LEVEL_RANK[requested]
  return [...supportedLevels]
    .sort((a, b) => EFFORT_LEVEL_RANK[b] - EFFORT_LEVEL_RANK[a])
    .find(level => EFFORT_LEVEL_RANK[level] <= requestedRank)
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (
    process.env.USER_TYPE === 'ant' &&
    typeof value === 'number' &&
    isValidNumericEffort(value)
  ) {
    return value
  }
  const str = String(value).toLowerCase()
  if (isEffortLevel(str)) {
    return str
  }
  const numericValue = Number(str)
  if (
    process.env.USER_TYPE === 'ant' &&
    !isNaN(numericValue) &&
    isValidNumericEffort(numericValue)
  ) {
    return numericValue
  }
  return undefined
}

export function getEffortValueOptionsDescription(): string {
  const levels = EFFORT_LEVELS.join(', ')
  return process.env.USER_TYPE === 'ant' ? `${levels} or an integer` : levels
}

/**
 * Numeric values are model-default only and not persisted.
 * 'max' is session-scoped for external users (ants can persist it).
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }
  if (value === 'max' && process.env.USER_TYPE === 'ant') {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel | undefined {
  // toPersistableEffort filters 'max' for non-ants on read, so a manually
  // edited settings.json doesn't leak session-scoped max into a fresh session.
  return toPersistableEffort(getInitialSettings().effortLevel)
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in ModelPicker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortValue | null | undefined {
  const envOverride = process.env.CLAUDE_CODE_EFFORT_LEVEL
  return envOverride?.toLowerCase() === 'unset' ||
    envOverride?.toLowerCase() === 'auto'
    ? null
    : parseEffortValue(envOverride)
}

/**
 * Resolve the effort value that will actually be sent to the API for a given
 * model, following the full precedence chain:
 *   env CLAUDE_CODE_EFFORT_LEVEL → appState.effortValue → model default
 *
 * Returns undefined when no effort parameter should be sent (env set to
 * 'unset', or no default exists for the model).
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
): EffortValue | undefined {
  const envOverride = getEffortEnvOverride()
  if (envOverride === null) {
    return undefined
  }
  const resolved =
    envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model)
  const supportedLevels = getSupportedEffortLevelsForModel(model)
  if (supportedLevels.length === 0) {
    return undefined
  }
  if (typeof resolved === 'string') {
    return clampEffortToSupportedLevels(resolved, supportedLevels)
  }
  return process.env.USER_TYPE === 'ant' ? resolved : undefined
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort
 * with the 'high' fallback (what the API uses when no effort param is sent).
 * Single source of truth for the status bar and /effort output (CC-1088).
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 * Returns empty string if the user hasn't explicitly set an effort value.
 * Delegates to resolveAppliedEffort() so the displayed level matches what
 * the API actually receives (including max→high clamp for non-Opus models).
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
): string {
  if (effortValue === undefined) return ''
  const resolved = resolveAppliedEffort(model, effortValue)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'max'
  }
  return 'high'
}

/**
 * Get user-facing description for effort levels
 *
 * @param level The effort level to describe
 * @returns Human-readable description
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      return 'Extended capability for long-horizon agentic work (Opus 4.7+)'
    case 'max':
      return 'Maximum capability with deepest reasoning (Opus 4.6+)'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 *
 * @param value The effort value to describe
 * @returns Human-readable description
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export type OpusDefaultEffortConfig = {
  enabled: boolean
  dialogTitle: string
  dialogDescription: string
}

const OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT: OpusDefaultEffortConfig = {
  enabled: true,
  dialogTitle: 'Choose the default effort for Opus',
  dialogDescription:
    'Effort determines how long Claude thinks for when completing your task. Opus 4.7 defaults to xhigh effort. You can raise it when you want stronger reasoning or lower it when you want faster responses or lower usage.',
}

export function getOpusDefaultEffortConfig(): OpusDefaultEffortConfig {
  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_grey_step2',
    OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
  )
  return {
    ...OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
    ...config,
  }
}

// @[MODEL LAUNCH]: Update the default effort levels for new models
export function getDefaultEffortForModel(
  model: string,
): EffortValue | undefined {
  if (process.env.USER_TYPE === 'ant') {
    const config = getAntModelOverrideConfig()
    const isDefaultModel =
      config?.defaultModel !== undefined &&
      model.toLowerCase() === config.defaultModel.toLowerCase()
    if (isDefaultModel && config?.defaultModelEffortLevel) {
      return config.defaultModelEffortLevel
    }
    const antModel = resolveAntModel(model)
    if (antModel) {
      if (antModel.defaultEffortLevel) {
        return antModel.defaultEffortLevel
      }
      if (antModel.defaultEffortValue !== undefined) {
        return antModel.defaultEffortValue
      }
    }
    // Always default ants to undefined/high
    return undefined
  }

  // IMPORTANT: Do not change the default effort level without notifying
  // the model launch DRI and research. Default effort is a sensitive setting
  // that can greatly affect model quality and bashing.

  // External Opus 4.7 defaults to xhigh. We still gate on providers known to
  // support effort so unknown 3P proxies keep the legacy "unset/high" path.
  const modelKey = `${getCanonicalName(model)} ${model}`.toLowerCase()
  if (modelKey.includes('opus-4-7') && getSupportedEffortLevelsForModel(model).includes('xhigh')) {
    return 'xhigh'
  }

  // Fallback to undefined, which means we don't set an effort level. This
  // should resolve to high effort level in the API.
  return undefined
}
