import type { LocalCommandCall } from '../../types/command.js'
import { applyAutoCompactWindow, describeAutoCompactWindowStatus } from './window.js'

export const call: LocalCommandCall = async (args, context) => {
  const model = context.options.mainLoopModel
  const trimmed = (args ?? '').trim()
  if (trimmed) {
    return { type: 'text', value: await applyAutoCompactWindow(trimmed, model) }
  }
  return { type: 'text', value: describeAutoCompactWindowStatus(model) }
}
