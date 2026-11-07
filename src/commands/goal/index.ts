import type { Command } from '../../commands.js'

const goal = {
  type: 'local',
  name: 'goal',
  description: 'Set or view the goal for a long-running task',
  argumentHint: '[<objective>|pause|resume|clear]',
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
