// @ts-nocheck
import memoize from 'lodash-es/memoize.js'
import { getRegisteredHooks } from '../../bootstrap/state.js'
import {
  prunePluginHookRegistryByRoots,
  replacePluginHookRegistry,
} from '../../services/extensions/registry.js'
import {
  discoverPluginHookMatchers,
  getEnabledPluginRoots,
} from '../../services/resources/plugins.js'
import { logForDebugging } from '../debug.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import { jsonStringify } from '../slowOperations.js'
import { clearPluginCache } from './pluginLoader.js'

// Track if hot reload subscription is set up
let hotReloadSubscribed = false

// Snapshot of enabledPlugins for change detection in hot reload
let lastPluginSettingsSnapshot: string | undefined

/**
 * Load and register hooks from all enabled plugins.
 *
 * loadPluginHooks is now an adapter over:
 * - resources layer: discover/filter hook matchers
 * - extensions registry: atomic clear+register swap
 */
export const loadPluginHooks = memoize(async (): Promise<void> => {
  const { hooksByEvent, enabledPluginCount, totalHookCount } =
    await discoverPluginHookMatchers()

  // Clear-then-register as an atomic pair. Previously the clear lived in
  // clearPluginHookCache(), which meant any clearAllCaches() call (from
  // /plugins UI, pluginInstallationHelpers, thinkback, etc.) wiped plugin
  // hooks from STATE.registeredHooks and left them wiped until someone
  // happened to call loadPluginHooks() again. SessionStart explicitly awaits
  // loadPluginHooks() before firing so it always re-registered; Stop has no
  // such guard, so plugin Stop hooks silently never fired after any plugin
  // management operation (gh-29767). Doing the clear here makes the swap
  // atomic — old hooks stay valid until this point, new hooks take over.
  replacePluginHookRegistry(hooksByEvent)

  logForDebugging(
    `Registered ${totalHookCount} hooks from ${enabledPluginCount} plugins`,
  )
})

export function clearPluginHookCache(): void {
  // Only invalidate the memoize — do NOT wipe STATE.registeredHooks here.
  // Wiping here left plugin hooks dead between clearAllCaches() and the next
  // loadPluginHooks() call, which for Stop hooks might never happen
  // (gh-29767). The clear now lives inside loadPluginHooks() as an atomic
  // clear-then-register, so old hooks stay valid until the fresh load swaps
  // them out.
  loadPluginHooks.cache?.clear?.()
}

/**
 * Remove hooks from plugins no longer in the enabled set, without adding
 * hooks from newly-enabled plugins. Called from clearAllCaches() so
 * uninstalled/disabled plugins stop firing hooks immediately (gh-36995),
 * while newly-enabled plugins wait for /reload-plugins — consistent with
 * how commands/agents/MCP behave.
 *
 * The full swap (clear + register all) still happens via loadPluginHooks(),
 * which /reload-plugins awaits.
 */
export async function pruneRemovedPluginHooks(): Promise<void> {
  // Early return when nothing to prune — avoids seeding the plugin loader
  // memoize in test/preload.ts beforeEach (which clears registeredHooks).
  if (!getRegisteredHooks()) return

  const enabledRoots = await getEnabledPluginRoots()
  prunePluginHookRegistryByRoots(enabledRoots)
}

/**
 * Reset hot reload subscription state. Only for testing.
 */
export function resetHotReloadState(): void {
  hotReloadSubscribed = false
  lastPluginSettingsSnapshot = undefined
}

/**
 * Build a stable string snapshot of the settings that feed into
 * plugin loading for change detection. Sorts keys so comparison is
 * deterministic regardless of insertion order.
 *
 * Hashes FOUR fields — not just enabledPlugins — because plugin loading also
 * reads strictKnownMarketplaces, blockedMarketplaces, and
 * extraKnownMarketplaces.
 */
// Exported for testing — the listener at setupPluginHookHotReload uses this
// for change detection; tests verify it diffs on the fields that matter.
export function getPluginAffectingSettingsSnapshot(): string {
  const merged = getSettings_DEPRECATED()
  const policy = getSettingsForSource('policySettings')
  // Key-sort the two Record fields so insertion order doesn't flap the hash.
  // Array fields (strictKnownMarketplaces, blockedMarketplaces) have
  // schema-stable order.
  const sortKeys = <T extends Record<string, unknown>>(o: T | undefined) =>
    o ? Object.fromEntries(Object.entries(o).sort()) : {}
  return jsonStringify({
    enabledPlugins: sortKeys(merged.enabledPlugins),
    extraKnownMarketplaces: sortKeys(merged.extraKnownMarketplaces),
    strictKnownMarketplaces: policy?.strictKnownMarketplaces ?? [],
    blockedMarketplaces: policy?.blockedMarketplaces ?? [],
  })
}

/**
 * Set up hot reload for plugin hooks when remote settings change.
 * When policySettings changes (e.g., from remote managed settings),
 * compares the plugin-affecting settings snapshot and only reloads if it
 * actually changed.
 */
export function setupPluginHookHotReload(): void {
  if (hotReloadSubscribed) {
    return
  }
  hotReloadSubscribed = true

  // Capture the initial snapshot so the first policySettings change can compare
  lastPluginSettingsSnapshot = getPluginAffectingSettingsSnapshot()

  settingsChangeDetector.subscribe(source => {
    if (source === 'policySettings') {
      const newSnapshot = getPluginAffectingSettingsSnapshot()
      if (newSnapshot === lastPluginSettingsSnapshot) {
        logForDebugging(
          'Plugin hooks: skipping reload, plugin-affecting settings unchanged',
        )
        return
      }

      lastPluginSettingsSnapshot = newSnapshot
      logForDebugging(
        'Plugin hooks: reloading due to plugin-affecting settings change',
      )

      // Clear all plugin-related caches
      clearPluginCache('loadPluginHooks: plugin-affecting settings changed')
      clearPluginHookCache()

      // Reload hooks (fire-and-forget, don't block)
      void loadPluginHooks()
    }
  })
}
