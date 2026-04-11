import { throwBuildExcludedCommand } from './buildExcluded.js'

const forceSnip = {
  name: 'force-snip',
  description: 'Force session snipping',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('force-snip')
    },
  }),
}

export default forceSnip
