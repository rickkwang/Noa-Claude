// @ts-nocheck
import type { Command } from '../../commands.js'

const provider = {
  type: 'local-jsx',
  name: 'provider',
  description: 'Manage AI provider profiles',
  argumentHint: '[list|add|edit|delete]',
  immediate: true,
  load: () => import('./provider.js'),
} satisfies Command

export default provider
