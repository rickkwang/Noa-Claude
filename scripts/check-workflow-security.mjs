#!/usr/bin/env bun
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

// Keep Noa's read-only workflows and live-provider credentials scoped to their steps.
// Inspired by anthropics/claude-code's workflow-hardening check; no hosted-agent policy.
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../.github/workflows')
const failures = []
const hasSecrets = env => Object.values(env ?? {}).some(value => /\bsecrets(?:\.|\[)/.test(String(value)))
const hasModelSecrets = env => Object.entries(env ?? {}).some(([key, value]) =>
  /^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)$/.test(key) && hasSecrets({ value }))

function actionProblem(uses, withOptions) {
  if (!uses || uses.startsWith('./')) return undefined
  if (!/^[^@\s]+@[a-f\d]{40}$/i.test(uses)) return 'external actions must use a full commit SHA'
  if (uses.startsWith('actions/checkout@') && withOptions?.['persist-credentials'] !== false) {
    return 'checkout must set persist-credentials: false'
  }
}

for (const file of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
  const workflow = parse(readFileSync(join(directory, file), 'utf8'))
  if (hasSecrets(workflow.env)) failures.push(`${file}: workflow env must not expose secrets to every step`)
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    const where = `${file}:${id}`
    const permissions = job.permissions ?? workflow.permissions
    if (!permissions || permissions.contents !== 'read' ||
        Object.values(permissions).some(value => value !== 'read' && value !== 'none')) {
      failures.push(`${where}: explicitly grant only read/none permissions, including contents: read`)
    }
    if (hasSecrets(job.env)) failures.push(`${where}: job env must not expose secrets to every step`)
    const jobProblem = actionProblem(job.uses, job.with)
    if (jobProblem) failures.push(`${where}: ${jobProblem}`)
    for (const step of job.steps ?? []) {
      const place = `${where}:${step.name ?? step.uses ?? 'step'}`
      const problem = actionProblem(step.uses, step.with)
      if (problem) failures.push(`${place}: ${problem}`)
      if (hasModelSecrets(step.env) && !/\bbun run smoke:engine:live\b/.test(step.run ?? '')) {
        failures.push(`${place}: model secrets belong only on the live smoke step`)
      }
    }
  }
}
// Local composite actions run inside those jobs, so their steps follow the same rules.
const actionsDirectory = resolve(directory, '../actions')
for (const name of existsSync(actionsDirectory) ? readdirSync(actionsDirectory) : []) {
  const file = ['action.yml', 'action.yaml'].map(f => join(actionsDirectory, name, f)).find(existsSync)
  if (!file) continue
  const action = parse(readFileSync(file, 'utf8'))
  for (const step of action.runs?.steps ?? []) {
    const place = `actions/${name}:${step.name ?? step.uses ?? 'step'}`
    const problem = actionProblem(step.uses, step.with)
    if (problem) failures.push(`${place}: ${problem}`)
    if (hasSecrets(step.env) || /\bsecrets(?:\.|\[)/.test(JSON.stringify(step.with ?? {}))) {
      failures.push(`${place}: composite actions must not read secrets; pass them as inputs from the workflow step`)
    }
  }
}
for (const failure of failures) console.error(failure)
assert.equal(failures.length, 0, 'Workflow security checks failed')
console.log('Workflow security checks passed.')
