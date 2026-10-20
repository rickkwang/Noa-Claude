// Real task and mailbox persistence boundaries, with all state isolated in /tmp.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
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

  // This microtask boundary cannot be rendezvoused through the HTTP CLI
  // fixture. Exercise the real query and both callers' shared inbox here:
  // a pre-check arrival must run; a post-check or cleanup arrival must refuse.
  const { query } = await import('../src/query.js')
  const { asSystemPrompt } = await import('../src/utils/systemPromptType.js')
  const { queuePendingMessage } = await import('../src/tasks/LocalAgentTask/LocalAgentTask.js')
  const deliveryChecks: unknown[] = []
  for (const mode of ['before-check', 'at-check', 'after-query']) {
    const deliveryId = 'a1123456789abcdef'
    let afterStop = false, injected = false, calls = 0
    let sent: Promise<any> | undefined
    state = getDefaultAppState()
    state.tasks[deliveryId] = {
      id: deliveryId, agentId: deliveryId, type: 'local_agent', agentType: 'general-purpose',
      status: 'running', isBackgrounded: true, retain: false,
      get pendingMessages() {
        if (mode === 'at-check' && afterStop && !injected) {
          injected = true
          queueMicrotask(() => { sent = sendDelivery() })
        }
        return []
      },
    }
    const sendDelivery = () => SendMessageTool.call({ to: deliveryId, message: 'DELIVERY_WINDOW_42', summary: 'Closing inbox fixture' }, agentContext, async () => ({ behavior: 'allow' }), createAssistantMessage({ content: 'Sender fixture' }))
    const delivered: boolean[] = []
    const generator = query({
      messages: [createUserMessage({ content: 'Start delivery fixture' })],
      systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {},
      canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      toolUseContext: { ...agentContext, agentId: asAgentId(deliveryId), setAppStateForTasks: setAppState },
      querySource: 'agent:custom', maxTurns: 3,
      deps: {
        callModel: async function* (messages) { calls++; delivered.push(JSON.stringify(messages).includes('DELIVERY_WINDOW_42')); yield createAssistantMessage({ content: 'Done' }) },
        microcompact: async messages => ({ messages }), autocompact: async () => ({ wasCompacted: false }),
        stopHooks: async function* () {
          afterStop = true
          if (mode === 'before-check' && !injected) { injected = true; sent = sendDelivery(); await sent }
          return { preventContinuation: false, blockingErrors: [] }
        },
      },
    })
    let next = await generator.next()
    while (!next.done) next = await generator.next()
    if (mode === 'after-query') sent = sendDelivery()
    const sendResult = await sent
    const directAccepted = mode === 'after-query' ? queuePendingMessage(deliveryId, 'TUI_WINDOW_42', setAppState) : undefined
    const observed = { mode, calls, delivered, terminal: next.value.reason, success: sendResult?.data.success, pending: state.tasks[deliveryId].pendingMessages, finishing: state.tasks[deliveryId].isFinishing, ...(mode === 'after-query' && { directAccepted }) }
    deliveryChecks.push(observed)
    results.push({ case: 'inbox-' + mode, ...observed })
  }
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  assert.deepEqual(deliveryChecks, [
    { mode: 'before-check', calls: 2, delivered: [false, true], terminal: 'completed', success: true, pending: [], finishing: true },
    { mode: 'at-check', calls: 1, delivered: [false], terminal: 'completed', success: false, pending: [], finishing: true },
    { mode: 'after-query', calls: 1, delivered: [false], terminal: 'completed', success: false, pending: [], finishing: true, directAccepted: false },
  ], 'closing inbox accepted a message it could not deliver')

  // Maintenance boundaries use real files, Git and attachment generation.
  const maintenanceFailures: string[] = []
  const maintenance = async (name: string, check: () => Promise<void>) => {
    try { await check(); results.push({ case: name, passed: true }) }
    catch (error) { maintenanceFailures.push(name); results.push({ case: name, passed: false, error: String(error) }) }
  }
  await maintenance('image-idle-pipe-refused', async () => {
    if (process.platform === 'win32') return
    const fifo = join(artifacts, 'idle.png')
    execFileSync('mkfifo', [fifo])
    const source = resolve(import.meta.dir, '../src/tools/FileReadTool/FileReadTool.ts')
    const output = execFileSync('bun', ['-e', `
      const { readImageWithTokenBudget } = await import(${JSON.stringify(source)});
      try { await readImageWithTokenBudget(${JSON.stringify(fifo)}); throw Error('pipe accepted'); }
      catch (e) { if (!/not a regular file/.test(e.message)) throw e; console.log('PIPE_REFUSED'); }
    `], { encoding: 'utf8', env: process.env, timeout: 3000 })
    assert.match(output, /PIPE_REFUSED/)
    const { readImageWithTokenBudget } = await import('../src/tools/FileReadTool/FileReadTool.js')
    const png = join(artifacts, 'regular.png')
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
    assert.equal((await readImageWithTokenBudget(png)).type, 'image')
  })
  await maintenance('transcript-torn-tail-sync-and-async', async () => {
    const { saveCustomTitle, getAgentTranscriptPath } = await import('../src/utils/sessionStorage.js')
    const transcript = join(artifacts, 'torn.jsonl')
    writeFileSync(transcript, '{"type":"user","message":')
    await saveCustomTitle('44444444-4444-4444-8444-444444444444' as any, 'RECOVERED_TITLE', transcript)
    const rows = (file: string) => readFileSync(file, 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
    assert.ok(rows(transcript).some(row => row.customTitle === 'RECOVERED_TITLE'), 'first metadata after torn tail was lost')
    const sideId = asAgentId('a9988776655443322')
    const sidePath = getAgentTranscriptPath(sideId)
    mkdirSync(resolve(sidePath, '..'), { recursive: true })
    writeFileSync(sidePath, '{"type":"assistant",')
    await recordSidechainTranscript([createUserMessage({ content: 'TORN_TAIL_RECOVERED' })], sideId)
    await flushSessionStorage()
    assert.ok(rows(sidePath).some(row => JSON.stringify(row).includes('TORN_TAIL_RECOVERED')), 'first queued message after torn tail was lost')
  })
  await maintenance('worktree-switched-head-and-failed-check', async () => {
    const { restoreWorktreeSession, hasWorktreeChanges } = await import('../src/utils/worktree.js')
    const { ExitWorktreeTool } = await import('../src/tools/ExitWorktreeTool/ExitWorktreeTool.js')
    const repo = join(artifacts, 'worktree-repo'), wt = join(artifacts, 'worktree-checkout')
    mkdirSync(repo)
    const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git(['init', '-b', 'main']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture'])
    writeFileSync(join(repo, 'file'), 'base'); git(['add', '.']); git(['commit', '-m', 'base'])
    const base = git(['rev-parse', 'HEAD'])
    git(['branch', 'other', base])
    git(['worktree', 'add', '-b', 'fixture-work', wt])
    const session: any = { originalCwd: repo, worktreePath: wt, worktreeBranch: 'fixture-work', originalHeadCommit: base }
    restoreWorktreeSession(session)
    try {
      assert.equal((await ExitWorktreeTool.validateInput!({ action: 'remove' }, agentContext)).result, true, 'clean worktree should be removable even from another cwd')
      writeFileSync(join(wt, 'file'), 'commit to preserve'); git(['add', '.'], wt); git(['commit', '-m', 'preserve'], wt)
      for (const checkout of [['checkout', '--detach', base], ['checkout', 'other']]) {
        git(checkout, wt)
        assert.equal((await ExitWorktreeTool.validateInput!({ action: 'remove' }, agentContext)).result, false, 'switched HEAD allowed deleting a branch with commits')
        assert.equal(await hasWorktreeChanges(wt, base, 'fixture-work'), true, 'agent cleanup considered switched HEAD safe')
      }
      git(['checkout', 'fixture-work'], wt)
      restoreWorktreeSession({ ...session, originalHeadCommit: 'missing-baseline' })
      assert.equal((await ExitWorktreeTool.validateInput!({ action: 'remove' }, agentContext)).result, false)
    } finally { restoreWorktreeSession(null) }
  })
  await maintenance('stale-worktree-keeps-original-branch', async () => {
    const { cleanupStaleAgentWorktrees, worktreeBranchName } = await import('../src/utils/worktree.js')
    const { getCwd } = await import('../src/utils/cwd.js')
    const { setCwd } = await import('../src/utils/Shell.js')
    const previous = getCwd(), repo = join(artifacts, 'worktree-repo')
    const wt = join(repo, '.noa', 'worktrees', 'agent-a1234567'), branch = worktreeBranchName('agent-a1234567')
    const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const base = git(['rev-parse', 'main'])
    git(['update-ref', 'refs/remotes/origin/main', base])
    git(['worktree', 'add', '-b', branch, wt, base])
    git(['commit', '--allow-empty', '-m', 'preserve stale branch'], wt)
    const saved = git(['rev-parse', branch])
    git(['checkout', '--detach', base], wt)
    utimesSync(wt, new Date(0), new Date(0))
    setCwd(repo)
    try {
      assert.equal(await cleanupStaleAgentWorktrees(new Date()), 0, 'stale sweep deleted a branch with unpushed commits')
      assert.ok(existsSync(wt)); assert.equal(git(['rev-parse', branch]), saved)
    } finally { setCwd(previous) }
  })
  await maintenance('skill-reload-resume-and-compaction', async () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    const { getAttachments, createAttachmentMessage } = await import('../src/utils/attachments.js')
    const { SkillTool } = await import('../src/tools/SkillTool/SkillTool.js')
    const { call: reloadSkills } = await import('../src/commands/reload-skills/reload-skills.js')
    const { restoreSkillStateFromMessages } = await import('../src/utils/conversationRecovery.js')
    const { getMessagesAfterCompactBoundary, createCompactBoundaryMessage } = await import('../src/utils/messages.js')
    const command: any = { type: 'prompt', name: 'maintenance-fixture', description: 'First description', loadedFrom: 'mcp', source: 'mcp' }
    state.mcp.commands = [command]
    const skillContext: any = { ...agentContext, options: { ...agentContext.options, tools: [SkillTool] } }
    const history: any[] = []
    const listing = async (messages = history) => (await getAttachments(null, skillContext, null, [], messages, 'repl_main_thread', { skipSkillDiscovery: true })).filter(a => a.type === 'skill_listing')
    const first = await listing(); assert.equal(first.length, 1)
    for (const keepNames of [false, true]) {
      const legacyHistory = [createAttachmentMessage({ ...first[0]!, names: keepNames ? first[0]!.names : undefined, digests: undefined })]
      restoreSkillStateFromMessages(legacyHistory)
      assert.equal((await listing(legacyHistory)).length, 0, 'unchanged legacy listing was resent')
      command.description = 'Legacy changed description'
      await reloadSkills('', skillContext)
      const legacyChanged = await listing(legacyHistory)
      assert.equal(legacyChanged.length, 1, 'legacy listing suppressed a changed description after reload')
      assert.equal(legacyChanged[0]!.skillCount, 1)
      assert.match(legacyChanged[0]!.content, /Legacy changed description/)
      legacyHistory.push(createAttachmentMessage(legacyChanged[0]!))
      assert.equal((await listing(legacyHistory)).length, 0, 'migrated legacy listing was resent')
      command.description = 'First description'
    }
    const namesOnlyHistory = [createAttachmentMessage({ ...first[0]!, content: first[0]!.names!.map(name => `- ${name}`).join('\n'), digests: undefined })]
    const refreshed = await listing(namesOnlyHistory)
    assert.equal(refreshed.length, 1, 'legacy names-only listing did not refresh its missing descriptions')
    assert.match(refreshed[0]!.content, /First description/)
    namesOnlyHistory.push(createAttachmentMessage(refreshed[0]!))
    assert.equal((await listing(namesOnlyHistory)).length, 0, 'legacy refresh repeated after migration')
    history.push(createAttachmentMessage(first[0]!))
    await reloadSkills('', skillContext)
    assert.equal((await listing()).length, 0, 'unchanged reload resent the listing')
    command.description = 'Changed description'
    await reloadSkills('', skillContext)
    const changed = await listing(); assert.equal(changed.length, 1); assert.equal(changed[0]!.skillCount, 1); assert.match(changed[0]!.content, /Changed description/)
    history.push(createAttachmentMessage(changed[0]!))
    command.description = 'First description'
    const reverted = await listing(); assert.equal(reverted.length, 1); assert.match(reverted[0]!.content, /First description/)
    history.push(createAttachmentMessage(reverted[0]!))
    restoreSkillStateFromMessages(history)
    assert.equal((await listing()).length, 0, 'resume resent unchanged skills')
    state.mcp.commands.push({ ...command, name: 'added-after-resume' })
    const added = await listing(); assert.equal(added.length, 1); assert.equal(added[0]!.skillCount, 1); assert.match(added[0]!.content, /added-after-resume/)
    const compacted = getMessagesAfterCompactBoundary([...history, createCompactBoundaryMessage('manual', 100)])
    const restored = await listing(compacted)
    assert.ok(restored.some(a => a.content.includes('maintenance-fixture')), 'compaction lost unused skill discovery')
    process.env.CLAUDE_CODE_SIMPLE = '1'
  })
  await maintenance('skill-once-hooks-own-their-registration', async () => {
    const { registerSkillHooks } = await import('../src/utils/hooks/registerSkillHooks.js')
    const { clearSessionHooks } = await import('../src/utils/hooks/sessionHooks.js')
    const { executePreToolHooks } = await import('../src/utils/hooks.js')
    const { getSessionId, setIsInteractive, getIsInteractive } = await import('../src/bootstrap/state.js')
    const session = getSessionId(), interactive = getIsInteractive(), log = join(artifacts, 'once-hooks.log')
    const hook = () => ({ type: 'command', command: `printf 'ran\\n' >> '${log}'`, once: true })
    for (const [name, matcher] of [['first', '^Read$'], ['second', 'Write']]) {
      registerSkillHooks(setAppState, session, { PreToolUse: [{ matcher, hooks: [hook()] }] } as any, name!, join(artifacts, name!))
    }
    delete process.env.CLAUDE_CODE_SIMPLE; setIsInteractive(false)
    try {
      for await (const _ of executePreToolHooks('Read', 'first-hook', {}, agentContext)) {}
      assert.equal(readFileSync(log, 'utf8'), 'ran\n', 'first hook never ran')
      assert.equal(state.sessionHooks.get(session)?.hooks.PreToolUse?.length, 1, 'one-shot hook removed another skill registration')
      for await (const _ of executePreToolHooks('Write', 'second-hook', {}, agentContext)) {}
      for await (const _ of executePreToolHooks('Read', 'already-ran', {}, agentContext)) {}
      for await (const _ of executePreToolHooks('Write', 'already-ran-too', {}, agentContext)) {}
      assert.equal(readFileSync(log, 'utf8'), 'ran\nran\n', 'once hooks did not execute exactly once each')
      const worker = 'skill-hook-worker', workerContext = { ...agentContext, agentId: worker }
      try {
        for (const [name, once] of [['once', true], ['persistent', false]] as const) {
          registerSkillHooks(setAppState, worker, { PreToolUse: [{ matcher: 'Read', hooks: [{ ...hook(), once }] }] } as any, name, join(artifacts, name))
        }
        for (const id of ['worker-first', 'worker-second']) {
          for await (const _ of executePreToolHooks('Read', id, {}, workerContext)) {}
        }
        assert.equal(readFileSync(log, 'utf8'), 'ran\n'.repeat(5), 'worker one-shot hook removed another skill or ran again')
        assert.equal(state.sessionHooks.get(worker)?.hooks.PreToolUse?.flatMap((m: any) => m.hooks).length, 1)
      } finally { clearSessionHooks(setAppState, worker) }
    } finally { clearSessionHooks(setAppState, session); setIsInteractive(interactive); process.env.CLAUDE_CODE_SIMPLE = '1' }
  })
  await maintenance('skill-hooks-background-context', async () => {
    const { createSubagentContext } = await import('../src/utils/forkedAgent.js')
    const { processPromptSlashCommand } = await import('../src/utils/processUserInput/processSlashCommand.js')
    const { clearSessionHooks } = await import('../src/utils/hooks/sessionHooks.js')
    const { executePreToolHooks } = await import('../src/utils/hooks.js')
    const { setIsInteractive, getIsInteractive } = await import('../src/bootstrap/state.js')
    const interactive = getIsInteractive(), log = join(artifacts, 'background-skill-hooks.log')
    const background = createSubagentContext(agentContext, { agentId: asAgentId('background-skill') })
    const nested = createSubagentContext(background, { agentId: asAgentId('nested-background-skill') })
    const command: any = { type: 'prompt', name: 'background-fixture', source: 'userSettings', description: 'fixture', skillRoot: artifacts, hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: `printf 'ran\\n' >> '${log}'`, once: true }] }] }, getPromptForCommand: async () => [{ type: 'text', text: 'fixture' }] }
    try {
      setIsInteractive(false)
      for (const worker of [background, nested]) {
        process.env.CLAUDE_CODE_SIMPLE = '1'
        await processPromptSlashCommand(command.name, '', [command], worker)
        assert.equal(state.sessionHooks.get(worker.agentId)?.hooks.PreToolUse?.length, 1, 'background skill never registered its hook')
        delete process.env.CLAUDE_CODE_SIMPLE
        for (const id of ['first', 'again']) for await (const _ of executePreToolHooks('Read', id, {}, worker)) {}
        assert.equal(state.sessionHooks.get(worker.agentId)?.hooks.PreToolUse, undefined, 'background once hook was not removed')
      }
      assert.equal(readFileSync(log, 'utf8'), 'ran\nran\n')
    } finally {
      for (const worker of [background, nested]) clearSessionHooks(setAppState, worker.agentId!)
      setIsInteractive(interactive); process.env.CLAUDE_CODE_SIMPLE = '1'
    }
  })
  await maintenance('skill-hooks-agent-exit-and-resume', async () => {
    // Replace only the model query; run the real agent setup, skill invocation,
    // hook execution and finally blocks for foreground/background agents.
    const { spyOn } = await import('bun:test')
    const queryModule = await import('../src/query.js')
    const { runAgent } = await import('../src/tools/AgentTool/runAgent.js')
    const { processPromptSlashCommand } = await import('../src/utils/processUserInput/processSlashCommand.js')
    const { executePreToolHooks } = await import('../src/utils/hooks.js')
    const { clearSessionHooks } = await import('../src/utils/hooks/sessionHooks.js')
    const { setIsInteractive, getIsInteractive } = await import('../src/bootstrap/state.js')
    const interactive = getIsInteractive(), log = join(artifacts, 'stale-agent-hook.log')
    const agent: any = { agentType: 'skill-worker', source: 'custom', tools: [], getSystemPrompt: () => 'fixture' }
    const command: any = { type: 'prompt', name: 'lifecycle-fixture', source: 'userSettings', description: 'fixture', skillRoot: artifacts, hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: `printf stale >> '${log}'` }] }] }, getPromptForCommand: async () => [{ type: 'text', text: 'fixture' }] }
    const query = spyOn(queryModule, 'query')
    const workers: string[] = []
    try {
      setIsInteractive(false)
      for (const isAsync of [false, true]) for (const ending of ['complete', 'error', 'abort']) {
        const id = `skill-${isAsync}-${ending}`; workers.push(id)
        const controller = new AbortController()
        const params: any = { agentDefinition: agent, promptMessages: [], toolUseContext: agentContext, isAsync, querySource: 'agent:custom', availableTools: [], override: { agentId: id, abortController: controller, systemPrompt: ['fixture'], userContext: {}, systemContext: {} } }
        query.mockImplementation((async function* ({ toolUseContext }: any) {
          await processPromptSlashCommand(command.name, '', [command], toolUseContext)
          assert.ok(state.sessionHooks.has(id), 'agent never registered its skill hooks')
          if (ending === 'error') throw new Error('fixture query failed')
          if (ending === 'abort') controller.abort()
        }) as any)
        if (ending === 'complete') { for await (const _ of runAgent(params)) {} }
        else await assert.rejects(async () => { for await (const _ of runAgent(params)) {} }, ending === 'error' ? /fixture query failed/ : /abort/i)
        assert.equal(state.sessionHooks.has(id), false, `skill hooks survived ${isAsync}/${ending}`)
        query.mockImplementation((async function* ({ toolUseContext }: any) {
          delete process.env.CLAUDE_CODE_SIMPLE
          for await (const _ of executePreToolHooks('Read', 'resumed-read', {}, toolUseContext)) {}
          process.env.CLAUDE_CODE_SIMPLE = '1'
        }) as any)
        params.override.abortController = new AbortController()
        for await (const _ of runAgent(params)) {}
        assert.equal(existsSync(log), false, 'old skill hook ran after agent resume')
      }
    } finally {
      query.mockRestore()
      for (const id of workers) clearSessionHooks(setAppState, id)
      setIsInteractive(interactive); process.env.CLAUDE_CODE_SIMPLE = '1'
    }
  })
  await maintenance('skill-hook-source-budgets', async () => {
    const { registerSkillHooks } = await import('../src/utils/hooks/registerSkillHooks.js')
    const { clearSessionHooks } = await import('../src/utils/hooks/sessionHooks.js')
    const session = 'hook-budget-fixture'
    const count = () => Object.values(state.sessionHooks.get(session)?.hooks ?? {}).flatMap((matchers: any) => matchers.flatMap((m: any) => m.hooks)).length
    try {
      const hooks = { PreToolUse: [{ matcher: 'Read', hooks: Array.from({ length: 600 }, (_, i) => ({ type: 'command', command: `printf ${i}` })) }] }
      for (const skill of ['a', 'b', 'c']) registerSkillHooks(setAppState, session, hooks as any, skill, join(artifacts, skill), 'same-repository')
      assert.equal(count(), 1024, 'same source bypassed its cumulative hook budget')
      registerSkillHooks(setAppState, session, { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'printf other' }] }] } as any, 'other', artifacts, 'another-source')
      assert.equal(count(), 1025, 'one source exhausted another source budget')
      const longMatcher = { PreToolUse: [{ matcher: 'x'.repeat(16385), hooks: [{ type: 'command', command: 'printf long' }] }] }
      registerSkillHooks(setAppState, session, longMatcher as any, 'long', artifacts, 'matcher-source')
      assert.equal(count(), 1025, 'oversized matcher registered hooks')
      for (const name of ['a', 'b', 'c']) {
        registerSkillHooks(setAppState, session, { PreToolUse: [{ matcher: name.repeat(8192), hooks: [{ type: 'command', command: `printf ${name}` }] }] } as any, name, artifacts, 'matcher-source')
      }
      assert.equal(count(), 1027, 'multiple skills bypassed their source matcher budget')
    } finally { clearSessionHooks(setAppState, session) }
  })
  await maintenance('skill-argument-name-bounds', async () => {
    const { parseArgumentNames, substituteArguments } = await import('../src/utils/argumentSubstitution.js')
    const names = Array.from({ length: 3000 }, (_, i) => `name_${i}`)
    assert.equal(parseArgumentNames(names).length, 64, 'argument name count is unbounded')
    const long = 'x'.repeat(65)
    assert.ok(parseArgumentNames([long]).every(name => name.length <= 64), 'argument name length is unbounded')
    assert.equal(substituteArguments('$second', 'first second', false, parseArgumentNames([long, 'second'])), 'second', 'skipped argument name shifted later values')
    assert.equal(parseArgumentNames(names.join(' ')).length, 64, 'string argument name count is unbounded')
    assert.equal(substituteArguments('$name_0 $name_63 $name_64', Array.from({ length: 65 }, (_, i) => `v${i}`).join(' '), false, names), 'v0 v63 $name_64')
    assert.equal(substituteArguments('$first $ARGUMENTS[1] $2 $ARGUMENTS', '"$second" b c', false, ['first', 'second']), '$second b c "$second" b c', 'inserted values were re-expanded')
    assert.equal(substituteArguments('$' + long, 'value', false, [long]), '$' + long, 'oversized argument name was expanded')
  })
  await maintenance('skill-policy-withholds-permissions-with-hooks', async () => {
    const probe = join(artifacts, 'skill-policy.ts'), source = resolve(import.meta.dir, '../src')
    writeFileSync(probe, `
      globalThis.MACRO = { VERSION: 'fixture' };
      const { enableConfigs } = await import(${JSON.stringify(source)} + '/utils/config.ts'); enableConfigs();
      const { getSettingsForSource } = await import(${JSON.stringify(source)} + '/utils/settings/settings.ts');
      const { processPromptSlashCommand } = await import(${JSON.stringify(source)} + '/utils/processUserInput/processSlashCommand.tsx');
      const { getDefaultAppState } = await import(${JSON.stringify(source)} + '/state/AppStateStore.ts');
      const { createSkillCommand } = await import(${JSON.stringify(source)} + '/skills/loadSkillsDir.ts');
      const { prepareForkedCommandContext } = await import(${JSON.stringify(source)} + '/utils/forkedAgent.ts');
      const { hasPermissionsToUseTool } = await import(${JSON.stringify(source)} + '/utils/permissions/permissions.ts');
      const { createAssistantMessage } = await import(${JSON.stringify(source)} + '/utils/messages.ts');
      const { BashTool } = await import(${JSON.stringify(source)} + '/tools/BashTool/BashTool.tsx');
      const { createFileStateCacheWithSizeLimit } = await import(${JSON.stringify(source)} + '/utils/fileStateCache.ts');
      const { existsSync } = await import('node:fs');
      let state = getDefaultAppState(); state.toolPermissionContext.mode = 'default';
      const context = { options: { tools: [BashTool], commands: [], mainLoopModel: 'claude-sonnet-4-6', mcpClients: [], mcpResources: {}, agentDefinitions: { activeAgents: [{ agentType: 'general-purpose', source: 'built-in', getSystemPrompt: () => 'fixture' }] } }, messages: [], getAppState: () => state, setAppState: fn => { state = fn(state); }, abortController: new AbortController(), readFileState: createFileStateCacheWithSizeLimit(10), updateFileHistoryState: () => {}, updateAttributionState: () => {}, setInProgressToolUseIDs: () => {}, setResponseLength: () => {} };
      const command = { type: 'prompt', name: 'policy-fixture', description: 'fixture', source: process.argv[2], allowedTools: ['Bash'], hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'printf hook' }] }] }, getPromptForCommand: async () => [{ type: 'text', text: 'fixture' }] };
      const result = await processPromptSlashCommand(command.name, '', [command], context);
      const marker = process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH + '/' + process.argv[2] + '-inline.txt';
      const inline = createSkillCommand({ skillName: 'inline-fixture', description: 'fixture', markdownContent: '!\\x60printf ok > ' + marker + '\\x60', allowedTools: ['Bash'], argumentNames: [], source: process.argv[2], loadedFrom: 'user' });
      let inlineError;
      try { await inline.getPromptForCommand('', context); } catch (error) { inlineError = String(error); }
      const fork = await prepareForkedCommandContext({ ...command, context: 'fork' }, '', context);
      const forkContext = { ...context, getAppState: fork.modifiedGetAppState };
      const shell = { command: 'printf fixture > ' + marker + '-fork' };
      const permission = await hasPermissionsToUseTool(BashTool, shell, forkContext, createAssistantMessage({ content: [] }), '');
      state.toolPermissionContext.alwaysDenyRules.cliArg = ['Bash'];
      const denied = await hasPermissionsToUseTool(BashTool, shell, forkContext, createAssistantMessage({ content: [] }), '');
      delete state.toolPermissionContext.alwaysDenyRules.cliArg;
      state.toolPermissionContext.alwaysAllowRules.cliArg = ['Bash'];
      const explicit = await hasPermissionsToUseTool(BashTool, shell, forkContext, createAssistantMessage({ content: [] }), '');
      console.log(JSON.stringify({ policy: getSettingsForSource('policySettings')?.strictPluginOnlyCustomization, allowedTools: result.allowedTools, hooks: [...state.sessionHooks.values()].flatMap(s => Object.values(s.hooks)).length, inlineRan: existsSync(marker), inlineError, forkRules: fork.modifiedGetAppState().toolPermissionContext.alwaysAllowRules.command ?? [], forkPermission: permission.behavior, deniedPermission: denied.behavior, explicitPermission: explicit.behavior }));
    `)
    const observations = []
    for (const restricted of [false, true]) {
      const managed = join(artifacts, `managed-${restricted}`); mkdirSync(managed)
      writeFileSync(join(managed, 'managed-settings.json'), JSON.stringify(restricted ? { strictPluginOnlyCustomization: ['hooks'] } : {}))
      for (const source of ['userSettings', 'plugin']) {
        const output = execFileSync('bun', [probe, source], { encoding: 'utf8', env: { ...process.env, USER_TYPE: 'ant', CLAUDE_CODE_MANAGED_SETTINGS_PATH: managed } })
        const observed = JSON.parse(output.trim()); observations.push({ restricted, source, ...observed })
        writeFileSync(join(artifacts, 'skill-policy.json'), JSON.stringify(observations, null, 2))
        assert.equal(observed.hooks, restricted && source === 'userSettings' ? 0 : 1)
        assert.equal(observed.inlineRan, !(restricted && source === 'userSettings'), `inline permission boundary failed: ${observed.inlineError}`)
        if (restricted && source === 'userSettings') assert.match(observed.inlineError, /permission/i)
        assert.deepEqual(observed.allowedTools, restricted && source === 'userSettings' ? [] : ['Bash'], 'skill kept permissions while its hooks were excluded')
        assert.deepEqual(observed.forkRules, observed.allowedTools, 'fork skill bypassed permission policy')
        assert.equal(observed.forkPermission, restricted && source === 'userSettings' ? 'ask' : 'allow')
        assert.equal(observed.deniedPermission, 'deny', 'skill overrode an explicit deny')
        assert.equal(observed.explicitPermission, 'allow', 'policy removed explicit CLI permission')
      }
    }
  })
  await maintenance('transcript-tombstone-write-failure-keeps-history', async () => {
    if (process.platform === 'win32') return
    // Real file-size limit injects write failure. Cover middle/last entries,
    // the >64KiB slow path, and the ordinary successful deletion path.
    const probe = join(artifacts, 'tombstone-failure.ts'), source = resolve(import.meta.dir, '../src')
    writeFileSync(probe, `
      process.on('SIGXFSZ', () => {}); globalThis.MACRO = { VERSION: 'fixture' };
      const { setSessionFileForTesting, removeTranscriptMessage } = await import(${JSON.stringify(source)} + '/utils/sessionStorage.ts');
      setSessionFileForTesting(process.argv[2]); await removeTranscriptMessage('55555555-5555-4555-8555-555555555555');
    `)
    for (const mode of ['middle', 'slow', 'last', 'success']) {
      const file = join(artifacts, `tombstone-${mode}.jsonl`)
      const before = JSON.stringify({ uuid: '44444444-4444-4444-8444-444444444444', content: 'KEEP_BEFORE' }) + '\n'
      const target = JSON.stringify({ uuid: '55555555-5555-4555-8555-555555555555', content: 'REMOVE_ME' }) + '\n'
      const after = mode === 'last' ? '' : JSON.stringify({ uuid: '66666666-6666-4666-8666-666666666666', content: 'KEEP_AFTER' + 'x'.repeat(mode === 'slow' ? 70000 : mode === 'middle' ? 4096 : 0) }) + '\n'
      const original = before + target + after
      writeFileSync(file, original)
      execFileSync('bash', ['-c', `${mode === 'success' ? '' : 'ulimit -f 1; '}exec bun "$1" "$2"`, '--', probe, file], { env: process.env, stdio: 'pipe', timeout: 10000 })
      assert.equal(readFileSync(file, 'utf8'), mode === 'last' || mode === 'success' ? before + after : original, `tombstone ${mode} lost history after a write failure`)
      assert.equal(readdirSync(artifacts).filter(name => name.startsWith(`tombstone-${mode}.jsonl.`) && name.endsWith('.tmp')).length, 0, 'failed transcript replacement left a temp file')
    }
    const { setSessionFileForTesting, enqueueEntryForTesting, removeTranscriptMessage, getTranscriptPath } = await import('../src/utils/sessionStorage.js')
    const file = join(artifacts, 'tombstone-queued.jsonl')
    const target = { type: 'user', uuid: '55555555-5555-4555-8555-555555555555', message: { role: 'user', content: 'REMOVE_ME' } }
    writeFileSync(file, JSON.stringify(target) + '\n')
    setSessionFileForTesting(file)
    try {
      const queued = enqueueEntryForTesting({ type: 'custom-title', customTitle: 'KEEP_QUEUED', sessionId: '33333333-3333-4333-8333-333333333333' } as any)
      await removeTranscriptMessage(target.uuid as any); await queued
      assert.match(readFileSync(file, 'utf8'), /KEEP_QUEUED/)
      assert.ok(!readFileSync(file, 'utf8').includes('REMOVE_ME'))
    } finally { setSessionFileForTesting(getTranscriptPath()) }
  })
  await maintenance('transcript-large-tail-tombstone', async () => {
    const probe = join(artifacts, 'tombstone-large.ts'), source = resolve(import.meta.dir, '../src')
    writeFileSync(probe, `
      process.on('SIGXFSZ', () => {}); globalThis.MACRO = { VERSION: 'fixture' };
      const { setSessionFileForTesting, removeTranscriptMessage } = await import(${JSON.stringify(source)} + '/utils/sessionStorage.ts');
      setSessionFileForTesting(process.argv[2]); await removeTranscriptMessage('55555555-5555-4555-8555-555555555555');
    `)
    const prefix = (JSON.stringify({ type: 'system', content: 'x'.repeat(65536) + '你好🙂' }) + '\n').repeat(801)
    const target = JSON.stringify({ uuid: '55555555-5555-4555-8555-555555555555', content: 'REMOVE_ME' }) + '\n'
    const metadata = JSON.stringify({ type: 'custom-title', customTitle: 'KEEP_METADATA' }) + '\n'
    const hash = (text: string) => createHash('sha256').update(text).digest('hex')
    for (const mode of ['middle', 'last', ...(process.platform === 'win32' ? [] : ['write-failure'])]) {
      const file = join(artifacts, `large-${mode}.jsonl`), suffix = mode === 'last' ? '' : metadata
      const original = prefix + target + suffix
      writeFileSync(file, original)
      if (mode === 'write-failure') execFileSync('bash', ['-c', 'ulimit -f 1; exec bun "$1" "$2"', '--', probe, file], { env: process.env, stdio: 'pipe', timeout: 10000 })
      else execFileSync('bun', [probe, file], { env: process.env, stdio: 'pipe', timeout: 10000 })
      assert.equal(hash(readFileSync(file, 'utf8')), hash(mode === 'write-failure' ? original : prefix + suffix), `large transcript ${mode} was not safely edited`)
      assert.equal(readdirSync(artifacts).filter(name => name.startsWith(`large-${mode}.jsonl.`) && name.endsWith('.tmp')).length, 0)
    }
  })
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  assert.deepEqual(maintenanceFailures, [], 'maintenance boundary regressions')

  passed = true; console.log('PASS task edges, snapshot ACKs, cancellation persistence, atomic agent inbox closure and maintenance boundaries')
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, transport: 'Real task tool and file-backed mailbox lifecycle, no model API', observed: results.length, results_sha256: createHash('sha256').update(JSON.stringify(results)).digest('hex'), exit_code: passed ? 0 : 1 }, null, 2))
}

process.exit(passed ? 0 : 1)
