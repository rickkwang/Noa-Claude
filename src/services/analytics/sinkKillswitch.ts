// @ts-nocheck
import { getDynamicConfig_CACHED_MAY_BE_STALE } from './growthbook.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// Mangled name: per-sink analytics killswitch
const SINK_KILLSWITCH_CONFIG_NAME = 'tengu_frond_boric'

export type SinkName = 'datadog' | 'firstParty'

/**
 * GrowthBook JSON config that disables individual analytics sinks.
 * Shape: { datadog?: boolean, firstParty?: boolean }
 * A value of true for a key stops all dispatch to that sink.
 * Default {} (nothing killed). Fail-open: missing/malformed config = sink stays on.
 *
 * NOTE: Must NOT be called from inside is1PEventLoggingEnabled() -
 * growthbook.ts:isGrowthBookEnabled() calls that, so a lookup here would recurse.
 * Call at per-event dispatch sites instead.
 */
export function isSinkKilled(sink: SinkName): boolean {
  // Local override for isolated deployments. Example:
  // CLAUDE_AGENT_ANALYTICS_SINKS_DISABLED=datadog,firstParty
  const localList = process.env.CLAUDE_AGENT_ANALYTICS_SINKS_DISABLED
  if (localList) {
    const disabled = new Set(
      localList
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    )
    if (disabled.has(sink)) {
      return true
    }
  }
  if (isEnvTruthy(process.env.CLAUDE_AGENT_DISABLE_ALL_ANALYTICS_SINKS)) {
    return true
  }

  const config = getDynamicConfig_CACHED_MAY_BE_STALE<
    Partial<Record<SinkName, boolean>>
  >(SINK_KILLSWITCH_CONFIG_NAME, {})
  // getFeatureValue_CACHED_MAY_BE_STALE guards on `!== undefined`, so a
  // cached JSON null leaks through instead of falling back to {}.
  return config?.[sink] === true
}
