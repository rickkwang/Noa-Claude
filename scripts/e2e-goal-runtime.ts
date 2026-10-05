// CLI blind spots: async replacement during evaluation, pending background work,
// error-driven wakeups, text-only spinning, and premature model completion.
// Drive the real query/tool/evaluator chain; only model transport is scripted.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { APIError } from '@anthropic-ai/sdk/error'
import type { ToolUseContext } from '../src/Tool.js'

const artifacts = process.argv.includes('--artifacts') ? resolve(process.argv[process.argv.indexOf('--artifacts') + 1]!) : mkdtempSync(join(tmpdir(), 'noa-goal-e2e-'))
mkdirSync(artifacts, { recursive: true })
assert.notEqual(process.env.NODE_ENV, 'test', 'NODE_ENV=test replays VCR; use development for real transport')
for (const name of Object.keys(process.env)) {
  if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
}
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
process.env.ANTHROPIC_API_KEY = 'isolated-dummy'
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
process.env.CLAUDE_CODE_SIMPLE = '1'
;(globalThis as any).MACRO = { VERSION: '1.17.0', DISPLAY_VERSION: '1.17.0', BUILD_TIME: '' }
const { enableConfigs } = await import('../src/utils/config.js')
const { query } = await import('../src/query.js')
const { createThreadGoal } = await import('../src/utils/goalState.js')
const { consumeGoalWake } = await import('../src/utils/goalRuntime.js')
const { getAssistantMessageFromError } = await import('../src/services/api/errors.js')
const { createAssistantMessage, createUserMessage } = await import('../src/utils/messages.js')
const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
const { FileStateCache } = await import('../src/utils/fileStateCache.js')
const { GoalTool } = await import('../src/tools/GoalTool/GoalTool.js')
const { asSystemPrompt } = await import('../src/utils/systemPromptType.js')
enableConfigs()
const scenarios = ['background', 'background-budget', 'background-large-description', 'unrelated-background', 'background-service', 'background-starts-during-evaluation', 'stale', 'fatal', 'mapped-auth', 'provider-quota', 'transient', 'impossible', 'impossible-verify', 'no-progress', 'no-progress-user-reset', 'completion', 'live-created-goal', 'verify', 'child-paused', 'stale-wake', 'restore-cache', 'restore-created-goal'].filter(name => !process.argv.includes('--case') || name === process.argv[process.argv.indexOf('--case') + 1])
assert.ok(scenarios.length, 'unknown case')
const results: unknown[] = []
const originalFetch = globalThis.fetch
try {
  for (const scenario of scenarios) {
    const goal = createThreadGoal({ objective: 'FIXTURE_GOAL_A', tokenBudget: 10000, now: Date.now(), ...(['verify','impossible-verify'].includes(scenario) ? { verifyCommand: 'false' } : {}) })
    let state: any = { goal, tasks: {}, toolPermissionContext: getEmptyToolPermissionContext(), agentNameRegistry: new Map(), agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] }, sessionHooks: new Map(), mcp: { tools: [], clients: [] } }
    if (['background','background-budget','unrelated-background','background-service'].includes(scenario)) state.tasks.bg = { id: 'bg', type: 'local_bash', status: 'running', isBackgrounded: true, description: ['background','background-budget'].includes(scenario)?'pending shell':'long-running dev server', startTime: goal.createdAt + (scenario==='unrelated-background'?-60000:0) }
    if (scenario==='background-budget') state.goal={...goal,tokensUsed:13,tokenBudget:20,nextCheckInAt:Date.now()-1}
    if (scenario==='background-large-description') state.tasks.bg={id:'bg',type:'local_bash',status:'running',isBackgrounded:true,description:'LONG_BG_MARKER_'+ 'X'.repeat(20000),startTime:goal.createdAt}
    if (scenario==='live-created-goal') state.goal=undefined
    if (scenario==='no-progress-user-reset') state.goal={...goal,noProgressTurns:2}
    const context: ToolUseContext = {
      options: { commands: [], debug: false, mainLoopModel: 'claude-sonnet-4-6', tools: ['completion','live-created-goal'].includes(scenario) ? [GoalTool] : [], verbose: false, thinkingConfig: { type: 'disabled' }, mcpClients: [], mcpResources: {}, isNonInteractiveSession: scenario !== 'transient', agentDefinitions: state.agentDefinitions },
      abortController: new AbortController(), readFileState: new FileStateCache(100, 100000), getAppState: () => state, setAppState: update => { state = update(state) }, setInProgressToolUseIDs: () => {}, setResponseLength: () => {}, updateFileHistoryState: () => {}, updateAttributionState: () => {}, messages: [],
    } as ToolUseContext
    if(scenario==='child-paused'){context.agentId='fixture-child' as any;context.goalAtStart=goal;context.setAppStateForTasks=context.setAppState;state.goal={...goal,status:'paused'}}
    let evaluations = 0, calls = 0, completionWasPending = false
    const events: any[] = []
    globalThis.fetch = (async (...args:any[]) => {
      evaluations++
      if (scenario==='background-starts-during-evaluation') state.tasks.late={id:'late',type:'local_bash',status:'running',isBackgrounded:true,description:'required late work',startTime:Date.now()}
      if (scenario === 'stale') state.goal = createThreadGoal({ objective: 'UNRELATED_GOAL_B', tokenBudget: 10000, now: goal.createdAt + 1 })
      if (['background','background-budget'].includes(scenario)) assert.ok(args[1]?.body.includes('pending shell'),'evaluator did not receive pending work')
      if (scenario==='background-large-description') {assert.ok(args[1]?.body.includes('LONG_BG_MARKER_'));assert.ok(args[1]?.body.length<15000,'task description bypassed evaluator context bound');assert.ok(args[1]?.body.includes('[task details truncated]'))}
      const verdict = { achieved: !['background','background-budget','background-large-description','impossible','impossible-verify','no-progress','no-progress-user-reset'].includes(scenario), impossible: ['impossible','impossible-verify'].includes(scenario), reason: 'Independent fixture verdict' }
      const message = { id: `eval_${evaluations}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: JSON.stringify(verdict) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      if (JSON.parse(args[1]?.body ?? '{}').stream) {
        const events = [
          { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(verdict) } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
          { type: 'message_stop' },
        ]
        return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const run = async (messages: any[]) => {
      const deps: any = {
        uuid: () => crypto.randomUUID(), microcompact: async (messages: any[]) => ({ messages }), autocompact: async () => ({ wasCompacted: false }),
        stopHooks: async function* () { return { blockingErrors: [], preventContinuation: false } },
        callModel: async function* (params: any) {
          calls++
          if (scenario === 'fatal' || scenario === 'transient') yield getAssistantMessageFromError(new APIError(scenario === 'fatal' ? 401 : 529, { type: 'error', error: { type: scenario === 'fatal' ? 'authentication_error' : 'overloaded_error', message: 'Fixture failure' } }, 'Fixture failure', new Headers()), 'claude-sonnet-4-6')
          else if(scenario==='provider-quota')yield getAssistantMessageFromError(new APIError(403,{type:'error',error:{type:'permission_error',message:"You've reached your weekly (7-day) usage limit"}},"You've reached your weekly (7-day) usage limit",new Headers()),'claude-sonnet-4-6')
          else if (scenario==='mapped-auth') {
            const route=process.env.ANTHROPIC_BASE_URL;process.env.ANTHROPIC_BASE_URL='http://api.anthropic.com'
            let errorMessage
            try {errorMessage=getAssistantMessageFromError(new Error('Could not resolve authentication method: X-Api-Key'),'claude-sonnet-4-6')} finally {process.env.ANTHROPIC_BASE_URL=route}
            assert.equal(errorMessage.error,'authentication_failed');yield errorMessage
          }
          else if (scenario==='live-created-goal' && calls===1) yield createAssistantMessage({content:[{type:'tool_use',id:'create_goal',name:'goal',input:{operation:'create_goal',objective:goal.objective,token_budget:10000}}],usage:{input_tokens:1000,output_tokens:10,cache_read_input_tokens:200,cache_creation_input_tokens:100} as any})
          else if (scenario === 'completion' && calls === 1) yield createAssistantMessage({ content: [{ type: 'tool_use', id: 'complete_goal', name: 'goal', input: { operation: 'update_goal', status: 'complete' } }] })
          else { if (scenario === 'completion') completionWasPending = JSON.stringify(params.messages).includes('independent evaluator'); yield createAssistantMessage({ content: 'Turn finished.', ...(scenario==='child-paused'?{usage:{input_tokens:4,output_tokens:5,cache_read_input_tokens:6,cache_creation_input_tokens:7} as any}:{}) }) }
        },
      }
      for await (const event of query({ messages, systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {}, canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }), toolUseContext: context, querySource: 'repl_main_thread', deps, maxTurns: 8 })) events.push(event)
    }
    if(scenario==='restore-created-goal') {
      const {restoreSessionStateFromLog}=await import('../src/utils/sessionRestore.js')
      const {getDefaultAppState}=await import('../src/state/AppStateStore.js')
      let restored=getDefaultAppState()
      const blocks=[createAssistantMessage({content:[{type:'tool_use',id:'create_fixture',name:'goal',input:{operation:'create_goal',objective:goal.objective,token_budget:10000}}]}),createAssistantMessage({content:'Goal created.',usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:100,cache_creation_input_tokens:20} as any})]
      for(const m of blocks)m.message.id='creating_response'
      const result=createUserMessage({content:[{type:'tool_result',tool_use_id:'create_fixture',content:JSON.stringify({goal:{objective:goal.objective,status:'active',token_budget:10000,tokens_used:0}})}]})
      restoreSessionStateFromLog({messages:[...blocks,result]},update=>{restored=update(restored)})
      writeFileSync(join(artifacts,`${scenario}-observed.json`),JSON.stringify(restored.goal,null,2))
      assert.equal(restored.goal?.tokensUsed,0);assert.equal(restored.goal?.status,'active')
      results.push({scenario,passed:true,tokens:0,status:restored.goal?.status});console.log('PASS restore-created-goal');continue
    }
    if(scenario==='restore-cache') {
      const {restoreSessionStateFromLog}=await import('../src/utils/sessionRestore.js')
      const {getDefaultAppState}=await import('../src/state/AppStateStore.js')
      const {createSystemMessage}=await import('../src/utils/messages.js')
      let restored=getDefaultAppState()
      const blocks=[createAssistantMessage({content:'first',usage:{input_tokens:10,output_tokens:0,cache_read_input_tokens:20,cache_creation_input_tokens:30} as any}),createAssistantMessage({content:'last',usage:{input_tokens:10,output_tokens:4,cache_read_input_tokens:20,cache_creation_input_tokens:30} as any})]
      for(const m of blocks)m.message.id='one_response'
      restoreSessionStateFromLog({messages:[...blocks,createSystemMessage('Goal paused: Fixture API rate limit','warning')],goalState:goal},update=>{restored=update(restored)})
      assert.equal(restored.goal?.tokensUsed,64);assert.equal(restored.goal?.status,'paused')
      results.push({scenario,passed:true,tokens:64,status:restored.goal?.status});console.log('PASS restore-cache');continue
    }
    if(scenario==='stale-wake') {
      const {processQueuedCommandsForTurn}=await import('../src/utils/queuedCommandTurnProcessor.js')
      const command:any={value:'GOAL_WAKE_FIXTURE',mode:'prompt',isMeta:true,skipSlashCommands:true,goalWake:{createdAt:goal.createdAt,objective:goal.objective}}
      const processQueue=()=>processQueuedCommandsForTurn({commands:[command],messages:[],setToolJSX:()=>{},makeContext:()=>context as any,setUserInputOnProcessing:()=>{},querySource:'repl_main_thread',ideSelection:undefined})
      state.goal={...goal,status:'paused'};assert.equal((await processQueue()).shouldQuery,false)
      state.goal=createThreadGoal({objective:'UNRELATED_GOAL_B',tokenBudget:null,now:goal.createdAt+1});assert.equal((await processQueue()).shouldQuery,false)
      state.goal=goal;const active=await processQueue();assert.equal(active.shouldQuery,true);assert.ok(JSON.stringify(active.newMessages).includes('GOAL_WAKE_FIXTURE'))
      results.push({scenario,passed:true,pausedDropped:true,replacedDropped:true,activeDelivered:true});console.log('PASS stale-wake');continue
    }
    await run([createUserMessage({ content: 'Work toward the fixture goal.' })])
    if (scenario === 'transient') {
      assert.equal(state.goal.retryCount, 1)
      for (let i = 0; i < 3; i++) {
        const prompt = consumeGoalWake({ goal: state.goal, getAppState: () => state, setAppState: context.setAppState, now: state.goal.retryAt })
        assert.ok(prompt, 'retry never scheduled')
        await run([createUserMessage({ content: prompt, isMeta: true })])
      }
    }
    writeFileSync(join(artifacts, `${scenario}-observed.json`), JSON.stringify({ calls, evaluations, goal: state.goal, notices: events.filter(e => e.type === 'system').map(e => e.content) }, null, 2))
    if (scenario === 'background') { assert.equal(evaluations, 1); assert.equal(state.goal.status, 'active'); assert.ok(state.goal.nextCheckInAt) }
    if (scenario === 'background-budget') {assert.equal(evaluations,1);assert.equal(calls,1);assert.equal(state.goal.status,'budget_limited');assert.equal(state.goal.tokensUsed,27)}
    if (scenario==='background-large-description') {assert.equal(evaluations,1);assert.equal(state.goal.status,'active');assert.ok(state.goal.nextCheckInAt)}
    if (['unrelated-background','background-service'].includes(scenario)) {assert.equal(evaluations,1);assert.equal(state.goal.status,'complete')}
    if (scenario==='background-starts-during-evaluation') {assert.equal(evaluations,1);assert.equal(state.goal.status,'active');assert.ok(state.goal.nextCheckInAt)}
    if (scenario === 'stale') { assert.equal(evaluations, 1); assert.equal(state.goal.objective, 'UNRELATED_GOAL_B'); assert.equal(state.goal.status, 'active'); assert.equal(state.goal.tokensUsed, 0) }
    if (scenario === 'fatal') { assert.equal(state.goal.status, 'paused'); assert.equal(state.goal.stopReason, 'unrecoverable_error') }
    if (scenario === 'mapped-auth') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'unrecoverable_error')}
    if (scenario==='provider-quota') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'rate_limit');assert.equal(calls,1);assert.equal(evaluations,0)}
    if (scenario === 'transient') { assert.equal(state.goal.status, 'paused'); assert.equal(state.goal.retryCount, 3); assert.equal(state.goal.stopReason, 'retry_exhausted'); assert.equal(calls, 4) }
    if (scenario === 'impossible') { assert.equal(state.goal.stopReason, 'impossible'); assert.equal(evaluations, 1) }
    if (scenario === 'impossible-verify') {assert.equal(state.goal.stopReason,'impossible');assert.equal(evaluations,1);assert.equal(calls,1)}
    if (scenario === 'live-created-goal') {assert.equal(state.goal.tokensUsed,14);assert.equal(state.goal.status,'complete')}
    if (scenario === 'no-progress') { assert.equal(state.goal.stopReason, 'no_progress'); assert.equal(evaluations, 3) }
    if (scenario === 'no-progress-user-reset') { assert.equal(state.goal.stopReason, 'no_progress'); assert.equal(evaluations, 3, 'an interrupted chain carried its no-progress count into a new user prompt') }
    if (scenario === 'completion') { assert.ok(completionWasPending); assert.equal(evaluations, 1); assert.equal(state.goal.status, 'complete') }
    if (scenario === 'child-paused') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.tokensUsed,22);assert.equal(evaluations,0)}
    if (scenario === 'verify') { assert.notEqual(state.goal.status, 'complete'); assert.ok(evaluations > 0) }
    results.push({ scenario, passed: true, calls, evaluations, goal: state.goal, notices: events.filter(e => e.type === 'system').map(e => e.content) })
    console.log(`PASS ${scenario}`)
  }
} finally {
  globalThis.fetch = originalFetch
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, nodeEnv: process.env.NODE_ENV, transport: 'Real query/tool/independent evaluator chain, scripted model transport, no live API', resultsSha256: createHash('sha256').update(JSON.stringify(results)).digest('hex'), passed: results.length, expected: scenarios.length, exit_code: results.length === scenarios.length ? 0 : 1 }, null, 2))
}
