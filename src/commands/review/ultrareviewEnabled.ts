// @ts-nocheck
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

/**
 * Runtime gate for /ultrareview. This build disables remote GrowthBook fetches,
 * so a missing config must not permanently hide the command. Explicit
 * `enabled: false` still acts as a local kill switch.
 */
export function isUltrareviewEnabled(): boolean {
  const cfg = getFeatureValue_CACHED_MAY_BE_STALE<Record<
    string,
    unknown
  > | null>('tengu_review_bughunter_config', null)
  return cfg?.enabled !== false
}
