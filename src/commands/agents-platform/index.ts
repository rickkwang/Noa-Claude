import type { Command } from '../../types/command.js'
import { throwBuildExcludedCommand } from '../buildExcluded.js'

const agentsPlatform = {
  name: 'agents-platform',
  description: 'Manage agents platform',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('agents-platform')
    },
  }),
} satisfies Command

export default agentsPlatform
