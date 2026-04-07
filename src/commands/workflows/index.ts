import type { Command } from '../../types/command.js'

const workflows = {
  name: 'workflows',
  description: 'Manage workflows',
  type: 'local-jsx' as const,
  isHidden: true,
  load: async () => ({
    call: async () => {
      throw new Error('Workflows feature is not available in this build')
    },
  }),
} satisfies Command

export default workflows
