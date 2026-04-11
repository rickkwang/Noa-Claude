// @ts-nocheck
import type { Command } from '../../types/command.js'
import { throwBuildExcludedCommand } from '../buildExcluded.js'

const peers = {
  name: 'peers',
  description: 'Manage peer connections',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('peers')
    },
  }),
} satisfies Command

export default peers
