// @ts-nocheck
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isClaudeAISubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import {
  type ModelCosts,
  COST_TIER_10_50,
  COST_TIER_10_50_CHEAP_CACHE,
  COST_TIER_3_15,
  COST_HAIKU_35,
  COST_HAIKU_45,
  COST_HAIKU_55,
  formatModelPricing,
  COST_TIER_2_10,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getAPIProvider, isDirectFirstParty } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getClaudeAiUserDefaultModelDescription,
  getDefaultSonnetModel,
  getDefaultFableModel,
  getDefaultOpusModel,
  getDefaultHaikuModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isNonCustomOpusModel,
  isOpus1mMergeEnabled,
  isOpusDefaultSubscriber,
  parseUserSpecifiedModel,
  getOpusPricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { has1mContext, is1mContextDisabled } from '../context.js'
import { getGlobalConfig } from '../config.js'
import { hasNative1mContext } from './native1m.js'
import { getActiveProviderModelNames } from './providerModels.js'

// @[MODEL LAUNCH]: Update all the available and default model option strings below.

// Marks picker options found by querying an OpenAI-compatible /models list, so
// they can be evicted when the session is no longer on that provider.
export const DISCOVERED_MODEL_DESCRIPTION =
  'Discovered from OpenAI-compatible endpoint'

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

const PROVIDER_PROFILE_MODEL_DESCRIPTION = 'Served by the active provider'

/**
 * isClaudeAISubscriber() throws when no credentials are configured at all.
 * Picker labels must never be the thing that breaks a session, so treat an
 * indeterminate answer as "not a subscriber" — that yields the PAYG rendering,
 * which is the safe default for an account we cannot classify.
 */
function isSubscriberSafe(): boolean {
  try {
    return isClaudeAISubscriber()
  } catch {
    return false
  }
}

// Per-Mtok API pricing is only meaningful to PAYG users. Subscribers draw from
// plan usage, so upstream's subscriber rows omit the price entirely and use
// usage language instead ("Draws from usage credits"). Showing them $/Mtok
// would state a price they do not pay.
function getFirstPartyPricingSuffix(costs: ModelCosts): string {
  if (isSubscriberSafe()) {
    return ''
  }
  return isDirectFirstParty() ? ` · ${formatModelPricing(costs)}` : ''
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  if (process.env.USER_TYPE === 'ant') {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model for Ants (currently ${currentModel})`,
      descriptionForModel: `Default model (currently ${currentModel})`,
    }
  }

  // Subscribers
  if (isClaudeAISubscriber()) {
    return {
      value: null,
      label: 'Default (recommended)',
      description: getClaudeAiUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  const setting = getDefaultMainLoopModelSetting()
  const model = parseUserSpecifiedModel(setting).replace(/\[1m\]$/i, '')
  const pricing = isNonCustomOpusModel(model)
    ? getOpusPricingSuffix(fastMode, model)
    : getFirstPartyPricingSuffix(COST_TIER_2_10)
  return {
    value: null,
    label:
      getAPIProvider() === 'firstParty' ? 'Default (recommended)' : 'Default',
    description: `Use the default model (currently ${renderDefaultModelSetting(setting)})${pricing}`,
  }
}

/** Whether the Default row already stands for the `opus` alias. */
function isDefaultOpus(): boolean {
  return (
    getDefaultMainLoopModelSetting().replace(/\[1m\]$/i, '') ===
    getDefaultOpusModel()
  )
}

function getCustomSonnetOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customSonnetModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  // When a 3P user has a custom sonnet model string, show it directly
  if (is3P && customSonnetModel) {
    const is1m = has1mContext(customSonnetModel)
    return {
      value: 'sonnet',
      label:
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME ?? customSonnetModel,
      description:
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION ??
        `Custom Sonnet model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION ?? `Custom Sonnet model${is1m ? ' with 1M context' : ''}`} (${customSonnetModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add model option functions (getSonnetXXOption, getOpusXXOption, etc.)
// with the new model's label and description. These appear in the /model picker.
//
// Main-row text mirrors the upstream model catalog (the signed remote catalog
// at downloads.claude.ai/model-catalog, baked fallback in the binary): labels
// are the versioned marketing names ("Opus 5.5"), descriptions the catalog's
// per-model strings. Values stay Noa-side: family aliases on 1P so the pick
// tracks the alias across launches, pinned full ids on 3P.
function getSonnet55Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet55 : 'sonnet',
    label: 'Sonnet 5.5',
    description: `Sonnet 5.5 · Most efficient for simpler tasks${getFirstPartyPricingSuffix(COST_TIER_2_10)}`,
    descriptionForModel:
      'Sonnet 5.5 - most efficient for simpler tasks. Generally recommended for most coding tasks',
  }
}

// Overflow row: the `sonnet` alias now resolves to 5.5, so Sonnet 5 is only
// reachable by its full id.
function getSonnet5Option(): ModelOption {
  return {
    value: getModelStrings().sonnet5,
    label: 'Sonnet 5',
    description: `Sonnet 5 · Efficient for routine tasks${getFirstPartyPricingSuffix(COST_TIER_2_10)}`,
    descriptionForModel: 'Sonnet 5 - efficient for routine tasks',
  }
}

function getSonnet46Option(): ModelOption {
  return {
    value: getModelStrings().sonnet46,
    label: 'Sonnet 4.6',
    description: `Sonnet 4.6 · Efficient for routine tasks${getFirstPartyPricingSuffix(COST_TIER_3_15)}`,
    descriptionForModel: 'Sonnet 4.6 - efficient for routine tasks',
  }
}

function getCustomOpusOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customOpusModel = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  // When a 3P user has a custom opus model string, show it directly
  if (is3P && customOpusModel) {
    const is1m = has1mContext(customOpusModel)
    return {
      value: 'opus',
      label: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME ?? customOpusModel,
      description:
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION ??
        `Custom Opus model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION ?? `Custom Opus model${is1m ? ' with 1M context' : ''}`} (${customOpusModel})`,
    }
  }
}

// Overflow row: Opus 4.8 pins its full id (the `opus` alias resolves to 5.5).
function getOpus48Option(fastMode = false): ModelOption {
  const model = getModelStrings().opus48
  return {
    value: model,
    label: 'Opus 4.8',
    description: `Opus 4.8 · Best for everyday, complex tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 4.8 - best for everyday, complex tasks',
  }
}

function getOpus47Option(fastMode = false): ModelOption {
  const model = getModelStrings().opus47
  return {
    value: model,
    label: 'Opus 4.7',
    description: `Opus 4.7 · Best for everyday, complex tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 4.7 - best for everyday, complex tasks',
  }
}

function getOpus46Option(fastMode = false): ModelOption {
  const model = getModelStrings().opus46
  return {
    value: model,
    label: 'Opus 4.6',
    description: `Opus 4.6 · Best for everyday, complex tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 4.6 - best for everyday, complex tasks',
  }
}

export function getOpus48_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus48 + '[1m]' : 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 4.8 with 1M context · Best for everyday, complex tasks${getOpusPricingSuffix(fastMode, getModelStrings().opus48)}`,
    descriptionForModel:
      'Opus 4.8 with 1M context window - for long sessions with large codebases',
  }
}

// Overflow row: Opus 5 pinned by id. No longer what the `opus` alias resolves
// to, so it is an explicit row for accounts that don't have Opus 5.5 yet.
function getOpus5Option(fastMode = false): ModelOption {
  const model = getModelStrings().opus5
  return {
    value: model,
    label: 'Opus 5',
    description: `Opus 5 · Best for everyday, complex tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 5 - best for everyday, complex tasks',
  }
}

function getOpus55Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus55
  return {
    value: is3P ? model : 'opus',
    label: 'Opus 5.5',
    description: `Opus 5.5 · For complex work and everyday tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: 'Opus 5.5 - for complex work and everyday tasks',
  }
}

export function getOpus55_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const model = getModelStrings().opus55
  return {
    value: is3P ? model + '[1m]' : 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 5.5 with 1M context · For complex work and everyday tasks${getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel:
      'Opus 5.5 with 1M context window - for long sessions with large codebases',
  }
}

export function getMaxOpus55_1MOption(fastMode = false): ModelOption {
  const billingInfo = isClaudeAISubscriber() ? ' · Draws from usage credits' : ''
  return {
    value: 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 5.5 with 1M context${billingInfo}${getOpusPricingSuffix(fastMode, getModelStrings().opus55)}`,
  }
}

// Fable 5.1 — top tier, above Opus. Never a default (it's the most expensive
// model); offered as an explicit opt-in row. The `[1m]` variant is reachable
// via the `fable[1m]` alias.
function getFable51Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().fable51 : 'fable',
    label: 'Fable 5.1',
    description: `Fable 5.1 · For your toughest challenges${getFirstPartyPricingSuffix(COST_TIER_10_50_CHEAP_CACHE)}`,
    descriptionForModel: 'Fable 5.1 - for your toughest challenges',
  }
}

// Overflow row: Fable 5 pinned by id (the `fable` alias resolves to 5.1).
function getFable5Option(): ModelOption {
  const model = getModelStrings().fable5
  return {
    value: model,
    label: 'Fable 5',
    description: `Fable 5 · Most capable for your hardest and longest-running tasks${getFirstPartyPricingSuffix(COST_TIER_10_50)}`,
    descriptionForModel:
      'Fable 5 - most capable for your hardest and longest-running tasks',
  }
}

export function getSonnet55_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet55 + '[1m]' : 'sonnet[1m]',
    label: 'Sonnet (1M context)',
    description: `Sonnet 5.5 with 1M context · Most efficient for simpler tasks${getFirstPartyPricingSuffix(COST_TIER_2_10)}`,
    descriptionForModel:
      'Sonnet 5.5 with 1M context window - for long sessions with large codebases',
  }
}

function getCustomHaikuOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customHaikuModel = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  // When a 3P user has a custom haiku model string, show it directly
  if (is3P && customHaikuModel) {
    return {
      value: 'haiku',
      label: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME ?? customHaikuModel,
      description:
        process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION ??
        'Custom Haiku model',
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION ?? 'Custom Haiku model'} (${customHaikuModel})`,
    }
  }
}

function getHaiku45Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'haiku',
    label: 'Haiku 4.5',
    description: `Haiku 4.5 · Fastest for quick answers${getFirstPartyPricingSuffix(COST_HAIKU_45)}`,
    descriptionForModel:
      'Haiku 4.5 - fastest for quick answers. Lower cost but less capable than Sonnet 4.6.',
  }
}

function getHaiku55Option(): ModelOption {
  return {
    value: 'haiku',
    label: 'Haiku 5.5',
    description: `Haiku 5.5 · Fastest for quick answers${getFirstPartyPricingSuffix(COST_HAIKU_55)}`,
    descriptionForModel:
      'Haiku 5.5 - fastest for quick answers. Lower cost but less capable than Sonnet 5.5.',
  }
}

function getHaiku35Option(): ModelOption {
  return {
    value: 'haiku',
    label: 'Haiku',
    description: `Haiku 3.5 for simple tasks${getFirstPartyPricingSuffix(COST_HAIKU_35)}`,
    descriptionForModel:
      'Haiku 3.5 - faster and lower cost, but less capable than Sonnet. Use for simple tasks.',
  }
}

function getHaikuOption(): ModelOption {
  // Return correct Haiku option based on provider
  const haikuModel = getDefaultHaikuModel()
  if (haikuModel === getModelStrings().haiku55) return getHaiku55Option()
  return haikuModel === getModelStrings().haiku45
    ? getHaiku45Option()
    : getHaiku35Option()
}

function getMaxOpusOption(fastMode = false): ModelOption {
  return {
    value: 'opus',
    label: 'Opus 5.5',
    description: `Opus 5.5 · For complex work and everyday tasks${fastMode ? getOpusPricingSuffix(true, getModelStrings().opus55) : ''}`,
  }
}

export function getMaxSonnet55_1MOption(): ModelOption {
  const billingInfo = isClaudeAISubscriber() ? ' · Draws from usage credits' : ''
  return {
    value: 'sonnet[1m]',
    label: 'Sonnet (1M context)',
    description: `Sonnet 5.5 with 1M context${billingInfo}${getFirstPartyPricingSuffix(COST_TIER_2_10)}`,
  }
}

function getMergedOpus1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  // The merged row always represents whatever the `opus` alias resolves to, so
  // it follows getDefaultOpusModel (Opus 5.5 on 1P/Bedrock/Vertex, 4.6 on Foundry) rather than
  // pinning a version string.
  const model = getDefaultOpusModel()
  const name = getMarketingNameForModel(model) ?? 'Opus'
  const pricing =
    !is3P && !isSubscriberSafe() ? getOpusPricingSuffix(fastMode, model) : ''
  return {
    value: is3P ? model + '[1m]' : 'opus[1m]',
    label: 'Opus (1M context)',
    description: `${name} with 1M context · For complex work and everyday tasks${pricing}`,
    descriptionForModel: `${name} with 1M context - for complex work and everyday tasks`,
  }
}

const MaxSonnet55Option: ModelOption = {
  value: 'sonnet',
  label: 'Sonnet 5.5',
  description: 'Sonnet 5.5 · Most efficient for simpler tasks',
}

/** Explicit `opus` alias row for a first-party picker. */
function getOpusAliasOption(fastMode: boolean): ModelOption {
  if (isOpus1mMergeEnabled()) {
    return getMergedOpus1MOption(fastMode)
  }
  const subscriber = isSubscriberSafe()
  const model = getDefaultOpusModel()
  if (model === getModelStrings().opus55) {
    return subscriber ? getMaxOpusOption() : getOpus55Option(fastMode)
  }
  const name = getMarketingNameForModel(model) ?? 'Opus'
  return {
    value: 'opus',
    label: name,
    description: `${name} · Best for everyday, complex tasks${subscriber ? '' : getOpusPricingSuffix(fastMode, model)}`,
    descriptionForModel: `${name} - best for everyday, complex tasks`,
  }
}

/** Explicit `sonnet` alias row for a first-party picker. */
function getSonnetAliasOption(): ModelOption {
  const model = getDefaultSonnetModel()
  if (model === getModelStrings().sonnet55) {
    return isSubscriberSafe() ? MaxSonnet55Option : getSonnet55Option()
  }
  const name = getMarketingNameForModel(model) ?? 'Sonnet'
  return {
    value: 'sonnet',
    label: name,
    description: `${name} · Efficient for routine tasks`,
    descriptionForModel: `${name} - efficient for routine tasks`,
  }
}

/**
 * The Default row follows whatever the tier resolves to, so the family it
 * currently stands for also gets an explicit alias row right after it —
 * picking that row pins the family instead of tracking the default.
 */
function withDefaultFamilyRow(
  options: ModelOption[],
  family: 'opus' | 'sonnet',
  fastMode: boolean,
): ModelOption[] {
  const merged = family === 'opus' && isOpus1mMergeEnabled()
  if (
    options.some(
      o => o.value === family || (merged && o.value === `${family}[1m]`),
    )
  ) {
    return options
  }
  const row =
    family === 'opus' ? getOpusAliasOption(fastMode) : getSonnetAliasOption()
  options.splice(options.findIndex(o => o.value === null) + 1, 0, row)
  return options
}

const MaxHaiku55Option: ModelOption = {
  value: 'haiku',
  label: 'Haiku 5.5',
  description: 'Haiku 5.5 · Fastest for quick answers',
}

function getOpusPlanOption(): ModelOption {
  return {
    value: 'opusplan',
    label: 'Opus Plan',
    description: 'Opus in plan mode, else Sonnet',
    descriptionForModel: 'Use Opus in plan mode, Sonnet otherwise',
  }
}

/**
 * The active provider profile's own catalogue, replacing the Claude-tier rows
 * entirely.
 *
 * An Anthropic-compatible third party (Kimi, MiniMax, …) reports provider
 * 'firstParty' — no CLAUDE_CODE_USE_* flag is set — so without this the picker
 * builds the PAYG 1P list: Sonnet/Opus/Haiku rows that buildProviderEnv has
 * pinned to the profile's single model, i.e. four labels for one model and no
 * way to reach anything else the endpoint serves.
 */
function getProviderProfileOptions(): ModelOption[] {
  const models = getActiveProviderModelNames()
  if (models.length === 0) return []

  // The profile's own default model id, not renderDefaultModelSetting(): that
  // resolves through the Claude tier aliases and would name a Claude model the
  // endpoint doesn't serve.
  const profileDefault = process.env.ANTHROPIC_MODEL
  return [
    {
      value: null,
      label: 'Default',
      description: profileDefault
        ? `${profileDefault} · Provider default`
        : 'Provider default',
    },
    ...models.map(model => ({
      value: model,
      label: model,
      description: PROVIDER_PROFILE_MODEL_DESCRIPTION,
    })),
  ]
}

/**
 * Previous-generation rows, in the upstream catalog's overflow order
 * (Sonnet 5, Opus 5, Fable 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6).
 * Every value pins a full model id — the family aliases resolve to
 * the current generation, so only a literal id reaches these. Offered on every
 * tier, not just 3P: the upstream picker lists them for first-party accounts
 * too (10 rows visible, rest behind scroll).
 */
function getOverflowOptions(fastMode = false): ModelOption[] {
  return [
    getSonnet5Option(),
    getOpus5Option(fastMode),
    getFable5Option(),
    getOpus48Option(fastMode),
    getOpus47Option(fastMode),
    getOpus46Option(fastMode),
    getSonnet46Option(),
  ]
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  // Checked before every tier: an active profile routes the session to that
  // endpoint, so its models are the only ones any of these rows could reach.
  const providerProfileOptions = getProviderProfileOptions()
  if (providerProfileOptions.length > 0) {
    return providerProfileOptions
  }

  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[ANT-ONLY] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...antModelOptions,
      getMergedOpus1MOption(fastMode),
      getFable51Option(),
      getSonnet55Option(),
      getSonnet55_1MOption(),
      getHaikuOption(),
    ]
  }

  if (isClaudeAISubscriber()) {
    if (isOpusDefaultSubscriber()) {
      // Opus-default plans (see isOpusDefaultSubscriber): main rows in the
      // upstream catalog order (Opus, Sonnet, Fable, Haiku) + overflow.
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      if (!isOpus1mMergeEnabled() && checkOpus1mAccess()) {
        premiumOptions.push(getMaxOpus55_1MOption(fastMode))
      }

      premiumOptions.push(MaxSonnet55Option)
      if (checkSonnet1mAccess()) {
        premiumOptions.push(getMaxSonnet55_1MOption())
      }

      premiumOptions.push(getFable51Option())

      premiumOptions.push(MaxHaiku55Option)
      premiumOptions.push(...getOverflowOptions(fastMode))
      return withDefaultFamilyRow(premiumOptions, 'opus', fastMode)
    }

    // Free and Sonnet-only plans: Sonnet is default, show Opus as alternative
    const standardOptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      standardOptions.push(getMaxSonnet55_1MOption())
    }

    if (isOpus1mMergeEnabled()) {
      standardOptions.push(getMergedOpus1MOption(fastMode))
    } else {
      standardOptions.push(getMaxOpusOption())
      if (checkOpus1mAccess()) {
        standardOptions.push(getMaxOpus55_1MOption())
      }
    }

    standardOptions.push(getFable51Option())
    standardOptions.push(MaxHaiku55Option)
    standardOptions.push(...getOverflowOptions(fastMode))
    return withDefaultFamilyRow(standardOptions, 'sonnet', fastMode)
  }

  // PAYG 1P API: Default + Opus 5.5 + Sonnet 5.5 + Fable 5.1 + Haiku (+1M
  // variants where they survive the native-1M merge) + overflow rows.
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (!isOpus1mMergeEnabled() && checkOpus1mAccess()) {
      payg1POptions.push(getOpus55_1MOption(fastMode))
    }
    payg1POptions.push(getSonnet55Option())
    if (checkSonnet1mAccess()) {
      payg1POptions.push(getSonnet55_1MOption())
    }
    payg1POptions.push(getFable51Option())
    payg1POptions.push(getHaikuOption())
    payg1POptions.push(...getOverflowOptions(fastMode))
    return withDefaultFamilyRow(payg1POptions, 'opus', fastMode)
  }

  // PAYG 3P: main rows in catalog order (Opus 5.5, Sonnet 5.5, Fable 5.1,
  // Haiku) + the full overflow set. Provider defaults come from ALIAS_DEFAULTS
  // in model.ts, not from this list.
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  const customOpus = getCustomOpusOption()
  if (customOpus !== undefined) {
    payg3pOptions.push(customOpus)
  } else {
    // Opus 5.5 is the Bedrock/Vertex default (Foundry gets 4.6), so it must be
    // reachable from the picker — without this row a third-party user who
    // switches away from the default cannot switch back without typing the
    // full model id.
    payg3pOptions.push(getOpus55Option(fastMode))
  }

  const customSonnet = getCustomSonnetOption()
  if (customSonnet !== undefined) {
    payg3pOptions.push(customSonnet)
  } else {
    // Sonnet 5.5 is not the third-party default (upstream's alias table pins
    // every cloud provider to Sonnet 4.5), so it needs its own row.
    payg3pOptions.push(getSonnet55Option())
    if (checkSonnet1mAccess()) {
      payg3pOptions.push(getSonnet55_1MOption())
    }
  }

  payg3pOptions.push(getFable51Option())

  const customHaiku = getCustomHaikuOption()
  if (customHaiku !== undefined) {
    payg3pOptions.push(customHaiku)
  } else {
    payg3pOptions.push(getHaikuOption())
  }

  // Overflow rows pin versioned ids, so they never collide with a custom env
  // main row — offer them regardless of custom model configuration (the
  // pre-rework 3P list likewise kept the other family's rows when a custom
  // model replaced one family).
  const overflow = getOverflowOptions(fastMode)
  if (checkOpus1mAccess()) {
    // Opus 4.8 is not natively 1M on 3P, so its [1m] opt-in stays a real row
    // there (on 1P the native-1M merge drops it against the base row).
    const idx = overflow.findIndex(o => o.value === getModelStrings().opus48)
    overflow.splice(
      idx === -1 ? overflow.length : idx + 1,
      0,
      getOpus48_1MOption(fastMode),
    )
  }
  payg3pOptions.push(...overflow)
  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // Sonnet family
  if (
    canonical.includes('claude-sonnet-5') ||
    canonical.includes('claude-sonnet-4-6') ||
    canonical.includes('claude-sonnet-4-5') ||
    canonical.includes('claude-sonnet-4-') ||
    canonical.includes('claude-3-7-sonnet') ||
    canonical.includes('claude-3-5-sonnet')
  ) {
    const currentName = getMarketingNameForModel(getDefaultSonnetModel())
    if (currentName) {
      return { alias: 'Sonnet', currentVersionName: currentName }
    }
  }

  // Opus family
  if (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-opus-5')
  ) {
    const currentName = getMarketingNameForModel(getDefaultOpusModel())
    if (currentName) {
      return { alias: 'Opus', currentVersionName: currentName }
    }
  }

  // Fable family (Mythos is access-program-only and has no alias)
  if (canonical.includes('claude-fable-')) {
    const currentName = getMarketingNameForModel(getDefaultFableModel())
    if (currentName) {
      return { alias: 'Fable', currentVersionName: currentName }
    }
  }

  // Haiku family
  if (
    canonical.includes('claude-haiku') ||
    canonical.includes('claude-3-5-haiku')
  ) {
    const currentName = getMarketingNameForModel(getDefaultHaikuModel())
    if (currentName) {
      return { alias: 'Haiku', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known Anthropic model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the ANTHROPIC_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Append additional model options fetched during bootstrap.
  // Skip OpenAI-compatible discoveries when the active provider is no longer
  // openaiCompatible — otherwise stale cache from a prior provider leaks
  // (e.g. 100+ OpenAI models showing up in a first-party Claude session).
  // Under an active provider profile, skip the whole cache: bootstrap never
  // runs there, so stale first-party entries can't be evicted at fetch time.
  const isOpenAICompatible = getAPIProvider() === 'openaiCompatible'
  const providerProfileActive = getActiveProviderModelNames().length > 0
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (providerProfileActive) {
      break
    }
    if (
      !isOpenAICompatible &&
      opt.description === DISCOVERED_MODEL_DESCRIPTION
    ) {
      continue
    }
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(mergeNative1mOptions(options))
  } else if (customModel === 'opusplan') {
    return filterModelOptionsByAllowlist(mergeNative1mOptions([...options, getOpusPlanOption()]))
  } else if (customModel === 'opus' && getAPIProvider() === 'firstParty') {
    // When the default is already Opus, an explicit Opus row duplicates the Default entry.
    if (isDefaultOpus()) {
      return filterModelOptionsByAllowlist(mergeNative1mOptions(options))
    }
    return filterModelOptionsByAllowlist(mergeNative1mOptions([
      ...options,
      getMaxOpusOption(fastMode),
    ]))
  } else if (customModel === 'opus[1m]' && getAPIProvider() === 'firstParty') {
    // With 1M-merge enabled, an Opus default already represents Opus 1M.
    if (isDefaultOpus() && isOpus1mMergeEnabled()) {
      return filterModelOptionsByAllowlist(mergeNative1mOptions(options))
    }
    return filterModelOptionsByAllowlist(mergeNative1mOptions([
      ...options,
      getMergedOpus1MOption(fastMode),
    ]))
  } else {
    // Try to show a human-readable label for known Anthropic models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(mergeNative1mOptions(options))
  }
}

/**
 * Collapse redundant `[1m]` picker rows for models that already serve 1M
 * natively (see native1m.ts): the base row and the `[1m]` row resolve to the
 * same window, and the "(1M context)" label falsely implies the base row is
 * smaller. The base row's description is annotated with "1M context" instead.
 *
 * The `[1m]` row is kept when it IS the current selection (so the picker can
 * still highlight it) or when no matching base row exists (e.g. the merged
 * Opus 1M entry, which replaces the plain Opus row entirely).
 *
 * Exported for tests.
 */
export function mergeNative1mOptions(options: ModelOption[]): ModelOption[] {
  if (is1mContextDisabled()) {
    return options
  }
  const values = new Set(options.map(o => o.value))

  // A base row and its `[1m]` sibling resolve to the same window once the
  // model is natively 1M, so exactly one of the pair may survive — keeping
  // both renders duplicate choices. Upstream suppresses the `[1m]` builder in
  // this case and keeps the base row; do the same here. Historical saved
  // `[1m]` settings are normalized by migrateOpusToOpus1m.
  const dropped = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || value.endsWith('[1m]')) {
      continue
    }
    const oneM = `${value}[1m]`
    if (
      values.has(oneM) &&
      hasNative1mContext(parseUserSpecifiedModel(value))
    ) {
      dropped.add(oneM)
    }
  }

  // Surviving `[1m]` rows keep their "(1M context)" label: upstream renders a
  // `[1m]` model string that way wherever it appears (see the display-name
  // path), so rewriting it here would put the picker at odds with the banner.
  // The redundancy is fixed by not offering the row, not by relabelling it.
  return options.filter(
    opt => typeof opt.value !== 'string' || !dropped.has(opt.value),
  )
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}
