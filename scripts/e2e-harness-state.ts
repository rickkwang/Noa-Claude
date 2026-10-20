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
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  assert.deepEqual(maintenanceFailures, [], 'maintenance boundary regressions')

  passed = true; console.log('PASS task edges, snapshot ACKs, cancellation persistence, atomic agent inbox closure and maintenance boundaries')
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, transport: 'Real task tool and file-backed mailbox lifecycle, no model API', observed: results.length, results_sha256: createHash('sha256').update(JSON.stringify(results)).digest('hex'), exit_code: passed ? 0 : 1 }, null, 2))
}

process.exit(passed ? 0 : 1)
