import { throwBuildExcludedCommand } from './buildExcluded.js'

const torch = {
  name: 'torch',
  description: 'Torch command',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('torch')
    },
  }),
}

export default torch
