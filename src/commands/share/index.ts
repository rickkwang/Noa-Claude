import type { Command } from '../../types/command.js'

const share = {
  type: 'local',
  name: 'share',
  description: 'Export a local share snapshot for the current session',
  argumentHint: '[filename] [--detailed]',
  supportsNonInteractive: true,
  isHidden: false,
  load: () => import('./share.js'),
} satisfies Command

export default share
