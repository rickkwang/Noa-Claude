// @ts-nocheck
import { HOOK_EVENTS } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import { logForDebugging } from '../debug.js'
import type { HooksSettings } from '../settings/types.js'
import { addSessionHook, removeSessionHook } from './sessionHooks.js'

const MAX_SOURCE_HOOKS = 1024
const MAX_SOURCE_MATCHER_CHARS = 16_384

/**
 * Registers hooks from a skill's frontmatter as session hooks.
 *
 * Hooks are registered as session-scoped hooks that persist for the duration
 * of the session. If a hook has `once: true`, it will be automatically removed
 * after its first successful execution.
 *
 * @param setAppState - Function to update the app state
 * @param sessionId - The current session ID
 * @param hooks - The hooks settings from the skill's frontmatter
 * @param skillName - The name of the skill (for logging)
 * @param skillRoot - The base directory of the skill (for CLAUDE_PLUGIN_ROOT env var)
 */
export function registerSkillHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  hooks: HooksSettings,
  skillName: string,
  skillRoot?: string,
  sourceKey: string = skillRoot ?? skillName,
): void {
  let registeredCount = 0
  let budget!: { count: number; matcherChars: number }
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId) ?? { hooks: {} }
    store.skillHookBudgets ??= new Map()
    budget = store.skillHookBudgets.get(sourceKey) ?? { count: 0, matcherChars: 0 }
    store.skillHookBudgets.set(sourceKey, budget)
    prev.sessionHooks.set(sessionId, store)
    return prev
  })

  events: for (const eventName of HOOK_EVENTS) {
    const matchers = hooks[eventName]
    if (!matchers) continue

    for (const matcher of matchers) {
      const pattern = matcher.matcher || ''
      if (budget.matcherChars + pattern.length > MAX_SOURCE_MATCHER_CHARS) {
        logForDebugging(`Skill hook matcher budget exceeded for ${sourceKey}`, { level: 'warn' })
        continue
      }
      let chargedMatcher = false
      for (const hook of matcher.hooks) {
        if (budget.count >= MAX_SOURCE_HOOKS) {
          logForDebugging(`Skill hook count budget exceeded for ${sourceKey}`, { level: 'warn' })
          break events
        }
        // Each invocation owns its registration, including reused command objects.
        const registeredHook = { ...hook }
        // For once: true hooks, use onHookSuccess callback to remove after execution
        const onHookSuccess = hook.once
          ? () => {
              logForDebugging(
                `Removing one-shot hook for event ${eventName} in skill '${skillName}'`,
              )
              removeSessionHook(setAppState, sessionId, eventName, registeredHook)
            }
          : undefined

        addSessionHook(
          setAppState,
          sessionId,
          eventName,
          pattern,
          registeredHook,
          onHookSuccess,
          skillRoot,
        )
        budget.count++
        if (!chargedMatcher) {
          budget.matcherChars += pattern.length
          chargedMatcher = true
        }
        registeredCount++
      }
    }
  }

  if (registeredCount > 0) {
    logForDebugging(
      `Registered ${registeredCount} hooks from skill '${skillName}'`,
    )
  }
}
