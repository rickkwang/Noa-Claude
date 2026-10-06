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
  passed = true; console.log('PASS task edge truthfulness and snapshot ACKs, including identical messages, replay and legacy data')
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, transport: 'Real task tool and file-backed mailbox lifecycle, no model API', observed: results.length, results_sha256: createHash('sha256').update(JSON.stringify(results)).digest('hex'), exit_code: passed ? 0 : 1 }, null, 2))
}
