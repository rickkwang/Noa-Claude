// @ts-nocheck
import type { Command } from '../../types/command.js'

const proactive = {
  name: 'proactive',
  description: 'Enable proactive mode',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Proactive mode is not available in this build')
    },
  }),
} satisfies Command

export default proactive
