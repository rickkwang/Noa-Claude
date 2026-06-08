// @ts-nocheck
import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Edit Noa Claude memory files',
  load: () => import('./memory.js'),
}

export default memory
