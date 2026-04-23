// @ts-nocheck
import type { HooksSettings } from '../../schemas/hooks.js';
import type { LoadedPlugin } from '../../types/plugin.js';
import { logForDebugging } from '../../utils/debug.js';
import type { PluginHookMatcher } from '../../utils/settings/types.js';
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js';
import { createEmptyPluginHookRegistry } from '../extensions/registry.js';

type HookEvent = keyof HooksSettings;

function convertPluginHooksToMatchers(
  plugin: LoadedPlugin,
): Record<HookEvent, PluginHookMatcher[]> {
  const pluginMatchers = createEmptyPluginHookRegistry();

  if (!plugin.hooksConfig) {
    return pluginMatchers;
  }

  for (const [event, matchers] of Object.entries(plugin.hooksConfig)) {
    const hookEvent = event as HookEvent;
    if (!pluginMatchers[hookEvent]) {
      continue;
    }

    for (const matcher of matchers) {
      if (matcher.hooks.length > 0) {
        pluginMatchers[hookEvent].push({
          matcher: matcher.matcher,
          hooks: matcher.hooks,
          pluginRoot: plugin.path,
          pluginName: plugin.name,
          pluginId: plugin.source,
        });
      }
    }
  }

  return pluginMatchers;
}

export async function discoverPluginHookMatchers(): Promise<{
  hooksByEvent: Record<HookEvent, PluginHookMatcher[]>;
  enabledPluginCount: number;
  totalHookCount: number;
}> {
  const { enabled } = await loadAllPluginsCacheOnly();
  const hooksByEvent = createEmptyPluginHookRegistry();

  for (const plugin of enabled) {
    if (!plugin.hooksConfig) {
      continue;
    }

    logForDebugging(`Loading hooks from plugin: ${plugin.name}`);
    const pluginMatchers = convertPluginHooksToMatchers(plugin);

    for (const event of Object.keys(pluginMatchers) as HookEvent[]) {
      hooksByEvent[event].push(...pluginMatchers[event]);
    }
  }

  const totalHookCount = Object.values(hooksByEvent).reduce(
    (sum, matchers) => sum + matchers.reduce((inner, m) => inner + m.hooks.length, 0),
    0,
  );

  return {
    hooksByEvent,
    enabledPluginCount: enabled.length,
    totalHookCount,
  };
}

export async function getEnabledPluginRoots(): Promise<Set<string>> {
  const { enabled } = await loadAllPluginsCacheOnly();
  return new Set(enabled.map(plugin => plugin.path));
}
