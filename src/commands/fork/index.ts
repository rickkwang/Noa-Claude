import type { Command } from '../../types/command.js'

const fork = {
  name: 'fork',
  description: 'Fork the current conversation and return a resumable session ID',
  type: 'local' as const,
  argumentHint: '[name]',
  isHidden: false,
  supportsNonInteractive: true,
  load: () => import('./fork.js'),
} satisfies Command

export default fork
