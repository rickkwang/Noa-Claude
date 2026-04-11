import type { Command } from '../../types/command.js'
import { throwBuildExcludedCommand } from '../buildExcluded.js'

const remoteControlServer = {
  name: 'remote-control',
  description: 'Remote control server',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throwBuildExcludedCommand('remote-control')
    },
  }),
} satisfies Command

export default remoteControlServer
