// @ts-nocheck
import {
  clearRegisteredPluginHooks,
  getRegisteredHooks,
  registerHookCallbacks,
} from '../../bootstrap/state.js';
import type { HookEvent } from '../../entrypoints/agentSdkTypes.js';
import type { Command } from '../../types/command.js';
import type { PluginHookMatcher } from '../../utils/settings/types.js';

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
