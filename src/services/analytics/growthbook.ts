/**
 * Feature-gate API kept for call-site compatibility. Noa has no remote
 * feature-flag service, so every gate resolves to its in-code default and
 * boolean gates without one resolve to false.
 */

export const initializeGrowthBook = async (): Promise<null> => null

/** Gate values never change at runtime; returns a no-op unsubscribe. */
export function onGrowthBookRefresh(_listener: () => void | Promise<void>): () => void {
  return () => {}
}

export async function getFeatureValue_DEPRECATED<T>(
  _feature: string,
  defaultValue: T,
): Promise<T> {
  return defaultValue
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  _feature: string,
  defaultValue: T,
): T {
  return defaultValue
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  _feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return defaultValue
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  _gate: string,
): boolean {
  return false
}

export async function checkSecurityRestrictionGate(
  _gate: string,
): Promise<boolean> {
  return false
}

export async function checkGate_CACHED_OR_BLOCKING(
  _gate: string,
): Promise<boolean> {
  return false
}

export function refreshGrowthBookAfterAuthChange(): void {}

export function resetGrowthBook(): void {}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  _configName: string,
  defaultValue: T,
): Promise<T> {
  return defaultValue
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  _configName: string,
  defaultValue: T,
): T {
  return defaultValue
}
