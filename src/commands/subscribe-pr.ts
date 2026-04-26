import { throwBuildExcludedCommand } from './buildExcluded.js'
import type { Command } from '../types/command.js'

const subscribePr = {
  name: 'subscribe-pr',
  description: 'Subscribe to PR notifications',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('subscribe-pr')
    },
  }),
} satisfies Command

export default subscribePr
