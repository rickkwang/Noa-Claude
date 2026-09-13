import type { Command } from '../../commands.js'

const outputStyle = {
  type: 'local-jsx',
  name: 'output-style',
  description: 'Change how Noa Claude communicates in its responses',
  load: () => import('./output-style.js'),
} satisfies Command

export default outputStyle
