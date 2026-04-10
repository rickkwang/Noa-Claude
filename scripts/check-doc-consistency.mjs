#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const readmePath = resolve(root, 'README.md')
const matrixPath = resolve(root, 'FEATURE_AVAILABILITY_MATRIX.md')

const readme = readFileSync(readmePath, 'utf8')
const matrix = readFileSync(matrixPath, 'utf8')
const progressArtifactsPath = resolve(root, 'docs', 'progress-artifacts.md')
const progressArtifacts = readFileSync(progressArtifactsPath, 'utf8')

const requiredProductCommands = ['/fork', '/workflows', '/summary', '/share']
const failures = []

for (const command of requiredProductCommands) {
  if (!readme.includes(command)) {
    failures.push(`README is missing product command ${command}`)
  }
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rowPattern = new RegExp(`\\|\\s*\`?${escapedCommand}\`?\\s*\\|\\s*Available\\s*\\|`, 'i')
  if (!rowPattern.test(matrix)) {
    failures.push(`Feature matrix does not mark ${command} as Available`)
  }
}

if (!/## Slash Commands: Product-Available/.test(matrix)) {
  failures.push('Feature matrix is missing "Slash Commands: Product-Available" section')
}

if (!readme.includes('docs/progress-artifacts.md')) {
  failures.push('README is missing focused docs link for progress artifacts')
}

if (!progressArtifacts.includes('.claude-agent/progress.md')) {
  failures.push('Progress artifacts doc is missing the project-local progress path')
}

if (failures.length > 0) {
  console.error('Documentation consistency check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Documentation consistency check passed.')
