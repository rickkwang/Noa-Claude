// @ts-nocheck
import type { Command } from '../../commands.js'
import { isUsing3PServices } from '../../utils/auth.js'

export default {
  type: 'local-jsx',
  name: 'provider',
  description: 'Switch between configured AI providers',
  isEnabled: () => !isUsing3PServices(),
  load: () => import('./provider.js'),
} satisfies Command
