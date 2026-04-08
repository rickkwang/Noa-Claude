import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { getPrimaryProjectSubdir, getProjectSubdirCandidates } from '../../utils/productPaths.js'

export type StoredWorkflow = {
  name: string
  steps: string[]
  createdAt: string
  updatedAt: string
}

export type WorkflowWithSource = StoredWorkflow & {
  sourcePath: string
}

export function usageText(): string {
  return [
    'Usage:',
    '  /workflows list',
    '  /workflows create <name> :: <step1> ;; <step2>',
    '  /workflows run <name> [k=v ...]',
    '  /workflows delete <name>',
    '',
    'Notes:',
    '  - Project path priority: .claude-agent/workflows > .claude/workflows',
    '  - Use {{var}} placeholders in steps and pass values via k=v',
  ].join('\n')
}

export function normalizeWorkflowName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-')
}

export function parseWorkflowKeyValues(raw: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const part of raw.split(/\s+/).filter(Boolean)) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key) vars[key] = value
  }
  return vars
}

export function applyWorkflowTemplateVars(
  input: string,
  vars: Record<string, string>,
): string {
  return input.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, key) => vars[key] ?? '')
}

export function buildWorkflowExecutionPrompt(workflow: {
  name: string
  steps: string[]
}): string {
  return [
    `Run workflow '${workflow.name}' exactly in the order below and report progress after each step:`,
    ...workflow.steps.map((step, index) => `${index + 1}. ${step}`),
  ].join('\n')
}

export async function loadWorkflowFromFile(
  path: string,
): Promise<StoredWorkflow | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredWorkflow>
    if (!parsed || typeof parsed.name !== 'string') return null
    if (!Array.isArray(parsed.steps)) return null
    const steps = parsed.steps.filter(
      step => typeof step === 'string' && step.trim().length > 0,
    )
    if (steps.length === 0) return null
    return {
      name: normalizeWorkflowName(parsed.name),
      steps,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function loadAllWorkflows(
  cwd: string,
): Promise<WorkflowWithSource[]> {
  const candidates = getProjectSubdirCandidates(cwd, 'workflows')
  if (!candidates.some(path => existsSync(path))) {
    return []
  }
  const deduped = new Map<string, WorkflowWithSource>()

  for (const dir of candidates) {
    let entries: string[] = []
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const fullPath = join(dir, entry)
      const loaded = await loadWorkflowFromFile(fullPath)
      if (!loaded) continue
      const key = normalizeWorkflowName(loaded.name || basename(entry, '.json'))
      if (!key || deduped.has(key)) continue
      deduped.set(key, {
        ...loaded,
        name: key,
        sourcePath: fullPath,
      })
    }
  }

  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function writeWorkflow(
  cwd: string,
  workflow: StoredWorkflow,
): Promise<string> {
  const root = getPrimaryProjectSubdir(cwd, 'workflows')
  await mkdir(root, { recursive: true })
  const path = join(root, `${normalizeWorkflowName(workflow.name)}.json`)
  await writeFile(path, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8')
  return path
}

export async function deleteWorkflow(
  cwd: string,
  name: string,
): Promise<number> {
  const filename = `${normalizeWorkflowName(name)}.json`
  const candidates = getProjectSubdirCandidates(cwd, 'workflows').map(dir =>
    join(dir, filename),
  )
  let removed = 0
  await Promise.all(
    candidates.map(async path => {
      try {
        await rm(path)
        removed += 1
      } catch {
        // Ignore missing files
      }
    }),
  )
  return removed
}
