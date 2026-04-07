// @ts-nocheck
import type { Command } from '../../types/command.js'

const agentsPlatform = {
  name: 'agents-platform',
  description: 'Manage agents platform',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Agents platform is not available in this build')
    },
  }),
} satisfies Command

export default agentsPlatform
