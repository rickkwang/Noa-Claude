import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  // Upstream folds /cost and /stats into /usage; both resolve here.
  aliases: ['cost', 'stats'],
  description: 'Show usage, config, and stats',
  load: () => import('./usage.js'),
} satisfies Command
