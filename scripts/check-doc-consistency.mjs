#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COMMAND_SURFACE_STATUS,
  getCommandSurfacesByCategory,
} from '../src/commands/surfaceStatus.ts'

const root = process.cwd()
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
const matrix = readFileSync(resolve(root, 'FEATURE_AVAILABILITY_MATRIX.md'), 'utf8')
const progressArtifacts = readFileSync(
  resolve(root, 'docs', 'progress-artifacts.md'),
  'utf8',
)
const roadmap = readFileSync(
  resolve(root, 'docs', 'optimization-roadmap.md'),
  'utf8',
)
const governance = readFileSync(
  resolve(root, 'docs', 'command-surface-governance.md'),
  'utf8',
)
const featureGapAudit = readFileSync(
  resolve(root, 'docs', 'feature-gap-audit.md'),
  'utf8',
)

const baselineCommands = getCommandSurfacesByCategory('baseline').map(
  entry => entry.command,
)
const implementedNonBaselineCommands = getCommandSurfacesByCategory(
  'implemented-non-baseline',
).map(entry => entry.command)
const buildExcludedCommands = getCommandSurfacesByCategory('build-excluded').map(
  entry => entry.command,
)
const stubCommands = getCommandSurfacesByCategory('stub').map(
  entry => entry.command,
)

const failures = []

for (const command of baselineCommands) {
  if (!readme.includes(command)) {
    failures.push(`README is missing baseline command ${command}`)
  }
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rowPattern = new RegExp(
    `\\|\\s*\`?${escapedCommand}\`?\\s*\\|\\s*Available\\s*\\|`,
    'i',
  )
  if (!rowPattern.test(matrix)) {
    failures.push(
      `Feature matrix does not mark baseline command ${command} as Available`,
    )
  }
}

for (const command of implementedNonBaselineCommands) {
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rowPattern = new RegExp(
    `\\|\\s*\`?${escapedCommand}\`?\\s*\\|\\s*Available\\s*\\|`,
    'i',
  )
  if (!rowPattern.test(matrix)) {
    failures.push(
      `Feature matrix does not mark implemented non-baseline command ${command} as Available`,
    )
  }
  if (!governance.includes(command)) {
    failures.push(
      `Governance doc is missing implemented non-baseline command ${command}`,
    )
  }
  if (!featureGapAudit.includes(command)) {
    failures.push(
      `Feature gap audit is missing implemented non-baseline command ${command}`,
    )
  }
}

for (const command of buildExcludedCommands) {
  if (!matrix.includes(command)) {
    failures.push(`Feature matrix is missing build-excluded command ${command}`)
  }
  if (!governance.includes(command)) {
    failures.push(`Governance doc is missing build-excluded command ${command}`)
  }
  if (!featureGapAudit.includes(command)) {
    failures.push(`Feature gap audit is missing build-excluded command ${command}`)
  }
}

for (const command of stubCommands) {
  if (!matrix.includes(command)) {
    failures.push(`Feature matrix is missing stub command ${command}`)
  }
}

for (const entry of COMMAND_SURFACE_STATUS) {
  if (!entry.reason || !entry.upgradeCondition) {
    failures.push(
      `Surface status entry ${entry.command} is missing reason/upgradeCondition`,
    )
  }
}

if (!/## Slash Commands: Product-Available/.test(matrix)) {
  failures.push(
    'Feature matrix is missing "Slash Commands: Product-Available" section',
  )
}

if (!/## Slash Commands: Implemented but Non-Baseline/.test(matrix)) {
  failures.push(
    'Feature matrix is missing "Slash Commands: Implemented but Non-Baseline" section',
  )
}

if (!/## Slash Commands: Build-Excluded/.test(matrix)) {
  failures.push(
    'Feature matrix is missing "Slash Commands: Build-Excluded" section',
  )
}

if (!/## Slash Commands: Stub/.test(matrix)) {
  failures.push('Feature matrix is missing "Slash Commands: Stub" section')
}

if (/## Slash Commands: Hidden but Implemented/.test(matrix)) {
  failures.push(
    'Feature matrix still uses deprecated section title "Hidden but Implemented"',
  )
}

if (!readme.includes('docs/progress-artifacts.md')) {
  failures.push('README is missing focused docs link for progress artifacts')
}

if (!readme.includes('docs/optimization-roadmap.md')) {
  failures.push('README is missing focused docs link for optimization roadmap')
}

if (!readme.includes('docs/command-surface-governance.md')) {
  failures.push('README is missing focused docs link for command surface governance')
}

if (!progressArtifacts.includes('.claude-agent/progress.md')) {
  failures.push('Progress artifacts doc is missing the project-local progress path')
}

if (!/## Phase 1: Truth and Guardrails/.test(roadmap)) {
  failures.push('Optimization roadmap is missing Phase 1 section')
}

if (!/## Build-Excluded Commands/.test(governance)) {
  failures.push('Command surface governance doc is missing Build-Excluded section')
}

if (!/Upgrade condition/.test(featureGapAudit)) {
  failures.push('Feature gap audit must include an "Upgrade condition" column')
}

if (failures.length > 0) {
  console.error('Documentation consistency check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Documentation consistency check passed.')
