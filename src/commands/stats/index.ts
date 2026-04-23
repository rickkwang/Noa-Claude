// @ts-nocheck
import type { Command } from '../../commands.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: 'Deprecated: use /usage',
  load: () => import('./stats.js'),
} satisfies Command

export default stats
