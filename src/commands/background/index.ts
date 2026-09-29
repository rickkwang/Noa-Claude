import type { Command } from '../../commands.js'

const background = {
  type: 'local-jsx',
  name: 'background',
  aliases: ['bg'],
  description: 'Send this session to the background and free the terminal',
  argumentHint: '[prompt]',
  // Bare, it runs at once (a running turn is stopped and finished in the
  // background); with a prompt it waits for the turn like any other input.
  immediate: (args: string) => !args.trim(),
  load: () => import('./background.js'),
} satisfies Command

export default background
