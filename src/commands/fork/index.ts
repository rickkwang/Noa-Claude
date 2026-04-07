import type { Command } from '../../types/command.js'

const fork = {
  name: 'fork',
  description: 'Fork a sub-agent session',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Fork feature is not available in this build')
    },
  }),
} satisfies Command

export default fork
