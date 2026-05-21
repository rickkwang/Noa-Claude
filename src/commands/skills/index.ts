// @ts-nocheck
import type { Command } from '../../commands.js'

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: 'Browse available skills',
  load: () => import('./skills.js'),
} satisfies Command

export default skills
