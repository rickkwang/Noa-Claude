import type { AppState } from '../../state/AppStateStore.js'
import {
  isValidAdvisorModel,
  isValidAdvisorPairing,
  modelSupportsAdvisor,
} from '../../utils/advisor.js'
import {
  normalizeModelStringForAPI,
  parseUserSpecifiedModel,
  renderModelName,
} from '../../utils/model/model.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

const ADVISOR_ALIASES = ['fable', 'opus', 'sonnet'] as const

export function resolveAdvisorModel(model: string): string {
  return normalizeModelStringForAPI(parseUserSpecifiedModel(model))
}

export function getAdvisorAliases(): string[] {
  return ADVISOR_ALIASES.filter(alias =>
    isValidAdvisorModel(resolveAdvisorModel(alias)),
  )
}

export function getAdvisorUsageHint(): string {
  return `Usage: /advisor <${[...getAdvisorAliases(), 'off'].join('|')}>`
}

export function describeAdvisor(advisorModel: string | undefined): string {
  return advisorModel
    ? `Advisor: ${renderModelName(resolveAdvisorModel(advisorModel))}`
    : 'Advisor: off'
}

/**
 * Applies an /advisor choice ('off' or a model alias/ID) to the session and
 * the user settings. `changed` is true when the session's advisor changed,
 * which alters the request's tools and system prompt.
 */
export function setAdvisor(
  choice: string,
  previous: string | undefined,
  mainLoopModel: string,
  setAppState: (f: (prev: AppState) => AppState) => void,
): { message: string; changed: boolean } {
  if (choice === 'off') {
    setAppState(prev =>
      prev.advisorModel === undefined
        ? prev
        : { ...prev, advisorModel: undefined },
    )
    const result = updateSettingsForSource('userSettings', {
      advisorModel: undefined,
    })
    const changed = previous !== undefined
    if (result.error) {
      return {
        message: `Failed to save advisor setting: ${result.error.message}`,
        changed,
      }
    }
    return { message: 'Advisor disabled', changed }
  }

  const advisor = resolveAdvisorModel(choice)
  if (!isValidAdvisorModel(advisor)) {
    const valid = [...getAdvisorAliases(), 'off'].join(', ')
    return {
      message: `${choice} cannot be used as an advisor. Valid options: ${valid}`,
      changed: false,
    }
  }

  setAppState(prev =>
    prev.advisorModel === choice ? prev : { ...prev, advisorModel: choice },
  )
  const result = updateSettingsForSource('userSettings', {
    advisorModel: choice,
  })
  const changed = previous !== choice
  if (result.error) {
    return {
      message: `Failed to save advisor setting: ${result.error.message}`,
      changed,
    }
  }

  const advisorName = renderModelName(advisor)
  const mainName = renderModelName(mainLoopModel)
  let message = `Advisor set to ${advisorName}`
  if (!modelSupportsAdvisor(mainLoopModel)) {
    message += `\nNote: the current main model (${mainName}) does not support the advisor. It will activate when you switch to a supported main model.`
  } else if (!isValidAdvisorPairing(mainLoopModel, advisor)) {
    message += `\nNote: ${advisorName} is less capable than the current main model (${mainName}), so the advisor will not activate. Choose a more capable advisor, or switch to a smaller main model.`
  }
  return { message, changed }
}
