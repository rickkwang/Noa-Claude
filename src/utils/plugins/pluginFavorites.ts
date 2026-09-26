/**
 * Plugin favorites (plugin panel "Favorites" section, `f` key).
 *
 * CC 2.1.283 keeps favorites account-side; Noa is local-first, so they live in
 * user settings (`favoritePlugins: string[]`, pluginId = `name@marketplace`).
 * Favorites are a per-user preference — always written to userSettings,
 * never project/local scope.
 */

import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../settings/settings.js'
import { logForDebugging } from '../debug.js'

export function getFavoritePlugins(): string[] {
  return getSettings_DEPRECATED().favoritePlugins ?? []
}

export function getFavoritePluginSet(): Set<string> {
  return new Set(getFavoritePlugins())
}

export function isFavoritePlugin(pluginId: string): boolean {
  return getFavoritePlugins().includes(pluginId)
}

/**
 * Toggle a plugin's favorite state. Returns the new state, or null when the
 * settings write failed (logged; UI keeps its previous state).
 */
export function toggleFavoritePlugin(pluginId: string): boolean | null {
  const current = getFavoritePlugins()
  const isNowFavorite = !current.includes(pluginId)
  const next = isNowFavorite
    ? [...current, pluginId]
    : current.filter(id => id !== pluginId)
  const { error } = updateSettingsForSource('userSettings', {
    favoritePlugins: next,
  })
  if (error) {
    logForDebugging(`toggleFavoritePlugin(${pluginId}) failed: ${error.message}`, {
      level: 'warn',
    })
    return null
  }
  return isNowFavorite
}
