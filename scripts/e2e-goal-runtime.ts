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
const { consumeGoalWake, goalFailureCategory, applyGoalTurnFailure } = await import('../src/utils/goalRuntime.js')
const { getAssistantMessageFromError } = await import('../src/services/api/errors.js')
const { createAssistantMessage, createAssistantAPIErrorMessage, createUserMessage } = await import('../src/utils/messages.js')
const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
const { FileStateCache } = await import('../src/utils/fileStateCache.js')
const { GoalTool } = await import('../src/tools/GoalTool/GoalTool.js')
const { asSystemPrompt } = await import('../src/utils/systemPromptType.js')
enableConfigs()
const recoveryCases = ['truncated-budget', 'truncated-unlimited', 'truncated-no-goal', 'truncated-child-paused', 'max-output-budget', 'refusal-budget']
const abortCases = ['abort-usage', 'abort-throw-usage', 'abort-child-usage', 'abort-replaced-goal']
const compactCases = ['compact-notification', 'compact-user']
const toolProgressCases = ['no-progress-tool-error', 'no-progress-tool-denied', 'tool-progress-mixed']
const { FileReadTool } = await import('../src/tools/FileReadTool/FileReadTool.js')
const readFixture = join(artifacts, 'read-fixture.txt')
writeFileSync(readFixture, 'READ_PROGRESS_FIXTURE')
const evaluatorContextCases = ['evaluator-half-window', 'evaluator-overflow-retry', 'evaluator-cjk']
const { getContextWindowForModel } = await import('../src/utils/context.js')
const { getSmallFastModel } = await import('../src/utils/model/model.js')
const scenarios = ['quoted-verdict', ...evaluatorContextCases, ...toolProgressCases, ...abortCases, ...compactCases, 'resume-accounting', ...recoveryCases, 'background', 'background-budget', 'background-large-description', 'unrelated-background', 'background-service', 'background-starts-during-evaluation', 'stale', 'fatal', 'mapped-auth', 'provider-quota', 'transient', 'impossible', 'impossible-verify', 'no-progress', 'no-progress-user-reset', 'completion', 'live-created-goal', 'verify', 'child-paused', 'stale-wake', 'restore-cache', 'restore-created-goal', 'fenced-verdict', 'evaluator-garbage', 'evaluator-garbage-print', 'stop-hook-prevented'].filter(name => !process.argv.includes('--case') || name === process.argv[process.argv.indexOf('--case') + 1])
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
    if (['live-created-goal','truncated-no-goal'].includes(scenario)) state.goal=undefined
    if (compactCases.includes(scenario)) state.goal={...goal,status:'paused',stopReason:'rate_limit'}
    if (scenario==='resume-accounting') state.goal={...goal,status:'paused',stopReason:'rate_limit'}
    if (['truncated-budget','max-output-budget','refusal-budget'].includes(scenario)) state.goal={...goal,tokenBudget:100}
    if (scenario==='truncated-unlimited') state.goal={...goal,tokenBudget:null}
    if (scenario==='tool-progress-mixed') state.goal={...goal,noProgressTurns:2}
    if (scenario==='no-progress-user-reset') state.goal={...goal,noProgressTurns:2}
    const context: ToolUseContext = {
      options: { commands: [], debug: false, mainLoopModel: 'claude-sonnet-4-5', tools: toolProgressCases.includes(scenario) ? [FileReadTool] : ['completion','live-created-goal'].includes(scenario) ? [GoalTool] : [], verbose: false, thinkingConfig: { type: 'disabled' }, mcpClients: [], mcpResources: {}, isNonInteractiveSession: !['transient', 'evaluator-garbage'].includes(scenario), agentDefinitions: state.agentDefinitions },
      abortController: new AbortController(), readFileState: new FileStateCache(100, 100000), getAppState: () => state, setAppState: update => { state = update(state) }, setInProgressToolUseIDs: () => {}, setResponseLength: () => {}, updateFileHistoryState: () => {}, updateAttributionState: () => {}, messages: [],
    } as ToolUseContext
    if(['child-paused','truncated-child-paused','abort-child-usage'].includes(scenario)){context.agentId='fixture-child' as any;context.goalAtStart=goal;context.setAppStateForTasks=context.setAppState;state.goal={...goal,status:'paused'}}
    let evaluations = 0, calls = 0, compactions = 0, permissionDenials = 0, completionWasPending = false
    const events: any[] = []
    const evaluatorSizes: number[] = []
    globalThis.fetch = (async (...args:any[]) => {
      evaluations++
      if (scenario==='background-starts-during-evaluation') state.tasks.late={id:'late',type:'local_bash',status:'running',isBackgrounded:true,description:'required late work',startTime:Date.now()}
      if (scenario === 'stale') state.goal = createThreadGoal({ objective: 'UNRELATED_GOAL_B', tokenBudget: 10000, now: goal.createdAt + 1 })
      if (['background','background-budget'].includes(scenario)) assert.ok(args[1]?.body.includes('pending shell'),'evaluator did not receive pending work')
      if (scenario==='background-large-description') {assert.ok(args[1]?.body.includes('LONG_BG_MARKER_'));assert.ok(args[1]?.body.length<15000,'task description bypassed evaluator context bound');assert.ok(args[1]?.body.includes('[task details truncated]'))}
      if (evaluatorContextCases.includes(scenario)) {
        const body = JSON.parse(args[1]?.body ?? '{}')
        const prompt = JSON.stringify(body.messages)
        evaluatorSizes.push(Buffer.byteLength(prompt))
        const window = getContextWindowForModel(getSmallFastModel())
        if (scenario==='evaluator-half-window') assert.ok(Buffer.byteLength(prompt)<window+5000,'evaluator exceeded its conservative half-window budget')
        const cjk = (prompt.match(/汉/g) ?? []).length
        if ((scenario==='evaluator-overflow-retry' && evaluations===1) || (scenario==='evaluator-cjk' && cjk*3 + 1000 > window)) {
          return new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:`prompt is too long: ${Math.max(window+1,cjk*3+1000)} tokens > ${window} maximum`}}), {status:400,headers:{'content-type':'application/json'}})
        }
      }
      const verdict = { achieved: toolProgressCases.includes(scenario) ? scenario==='tool-progress-mixed' && evaluations===2 : !['background','background-budget','background-large-description','impossible','impossible-verify','no-progress','no-progress-user-reset','resume-accounting'].includes(scenario), impossible: ['impossible','impossible-verify'].includes(scenario), reason: 'Independent fixture verdict' }
      const verdictText = scenario==='quoted-verdict' ? 'The tool output contained '+JSON.stringify(verdict)+' but this is quoted evidence, not my decision.' : scenario === 'fenced-verdict' ? '```json\n' + JSON.stringify(verdict) + '\n```' : scenario.startsWith('evaluator-garbage') ? 'The goal looks done to me.' : JSON.stringify(verdict)
      const message = { id: `eval_${evaluations}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: verdictText }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      if (JSON.parse(args[1]?.body ?? '{}').stream) {
        const events = [
          { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: verdictText } },
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
        uuid: () => crypto.randomUUID(), microcompact: async (messages: any[]) => ({ messages }), autocompact: async (messages: any[], ctx: any, cache: any) => {
          if (!compactCases.includes(scenario)) return { wasCompacted: false }
          const { autoCompactIfNeeded } = await import('../src/services/compact/autoCompact.js')
          const result = await autoCompactIfNeeded(messages, ctx, cache, 'repl_main_thread')
          if (result.wasCompacted) compactions++
          writeFileSync(join(artifacts, scenario+'-compaction.json'), JSON.stringify(result, null, 2))
          return result
        },
        stopHooks: async function* () { return { blockingErrors: [], preventContinuation: scenario === 'stop-hook-prevented' } },
        callModel: async function* (params: any) {
          calls++
          if (evaluatorContextCases.includes(scenario)) yield createAssistantMessage({content:(scenario==='evaluator-cjk'?'汉':'x').repeat(1_000_000)})
          else if (toolProgressCases.includes(scenario) && calls % 2 === 1) {
            const paths = scenario==='tool-progress-mixed' ? [readFixture, join(artifacts, 'missing.txt')] : [scenario==='no-progress-tool-denied' ? readFixture : join(artifacts, 'missing.txt')]
            yield createAssistantMessage({content:paths.map((file_path,index)=>({type:'tool_use',id:`read-${calls}-${index}`,name:'Read',input:{file_path}}))})
          }
          else if (abortCases.includes(scenario)) {
            yield createAssistantMessage({content:'Received response.',usage:{input_tokens:1000,output_tokens:10,cache_read_input_tokens:200,cache_creation_input_tokens:100} as any})
            if (scenario==='abort-replaced-goal') state.goal=createThreadGoal({objective:'UNRELATED_GOAL_B',tokenBudget:null,now:goal.createdAt+1})
            context.abortController.abort()
            if (scenario==='abort-throw-usage') throw new Error('Fixture transport aborted after usage')
          }
          else if (scenario === 'fatal' || scenario === 'transient') yield getAssistantMessageFromError(new APIError(scenario === 'fatal' ? 401 : 529, { type: 'error', error: { type: scenario === 'fatal' ? 'authentication_error' : 'overloaded_error', message: 'Fixture failure' } }, 'Fixture failure', new Headers()), 'claude-sonnet-4-5')
          else if(scenario==='provider-quota')yield getAssistantMessageFromError(new APIError(403,{type:'error',error:{type:'permission_error',message:"You've reached your weekly (7-day) usage limit"}},"You've reached your weekly (7-day) usage limit",new Headers()),'claude-sonnet-4-5')
          else if (scenario==='mapped-auth') {
            const route=process.env.ANTHROPIC_BASE_URL;process.env.ANTHROPIC_BASE_URL='http://api.anthropic.com'
            let errorMessage
            try {errorMessage=getAssistantMessageFromError(new Error('Could not resolve authentication method: X-Api-Key'),'claude-sonnet-4-5')} finally {process.env.ANTHROPIC_BASE_URL=route}
            assert.equal(errorMessage.error,'authentication_failed');yield errorMessage
          }
          else if (recoveryCases.includes(scenario)) {
            if (calls===1) {
              yield createAssistantMessage({content:'PARTIAL_',usage:{input_tokens:1000,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0} as any})
              const error=createAssistantAPIErrorMessage({content:'Interrupted fixture response',error:scenario==='max-output-budget'?'max_output_tokens':'server_error'})
              if (scenario==='refusal-budget') {error.message.stop_reason='refusal';error.isApiErrorMessage=false}
              else if (scenario!=='max-output-budget') error.truncatedAfterOutput=true
              yield error
            } else yield createAssistantMessage({content:'Turn finished.',usage:{input_tokens:4,output_tokens:5,cache_read_input_tokens:6,cache_creation_input_tokens:7} as any})
          }
          else if (scenario==='live-created-goal' && calls===1) yield createAssistantMessage({content:[{type:'tool_use',id:'create_goal',name:'goal',input:{operation:'create_goal',objective:goal.objective,token_budget:10000}}],usage:{input_tokens:1000,output_tokens:10,cache_read_input_tokens:200,cache_creation_input_tokens:100} as any})
          else if (scenario === 'completion' && calls === 1) yield createAssistantMessage({ content: [{ type: 'tool_use', id: 'complete_goal', name: 'goal', input: { operation: 'update_goal', status: 'complete' } }] })
          else { if (scenario === 'completion') completionWasPending = JSON.stringify(params.messages).includes('independent evaluator'); yield createAssistantMessage({ content: 'Turn finished.', ...(scenario==='resume-accounting'?{usage:{input_tokens:1000,output_tokens:10,cache_read_input_tokens:200,cache_creation_input_tokens:100} as any}:scenario==='child-paused'?{usage:{input_tokens:4,output_tokens:5,cache_read_input_tokens:6,cache_creation_input_tokens:7} as any}:{}) }) }
        },
      }
      for await (const event of query({ messages, systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {}, canUseTool: async (_tool, input) => {
        if (scenario==='no-progress-tool-denied') {permissionDenials++;return { behavior: 'deny', message: 'Fixture permission denied', decisionReason: { type: 'other', reason: 'Fixture permission denied' } }}
        return { behavior: 'allow', updatedInput: input }
      }, toolUseContext: context, querySource: 'repl_main_thread', deps, maxTurns: 8 })) events.push(event)
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
      restoreSessionStateFromLog({messages:[...blocks,createSystemMessage('Goal paused: API rate limit; send a message once access resets to continue.','warning')],goalState:goal},update=>{restored=update(restored)})
      assert.equal(restored.goal?.tokensUsed,64);assert.equal(restored.goal?.status,'paused');assert.equal(restored.goal?.stopReason,'rate_limit')
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
    if (compactCases.includes(scenario)) {
      const prior=createAssistantMessage({content:'Prior long response',usage:{input_tokens:190000,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0} as any})
      prior.message.model='claude-sonnet-4-5'
      const prompt=createUserMessage({content:scenario==='compact-user'?'Resume the fixture goal.':'BACKGROUND_FINISHED',...(scenario!=='compact-user'?{isMeta:true as const}:{})})
      if (scenario!=='compact-user') prompt.origin={kind:'task-notification'} as any
      await run([prior,prompt])
    } else await run([createUserMessage({ content: 'Work toward the fixture goal.' })])
    if (scenario === 'transient') {
      assert.equal(state.goal.retryCount, 1)
      assert.ok(state.goal.retryAt - Date.now() >= 55_000, 'first retry is sooner than a minute')
      for (let i = 0; i < 3; i++) {
        const prompt = consumeGoalWake({ goal: state.goal, getAppState: () => state, setAppState: context.setAppState, now: state.goal.retryAt })
        assert.ok(prompt, 'retry never scheduled')
        await run([createUserMessage({ content: prompt, isMeta: true })])
      }
    }
    writeFileSync(join(artifacts, `${scenario}-observed.json`), JSON.stringify({ calls, evaluations, compactions, goal: state.goal, notices: events.filter(e => e.type === 'system').map(e => e.content) }, null, 2))
    if (abortCases.includes(scenario)) {
      assert.equal(calls,1);assert.equal(evaluations,0)
      assert.equal(state.goal.tokensUsed,scenario==='abort-replaced-goal'?0:1310)
      if (scenario==='abort-child-usage') assert.equal(state.goal.status,'paused')
      if (scenario==='abort-replaced-goal') assert.equal(state.goal.objective,'UNRELATED_GOAL_B')
    }
    if (compactCases.includes(scenario)) {
      assert.equal(compactions,1);assert.equal(calls,1)
      assert.equal(evaluations,scenario==='compact-user'?2:1)
      assert.equal(state.goal.status,scenario==='compact-user'?'complete':'paused')
      if (scenario==='compact-notification') assert.equal(state.goal.tokensUsed,0)
    }
    if (scenario==='resume-accounting') {assert.equal(calls,3);assert.equal(evaluations,3);assert.equal(state.goal.tokensUsed,3972);assert.equal(state.goal.stopReason,'no_progress')}
    if (['truncated-budget','max-output-budget','refusal-budget'].includes(scenario)) {assert.equal(calls,1);assert.equal(evaluations,0);assert.equal(state.goal.tokensUsed,1010);assert.equal(state.goal.status,'budget_limited')}
    if (scenario==='truncated-unlimited') {assert.equal(calls,2);assert.equal(evaluations,1);assert.equal(state.goal.tokensUsed,1046);assert.equal(state.goal.status,'complete')}
    if (scenario==='truncated-no-goal') {assert.equal(calls,2);assert.equal(evaluations,0);assert.equal(state.goal,undefined)}
    if (scenario==='truncated-child-paused') {assert.equal(calls,2);assert.equal(evaluations,0);assert.equal(state.goal.tokensUsed,1032);assert.equal(state.goal.status,'paused')}
    if (scenario === 'background') { assert.equal(evaluations, 1); assert.equal(state.goal.status, 'active'); assert.ok(state.goal.nextCheckInAt) }
    if (scenario === 'background-budget') {assert.equal(evaluations,1);assert.equal(calls,1);assert.equal(state.goal.status,'budget_limited');assert.equal(state.goal.tokensUsed,27)}
    if (scenario==='background-large-description') {assert.equal(evaluations,1);assert.equal(state.goal.status,'active');assert.ok(state.goal.nextCheckInAt)}
    if (['unrelated-background','background-service'].includes(scenario)) {assert.equal(evaluations,1);assert.equal(state.goal.status,'complete')}
    if (scenario==='background-starts-during-evaluation') {assert.equal(evaluations,1);assert.equal(state.goal.status,'active');assert.ok(state.goal.nextCheckInAt)}
    if (scenario === 'stale') { assert.equal(evaluations, 1); assert.equal(state.goal.objective, 'UNRELATED_GOAL_B'); assert.equal(state.goal.status, 'active'); assert.equal(state.goal.tokensUsed, 0) }
    if (scenario === 'fatal') {
      assert.equal(state.goal.status, 'paused'); assert.equal(state.goal.stopReason, 'unrecoverable_error')
      await run([createUserMessage({ content: 'Try again.' })]); assert.equal(state.goal.status, 'paused', 'a user prompt resumed an unrecoverable failure')
      // Host-managed credentials come back on their own: retry instead of waiting without a wake.
      let managed: any = { goal: { ...goal, status: 'active' } }
      applyGoalTurnFailure({ category: 'auth', managedAuth: true, goal: managed.goal, setAppState: u => { managed = u(managed) }, isNonInteractiveSession: false })
      assert.equal(managed.goal.status, 'active'); assert.equal(managed.goal.retryCount, 1); assert.ok(managed.goal.retryAt)
    }
    if (scenario === 'mapped-auth') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'unrecoverable_error')}
    if (scenario==='provider-quota') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'rate_limit');assert.equal(calls,1);assert.equal(evaluations,0)}
    if (scenario === 'transient') {
      assert.equal(state.goal.status, 'paused'); assert.equal(state.goal.retryCount, 3); assert.equal(state.goal.stopReason, 'retry_exhausted'); assert.equal(calls, 4)
      // A finished background task is not the user's answer; the user's next prompt resumes the goal.
      const notification = createUserMessage({ content: '<task-notification>done</task-notification>' }); (notification as any).origin = { kind: 'task-notification' }
      await run([notification]); assert.equal(state.goal.status, 'paused'); assert.equal(calls, 5)
      // An image prompt ends with its own meta metadata message; it is still the user's prompt.
      await run([createUserMessage({ content: 'The outage is over, carry on.' }), createUserMessage({ content: '[Image: 10x10]', isMeta: true })]); assert.equal(state.goal.status, 'active'); assert.equal(state.goal.retryCount, 1); assert.equal(calls, 6)
      for (const error of ['max_output_tokens', 'unknown'] as const) assert.equal(goalFailureCategory(createAssistantAPIErrorMessage({ content: 'Fixture', error })), 'transient')
    }
    if (scenario === 'impossible') { assert.equal(state.goal.stopReason, 'impossible'); assert.equal(evaluations, 1) }
    if (scenario === 'evaluator-garbage-print') {assert.equal(evaluations,1);assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'turn_failed');assert.ok(events.some(e=>e.type==='system'&&String(e.content).startsWith('Goal paused')),'non-interactive pause gave no notice')}
    if (scenario === 'stop-hook-prevented') {assert.equal(evaluations,0);assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'turn_failed')}
    if (scenario==='quoted-verdict') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.stopReason,'turn_failed');assert.equal(evaluations,1)}
    if (evaluatorContextCases.includes(scenario)) {assert.equal(state.goal.status,'complete');assert.equal(evaluations,scenario==='evaluator-half-window'?1:2);if(evaluatorSizes.length===2)assert.ok(evaluatorSizes[1]!<evaluatorSizes[0]!,'overflow retry did not reduce context')}
    if (scenario === 'fenced-verdict') {assert.equal(evaluations,1);assert.equal(state.goal.status,'complete')}
    if (scenario === 'evaluator-garbage') {assert.equal(evaluations,1);assert.equal(state.goal.status,'active');assert.equal(state.goal.retryCount,1);assert.ok(state.goal.retryAt > Date.now(),'unparseable verdict did not schedule a retry')}
    if (scenario === 'impossible-verify') {assert.equal(state.goal.stopReason,'impossible');assert.equal(evaluations,1);assert.equal(calls,1)}
    if (scenario === 'live-created-goal') {assert.equal(state.goal.tokensUsed,14);assert.equal(state.goal.status,'complete')}
    if (toolProgressCases.includes(scenario)) {
      if (scenario==='tool-progress-mixed') {assert.equal(state.goal.status,'complete');assert.equal(evaluations,2);assert.equal(state.goal.noProgressTurns,0)}
      else {assert.equal(state.goal.stopReason,'no_progress');assert.equal(evaluations,3);assert.equal(calls,6);assert.ok(events.some(e=>e.type==='user'&&e.message.content.some((b:any)=>b.type==='tool_result'&&b.is_error===true)),'failed tool never ran')}
    }
    if (scenario==='no-progress-tool-denied') assert.equal(permissionDenials,3,'permission denial path never ran')
    if (scenario === 'no-progress') { assert.equal(state.goal.stopReason, 'no_progress'); assert.equal(evaluations, 3) }
    if (scenario === 'no-progress-user-reset') { assert.equal(state.goal.stopReason, 'no_progress'); assert.equal(evaluations, 3, 'an interrupted chain carried its no-progress count into a new user prompt') }
    if (scenario === 'completion') { assert.ok(completionWasPending); assert.equal(evaluations, 1); assert.equal(state.goal.status, 'complete') }
    if (scenario === 'child-paused') {assert.equal(state.goal.status,'paused');assert.equal(state.goal.tokensUsed,22);assert.equal(evaluations,0)}
    if (scenario === 'verify') { assert.notEqual(state.goal.status, 'complete'); assert.ok(evaluations > 0) }
    results.push({ scenario, passed: true, calls, evaluations, permissionDenials, goal: state.goal, notices: events.filter(e => e.type === 'system').map(e => e.content) })
    console.log(`PASS ${scenario}`)
  }
} finally {
  globalThis.fetch = originalFetch
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, nodeEnv: process.env.NODE_ENV, transport: 'Real query/tool/independent evaluator chain, scripted model transport, no live API', resultsSha256: createHash('sha256').update(JSON.stringify(results)).digest('hex'), passed: results.length, expected: scenarios.length, exit_code: results.length === scenarios.length ? 0 : 1 }, null, 2))
}

await (await import('../src/utils/cleanupRegistry.js')).runCleanupFunctions()
process.exit(results.length === scenarios.length ? 0 : 1)
