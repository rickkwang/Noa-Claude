import type { Command } from '../../types/command.js'

const workflows = {
  name: 'workflows',
  description: 'Manage local reusable workflows',
  type: 'local-jsx' as const,
  argumentHint: 'list | create <name> :: <step1> ;; <step2> | run <name> [k=v] | delete <name>',
  isHidden: false,
  load: () => import('./workflows.js'),
} satisfies Command

export default workflows
