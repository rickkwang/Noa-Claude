// @ts-nocheck
/**
 * Model deprecation utilities
 *
 * Contains information about deprecated models and their retirement dates.
 */

import { getCanonicalName } from './model.js'
import { type APIProvider, getAPIProvider } from './providers.js'

type DeprecatedModelInfo = {
  isDeprecated: true
  modelName: string
  retirementDate: string
}

type NotDeprecatedInfo = {
  isDeprecated: false
}

type DeprecationInfo = DeprecatedModelInfo | NotDeprecatedInfo

type DeprecationEntry = {
  /** Human-readable model name */
  modelName: string
  /** Retirement dates by provider (null = not deprecated for that provider) */
  retirementDates: Record<APIProvider, string | null>
}

/**
 * Deprecated models and their retirement dates by provider, keyed by canonical
 * name (getCanonicalName). Mirrors upstream's table (2.1.280); Opus 4.1 is
 * absent because upstream lists no dates for it, only the legacy remap that
 * isLegacyModelRemapEnabled() already covers.
 */
const DEPRECATED_MODELS: Record<string, DeprecationEntry> = {
  'claude-opus-4-0': {
    modelName: 'Claude Opus 4',
    retirementDates: {
      firstParty: 'June 15, 2026',
      bedrock: 'May 31, 2026',
      vertex: 'September 14, 2026',
      foundry: null,
    },
  },
  // Canonical name for claude-sonnet-4-20250514 is 'claude-sonnet-4'.
  'claude-sonnet-4': {
    modelName: 'Claude Sonnet 4',
    retirementDates: {
      firstParty: 'June 15, 2026',
      bedrock: 'October 14, 2026',
      vertex: 'September 14, 2026',
      foundry: null,
    },
  },
  'claude-3-opus': {
    modelName: 'Claude 3 Opus',
    retirementDates: {
      firstParty: 'January 5, 2026',
      bedrock: 'January 15, 2026',
      vertex: 'January 5, 2026',
      foundry: 'January 5, 2026',
    },
  },
  'claude-3-7-sonnet': {
    modelName: 'Claude 3.7 Sonnet',
    retirementDates: {
      firstParty: 'February 19, 2026',
      bedrock: 'April 28, 2026',
      vertex: 'May 11, 2026',
      foundry: 'February 19, 2026',
    },
  },
  'claude-3-5-haiku': {
    modelName: 'Claude 3.5 Haiku',
    retirementDates: {
      firstParty: 'February 19, 2026',
      bedrock: null,
      vertex: null,
      foundry: null,
    },
  },
}

/**
 * Check if a model is deprecated and get its deprecation info
 */
function getDeprecatedModelInfo(modelId: string): DeprecationInfo {
  const entry = Object.hasOwn(DEPRECATED_MODELS, getCanonicalName(modelId))
    ? DEPRECATED_MODELS[getCanonicalName(modelId)]
    : undefined
  const retirementDate = entry?.retirementDates[getAPIProvider()]
  if (!entry || !retirementDate) {
    return { isDeprecated: false }
  }
  return {
    isDeprecated: true,
    modelName: entry.modelName,
    retirementDate,
  }
}

/**
 * Get a deprecation warning message for a model, or null if not deprecated
 */
export function getModelDeprecationWarning(
  modelId: string | null,
): string | null {
  if (!modelId) {
    return null
  }

  const info = getDeprecatedModelInfo(modelId)
  if (!info.isDeprecated) {
    return null
  }

  const retired = new Date(info.retirementDate)
  if (!Number.isNaN(retired.getTime()) && retired < new Date()) {
    return `⚠ ${info.modelName} was retired on ${info.retirementDate}. Switch to a newer model with /model.`
  }
  return `⚠ ${info.modelName} will be retired on ${info.retirementDate}. Consider switching to a newer model.`
}
