// @ts-nocheck
import memoize from 'lodash-es/memoize.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import {
  addToBaseCache,
  pluginThemesStore,
  readThemesFromPathAsync,
} from '../customThemes.js'
import { logForDebugging } from '../debug.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'

/**
 * Load custom themes from all enabled plugins: the auto-detected themes/
 * directory plus any manifest-listed paths. Theme slugs are namespaced as
 * `<plugin>:<slug>` so plugins can't collide with user themes or each other.
 *
 * Results are published to pluginThemesStore (which the ThemeProvider
 * subscribes to) and folded into the slug → base cache so a
 * `custom:<plugin>:<slug>` setting resolves even before the provider mounts.
 */
export const loadPluginThemes = memoize(async () => {
  // Only load themes from enabled plugins
  const { enabled, errors } = await loadAllPluginsCacheOnly()
  const allThemes = []

  if (errors.length > 0) {
    logForDebugging(
      `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
    )
  }

  for (const plugin of enabled) {
    const source = { plugin: plugin.name }
    const slugPrefix = `${plugin.name}:`

    if (plugin.themesPath) {
      try {
        const themes = await readThemesFromPathAsync(
          plugin.themesPath,
          source,
          slugPrefix,
        )
        allThemes.push(...themes)

        if (themes.length > 0) {
          logForDebugging(
            `Loaded ${themes.length} themes from plugin ${plugin.name} default directory`,
          )
        }
      } catch (error) {
        logForDebugging(
          `Failed to load themes from plugin ${plugin.name} default directory: ${error}`,
          { level: 'error' },
        )
      }
    }

    if (plugin.themesPaths) {
      for (const themesPath of plugin.themesPaths) {
        try {
          const themes = await readThemesFromPathAsync(
            themesPath,
            source,
            slugPrefix,
          )
          allThemes.push(...themes)

          if (themes.length > 0) {
            logForDebugging(
              `Loaded ${themes.length} themes from plugin ${plugin.name} custom path: ${themesPath}`,
            )
          }
        } catch (error) {
          logForDebugging(
            `Failed to load themes from plugin ${plugin.name} custom path ${themesPath}: ${error}`,
            { level: 'error' },
          )
        }
      }
    }
  }

  addToBaseCache(allThemes)
  allThemes.sort((a, b) => a.name.localeCompare(b.name))
  pluginThemesStore.setState(allThemes)
  logForDebugging(`Total plugin themes loaded: ${allThemes.length}`)
  return allThemes
})

export function clearPluginThemeCache() {
  loadPluginThemes.cache?.clear?.()
}
