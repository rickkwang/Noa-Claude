// @ts-nocheck
import type { Command } from '../../commands.js'
import { isBgSession } from '../../utils/background/bgJob.js'

const exit = {
  type: 'local-jsx',
  name: 'exit',
  aliases: ['quit'],
  get description() {
    return isBgSession() ? 'Detach from this background session (it keeps running)' : 'Exit the REPL'
  },
  immediate: true,
  load: () => import('./exit.js'),
} satisfies Command

export default exit
