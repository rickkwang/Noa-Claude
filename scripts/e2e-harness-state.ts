// Real task and mailbox persistence boundaries, with all state isolated in /tmp.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const artifacts = process.argv.includes('--artifacts') ? resolve(process.argv[process.argv.indexOf('--artifacts') + 1]!) : mkdtempSync(join(tmpdir(), 'noa-state-e2e-'))
mkdirSync(artifacts, { recursive: true })
for (const name of Object.keys(process.env)) if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
process.env.CLAUDE_CODE_TASK_LIST_ID = 'state-fixture'
process.env.CLAUDE_CODE_SIMPLE = '1'
process.env.ANTHROPIC_API_KEY = 'isolated-dummy'
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
;(globalThis as any).MACRO = { VERSION: '1.17.0' }
const { createTask, getTask, getTaskListId } = await import('../src/utils/tasks.js')
const { TaskUpdateTool } = await import('../src/tools/TaskUpdateTool/TaskUpdateTool.js')
const { writeToMailbox, readUnreadMessages, markMessagesAsRead, getInboxPath } = await import('../src/utils/teammateMailbox.js')
const context: any = { setAppState: () => {}, abortController: new AbortController() }
const taskList = getTaskListId()
const results: unknown[] = []
let passed = false
try {
  const a = await createTask(taskList, { subject: 'A', description: 'Fixture', status: 'pending', blocks: [], blockedBy: [] })
  const b = await createTask(taskList, { subject: 'B', description: 'Fixture', status: 'pending', blocks: [], blockedBy: [] })
  for (const field of ['addBlocks', 'addBlockedBy']) {
    const result = await TaskUpdateTool.call({ taskId: a, [field]: ['999999'] }, context)
    results.push({ case: 'missing-' + field, result })
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
    assert.equal(result.data.success, false); assert.deepEqual(result.data.updatedFields, []); assert.ok(result.data.error?.includes('999999'))
    assert.equal(TaskUpdateTool.mapToolResultToToolResultBlockParam(result.data, field).content, result.data.error)
  }
  const partial = await TaskUpdateTool.call({ taskId: a, addBlocks: [b, '999999'] }, context)
  results.push({ case: 'partial-valid-edge', result: partial, a: await getTask(taskList, a), b: await getTask(taskList, b) })
  assert.equal(partial.data.success, false); assert.deepEqual(partial.data.updatedFields, ['blocks'])
  assert.match(TaskUpdateTool.mapToolResultToToolResultBlockParam(partial.data, 'partial').content, /#\d+ → #999999: one of the tasks no longer exists\.\nOther updates to task #\d+ were applied: blocks$/)
  assert.deepEqual((await getTask(taskList, a))?.blocks, [b]); assert.deepEqual((await getTask(taskList, b))?.blockedBy, [a])
  const mixed = await TaskUpdateTool.call({ taskId: b, status: 'in_progress', addBlockedBy: ['999999'] }, context)
  const mixedContent = TaskUpdateTool.mapToolResultToToolResultBlockParam(mixed.data, 'mixed').content
  results.push({ case: 'status-with-missing-blocker', result: mixed, content: mixedContent, b: await getTask(taskList, b) })
  assert.equal(mixed.data.success, false); assert.deepEqual(mixed.data.updatedFields, ['status'])
  assert.equal((await getTask(taskList, b))?.status, 'in_progress'); assert.ok(mixedContent.endsWith('were applied: status'), mixedContent)
  const valid = await TaskUpdateTool.call({ taskId: b, addBlocks: [a] }, context)
  assert.equal(valid.data.success, true); assert.deepEqual(valid.data.updatedFields, ['blocks'])
  const duplicate = await TaskUpdateTool.call({ taskId: b, addBlocks: [a] }, context)
  assert.equal(duplicate.data.success, true); assert.deepEqual(duplicate.data.updatedFields, [])
  for (const sameContent of [false, true]) {
    const agent = sameContent ? 'identical' : 'distinct', team = 'state-fixture'
    const message = { from: 'sender', text: 'A', timestamp: '2026-10-05T00:00:00.000Z' }
    await writeToMailbox(agent, message, team)
    const delivered = await readUnreadMessages(agent, team)
    await writeToMailbox(agent, sameContent ? message : { ...message, text: 'B' }, team)
    await markMessagesAsRead(agent, team, delivered)
    const pending = await readUnreadMessages(agent, team)
    results.push({ case: agent + '-arrival-during-ack', delivered, pending })
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
    assert.equal(pending.length, 1)
    await markMessagesAsRead(agent, team, delivered)
    assert.equal((await readUnreadMessages(agent, team)).length, 1, 'repeating an ACK consumed a new message')
    await markMessagesAsRead(agent, team, pending)
    assert.equal((await readUnreadMessages(agent, team)).length, 0)
  }
  const legacy = { from: 'sender', text: 'Legacy', timestamp: 'old', read: false }
  const legacyPath = getInboxPath('legacy', 'state-fixture'); mkdirSync(resolve(legacyPath, '..'), { recursive: true })
  writeFileSync(legacyPath, JSON.stringify([legacy]))
  const delivered = await readUnreadMessages('legacy', 'state-fixture')
  await writeToMailbox('legacy', { from: 'sender', text: 'Legacy', timestamp: 'old' }, 'state-fixture')
  await markMessagesAsRead('legacy', 'state-fixture', delivered)
  assert.equal((await readUnreadMessages('legacy', 'state-fixture')).length, 1)
  await markMessagesAsRead('legacy', 'state-fixture')
  assert.equal((await readUnreadMessages('legacy', 'state-fixture')).length, 0)
  results.push({ case: 'legacy-and-mark-all', passed: true })
  // Inbox writes replace the file by rename: no temp files left, every inbox still parses.
  const inboxDir = resolve(legacyPath, '..'), inboxFiles = readdirSync(inboxDir)
  results.push({ case: 'atomic-inbox-writes', inboxFiles })
  assert.deepEqual(inboxFiles.filter(name => name.endsWith('.tmp')), [])
  for (const name of inboxFiles.filter(name => name.endsWith('.json'))) assert.ok(Array.isArray(JSON.parse(readFileSync(join(inboxDir, name), 'utf8'))))
  // A user stop must outlive task eviction and metadata cleanup; ordinary completions stay resumable.
  const { enableConfigs } = await import('../src/utils/config.js'); enableConfigs()
  await import('../src/tools/AgentTool/AgentTool.js')
  const { SendMessageTool } = await import('../src/tools/SendMessageTool/SendMessageTool.js')
  const { killAsyncAgent } = await import('../src/tasks/LocalAgentTask/LocalAgentTask.js')
  const { evictTerminalTask } = await import('../src/utils/task/framework.js')
  const { recordSidechainTranscript, flushSessionStorage, writeAgentMetadata } = await import('../src/utils/sessionStorage.js')
  const { createUserMessage, createAssistantMessage } = await import('../src/utils/messages.js')
  const { getDefaultAppState } = await import('../src/state/AppStateStore.js')
  const { createFileStateCacheWithSizeLimit } = await import('../src/utils/fileStateCache.js')
  const { asAgentId } = await import('../src/types/ids.js')
  const { switchSession } = await import('../src/bootstrap/state.js')
  switchSession('22222222-2222-4222-8222-222222222222' as any)
  const id = 'a0123456789abcdef'
  let state: any = getDefaultAppState()
  state.agentNameRegistry.set('cancelled-worker', id)
  const controller = new AbortController()
  state.tasks[id] = { id, agentId: id, type: 'local_agent', agentType: 'general-purpose', status: 'running', abortController: controller, isBackgrounded: true, retain: false, pendingMessages: [] }
  const setAppState = (fn: any) => { state = fn(state) }
  const agentContext: any = { options: { commands: [], debug: false, mainLoopModel: 'claude-sonnet-4-6', tools: [], verbose: false, thinkingConfig: { type: 'disabled' }, mcpClients: [], mcpResources: {}, isNonInteractiveSession: true, agentDefinitions: state.agentDefinitions }, abortController: new AbortController(), readFileState: createFileStateCacheWithSizeLimit(10), getAppState: () => state, setAppState, setInProgressToolUseIDs: () => {}, setResponseLength: () => {}, updateFileHistoryState: () => {}, updateAttributionState: () => {}, messages: [] }
  await recordSidechainTranscript([createUserMessage({ content: 'Cancellation fixture.' })], asAgentId(id)); await flushSessionStorage()
  await writeAgentMetadata(asAgentId(id), { agentType: 'general-purpose' })
  killAsyncAgent(id, setAppState, { stoppedByUser: true })
  assert.equal(controller.signal.aborted, true)
  const send = () => SendMessageTool.call({ to: 'cancelled-worker', message: 'Continue the old task.', summary: 'Cancellation fixture' }, agentContext, async () => ({ behavior: 'allow' }), createAssistantMessage({ content: 'Cancellation fixture.' }))
  const before = await send(); assert.equal(before.data.success, false); assert.match(before.data.message, /stopped by the user/)
  state.tasks[id] = { ...state.tasks[id], notified: true, evictAfter: 0 }
  evictTerminalTask(id, setAppState); assert.equal(state.tasks[id], undefined)
  await writeAgentMetadata(asAgentId(id), { agentType: 'general-purpose', description: 'Cleanup fixture' })
  const after = await send()
  results.push({ case: 'cancel-after-eviction', before: before.data, after: after.data })
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  assert.equal(after.data.success, false, 'a cancelled agent resumed after eviction'); assert.match(after.data.message, /stopped by the user/)
  assert.equal(state.tasks[id], undefined, 'cancellation check allocated a background run')
  const restartProbe = join(artifacts, 'cancel-restart.ts')
  const imports = resolve(import.meta.dir, '../src')
  writeFileSync(restartProbe, `
    process.env.CLAUDE_CODE_SIMPLE = '1'; globalThis.MACRO = { VERSION: '1.17.0' };
    const source = ${JSON.stringify(imports)};
    const { enableConfigs } = await import(source + '/utils/config.ts'); enableConfigs();
    await import(source + '/tools/AgentTool/AgentTool.tsx');
    const { switchSession } = await import(source + '/bootstrap/state.ts');
    switchSession('22222222-2222-4222-8222-222222222222');
    const { resumeAgentBackground } = await import(source + '/tools/AgentTool/resumeAgent.ts');
    const { getDefaultAppState } = await import(source + '/state/AppStateStore.ts');
    const state = getDefaultAppState();
    try {
      await resumeAgentBackground({ agentId: '${id}', prompt: 'Resume cancelled work', toolUseContext: {
        getAppState: () => state, setAppState: fn => Object.assign(state, fn(state)),
        options: { agentDefinitions: state.agentDefinitions, mainLoopModel: 'claude-sonnet-4-6', tools: [], mcpClients: [] },
      } });
      throw Error('cancelled agent resumed');
    } catch (e) {
      if (!e.message.includes('stopped by the user')) throw e;
      console.log('CANCELLED_AFTER_RESTART');
    }
  `)
  const restart = execFileSync('bun', [restartProbe], { encoding: 'utf8', env: process.env })
  assert.ok(restart.includes('CANCELLED_AFTER_RESTART'))
  results.push({ case: 'cancel-after-restart', output: restart.trim() })
  switchSession('33333333-3333-4333-8333-333333333333' as any)
  await recordSidechainTranscript([createUserMessage({ content: 'Late output after clearing the conversation.' })], asAgentId(id)); await flushSessionStorage()
  await writeAgentMetadata(asAgentId(id), { agentType: 'general-purpose' })
  const afterClear = await send()
  results.push({ case: 'cancel-after-session-change', result: afterClear.data })
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  assert.equal(afterClear.data.success, false, 'session change lost user cancellation'); assert.match(afterClear.data.message, /stopped by the user/)
  assert.equal(state.tasks[id], undefined)

  passed = true; console.log('PASS task edge truthfulness and snapshot ACKs, including identical messages, replay and legacy data')
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, transport: 'Real task tool and file-backed mailbox lifecycle, no model API', observed: results.length, results_sha256: createHash('sha256').update(JSON.stringify(results)).digest('hex'), exit_code: passed ? 0 : 1 }, null, 2))
}

process.exit(passed ? 0 : 1)
