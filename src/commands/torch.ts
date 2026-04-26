import { throwBuildExcludedCommand } from './buildExcluded.js'
import type { Command } from '../types/command.js'

const torch = {
  name: 'torch',
  description: 'Torch command',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('torch')
    },
  }),
} satisfies Command

export default torch
