// @ts-nocheck
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Ensure that any model codenames introduced here are also added to
 * scripts/excluded-strings.txt to avoid leaking them. Wrap any codename string
 * literals with process.env.USER_TYPE === 'ant' for Bun to remove the codenames
 * during dead code elimination
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import {
  getSubscriptionType,
  isClaudeAISubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import {
  has1mContext,
  is1mContextDisabled,
  modelSupports1M,
} from '../context.js'
import { isEnvTruthy } from '../envUtils.js'
import { getModelStrings, resolveOverriddenModel } from './modelStrings.js'
import { formatModelPricing, getOpusCostTierForModel } from '../modelCost.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getAPIProvider, isDirectFirstParty } from './providers.js'
import { LIGHTNING_BOLT } from '../../constants/figures.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias, isModelAlias } from './aliases.js'
import { capitalize } from '../stringUtils.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || getDefaultHaikuModel()
}

export function isNonCustomOpusModel(model: ModelName): boolean {
  return (
    model === getModelStrings().opus40 ||
    model === getModelStrings().opus41 ||
    model === getModelStrings().opus45 ||
    model === getModelStrings().opus46 ||
    model === getModelStrings().opus47 ||
    model === getModelStrings().opus48 ||
    model === getModelStrings().opus5
  )
}

/**
 * Whether ANTHROPIC_MODEL is the value an active provider profile persisted,
 * rather than one the caller exported. applyActiveProviderProfileEnv writes
 * both process.env and userSettings.env from the same profile, so a match on
 * that persisted copy identifies it.
 */
function isProviderProfileEnvModel(envModel: string | undefined): boolean {
  if (!envModel) return false
  return getSettingsForSource('userSettings')?.env?.ANTHROPIC_MODEL === envModel
}

/**
 * Helper to get the model from /model (including via /config), the --model flag, environment variable,
 * or the saved settings. The returned value can be a model alias if that's what the user specified.
 * Undefined if the user didn't configure anything, in which case we fall back to
 * the default (null).
 *
 * Priority order within this function:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. ANTHROPIC_MODEL environment variable
 * 4. Settings (from user's saved settings)
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined && modelOverride !== null) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    const envModel = process.env.ANTHROPIC_MODEL
    // A provider profile writes its default model into ANTHROPIC_MODEL, which
    // would then outrank the model the user actually picked in /model on every
    // subsequent launch. That value is ours, not the operator's, so let the
    // saved choice win over it — an ANTHROPIC_MODEL the caller set themselves
    // still takes precedence.
    specifiedModel = isProviderProfileEnvModel(envModel)
      ? settings.model || envModel
      : envModel || settings.model || undefined
  }

  // Ignore the user-specified model if it's not in the availableModels allowlist.
  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}

/**
 * Get the main loop model to use for the current session.
 *
 * Model Selection Priority Order:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. ANTHROPIC_MODEL environment variable
 * 4. Settings (from user's saved settings)
 * 5. Built-in default
 *
 * @returns The resolved model name to use
 */
export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getBestModel(): ModelName {
  return getDefaultOpusModel()
}

/**
 * Why Bedrock/Vertex/Foundry get a generation-behind default.
 *
 * Not because those backends necessarily lag on availability — for Bedrock and
 * Vertex they no longer do, and upstream's alias table defaults both to the
 * current Opus generation. The reason is that Noa cannot recover when a default
 * turns out not to be enabled on the caller's account:
 *
 *   - no 400 classifier that strips an unsupported field and retries
 *   - no per-model third-party fallback chain; `fallbackModel` is whatever the
 *     user passed to --fallback-model and nothing else
 *   - releases far less often than upstream, which rebuilds against each
 *     backend's current GA state
 *
 * Per-provider availability is the fastest-moving fact in the model tables, so
 * a snapshot of it goes stale in one direction or the other. Stale-conservative
 * costs a generation of quality silently; stale-aggressive fails the first
 * request of every session. Without the recovery machinery above, the second is
 * the worse trade, so this branch deliberately trails.
 *
 * Both directions are one env var away from being overridden —
 * ANTHROPIC_DEFAULT_OPUS_MODEL / _SONNET_MODEL are checked first — and that is
 * the intended escape hatch for anyone whose account is ahead of this default.
 *
 * Known open question: Foundry is the one backend where this branch is *ahead*
 * of upstream, which defaults Foundry's opus alias to Opus 4.6. If that
 * reflects a real availability ceiling, Foundry sessions fail on the first
 * request rather than merely running a generation behind. Unverified — needs a
 * live Foundry endpoint to settle.
 */
// @[MODEL LAUNCH]: Update the default Opus model. Read the block above before
// touching the third-party branch.
export function getDefaultOpusModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  }
  if (getAPIProvider() !== 'firstParty') {
    return getModelStrings().opus48 || 'claude-opus-4-8'
  }
  return getModelStrings().opus5 || 'claude-opus-5'
}

// @[MODEL LAUNCH]: Update the default Fable model.
// Fable 5 is the top tier (above Opus). It is not anyone's default; this only
// resolves the explicit `fable` alias, so there is no third-party branch to
// trail: asking for `fable` by name is already an explicit choice.
export function getDefaultFableModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_FABLE_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_FABLE_MODEL
  }
  return getModelStrings().fable5 || 'claude-fable-5'
}

// @[MODEL LAUNCH]: Update the default Sonnet model. The third-party branch
// trails for the reasons given above getDefaultOpusModel.
export function getDefaultSonnetModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  }
  if (getAPIProvider() !== 'firstParty') {
    return getModelStrings().sonnet46 || 'claude-sonnet-4-6'
  }
  return getModelStrings().sonnet5 || 'claude-sonnet-5'
}

// @[MODEL LAUNCH]: Update the default Haiku model.
export function getDefaultHaikuModel(): ModelName {
  if (process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  }

  // Haiku 4.5 is available on all platforms (first-party, Foundry, Bedrock, Vertex)
  return getModelStrings().haiku45 || 'claude-haiku-4-5'
}

/**
 * Get the model to use for runtime, depending on the runtime context.
 * @param params Subset of the runtime context to determine the model to use.
 * @returns The model to use
 */
export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  const { permissionMode, mainLoopModel, exceeds200kTokens = false } = params

  // opusplan uses Opus in plan mode without [1m] suffix.
  if (
    getUserSpecifiedModelSetting() === 'opusplan' &&
    permissionMode === 'plan' &&
    !exceeds200kTokens
  ) {
    return getDefaultOpusModel()
  }

  // sonnetplan by default
  if (getUserSpecifiedModelSetting() === 'haiku' && permissionMode === 'plan') {
    return getDefaultSonnetModel()
  }

  return mainLoopModel
}

/**
 * Get the default main loop model setting.
 *
 * This handles the built-in default:
 * - Opus for Max and Team Premium users
 * - Sonnet 4.6 for all other users (including Team Standard, Pro, Enterprise)
 *
 * @returns The default model setting to use
 */
export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  // Ants default to defaultModel from flag config, or Opus 1M if not configured
  if (process.env.USER_TYPE === 'ant') {
    return (
      getAntModelOverrideConfig()?.defaultModel ??
      getDefaultOpusModel() + '[1m]'
    )
  }

  // Max users get Opus as default
  if (isMaxSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  // Team Premium gets Opus (same as Max)
  if (isTeamPremiumSubscriber()) {
    return getDefaultOpusModel() + (isOpus1mMergeEnabled() ? '[1m]' : '')
  }

  // PAYG (1P and 3P), Enterprise, Team Standard, and Pro get Sonnet as default
  // Note that PAYG (3P) may default to an older Sonnet model
  return getDefaultSonnetModel()
}

/**
 * Synchronous operation to get the default main loop model to use
 * (bypassing any user-specified values).
 */
export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

// @[MODEL LAUNCH]: Add a canonical name mapping for the new model below.
/**
 * Pure string-match that strips date/provider suffixes from a first-party model
 * name. Input must already be a 1P-format ID (e.g. 'claude-3-7-sonnet-20250219',
 * 'us.anthropic.claude-opus-4-6-v1:0'). Does not touch settings, so safe at
 * module top-level (see MODEL_COSTS in modelCost.ts).
 */
export function firstPartyNameToCanonical(name: ModelName | undefined): ModelShortName {
  if (!name) {
    return '' as ModelShortName
  }
  name = name.toLowerCase()
  // Special cases for Claude 4+ models to differentiate versions
  // Order matters: check more specific versions first (4-5 before 4)
  if (name.includes('claude-opus-5')) {
    return 'claude-opus-5'
  }
  if (name.includes('claude-opus-4-8')) {
    return 'claude-opus-4-8'
  }
  if (name.includes('claude-opus-4-7')) {
    return 'claude-opus-4-7'
  }
  if (name.includes('claude-opus-4-6')) {
    return 'claude-opus-4-6'
  }
  if (name.includes('claude-opus-4-5')) {
    return 'claude-opus-4-5'
  }
  if (name.includes('claude-opus-4-1')) {
    return 'claude-opus-4-1'
  }
  if (name.includes('claude-opus-4')) {
    return 'claude-opus-4-0'
  }
  if (name.includes('claude-fable-5')) {
    return 'claude-fable-5'
  }
  if (name.includes('claude-mythos-5')) {
    return 'claude-mythos-5'
  }
  if (name.includes('claude-sonnet-5')) {
    return 'claude-sonnet-5'
  }
  if (name.includes('claude-sonnet-4-6')) {
    return 'claude-sonnet-4-6'
  }
  if (name.includes('claude-sonnet-4-5')) {
    return 'claude-sonnet-4-5'
  }
  if (name.includes('claude-sonnet-4')) {
    return 'claude-sonnet-4'
  }
  if (name.includes('claude-haiku-4-5')) {
    return 'claude-haiku-4-5'
  }
  // Claude 3.x models use a different naming scheme (claude-3-{family})
  if (name.includes('claude-3-7-sonnet')) {
    return 'claude-3-7-sonnet'
  }
  if (name.includes('claude-3-5-sonnet')) {
    return 'claude-3-5-sonnet'
  }
  if (name.includes('claude-3-5-haiku')) {
    return 'claude-3-5-haiku'
  }
  if (name.includes('claude-3-opus')) {
    return 'claude-3-opus'
  }
  if (name.includes('claude-3-sonnet')) {
    return 'claude-3-sonnet'
  }
  if (name.includes('claude-3-haiku')) {
    return 'claude-3-haiku'
  }
  const match = name.match(/(claude-(\d+-\d+-)?\w+)/)
  if (match && match[1]) {
    return match[1]
  }
  // Fall back to the original name if no pattern matches
  return name
}

/**
 * Maps a full model string to a shorter canonical version that's unified across 1P and 3P providers.
 * For example, 'claude-3-5-haiku-20241022' and 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
 * would both be mapped to 'claude-3-5-haiku'.
 * @param fullModelName The full model name (e.g., 'claude-3-5-haiku-20241022')
 * @returns The short name (e.g., 'claude-3-5-haiku') if found, or the original name if no mapping exists
 */
export function getCanonicalName(fullModelName: ModelName | undefined): ModelShortName {
  if (!fullModelName) {
    return '' as ModelShortName
  }
  // Resolve overridden model IDs (e.g. Bedrock ARNs) back to canonical names.
  // resolved is always a 1P-format ID, so firstPartyNameToCanonical can handle it.
  return firstPartyNameToCanonical(resolveOverriddenModel(fullModelName))
}

// @[MODEL LAUNCH]: Update the default model description strings shown to users.
export function getClaudeAiUserDefaultModelDescription(
  fastMode = false,
): string {
  if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
    if (isOpus1mMergeEnabled()) {
      return `Opus with 1M context · Best for everyday, complex tasks${fastMode ? getOpus46PricingSuffix(true, getDefaultOpusModel()) : ''}`
    }
    return `Opus · Best for everyday, complex tasks${fastMode ? getOpus46PricingSuffix(true, getDefaultOpusModel()) : ''}`
  }
  const sonnetName = getMarketingNameForModel(getDefaultSonnetModel()) ?? 'Sonnet'
  return `${sonnetName} · Efficient for routine tasks`
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias | undefined | null,
): string {
  if (!setting) {
    return renderModelName(getDefaultMainLoopModel())
  }
  if (setting === 'opusplan') {
    return 'Opus in plan mode, else Sonnet'
  }
  return renderModelName(parseUserSpecifiedModel(setting))
}

/**
 * Price suffix for an Opus picker row. `model` selects the fast-mode tier —
 * Opus 5 charges $10/$50 in fast mode where Opus 4.6/4.7 charged $30/$150 —
 * and defaults to whichever Opus the `opus` alias currently resolves to.
 */
export function getOpus46PricingSuffix(
  fastMode: boolean,
  model: ModelName = getDefaultOpusModel(),
): string {
  if (getAPIProvider() !== 'firstParty') return ''
  // Subscribers draw from plan usage, not per-Mtok API pricing. Upstream shows
  // them a usage multiplier instead (see getProUsageMultiplierSuffix); the
  // fast-mode indicator still applies since that is a mode, not a price.
  // isClaudeAISubscriber() throws without credentials — an indeterminate answer
  // falls through to the PAYG rendering rather than breaking the picker.
  try {
    if (isClaudeAISubscriber() && !fastMode) return ''
  } catch {
    // treat as non-subscriber
  }
  const pricing = formatModelPricing(getOpusCostTierForModel(model, fastMode))
  const fastModeIndicator = fastMode ? ` (${LIGHTNING_BOLT})` : ''
  return ` ·${fastModeIndicator} ${pricing}`
}

export function isOpus1mMergeEnabled(): boolean {
  if (is1mContextDisabled() || getAPIProvider() !== 'firstParty') {
    return false
  }
  // These auth lookups throw when no credentials are configured at all. Fail
  // closed: an account we cannot classify does not get `opus[1m]` pinned.
  try {
    // Pro is excluded upstream: the merge exists to fold a paid 1M upgrade into
    // the default Opus entry for plans that have one. Enabling it for Pro pins
    // `opus[1m]` into settings, which then renders as "Opus 4.8 (1M context)"
    // everywhere even though Opus 4.8 is natively 1M and the suffix is a no-op.
    if (getSubscriptionType() === 'pro') {
      return false
    }
    // Fail closed when a subscriber's subscription type is unknown. The VS Code
    // config-loading subprocess can have OAuth tokens with valid scopes but no
    // subscriptionType field (stale or partial refresh). Without this guard we'd
    // append opus[1m] for a user whose entitlement we can't confirm — the API
    // then rejects it with a misleading "rate limit reached" error.
    if (isClaudeAISubscriber() && getSubscriptionType() === null) {
      return false
    }
  } catch {
    return false
  }
  return true
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Opus Plan'
  }
  // Resolve aliases (e.g. 'opus' → 'claude-opus-4-7') before rendering so the
  // logo and other display surfaces show the actual version, not just "Opus".
  return renderModelName(parseUserSpecifiedModel(setting))
}

// @[MODEL LAUNCH]: Add display name cases for the new model (base + [1m] variant if applicable).
/**
 * Returns a human-readable display name for known public models, or null
 * if the model is not recognized as a public model.
 */
export function getPublicModelDisplayName(model: ModelName): string | null {
  switch (model) {
    case getModelStrings().fable5:
      return 'Fable 5'
    case getModelStrings().fable5 + '[1m]':
      return 'Fable 5 (1M context)'
    case getModelStrings().opus5:
      return 'Opus 5'
    case getModelStrings().opus5 + '[1m]':
      return 'Opus 5 (1M context)'
    case getModelStrings().opus48:
      return 'Opus 4.8'
    case getModelStrings().opus48 + '[1m]':
      return 'Opus 4.8 (1M context)'
    case getModelStrings().opus47:
      return 'Opus 4.7'
    case getModelStrings().opus47 + '[1m]':
      return 'Opus 4.7 (1M context)'
    case getModelStrings().opus46:
      return 'Opus 4.6'
    case getModelStrings().opus46 + '[1m]':
      return 'Opus 4.6 (1M context)'
    case getModelStrings().opus45:
      return 'Opus 4.5'
    case getModelStrings().opus41:
      return 'Opus 4.1'
    case getModelStrings().opus40:
      return 'Opus 4'
    case getModelStrings().sonnet5 + '[1m]':
      return 'Sonnet 5 (1M context)'
    case getModelStrings().sonnet5:
      return 'Sonnet 5'
    case getModelStrings().sonnet46 + '[1m]':
      return 'Sonnet 4.6 (1M context)'
    case getModelStrings().sonnet46:
      return 'Sonnet 4.6'
    case getModelStrings().sonnet45 + '[1m]':
      return 'Sonnet 4.5 (1M context)'
    case getModelStrings().sonnet45:
      return 'Sonnet 4.5'
    case getModelStrings().sonnet40:
      return 'Sonnet 4'
    case getModelStrings().sonnet40 + '[1m]':
      return 'Sonnet 4 (1M context)'
    case getModelStrings().sonnet37:
      return 'Sonnet 3.7'
    case getModelStrings().sonnet35:
      return 'Sonnet 3.5'
    case getModelStrings().haiku45:
      return 'Haiku 4.5'
    case getModelStrings().haiku35:
      return 'Haiku 3.5'
    default:
      return null
  }
}

function maskModelCodename(baseName: string): string {
  // Mask only the first dash-separated segment (the codename), preserve the rest
  // e.g. capybara-v2-fast → cap*****-v2-fast
  const [codename = '', ...rest] = baseName.split('-')
  const masked =
    codename.slice(0, 3) + '*'.repeat(Math.max(0, codename.length - 3))
  return [masked, ...rest].join('-')
}

export function renderModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName
  }
  if (process.env.USER_TYPE === 'ant') {
    const resolved = parseUserSpecifiedModel(model)
    const antModel = resolveAntModel(model)
    if (antModel) {
      const baseName = antModel.model.replace(/\[1m\]$/i, '')
      const masked = maskModelCodename(baseName)
      const suffix = has1mContext(resolved) ? '[1m]' : ''
      return masked + suffix
    }
    if (resolved !== model) {
      return `${model} (${resolved})`
    }
    return resolved
  }
  return model
}

/**
 * Returns a safe author name for public display (e.g., in git commit trailers).
 * Returns "Claude {ModelName}" for publicly known models, or "Claude ({model})"
 * for unknown/internal models so the exact model name is preserved.
 *
 * @param model The full model name
 * @returns "Claude {ModelName}" for public models, or "Claude ({model})" for non-public models
 */
export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return `Claude ${publicName}`
  }
  return `Claude (${model})`
}

/**
 * Returns a full model name for use in this session, possibly after resolving
 * a model alias.
 *
 * This function intentionally does not support version numbers to align with
 * the model switcher.
 *
 * Supports [1m] suffix on any model alias (e.g., haiku[1m], sonnet[1m]) to enable
 * 1M context window without requiring each variant to be in MODEL_ALIASES.
 *
 * @param modelInput The model alias or name provided by the user.
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias | undefined | null,
): ModelName {
  if (typeof modelInput !== 'string') {
    return getDefaultSonnetModel()
  }
  const modelInputTrimmed = modelInput.trim()
  if (!modelInputTrimmed) {
    return getDefaultSonnetModel()
  }
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = has1mContext(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  if (isModelAlias(modelString)) {
    switch (modelString) {
      case 'opusplan':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '') // Sonnet is default, Opus in plan mode
      case 'sonnet':
        return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
      case 'haiku':
        return getDefaultHaikuModel() + (has1mTag ? '[1m]' : '')
      case 'opus':
        return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
      case 'fable': {
        // Fable carries no `supports_1m_suffix` upstream, and the suffix is a
        // no-op on a natively-1M model, so it is normalised away on direct
        // first-party rather than being echoed back in every display name.
        return (
          getDefaultFableModel() +
          (has1mTag && !isDirectFirstParty() ? '[1m]' : '')
        )
      }
      case 'best':
        return getBestModel()
      default:
    }
  }

  // Opus 4/4.1 are no longer available on the first-party API (same as
  // Claude.ai) — silently remap to the current Opus default. The 'opus'
  // alias already resolves to 4.6, so the only users on these explicit
  // strings pinned them in settings/env/--model/SDK before 4.5 launched.
  // 3P providers may not yet have 4.6 capacity, so pass through unchanged.
  if (
    isDirectFirstParty() &&
    isLegacyOpusFirstParty(modelString) &&
    isLegacyModelRemapEnabled()
  ) {
    return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
  }

  if (process.env.USER_TYPE === 'ant') {
    const has1mAntTag = has1mContext(normalizedModel)
    const baseAntModel = normalizedModel.replace(/\[1m]$/i, '').trim()

    const antModel = resolveAntModel(baseAntModel)
    if (antModel) {
      const suffix = has1mAntTag ? '[1m]' : ''
      return antModel.model + suffix
    }

    // Fall through to the alias string if we cannot load the config. The API calls
    // will fail with this string, but we should hear about it through feedback and
    // can tell the user to restart/wait for flag cache refresh to get the latest values.
  }

  // Preserve original case for custom model names (e.g., Azure Foundry deployment IDs)
  // Only strip [1m] suffix if present, maintaining case of the base model
  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

/**
 * Resolves a skill's `model:` frontmatter against the current model, carrying
 * the `[1m]` suffix over when the target family supports it.
 *
 * A skill author writing `model: opus` means "use opus-class reasoning" — not
 * "downgrade to 200K". If the user is on opus[1m] at 230K tokens and invokes a
 * skill with `model: opus`, passing the bare alias through drops the effective
 * context window from 1M to 200K, which trips autocompact at 23% apparent usage
 * and surfaces "Context limit reached" even though nothing overflowed.
 *
 * We only carry [1m] when the target actually supports it (sonnet/opus). A skill
 * with `model: haiku` on a 1M session still downgrades — haiku has no 1M variant,
 * so the autocompact that follows is correct. Skills that already specify [1m]
 * are left untouched.
 */
export function resolveSkillModelOverride(
  skillModel: string,
  currentModel: string,
): string {
  if (has1mContext(skillModel) || !has1mContext(currentModel)) {
    return skillModel
  }
  // modelSupports1M matches on canonical IDs ('claude-opus-4-6', 'claude-sonnet-4');
  // a bare 'opus' alias falls through getCanonicalName unmatched. Resolve first.
  if (modelSupports1M(parseUserSpecifiedModel(skillModel))) {
    return skillModel + '[1m]'
  }
  return skillModel
}

const LEGACY_OPUS_FIRSTPARTY = [
  'claude-opus-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-opus-4-0',
  'claude-opus-4-1',
]

function isLegacyOpusFirstParty(model: string): boolean {
  return LEGACY_OPUS_FIRSTPARTY.includes(model)
}

/**
 * Opt-out for the legacy Opus 4.0/4.1 → current Opus remap.
 */
export function isLegacyModelRemapEnabled(): boolean {
  return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP)
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    if (process.env.USER_TYPE === 'ant') {
      return `Default for Ants (${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`
    } else if (isClaudeAISubscriber()) {
      return `Default (${getClaudeAiUserDefaultModelDescription()})`
    }
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

// @[MODEL LAUNCH]: Add a marketing name mapping for the new model below.
export function getMarketingNameForModel(modelId: string | undefined): string | undefined {
  if (!modelId) {
    return undefined
  }
  if (getAPIProvider() === 'foundry') {
    // deployment ID is user-defined in Foundry, so it may have no relation to the actual model
    return undefined
  }

  const has1m = modelId.toLowerCase().includes('[1m]')
  const canonical = getCanonicalName(modelId)

  if (canonical.includes('claude-fable-5')) {
    return has1m ? 'Fable 5 (with 1M context)' : 'Fable 5'
  }
  if (canonical.includes('claude-opus-5')) {
    return has1m ? 'Opus 5 (with 1M context)' : 'Opus 5'
  }
  if (canonical.includes('claude-opus-4-8')) {
    return has1m ? 'Opus 4.8 (with 1M context)' : 'Opus 4.8'
  }
  if (canonical.includes('claude-opus-4-7')) {
    return has1m ? 'Opus 4.7 (with 1M context)' : 'Opus 4.7'
  }
  if (canonical.includes('claude-opus-4-6')) {
    return has1m ? 'Opus 4.6 (with 1M context)' : 'Opus 4.6'
  }
  if (canonical.includes('claude-opus-4-5')) {
    return 'Opus 4.5'
  }
  if (canonical.includes('claude-opus-4-1')) {
    return 'Opus 4.1'
  }
  if (canonical.includes('claude-opus-4')) {
    return 'Opus 4'
  }
  if (canonical.includes('claude-sonnet-5')) {
    return has1m ? 'Sonnet 5 (with 1M context)' : 'Sonnet 5'
  }
  if (canonical.includes('claude-sonnet-4-6')) {
    return has1m ? 'Sonnet 4.6 (with 1M context)' : 'Sonnet 4.6'
  }
  if (canonical.includes('claude-sonnet-4-5')) {
    return has1m ? 'Sonnet 4.5 (with 1M context)' : 'Sonnet 4.5'
  }
  if (canonical.includes('claude-sonnet-4')) {
    return has1m ? 'Sonnet 4 (with 1M context)' : 'Sonnet 4'
  }
  if (canonical.includes('claude-3-7-sonnet')) {
    return 'Claude 3.7 Sonnet'
  }
  if (canonical.includes('claude-3-5-sonnet')) {
    return 'Claude 3.5 Sonnet'
  }
  if (canonical.includes('claude-haiku-4-5')) {
    return 'Haiku 4.5'
  }
  if (canonical.includes('claude-3-5-haiku')) {
    return 'Claude 3.5 Haiku'
  }

  return undefined
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
