import { homedir } from 'os'
import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { getProjectRoot } from '../../bootstrap/state.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { formatFileSize } from '../../utils/format.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import {
  getPrimaryProjectFile,
  getPrimaryProjectSubdir,
} from '../../utils/productPaths.js'

type CleanupScope = 'project' | 'all'

type CleanupTarget = {
  path: string
  reason: string
}

type ResolvedTarget = CleanupTarget & {
  exists: boolean
  size: number
}

function parseArgs(args: string): {
  error?: string
  scope?: CleanupScope
  confirm: boolean
} {
  const parts = args
    .split(/\s+/)
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)

  const allowed = new Set(['project', 'all', '--confirm', 'confirm'])
  const unknown = parts.filter(part => !allowed.has(part))
  if (unknown.length > 0) {
    return {
      error: `Unknown argument(s): ${unknown.join(', ')}\nUsage: /cleanup-data [project|all] [--confirm]`,
      confirm: false,
    }
  }

  if (parts.includes('project') && parts.includes('all')) {
    return {
      error:
        'Choose one cleanup scope: project or all.\nUsage: /cleanup-data [project|all] [--confirm]',
      confirm: false,
    }
  }

  const scope: CleanupScope = parts.includes('all') ? 'all' : 'project'
  const confirm = parts.includes('--confirm') || parts.includes('confirm')
  if (confirm && !parts.includes('project') && !parts.includes('all')) {
    return {
      error:
        'Confirm requires an explicit scope.\nUsage: /cleanup-data [project|all] [--confirm]',
      confirm: false,
    }
  }
  return { scope, confirm }
}

async function pathSize(path: string): Promise<{ exists: boolean; size: number }> {
  let info
  try {
    info = await stat(path)
  } catch {
    return { exists: false, size: 0 }
  }
  if (info.isFile()) return { exists: true, size: info.size }
  if (!info.isDirectory()) return { exists: true, size: 0 }

  let total = 0
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size
        } catch {
          // Broken symlink / raced delete — skip.
        }
      }
    }
  }
  await walk(path)
  return { exists: true, size: total }
}

async function resolveTargets(
  targets: CleanupTarget[],
): Promise<ResolvedTarget[]> {
  return Promise.all(
    targets.map(async target => ({
      ...target,
      ...(await pathSize(target.path)),
    })),
  )
}

function buildTargets(scope: CleanupScope): CleanupTarget[] {
  const projectRoot = getProjectRoot()
  const autoMemPath = getAutoMemPath().replace(/[\\/]+$/, '')
  const historyPath = join(getClaudeConfigHomeDir(), 'history.jsonl')
  const defaultMemoryRoot = join(getClaudeConfigHomeDir(), 'projects')
  const isCustomAutoMemPath = !autoMemPath.startsWith(defaultMemoryRoot)

  const targets: CleanupTarget[] = [
    {
      path: getPrimaryProjectSubdir(projectRoot, 'shares'),
      reason: 'Project share snapshots',
    },
    {
      path: getPrimaryProjectFile(projectRoot, 'progress.md'),
      reason: 'Project progress artifact',
    },
    {
      path: autoMemPath,
      reason: isCustomAutoMemPath
        ? 'Project auto-memory (custom location)'
        : 'Project auto-memory',
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

type DeleteOutcome = {
  deleted: string[]
  failed: { path: string; error: string }[]
}

async function deleteTargets(
  targets: ResolvedTarget[],
): Promise<DeleteOutcome> {
  const deleted: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const target of targets) {
    if (!target.exists) continue
    try {
      await rm(target.path, { recursive: true, force: true })
      deleted.push(target.path)
    } catch (err) {
      failed.push({
        path: target.path,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { deleted, failed }
}

function describeScope(scope: CleanupScope): string {
  return scope === 'all'
    ? "this project's tracking data + global prompt history"
    : "this project's tracking data"
}

function tildify(path: string): string {
  const home = homedir()
  if (home && path === home) return '~'
  if (home && path.startsWith(home + '/')) return '~' + path.slice(home.length)
  return path
}

function formatTargetSize(size: number): string {
  return size === 0 ? '(empty)' : formatFileSize(size)
}

export const call: LocalCommandCall = async args => {
  const { error, scope = 'project', confirm } = parseArgs(args || '')
  if (error) {
    return { type: 'text', value: error }
  }
  const targets = buildTargets(scope)
  const resolved = await resolveTargets(targets)

  const present = resolved.filter(t => t.exists)
  const missing = resolved.filter(t => !t.exists)
  const totalBytes = present.reduce((sum, t) => sum + t.size, 0)

  if (!confirm) {
    const previewSummary =
      scope === 'all'
        ? 'This removes project-scoped memory, share snapshots, progress artifacts, and global prompt history; settings/config files are kept.'
        : 'This removes project-scoped memory, share snapshots, and progress artifacts; settings/config files are kept.'
    const header = [
      `Scope: ${describeScope(scope)}`,
      `Project: ${getProjectRoot()}`,
      previewSummary,
      'Session transcripts are not touched here — use /clean-sessions for those.',
      '',
    ]
    if (present.length === 0) {
      header.push('No matching data found. Nothing to clean up.')
      return { type: 'text', value: header.join('\n') }
    }
    header.push(`Will delete ${present.length} target(s), ${formatFileSize(totalBytes)} total:`)
    header.push('```')
    for (const t of present) {
      header.push(`${formatTargetSize(t.size).padEnd(10)} ${t.reason}`)
      header.push(`           ${tildify(t.path)}`)
    }
    header.push('```')
    if (missing.length > 0) {
      header.push('', `Skipping ${missing.length} target(s) that don't exist.`)
    }
    header.push('', `Run /cleanup-data ${scope} --confirm to execute.`)
    return { type: 'text', value: header.join('\n') }
  }

  const { deleted, failed } = await deleteTargets(resolved)
  const lines = [
    `Cleanup complete (${describeScope(scope)}).`,
    `Deleted: ${deleted.length}/${present.length}  (${formatFileSize(totalBytes)} reclaimed)`,
  ]
  if (deleted.length > 0) {
    lines.push('```')
    for (const path of deleted) lines.push(tildify(path))
    lines.push('```')
  }
  if (failed.length > 0) {
    lines.push('', `Failed: ${failed.length}`)
    lines.push('```')
    for (const f of failed) lines.push(`${tildify(f.path)}: ${f.error}`)
    lines.push('```')
  }
  return { type: 'text', value: lines.join('\n') }
}
