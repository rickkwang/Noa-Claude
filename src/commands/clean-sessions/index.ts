import type { Command } from '../../types/command.js'

const cleanSessions = {
  type: 'local-jsx',
  name: 'clean-sessions',
  description:
    'Preview or delete small/noisy Noa Claude resume sessions like ping/test/hello',
  argumentHint: '[scan|delete] [--all] [--trivial-only] [--confirm]',
  load: () => import('./clean-sessions.js'),
} satisfies Command

export default cleanSessions
