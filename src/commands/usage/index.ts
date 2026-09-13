import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  // No aliases: /cost is its own command here (session cost + duration), and
  // /stats lands on the dashboard's Stats tab via its own command.
  description: 'Show usage, config, and stats',
  load: () => import('./usage.js'),
} satisfies Command
