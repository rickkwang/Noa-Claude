import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadCachedSessionMeta,
  META_SCHEMA_VERSION,
  type SessionMeta,
  planSessionMetaLoads,
  saveSessionMeta,
  selectSessionMetaLoadCandidates,
  isValidSessionMeta,
} from '../../commands/insightsCache.js'

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    schema_version: META_SCHEMA_VERSION,
    session_id: 'session-1',
    project_path: '/tmp/project',
    start_time: '2026-05-23T00:00:00.000Z',
    duration_minutes: 5,
    user_message_count: 2,
    assistant_message_count: 2,
    tool_counts: {},
    languages: {},
    git_commits: 0,
    git_pushes: 0,
    input_tokens: 1,
    output_tokens: 1,
    first_prompt: 'hello',
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: false,
    uses_mcp: false,
    uses_web_search: false,
    uses_web_fetch: false,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: [],
    user_message_timestamps: [],
    ...overrides,
  }
}

const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
const tempDirs: string[] = []

afterEach(async () => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempClaudeConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'insights-cache-test-'))
  tempDirs.push(dir)
  process.env.CLAUDE_CONFIG_DIR = dir
  return dir
}

describe('/insights cache planning', () => {
  test('partitions rebuild sessions ahead of ordinary cache misses', () => {
    const staleResults = Array.from({ length: 205 }, (_, index) => ({
      sessionInfo: {
        sessionId: `stale-${index}`,
        path: `/tmp/stale-${index}.jsonl`,
        mtime: 1000 - index,
        size: 1,
      },
      cache: {
        meta: null,
        needsRebuild: true,
      },
    }))
    const missingResults = Array.from({ length: 10 }, (_, index) => ({
      sessionInfo: {
        sessionId: `missing-${index}`,
        path: `/tmp/missing-${index}.jsonl`,
        mtime: 700 - index,
        size: 1,
      },
      cache: {
        meta: null,
        needsRebuild: false,
      },
    }))

    const planned = planSessionMetaLoads([...staleResults, ...missingResults])

    expect(planned.cachedMetas).toHaveLength(0)
    expect(planned.rebuildSessions).toHaveLength(205)
    expect(planned.missingCacheSessions).toHaveLength(10)
    expect(planned.rebuildSessions.map(s => s.sessionId)).toEqual(
      staleResults.map(result => result.sessionInfo.sessionId),
    )
    expect(planned.missingCacheSessions.map(s => s.sessionId)).toEqual(
      missingResults.map(result => result.sessionInfo.sessionId),
    )
  })

  test('keeps valid cached metas separate from uncached sessions', () => {
    const cachedMeta = makeMeta()
    const planned = planSessionMetaLoads([
      {
        sessionInfo: {
          sessionId: cachedMeta.session_id,
          path: '/tmp/cached.jsonl',
          mtime: 10,
          size: 1,
        },
        cache: {
          meta: cachedMeta,
          needsRebuild: false,
        },
      },
      {
        sessionInfo: {
          sessionId: 'missing-0',
          path: '/tmp/missing-0.jsonl',
          mtime: 9,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: false,
        },
      },
      {
        sessionInfo: {
          sessionId: 'missing-1',
          path: '/tmp/missing-1.jsonl',
          mtime: 8,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: false,
        },
      },
    ])

    expect(planned.cachedMetas).toEqual([cachedMeta])
    expect(planned.rebuildSessions).toEqual([])
    expect(planned.missingCacheSessions.map(s => s.sessionId)).toEqual([
      'missing-0',
      'missing-1',
    ])
  })

  test('global load cap prioritizes rebuilds without starving ordinary cache misses', () => {
    const firstBatch = planSessionMetaLoads([
      {
        sessionInfo: {
          sessionId: 'rebuild-0',
          path: '/tmp/rebuild-0.jsonl',
          mtime: 10,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: true,
        },
      },
      {
        sessionInfo: {
          sessionId: 'missing-0',
          path: '/tmp/missing-0.jsonl',
          mtime: 9,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: false,
        },
      },
      {
        sessionInfo: {
          sessionId: 'missing-1',
          path: '/tmp/missing-1.jsonl',
          mtime: 8,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: false,
        },
      },
    ])

    const secondBatch = planSessionMetaLoads([
      {
        sessionInfo: {
          sessionId: 'rebuild-1',
          path: '/tmp/rebuild-1.jsonl',
          mtime: 7,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: true,
        },
      },
      {
        sessionInfo: {
          sessionId: 'missing-2',
          path: '/tmp/missing-2.jsonl',
          mtime: 6,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: false,
        },
      },
      {
        sessionInfo: {
          sessionId: 'missing-3',
          path: '/tmp/missing-3.jsonl',
          mtime: 5,
          size: 1,
        },
        cache: {
          meta: null,
          needsRebuild: false,
        },
      },
    ])

    const globallyCapped = selectSessionMetaLoadCandidates(
      [...firstBatch.rebuildSessions, ...secondBatch.rebuildSessions],
      [...firstBatch.missingCacheSessions, ...secondBatch.missingCacheSessions],
      2,
    )

    expect(globallyCapped.map(s => s.sessionId)).toEqual([
      'rebuild-0',
      'missing-0',
    ])
  })

  test('does not let stale rebuilds consume every load slot when misses exist', () => {
    const rebuildSessions = Array.from({ length: 205 }, (_, index) => ({
      sessionId: `rebuild-${index}`,
      path: `/tmp/rebuild-${index}.jsonl`,
      mtime: 1000 - index,
      size: 1,
    }))
    const missingCacheSessions = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `missing-${index}`,
      path: `/tmp/missing-${index}.jsonl`,
      mtime: 2000 - index,
      size: 1,
    }))

    const selected = selectSessionMetaLoadCandidates(
      rebuildSessions,
      missingCacheSessions,
      200,
    )

    expect(selected).toHaveLength(200)
    expect(selected.filter(s => s.sessionId.startsWith('missing-'))).toHaveLength(
      10,
    )
    expect(selected.filter(s => s.sessionId.startsWith('rebuild-'))).toHaveLength(
      190,
    )
  })

  test('keeps rebuild priority when only one load slot is available', () => {
    const selected = selectSessionMetaLoadCandidates(
      [
        {
          sessionId: 'rebuild-0',
          path: '/tmp/rebuild-0.jsonl',
          mtime: 10,
          size: 1,
        },
      ],
      [
        {
          sessionId: 'missing-0',
          path: '/tmp/missing-0.jsonl',
          mtime: 20,
          size: 1,
        },
      ],
      1,
    )

    expect(selected.map(s => s.sessionId)).toEqual(['rebuild-0'])
  })
})

describe('/insights cache validation', () => {
  test('rejects cache entries missing first_prompt before aggregation can slice it', () => {
    const invalidShape = {
      ...makeMeta({
        session_id: 'broken-session',
      }),
      first_prompt: undefined,
    }

    expect(isValidSessionMeta(makeMeta())).toBe(true)
    expect(isValidSessionMeta(invalidShape)).toBe(false)
  })

  test('rejects cache entries missing numeric fields used during aggregation', () => {
    const invalidShape = {
      ...makeMeta({
        session_id: 'broken-session',
      }),
      duration_minutes: undefined,
    }

    expect(isValidSessionMeta(invalidShape)).toBe(false)
  })

  test('rejects cache entries with non-numeric record counts', () => {
    const invalidShape = {
      ...makeMeta({
        session_id: 'broken-session',
      }),
      tool_counts: {
        Bash: '1',
      },
    }

    expect(isValidSessionMeta(invalidShape)).toBe(false)
  })

  test('rejects valid cache entries stored under the wrong session id', async () => {
    const configDir = await makeTempClaudeConfigDir()
    const metaDir = join(configDir, 'usage-data', 'session-meta')
    await mkdir(metaDir, { recursive: true })
    const metaPath = join(metaDir, 'expected-session.json')
    const markerPath = join(metaDir, 'expected-session.rebuild')
    await writeFile(
      metaPath,
      JSON.stringify(makeMeta({ session_id: 'wrong-session' })),
      'utf8',
    )

    await expect(loadCachedSessionMeta('expected-session')).resolves.toEqual({
      meta: null,
      needsRebuild: true,
    })
    await expect(readFile(metaPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(markerPath, 'utf8')).resolves.toContain('rebuild')
  })

  test('deletes invalid cache files before marking them for rebuild', async () => {
    const configDir = await makeTempClaudeConfigDir()
    const metaDir = join(configDir, 'usage-data', 'session-meta')
    await mkdir(metaDir, { recursive: true })
    const metaPath = join(metaDir, 'broken-session.json')
    const markerPath = join(metaDir, 'broken-session.rebuild')
    await writeFile(metaPath, '{"schema_version":1,"session_id":"broken"}', 'utf8')

    await expect(loadCachedSessionMeta('broken-session')).resolves.toEqual({
      meta: null,
      needsRebuild: true,
    })
    await expect(readFile(metaPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(markerPath, 'utf8')).resolves.toContain('rebuild')
  })

  test('keeps rebuild priority across runs until saveSessionMeta replaces it', async () => {
    const configDir = await makeTempClaudeConfigDir()
    const metaDir = join(configDir, 'usage-data', 'session-meta')
    await mkdir(metaDir, { recursive: true })
    const metaPath = join(metaDir, 'stale-session.json')
    const markerPath = join(metaDir, 'stale-session.rebuild')
    await writeFile(metaPath, '{"schema_version":1,"session_id":"stale"}', 'utf8')

    await expect(loadCachedSessionMeta('stale-session')).resolves.toEqual({
      meta: null,
      needsRebuild: true,
    })
    await expect(loadCachedSessionMeta('stale-session')).resolves.toEqual({
      meta: null,
      needsRebuild: true,
    })

    await saveSessionMeta(makeMeta({ session_id: 'stale-session' }))

    const loaded = await loadCachedSessionMeta('stale-session')
    expect(loaded.needsRebuild).toBe(false)
    expect(loaded.meta?.session_id).toBe('stale-session')
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
