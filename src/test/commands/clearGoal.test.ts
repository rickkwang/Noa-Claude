import { beforeEach, describe, expect, test } from 'bun:test'
import { clearConversation } from '../../commands/clear/conversation.js'
import { setOriginalCwd } from '../../bootstrap/state.js'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { createThreadGoal } from '../../utils/goalState.js'

// clearConversation calls setCwd(getOriginalCwd()), which throws if the
// recorded original cwd no longer exists — other suites leave it pointing at
// their own deleted temp dirs. Pin it to a directory that is always present.
beforeEach(() => {
  setOriginalCwd(process.cwd())
})

async function clearWith(goal: AppState['goal']): Promise<AppState> {
  let state: AppState = { ...getDefaultAppState(), goal }
  await clearConversation({
    setMessages: () => {},
    readFileState: new Map() as never,
    getAppState: () => state,
    setAppState: updater => {
      state = updater(state)
    },
  })
  return state
}

// /clear starts a new session. Leaving the goal in AppState carried its
// accumulated tokensUsed (and a possible budget_limited status) into a
// conversation containing none of the evidence the evaluator judges against,
// and the new session's transcript held no record of it — so a later resume
// disagreed with the live state.
describe('/clear and the thread goal', () => {
  test('clears an active goal', async () => {
    const state = await clearWith(
      createThreadGoal({
        objective: 'Ship the release',
        tokenBudget: 100_000,
        now: 1,
      }),
    )

    expect(state.goal).toBeUndefined()
  })

  test('clears a budget_limited goal', async () => {
    const state = await clearWith({
      ...createThreadGoal({
        objective: 'Ship the release',
        tokenBudget: 100,
        now: 1,
      }),
      status: 'budget_limited',
      tokensUsed: 120,
      stopReason: 'budget_limited',
    })

    expect(state.goal).toBeUndefined()
  })

  test('is a no-op when no goal is set', async () => {
    expect((await clearWith(undefined)).goal).toBeUndefined()
  })
})
