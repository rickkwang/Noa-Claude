import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../../types/command.js'
import {
  buildWorkflowExecutionPrompt,
  loadAllWorkflows,
  parseWorkflowKeyValues,
  applyWorkflowTemplateVars,
} from '../../commands/workflows/shared.js'

function buildWorkflowDescription(steps: string[]): string {
  const firstStep = steps.find(step => step.trim().length > 0)?.trim()
  if (!firstStep) return 'Run a reusable local workflow'
  return firstStep.length <= 100 ? firstStep : `${firstStep.slice(0, 99)}…`
}

function buildWorkflowCommand(workflow: {
  name: string
  steps: string[]
}): Command {
  return {
    type: 'prompt',
    name: workflow.name,
    kind: 'workflow',
    description: buildWorkflowDescription(workflow.steps),
    progressMessage: 'running workflow',
    contentLength: workflow.steps.join('\n').length,
    source: 'builtin',
    argumentHint: '[k=v ...]',
    async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
      const vars = parseWorkflowKeyValues(args)
      const resolvedSteps = workflow.steps.map(step =>
        applyWorkflowTemplateVars(step, vars),
      )
      return [
        {
          type: 'text',
          text: buildWorkflowExecutionPrompt({
            name: workflow.name,
            steps: resolvedSteps,
          }),
        },
      ]
    },
  }
}

export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const workflows = await loadAllWorkflows(cwd)
  return workflows.map(workflow => buildWorkflowCommand(workflow))
}
