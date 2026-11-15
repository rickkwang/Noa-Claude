import type { LocalCommandCall } from '../../types/command.js'
import { isAdvisorEnabled } from '../../utils/advisor.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { describeAdvisor, getAdvisorUsageHint, setAdvisor } from './setAdvisor.js'

export const call: LocalCommandCall = async (args, context) => {
  if (!isAdvisorEnabled()) {
    return { type: 'text', value: 'The advisor is not available' }
  }
  const arg = args.trim().toLowerCase()
  const previous = context.getAppState().advisorModel
  if (!arg) {
    return {
      type: 'text',
      value: `${describeAdvisor(previous)}\n${getAdvisorUsageHint()}`,
    }
  }
  const choice = arg === 'unset' ? 'off' : arg
  return {
    type: 'text',
    value: setAdvisor(choice, previous, getMainLoopModel(), context.setAppState)
      .message,
  }
}
