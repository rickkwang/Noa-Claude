import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  flushSessionStorage,
  reAppendSessionMetadata,
  resetProjectForTesting,
  restoreSessionMetadata,
  saveGoalState,
  setSessionFileForTesting,
} from '../../utils/sessionStorage.js'
import { getSessionId } from '../../bootstrap/state.js'
import { createThreadGoal } from '../../utils/goalState.js'
import type { ThreadGoal } from '../../types/goal.js'

type GoalStateLine = {
  type: string
  goal: ThreadGoal | null
  timestamp: string
}

function goalStateLines(file: string): GoalStateLine[] {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(line => line.startsWith('{"type":"goal-state"'))
    .map(line => JSON.parse(line) as GoalStateLine)
}

describe('goal-state transcript persistence', () => {
  let tmpFile: string
  let tmpRoot: string

  beforeEach(() => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    resetProjectForTesting()
    tmpRoot = mkdtempSync(join(tmpdir(), 'noa-goal-state-'))
    tmpFile = join(tmpRoot, 'session.jsonl')
    writeFileSync(tmpFile, '', { mode: 0o600 })
    setSessionFileForTesting(tmpFile)
  })

  afterEach(() => {
    resetProjectForTesting()
    rmSync(tmpRoot, { recursive: true, force: true })
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  })

  test('saveGoalState writes a parseable goal-state line', async () => {
    const sessionId = getSessionId() as `${string}-${string}-${string}-${string}-${string}`
    const goal = createThreadGoal({
      objective: 'Ship the release',
      tokenBudget: 100_000,
      verifyCommand: 'bun test',
      now: 1,
    })

    saveGoalState(sessionId, goal)
    await flushSessionStorage()

    const lines = goalStateLines(tmpFile)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.goal).toMatchObject({
      objective: 'Ship the release',
      status: 'active',
      tokenBudget: 100_000,
      verifyCommand: 'bun test',
    })
  })

  // restoreSessionStateFromLog replays only messages newer than this stamp, so
  // a snapshot without one falls back to replaying the whole chain.
  test('every goal-state line carries a parseable timestamp', async () => {
    const sessionId = getSessionId() as `${string}-${string}-${string}-${string}-${string}`

    saveGoalState(
      sessionId,
      createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
    )
    await flushSessionStorage()

    const timestamp = goalStateLines(tmpFile).at(-1)!.timestamp
    expect(Number.isFinite(Date.parse(timestamp))).toBe(true)
  })

  test('an explicit clear is written as a null goal', async () => {
    const sessionId = getSessionId() as `${string}-${string}-${string}-${string}-${string}`

    saveGoalState(
      sessionId,
      createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
    )
    saveGoalState(sessionId, null)
    await flushSessionStorage()

    const lines = goalStateLines(tmpFile)
    expect(lines).toHaveLength(2)
    expect(lines.at(-1)!.goal).toBeNull()
  })

  // The >5MB load path only reads post-boundary bytes, so the cached goal has
  // to be re-appended at EOF when compaction runs.
  test('reAppendSessionMetadata re-writes the cached goal after compaction', async () => {
    const sessionId = getSessionId() as `${string}-${string}-${string}-${string}-${string}`

    saveGoalState(
      sessionId,
      createThreadGoal({ objective: 'Ship', tokenBudget: null, now: 1 }),
    )
    await flushSessionStorage()
    expect(goalStateLines(tmpFile)).toHaveLength(1)

    reAppendSessionMetadata()
    await flushSessionStorage()

    const lines = goalStateLines(tmpFile)
    expect(lines).toHaveLength(2)
    expect(lines.at(-1)!.goal).toMatchObject({ objective: 'Ship' })
  })

  test('no goal this session means nothing is re-appended', async () => {
    reAppendSessionMetadata()
    await flushSessionStorage()

    expect(goalStateLines(tmpFile)).toHaveLength(0)
  })

  test('restoreSessionMetadata seeds the cache so resume re-persists it', async () => {
    const goal = createThreadGoal({
      objective: 'Resumed goal',
      tokenBudget: null,
      now: 1,
    })

    restoreSessionMetadata({ goalState: goal })
    reAppendSessionMetadata()
    await flushSessionStorage()

    expect(goalStateLines(tmpFile).at(-1)!.goal).toMatchObject({
      objective: 'Resumed goal',
    })
  })
})
