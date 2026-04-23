// @ts-nocheck
import {
  clearRegisteredPluginHooks,
  getRegisteredHooks,
  registerHookCallbacks,
} from '../../bootstrap/state.js';
import type { HooksSettings } from '../../schemas/hooks.js';
import type { Command } from '../../types/command.js';
import type { PluginHookMatcher } from '../../utils/settings/types.js';

type HookEvent = keyof HooksSettings;

export function createEmptyPluginHookRegistry(): Record<
  HookEvent,
  PluginHookMatcher[]
> {
  return {
    PreToolUse: [],
    PostToolUse: [],
    PostToolUseFailure: [],
    PermissionDenied: [],
    Notification: [],
    UserPromptSubmit: [],
    SessionStart: [],
    SessionEnd: [],
    Stop: [],
    StopFailure: [],
    SubagentStart: [],
    SubagentStop: [],
    PreCompact: [],
    PostCompact: [],
    PermissionRequest: [],
    Setup: [],
    TeammateIdle: [],
    TaskCreated: [],
    TaskCompleted: [],
    Elicitation: [],
    ElicitationResult: [],
    ConfigChange: [],
    WorktreeCreate: [],
    WorktreeRemove: [],
    InstructionsLoaded: [],
    CwdChanged: [],
    FileChanged: [],
  };
}

export function replacePluginHookRegistry(
  nextRegistry: Partial<Record<HookEvent, PluginHookMatcher[]>>,
): void {
  clearRegisteredPluginHooks();
  registerHookCallbacks(nextRegistry);
}

export function prunePluginHookRegistryByRoots(enabledRoots: Set<string>): void {
  const current = getRegisteredHooks();
  if (!current) {
    return;
  }

  const survivors: Partial<Record<HookEvent, PluginHookMatcher[]>> = {};

  for (const [event, matchers] of Object.entries(current)) {
    const kept = matchers.filter(
      (matcher): matcher is PluginHookMatcher =>
        'pluginRoot' in matcher && enabledRoots.has(matcher.pluginRoot),
    );

    if (kept.length > 0) {
      survivors[event as HookEvent] = kept;
    }
  }

  replacePluginHookRegistry(survivors);
}

let registeredPluginCommands: readonly Command[] = [];

export type PluginCommandLoader = () => Promise<readonly Command[]>;

export function replaceRegisteredPluginCommands(
  commands: readonly Command[],
): void {
  registeredPluginCommands = [...commands];
}

export function getRegisteredPluginCommands(): readonly Command[] {
  return registeredPluginCommands;
}

export function clearRegisteredPluginCommands(): void {
  registeredPluginCommands = [];
}

export async function getOrLoadRegisteredPluginCommands(
  loader: PluginCommandLoader,
  options?: {
    forceReload?: boolean;
  },
): Promise<readonly Command[]> {
  const forceReload = options?.forceReload ?? false;

  if (!forceReload && registeredPluginCommands.length > 0) {
    return registeredPluginCommands;
  }

  const loadedCommands = await loader();
  replaceRegisteredPluginCommands(loadedCommands);
  return registeredPluginCommands;
}
