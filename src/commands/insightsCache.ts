import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

export type SessionMeta = {
  schema_version: number
  session_id: string
  project_path: string
  start_time: string
  duration_minutes: number
  user_message_count: number
  assistant_message_count: number
  tool_counts: Record<string, number>
  languages: Record<string, number>
  git_commits: number
  git_pushes: number
  input_tokens: number
  output_tokens: number
  first_prompt: string
  summary?: string
  user_interruptions: number
  user_response_times: number[]
  tool_errors: number
  tool_error_categories: Record<string, number>
  uses_task_agent: boolean
  uses_mcp: boolean
  uses_web_search: boolean
  uses_web_fetch: boolean
  lines_added: number
  lines_removed: number
  files_modified: number
  message_hours: number[]
  user_message_timestamps: string[]
}

export type CachedSessionMetaLoadResult = {
  meta: SessionMeta | null
  needsRebuild: boolean
}

export type LiteSessionInfo = {
  sessionId: string
  path: string
  mtime: number
  size: number
}

export type SessionMetaLoadPlanResult = {
  cachedMetas: SessionMeta[]
  rebuildSessions: LiteSessionInfo[]
  missingCacheSessions: LiteSessionInfo[]
}

export const META_SCHEMA_VERSION = 1

function getDataDir(): string {
  return join(getClaudeConfigHomeDir(), 'usage-data')
}

function getSessionMetaDir(): string {
  return join(getDataDir(), 'session-meta')
}

function getSessionMetaPath(sessionId: string): string {
  return join(getSessionMetaDir(), `${sessionId}.json`)
}

function getSessionMetaRebuildMarkerPath(sessionId: string): string {
  return join(getSessionMetaDir(), `${sessionId}.rebuild`)
}

export function isValidSessionMeta(obj: unknown): obj is SessionMeta {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return (
    typeof o.session_id === 'string' &&
    typeof o.start_time === 'string' &&
    typeof o.first_prompt === 'string' &&
    Array.isArray(o.user_message_timestamps) &&
    Array.isArray(o.user_response_times) &&
    Array.isArray(o.message_hours) &&
    o.tool_counts !== null &&
    typeof o.tool_counts === 'object' &&
    o.languages !== null &&
    typeof o.languages === 'object' &&
    o.tool_error_categories !== null &&
    typeof o.tool_error_categories === 'object'
  )
}

export async function loadCachedSessionMeta(
  sessionId: string,
): Promise<CachedSessionMetaLoadResult> {
  const metaPath = getSessionMetaPath(sessionId)
  try {
    const content = await readFile(metaPath, { encoding: 'utf-8' })
    const parsed: unknown = jsonParse(content)
    const isCurrentSchema =
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).schema_version ===
        META_SCHEMA_VERSION
    if (!isCurrentSchema || !isValidSessionMeta(parsed)) {
      await markSessionMetaForRebuild(sessionId)
      return { meta: null, needsRebuild: true }
    }
    return { meta: parsed, needsRebuild: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return {
        meta: null,
        needsRebuild: await hasSessionMetaRebuildMarker(sessionId),
      }
    }

    await markSessionMetaForRebuild(sessionId)
    return { meta: null, needsRebuild: true }
  }
}

export async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  try {
    await mkdir(getSessionMetaDir(), { recursive: true })
  } catch {
    // Directory may already exist
  }
  const metaPath = getSessionMetaPath(meta.session_id)
  await writeFile(metaPath, jsonStringify(meta, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
  await clearSessionMetaRebuildMarker(meta.session_id)
}

export function planSessionMetaLoads(
  results: Array<{
    sessionInfo: LiteSessionInfo
    cache: CachedSessionMetaLoadResult
  }>,
): SessionMetaLoadPlanResult {
  const cachedMetas: SessionMeta[] = []
  const rebuildSessions: LiteSessionInfo[] = []
  const missingCacheSessions: LiteSessionInfo[] = []

  for (const { sessionInfo, cache } of results) {
    if (cache.meta) {
      cachedMetas.push(cache.meta)
      continue
    }

    if (cache.needsRebuild) {
      rebuildSessions.push(sessionInfo)
      continue
    }

    missingCacheSessions.push(sessionInfo)
  }

  return {
    cachedMetas,
    rebuildSessions,
    missingCacheSessions,
  }
}

async function hasSessionMetaRebuildMarker(sessionId: string): Promise<boolean> {
  try {
    await access(getSessionMetaRebuildMarkerPath(sessionId))
    return true
  } catch {
    return false
  }
}

async function markSessionMetaForRebuild(sessionId: string): Promise<void> {
  try {
    await mkdir(getSessionMetaDir(), { recursive: true })
  } catch {
    // Directory may already exist
  }

  const markerPath = getSessionMetaRebuildMarkerPath(sessionId)
  let markerWritten = false
  try {
    await writeFile(markerPath, 'rebuild\n', {
      encoding: 'utf-8',
      mode: 0o600,
    })
    markerWritten = true
  } catch {
    // Keep the original cache file if we could not persist the rebuild marker.
  }

  if (markerWritten) {
    try {
      await unlink(getSessionMetaPath(sessionId))
    } catch {
      // Ignore deletion errors
    }
  }
}

async function clearSessionMetaRebuildMarker(sessionId: string): Promise<void> {
  try {
    await unlink(getSessionMetaRebuildMarkerPath(sessionId))
  } catch {
    // Ignore deletion errors
  }
}
