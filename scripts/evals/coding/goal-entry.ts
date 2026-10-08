import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAUNCHER_MACRO } from '../../../launcher-config.js'

;(globalThis as any).MACRO = LAUNCHER_MACRO
const { QueryEngine } = await import('../../../src/QueryEngine.js')
const { getDefaultAppState } = await import('../../../src/state/AppStateStore.js')
const { createStore } = await import('../../../src/state/store.js')
const { createThreadGoal } = await import('../../../src/utils/goalState.js')
const { createFileStateCacheWithSizeLimit } = await import('../../../src/utils/fileStateCache.js')
const { enableConfigs } = await import('../../../src/utils/config.js')
const { setSessionPersistenceDisabled } = await import('../../../src/bootstrap/state.js')
const { FileReadTool } = await import('../../../src/tools/FileReadTool/FileReadTool.js')
const { FileWriteTool } = await import('../../../src/tools/FileWriteTool/FileWriteTool.js')
const { FileEditTool } = await import('../../../src/tools/FileEditTool/FileEditTool.js')
const { GrepTool } = await import('../../../src/tools/GrepTool/GrepTool.js')
const { GlobTool } = await import('../../../src/tools/GlobTool/GlobTool.js')
const { BashTool } = await import('../../../src/tools/BashTool/BashTool.js')
const { GoalTool } = await import('../../../src/tools/GoalTool/GoalTool.js')

enableConfigs()
setSessionPersistenceDisabled(true)
const [cwd, check, turns] = process.argv.slice(2)
const prompt = await Bun.stdin.text()
const store = createStore(getDefaultAppState())
store.setState(state => ({ ...state, goal: createThreadGoal({
  objective: 'Implement every requirement in README.md and pass the independent acceptance check.',
  verifyCommand: check!,
  tokenBudget: null,
  maxAutoContinueTurns: 3,
  now: Date.now(),
}) }))
const engine = new QueryEngine({
  cwd: cwd!, tools: [FileReadTool, FileWriteTool, FileEditTool, GrepTool, GlobTool, BashTool, GoalTool],
  commands: [], mcpClients: [], agents: [],
  canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
  getAppState: store.getState, setAppState: store.setState,
  readFileCache: createFileStateCacheWithSizeLimit(100),
  userSpecifiedModel: process.env.ANTHROPIC_MODEL,
  thinkingConfig: { type: 'disabled' }, maxTurns: Number(turns),
})
for await (const message of engine.submitMessage(`${prompt}
The independent acceptance command is ${check}. You may read or run that check outside the fixture, but do not modify it.`)) {
  console.log(JSON.stringify(message))
}
writeFileSync(join(cwd!, 'goal-state.json'), JSON.stringify(store.getState().goal, null, 2))
process.exit(store.getState().goal?.status === 'complete' ? 0 : 1)
