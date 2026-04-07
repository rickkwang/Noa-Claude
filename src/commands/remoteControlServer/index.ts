// @ts-nocheck
import type { Command } from '../../types/command.js'

const remoteControlServer = {
  name: 'remote-control',
  description: 'Remote control server',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Remote control server is not available in this build')
    },
  }),
} satisfies Command

export default remoteControlServer
