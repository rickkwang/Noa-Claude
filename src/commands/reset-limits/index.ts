import type { CommandBase } from '../../types/command.js'

const stub = {
  isEnabled: () => false,
  isHidden: true,
  name: 'stub',
} satisfies Pick<CommandBase, 'isEnabled' | 'isHidden' | 'name'>

export default stub
export const resetLimits = stub
export const resetLimitsNonInteractive = stub
