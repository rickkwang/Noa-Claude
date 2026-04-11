// @ts-nocheck
import type { Command } from '../../types/command.js'
import { throwBuildExcludedCommand } from '../buildExcluded.js'

const proactive = {
  name: 'proactive',
  description: 'Enable proactive mode',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('proactive')
    },
  }),
} satisfies Command

export default proactive
