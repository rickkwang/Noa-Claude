import { throwBuildExcludedCommand } from './buildExcluded.js'

const subscribePr = {
  name: 'subscribe-pr',
  description: 'Subscribe to PR notifications',
  type: 'local-jsx',
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('subscribe-pr')
    },
  }),
}

export default subscribePr
