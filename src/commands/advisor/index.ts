import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { isAdvisorEnabled } from '../../utils/advisor.js'
import { getAdvisorAliases } from './setAdvisor.js'

const description = 'Let Claude consult a stronger model at key moments'

function argumentHint(): string {
  return `[${[...getAdvisorAliases(), 'off'].join('|')}]`
}

export const advisor: Command = {
  type: 'local-jsx',
  name: 'advisor',
  description,
  get argumentHint() {
    return argumentHint()
  },
  isEnabled: () => isAdvisorEnabled() && !getIsNonInteractiveSession(),
  get isHidden() {
    return !isAdvisorEnabled() || getIsNonInteractiveSession()
  },
  load: () => import('./advisor.js'),
}

export const advisorNonInteractive: Command = {
  type: 'local',
  name: 'advisor',
  supportsNonInteractive: true,
  description,
  get argumentHint() {
    return argumentHint()
  },
  isEnabled: () => isAdvisorEnabled() && getIsNonInteractiveSession(),
  get isHidden() {
    return !isAdvisorEnabled() || !getIsNonInteractiveSession()
  },
  load: () => import('./advisor-noninteractive.js'),
}
