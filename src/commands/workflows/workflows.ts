import type { LocalJSXCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import {
  applyWorkflowTemplateVars,
  buildWorkflowExecutionPrompt,
  deleteWorkflow,
  loadAllWorkflows,
  normalizeWorkflowName,
  parseWorkflowKeyValues,
  usageText,
  writeWorkflow,
} from './shared.js'

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const raw = args.trim()
  if (!raw) {
    onDone(usageText(), { display: 'system' })
    return null
  }

  const [subcommand, ...rest] = raw.split(/\s+/)
  const action = subcommand?.toLowerCase()
  const cwd = getCwd()

  if (action === 'list') {
    const all = await loadAllWorkflows(cwd)
    if (all.length === 0) {
      onDone('No workflows found.', { display: 'system' })
      return null
    }
    const lines = all.map(wf => `- ${wf.name}: ${wf.steps.length} step(s)`)
    onDone(`Workflows:\n${lines.join('\n')}`, { display: 'system' })
    return null
  }

  if (action === 'create') {
    const createRaw = rest.join(' ')
    const pivot = createRaw.indexOf('::')
    if (pivot <= 0) {
      onDone('Invalid workflow syntax. Usage: /workflows create <name> :: <step1> ;; <step2>.', {
        display: 'system',
      })
      return null
    }
    const name = normalizeWorkflowName(createRaw.slice(0, pivot))
    const stepsRaw = createRaw.slice(pivot + 2)
    const steps = stepsRaw
      .split(';;')
      .map(s => s.trim())
      .filter(Boolean)
    if (!name || steps.length === 0) {
      onDone('Workflow name and at least one step are required.', {
        display: 'system',
      })
      return null
    }

    const now = new Date().toISOString()
    const path = await writeWorkflow(cwd, {
      name,
      steps,
      createdAt: now,
      updatedAt: now,
    })
    onDone(`Created workflow '${name}' at ${path}`, { display: 'system' })
    return null
  }

  if (action === 'delete') {
    const name = normalizeWorkflowName(rest.join(' '))
    if (!name) {
      onDone('Workflow name is required for delete.', {
        display: 'system',
      })
      return null
    }
    const removed = await deleteWorkflow(cwd, name)
    if (removed === 0) {
      onDone(`Workflow '${name}' not found.`, { display: 'system' })
      return null
    }
    onDone(`Deleted workflow '${name}'.`, { display: 'system' })
    return null
  }

  if (action === 'run') {
    const name = normalizeWorkflowName(rest[0] ?? '')
    if (!name) {
      onDone('Workflow name is required for run.', {
        display: 'system',
      })
      return null
    }
    const vars = parseWorkflowKeyValues(rest.slice(1).join(' '))
    const all = await loadAllWorkflows(cwd)
    const wf = all.find(item => item.name === name)
    if (!wf) {
      onDone(`Workflow '${name}' not found.`, { display: 'system' })
      return null
    }
    const resolvedSteps = wf.steps.map(step =>
      applyWorkflowTemplateVars(step, vars),
    )
    const workflowPrompt = buildWorkflowExecutionPrompt({
      name: wf.name,
      steps: resolvedSteps,
    })
    onDone(`Running workflow '${wf.name}' (${resolvedSteps.length} step(s)).`, {
      display: 'system',
      nextInput: workflowPrompt,
      submitNextInput: true,
    })
    return null
  }

  onDone(`Unknown subcommand '${action}'.\n\n${usageText()}`, {
    display: 'system',
  })
  return null
}
