// @ts-nocheck
import type { Command } from '../../types/command.js'

const peers = {
  name: 'peers',
  description: 'Manage peer connections',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Peers feature is not available in this build')
    },
  }),
} satisfies Command

export default peers
