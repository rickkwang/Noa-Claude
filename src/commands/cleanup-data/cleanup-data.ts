// @ts-nocheck
import { rm } from 'fs/promises'
import { join } from 'path'
import { getProjectRoot } from '../../bootstrap/state.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import {
  getLegacyProjectFile,
  getLegacyProjectSubdir,
  getPrimaryProjectFile,
  getPrimaryProjectSubdir,
} from '../../utils/productPaths.js'
import { getProjectDir } from '../../utils/sessionStoragePortable.js'

type CleanupScope = 'project' | 'all'

type CleanupTarget = {
  path: string
  reason: string
}

function parseArgs(args: string): {
  scope: CleanupScope
  confirm: boolean
  dryRun: boolean
} {
  const parts = args
    .split(/\s+/)
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)

  const scope: CleanupScope = parts.includes('all') ? 'all' : 'project'
  const confirm = parts.includes('--confirm') || parts.includes('confirm')
  const dryRun = parts.includes('--dry-run') || parts.includes('dry-run')
  return { scope, confirm, dryRun }
}

function buildTargets(scope: CleanupScope): CleanupTarget[] {
  const projectRoot = getProjectRoot()
  const projectSessionDir = getProjectDir(projectRoot)
  const autoMemPath = getAutoMemPath().replace(/[\\/]+$/, '')
  const historyPath = join(getClaudeConfigHomeDir(), 'history.jsonl')

  const targets: CleanupTarget[] = [
    {
      path: getPrimaryProjectSubdir(projectRoot, 'shares'),
      reason: 'Project share snapshots',
    },
    {
      path: getLegacyProjectSubdir(projectRoot, 'shares'),
      reason: 'Legacy project share snapshots',
    },
    {
      path: getPrimaryProjectFile(projectRoot, 'progress.md'),
      reason: 'Project progress artifact',
    },
    {
      path: getLegacyProjectFile(projectRoot, 'progress.md'),
      reason: 'Legacy project progress artifact',
    },
    {
      path: projectSessionDir,
      reason: 'Session transcripts and metadata for this project',
    },
    {
      path: autoMemPath,
      reason: 'Auto-memory directory for this project',
    },
  ]

  if (scope === 'all') {
    targets.push({
      path: historyPath,
      reason: 'Global prompt history',
    })
  }

  // Stable ordering and de-duplication for deterministic output.
  const dedup = new Map<string, CleanupTarget>()
  for (const target of targets) {
    if (!dedup.has(target.path)) {
      dedup.set(target.path, target)
    }
  }
  return [...dedup.values()].sort((a, b) => a.path.localeCompare(b.path))
}

async function deleteTargets(targets: CleanupTarget[]): Promise<string[]> {
  const deleted: string[] = []
  for (const target of targets) {
    try {
      await rm(target.path, { recursive: true, force: true })
      deleted.push(target.path)
    } catch {
      // Keep going. rm(force:true) already swallows most "missing path" cases.
    }
  }
  return deleted
}

export const call: LocalCommandCall = async args => {
  const { scope, confirm, dryRun } = parseArgs(args || '')
  const targets = buildTargets(scope)

  if (!confirm || dryRun) {
    const header = [
      `Cleanup scope: ${scope}`,
      'This command removes local tracking data and keeps settings/config files.',
      '',
      'Targets:',
      ...targets.map(t => `- ${t.path} (${t.reason})`),
      '',
      'No files deleted.',
      `Run /cleanup-data ${scope} --confirm to execute.`,
    ]
    return { type: 'text', value: header.join('\n') }
  }

  const deleted = await deleteTargets(targets)
  return {
    type: 'text',
    value: [
      `Cleanup complete (${scope}).`,
      `Deleted targets: ${deleted.length}/${targets.length}`,
      ...deleted.map(path => `- ${path}`),
    ].join('\n'),
  }
}
