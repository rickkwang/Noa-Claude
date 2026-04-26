import { throwBuildExcludedCommand } from './buildExcluded.js'
import type { Command } from '../types/command.js'

const forceSnip = {
  name: 'force-snip',
  description: 'Force session snipping',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('force-snip')
    },
  }),
} satisfies Command

export default forceSnip
