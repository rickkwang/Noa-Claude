import type { Command } from '../../commands.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: 'Show usage activity stats — sessions, tokens, and models over time',
  immediate: true,
  load: () => import('./stats.js'),
} satisfies Command

export default stats
