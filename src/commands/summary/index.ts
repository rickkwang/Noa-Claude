import type { Command } from '../../types/command.js'

const summary = {
  type: 'local',
  name: 'summary',
  description: 'Generate a structured summary of the current session',
  argumentHint: '[short|detailed]',
  supportsNonInteractive: true,
  isHidden: false,
  load: () => import('./summary.js'),
} satisfies Command

export default summary
