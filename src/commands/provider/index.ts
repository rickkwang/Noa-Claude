// @ts-nocheck
import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'provider',
  description: 'Switch between configured AI providers',
  isEnabled: () => true,
  load: () => import('./provider.js'),
} satisfies Command
