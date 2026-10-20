// @ts-nocheck
/**
 * Plugin telemetry helpers — shared field builders for plugin lifecycle events.
 *
 * Implements the twin-column privacy pattern: every user-defined-name field
 * emits both a raw value (routed to PII-tagged _PROTO_* BQ columns) and a
 * redacted twin (real name iff marketplace ∈ allowlist, else 'third-party').
 *
 * plugin_id_hash provides an opaque per-plugin aggregation key with no privacy
 * dependency — sha256(name@marketplace + FIXED_SALT) truncated to 16 chars.
 * This answers distinct-count and per-plugin-trend questions that the
 * redacted column can't, without exposing user-defined names.
 */

import { createHash } from 'crypto'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'
import type { PluginManifest } from '../../types/plugin.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from '../plugins/pluginIdentifier.js'

// builtinPlugins.ts:BUILTIN_MARKETPLACE_NAME — inlined to avoid the cycle
// through commands.js. Marketplace schemas.ts enforces 'builtin' is reserved.
const BUILTIN_MARKETPLACE_NAME = 'builtin'

// Fixed salt for plugin_id_hash. Same constant across all repos and emission
// sites. Not per-org, not rotated — per-org salt would defeat cross-org
// distinct-count, rotation would break trend lines. Customers can compute the
// same hash on their known plugin names to reverse-match their own telemetry.
const PLUGIN_ID_HASH_SALT = 'claude-plugin-telemetry-v1'

/**
 * Opaque per-plugin aggregation key. Input is the name@marketplace string as
 * it appears in enabledPlugins keys, lowercased on the marketplace suffix for
 * reproducibility. 16-char truncation keeps BQ GROUP BY cardinality manageable
 * while making collisions negligible at projected 10k-plugin scale. Name case
 * is preserved in both branches (enabledPlugins keys are case-sensitive).
 */
export function hashPluginId(name: string, marketplace?: string): string {
  const key = marketplace ? `${name}@${marketplace.toLowerCase()}` : name
  return createHash('sha256')
    .update(key + PLUGIN_ID_HASH_SALT)
    .digest('hex')
    .slice(0, 16)
}

/**
 * 4-value scope enum for plugin origin. Distinct from PluginScope
 * (managed/user/project/local) which is installation-target — this is
 * marketplace-origin.
 *
 * - official: from an allowlisted Anthropic marketplace
 * - default-bundle: ships with product (@builtin), auto-enabled
 * - org: enterprise admin-pushed via managed settings (policySettings)
 * - user-local: user added marketplace or local plugin
 */
export type TelemetryPluginScope =
  | 'official'
  | 'org'
  | 'user-local'
  | 'default-bundle'

export function getTelemetryPluginScope(
  name: string,
  marketplace: string | undefined,
  managedNames: Set<string> | null,
): TelemetryPluginScope {
  if (marketplace === BUILTIN_MARKETPLACE_NAME) return 'default-bundle'
  if (isOfficialMarketplaceName(marketplace)) return 'official'
  if (managedNames?.has(name)) return 'org'
  return 'user-local'
}

/**
 * Common plugin telemetry fields keyed off name@marketplace. Returns the
 * hash, scope enum, and the redacted-twin columns. Callers add the raw
 * _PROTO_* fields separately (those require the PII-tagged marker type).
 */
export function buildPluginTelemetryFields(
  name: string,
  marketplace: string | undefined,
  managedNames: Set<string> | null = null,
): {
  plugin_id_hash: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  plugin_scope: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  plugin_name_redacted: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  marketplace_name_redacted: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  is_official_plugin: boolean
} {
  const scope = getTelemetryPluginScope(name, marketplace, managedNames)
  // Both official marketplaces and builtin plugins are Anthropic-controlled
  // — safe to expose real names in the redacted columns.
  const isAnthropicControlled =
    scope === 'official' || scope === 'default-bundle'
  return {
    plugin_id_hash: hashPluginId(
      name,
      marketplace,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_scope:
      scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_name_redacted: (isAnthropicControlled
      ? name
      : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    marketplace_name_redacted: (isAnthropicControlled && marketplace
      ? marketplace
      : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    is_official_plugin: isAnthropicControlled,
  }
}

/** Build plugin fields for skill and slash-command invocations. */
export function buildPluginCommandTelemetryFields(
  pluginInfo: { pluginManifest: PluginManifest; repository: string },
): ReturnType<typeof buildPluginTelemetryFields> {
  const { marketplace } = parsePluginIdentifier(pluginInfo.repository)
  return buildPluginTelemetryFields(
    pluginInfo.pluginManifest.name,
    marketplace,
    null,
  )
}

/**
 * Bounded-cardinality error bucket for CLI plugin operation failures.
 * Maps free-form error messages to 5 stable categories so dashboard
 * GROUP BY stays tractable.
 */
export type PluginCommandErrorCategory =
  | 'network'
  | 'not-found'
  | 'permission'
  | 'validation'
  | 'unknown'

export function classifyPluginCommandError(
  error: unknown,
): PluginCommandErrorCategory {
  const msg = String((error as { message?: unknown })?.message ?? error)
  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ECONNRESET|network|Could not resolve|Connection refused|timed out/i.test(
      msg,
    )
  ) {
    return 'network'
  }
  if (/\b404\b|not found|does not exist|no such plugin/i.test(msg)) {
    return 'not-found'
  }
  if (/\b40[13]\b|EACCES|EPERM|permission denied|unauthorized/i.test(msg)) {
    return 'permission'
  }
  if (/invalid|malformed|schema|validation|parse error/i.test(msg)) {
    return 'validation'
  }
  return 'unknown'
}
