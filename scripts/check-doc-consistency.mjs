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
const operatingGuide = readFileSync(resolve(root, 'docs', 'operating-guide.md'), 'utf8')
const productGovernance = readFileSync(resolve(root, 'docs', 'product-governance.md'), 'utf8')
const maintenanceFreezePlan = readFileSync(
  resolve(root, 'docs', 'maintenance-freeze-plan.md'),
  'utf8',
)
const initPrompt = readFileSync(resolve(root, 'src', 'commands', 'init.ts'), 'utf8')
const initVerifiersPrompt = readFileSync(
  resolve(root, 'src', 'commands', 'init-verifiers.ts'),
  'utf8',
)
const productPaths = readFileSync(
  resolve(root, 'src', 'utils', 'productPaths.ts'),
  'utf8',
)
const skillChangeDetector = readFileSync(
  resolve(root, 'src', 'utils', 'skills', 'skillChangeDetector.ts'),
  'utf8',
)
const mcpApprovalDialog = readFileSync(
  resolve(root, 'src', 'components', 'MCPServerApprovalDialog.tsx'),
  'utf8',
)
const mcpMultiselectDialog = readFileSync(
  resolve(root, 'src', 'components', 'MCPServerMultiselectDialog.tsx'),
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
}

for (const command of buildExcludedCommands) {
  if (!matrix.includes(command)) {
    failures.push(`Feature matrix is missing build-excluded command ${command}`)
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

if (!readme.includes('docs/operating-guide.md')) {
  failures.push('README is missing focused docs link for operating guide')
}

if (!readme.includes('docs/product-governance.md')) {
  failures.push('README is missing focused docs link for product governance')
}

for (const scriptName of [
  'bun run typecheck',
  'bun run check:runtime',
  'bun run smoke:features',
]) {
  if (!readme.includes(scriptName)) {
    failures.push(`README verification section is missing "${scriptName}"`)
  }
}

if (!/Default local maintenance checks:[\s\S]*bun run smoke:engine[\s\S]*bun run scan:pr-intent/.test(readme)) {
  failures.push('README verification section is missing default local maintenance checks')
}

if (
  !/## Runtime Toggles[\s\S]*NOA_CLAUDE_NO_FLICKER=1[\s\S]*NOA_CLAUDE_DISABLE_MOUSE=1[\s\S]*NOA_CLAUDE_DISABLE_MOUSE_CLICKS=1[\s\S]*Legacy `CLAUDE_CODE_\*` names are still accepted for compatibility/.test(
    readme,
  )
) {
  failures.push(
    'README is missing the Noa fullscreen runtime toggles or their compatibility note',
  )
}

if (/Default local maintenance checks:[\s\S]*bun run smoke:engine:live[\s\S]*Release candidate provider check:/.test(readme)) {
  failures.push('README must not list smoke:engine:live as a default local maintenance check')
}

if (!/Release candidate provider check:[\s\S]*bun run smoke:engine:live/.test(readme)) {
  failures.push('README is missing release candidate provider check')
}

if (!/smoke:engine:live[\s\S]*ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN/.test(readme)) {
  failures.push('README must document both supported credentials for smoke:engine:live')
}

if (!/This document merges the runtime, session, worktree, agent, and progress-artifact notes/.test(
  operatingGuide,
)) {
  failures.push('Operating guide is missing merge summary')
}

if (
  !/Runtime behavior switches are driven by environment variables:[\s\S]*NOA_CLAUDE_NO_FLICKER[\s\S]*NOA_CLAUDE_DISABLE_MOUSE[\s\S]*NOA_CLAUDE_DISABLE_MOUSE_CLICKS/.test(
    operatingGuide,
  )
) {
  failures.push(
    'Operating guide is missing the Noa fullscreen runtime toggles',
  )
}

if (/Legacy `CLAUDE_CODE_\*` names remain supported for compatibility/.test(operatingGuide)) {
  failures.push('Operating guide still advertises legacy CLAUDE_CODE_* compatibility')
}

for (const command of baselineCommands) {
  if (!productGovernance.includes(command)) {
    failures.push(`Product governance doc is missing baseline command ${command}`)
  }
}

for (const command of implementedNonBaselineCommands) {
  if (!productGovernance.includes(command)) {
    failures.push(
      `Product governance doc is missing implemented non-baseline command ${command}`,
    )
  }
}

if (!/\/output-style[\s\S]*deprecated shim/i.test(productGovernance)) {
  failures.push(
    'Product governance doc must mark /output-style as a deprecated shim',
  )
}

if (
  !/\/output-style[\s\S]*not eligible for baseline promotion/i.test(
    productGovernance,
  )
) {
  failures.push(
    'Product governance doc must state that /output-style is not baseline-promotable as a shim',
  )
}

for (const command of buildExcludedCommands) {
  if (!productGovernance.includes(command)) {
    failures.push(`Product governance doc is missing build-excluded command ${command}`)
  }
}

if (
  !/\/remote-control[\s\S]*slash command surface[\s\S]*bridge\/remote runtime code/i.test(
    productGovernance,
  )
) {
  failures.push(
    'Product governance doc must distinguish /remote-control command surface vs runtime bridge code',
  )
}

if (
  !/\/remote-control[\s\S]*slash command surface only[\s\S]*E_BUILD_EXCLUDED_/i.test(
    matrix,
  )
) {
  failures.push(
    'Feature matrix must distinguish /remote-control slash command surface and build-excluded runtime contract',
  )
}

for (const command of stubCommands) {
  if (!productGovernance.includes(command)) {
    failures.push(`Product governance doc is missing stub command ${command}`)
  }
}

if (!productGovernance.includes('maintenance-freeze-plan.md')) {
  failures.push('Product governance doc is missing maintenance freeze plan link')
}

if (!/command-surface boundary[\s\S]*maintenance plan defines what changes are allowed during freeze/i.test(productGovernance)) {
  failures.push(
    'Product governance doc must distinguish command-surface boundary from freeze policy',
  )
}

if (!/Noa Claude is in feature freeze/.test(maintenanceFreezePlan)) {
  failures.push('Maintenance freeze plan is missing feature freeze status')
}

if (!/New baseline commands/.test(maintenanceFreezePlan)) {
  failures.push('Maintenance freeze plan is missing new baseline command restriction')
}

if (!/smoke:engine:live[\s\S]*ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN/.test(maintenanceFreezePlan)) {
  failures.push('Maintenance freeze plan must document both supported credentials for live smoke')
}

if (!/## Runtime Health/.test(operatingGuide)) {
  failures.push('Operating guide is missing runtime health section')
}

if (!/## Session Continuity/.test(operatingGuide)) {
  failures.push('Operating guide is missing session continuity section')
}

if (!/## Worktrees/.test(operatingGuide)) {
  failures.push('Operating guide is missing worktrees section')
}

if (!/## Agents/.test(operatingGuide)) {
  failures.push('Operating guide is missing agents section')
}

for (const [label, text] of [
  ['init prompt', initPrompt],
  ['init verifier prompt', initVerifiersPrompt],
  ['product paths', productPaths],
  ['skill change detector', skillChangeDetector],
  ['MCP approval dialog', mcpApprovalDialog],
  ['MCP multiselect dialog', mcpMultiselectDialog],
]) {
  if (/legacy .*\.mcp\.json fallback/i.test(text)) {
    failures.push(`${label} still mentions legacy .mcp.json fallback`)
  }
  if (/legacy \\.claude\/skills/i.test(text)) {
    failures.push(`${label} still mentions legacy .claude/skills`)
  }
  if (/legacy \\.claude\/commands/i.test(text)) {
    failures.push(`${label} still mentions legacy .claude/commands`)
  }
}

if (failures.length > 0) {
  console.error('Documentation consistency check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Documentation consistency check passed.')
