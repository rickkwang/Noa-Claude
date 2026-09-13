import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  // No 'cost' alias: /cost is its own command here (session cost + duration).
  aliases: ['stats'],
  description: 'Show usage, config, and stats',
  load: () => import('./usage.js'),
} satisfies Command
