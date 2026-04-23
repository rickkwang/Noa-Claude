import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show usage, config, and stats',
  load: () => import('./usage.js'),
} satisfies Command
