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

const MISSING_CACHE_LOAD_RESERVE_RATIO = 0.25

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber)
}

export function isValidSessionMeta(obj: unknown): obj is SessionMeta {
  if (!isRecord(obj)) return false
  const o = obj as Record<string, unknown>
  return (
    o.schema_version === META_SCHEMA_VERSION &&
    typeof o.session_id === 'string' &&
    typeof o.project_path === 'string' &&
    typeof o.start_time === 'string' &&
    isFiniteNumber(o.duration_minutes) &&
    isFiniteNumber(o.user_message_count) &&
    isFiniteNumber(o.assistant_message_count) &&
    isNumberRecord(o.tool_counts) &&
    isNumberRecord(o.languages) &&
    isFiniteNumber(o.git_commits) &&
    isFiniteNumber(o.git_pushes) &&
    isFiniteNumber(o.input_tokens) &&
    isFiniteNumber(o.output_tokens) &&
    typeof o.first_prompt === 'string' &&
    (o.summary === undefined || typeof o.summary === 'string') &&
    isFiniteNumber(o.user_interruptions) &&
    isNumberArray(o.user_response_times) &&
    isFiniteNumber(o.tool_errors) &&
    isNumberRecord(o.tool_error_categories) &&
    typeof o.uses_task_agent === 'boolean' &&
    typeof o.uses_mcp === 'boolean' &&
    typeof o.uses_web_search === 'boolean' &&
    typeof o.uses_web_fetch === 'boolean' &&
    isFiniteNumber(o.lines_added) &&
    isFiniteNumber(o.lines_removed) &&
    isFiniteNumber(o.files_modified) &&
    isNumberArray(o.message_hours) &&
    isStringArray(o.user_message_timestamps)
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
    if (
      !isCurrentSchema ||
      !isValidSessionMeta(parsed) ||
      parsed.session_id !== sessionId
    ) {
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

export function selectSessionMetaLoadCandidates(
  rebuildSessions: LiteSessionInfo[],
  missingCacheSessions: LiteSessionInfo[],
  maxSessionsToLoad: number,
): LiteSessionInfo[] {
  if (maxSessionsToLoad <= 0) return []
  if (rebuildSessions.length === 0) {
    return missingCacheSessions.slice(0, maxSessionsToLoad)
  }
  if (missingCacheSessions.length === 0) {
    return rebuildSessions.slice(0, maxSessionsToLoad)
  }
  if (rebuildSessions.length + missingCacheSessions.length <= maxSessionsToLoad) {
    return [...rebuildSessions, ...missingCacheSessions]
  }

  const missingReserve = Math.min(
    missingCacheSessions.length,
    maxSessionsToLoad - 1,
    Math.max(
      1,
      Math.floor(maxSessionsToLoad * MISSING_CACHE_LOAD_RESERVE_RATIO),
    ),
  )
  const rebuildLimit = Math.min(
    rebuildSessions.length,
    maxSessionsToLoad - missingReserve,
  )
  const selected = rebuildSessions.slice(0, rebuildLimit)
  const remainingSlots = maxSessionsToLoad - selected.length

  selected.push(...missingCacheSessions.slice(0, remainingSlots))
  return selected
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
