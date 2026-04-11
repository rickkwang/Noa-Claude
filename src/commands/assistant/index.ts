import type { Command } from '../../types/command.js'

const assistant = {
  name: 'assistant',
  description: 'Manage assistant mode preference and runtime status',
  argumentHint: '[status|enable|disable]',
  type: 'local' as const,
  supportsNonInteractive: true,
  isHidden: false,
  load: () => import('./assistant.js'),
} satisfies Command

export default assistant
