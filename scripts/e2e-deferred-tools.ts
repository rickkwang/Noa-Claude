// Real query/Read/API transport without pre-query attachments; only server responses are scripted.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { TextBlockParam, ThinkingBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages'

const artifacts = resolve(process.argv.includes('--artifacts') ? process.argv[process.argv.indexOf('--artifacts') + 1]! : mkdtempSync(join(tmpdir(), 'noa-deferred-e2e-')))
mkdirSync(artifacts, { recursive: true })
for (const name of Object.keys(process.env)) if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_|ENABLE_TOOL_SEARCH$|USER_TYPE$|.*GROWTHBOOK.*)/.test(name)) delete process.env[name]
assert.notEqual(process.env.NODE_ENV, 'test', 'Use NODE_ENV=development for real transport')
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
process.env.CLAUDE_CODE_PRODUCT_DIR = process.env.CLAUDE_CONFIG_DIR
process.env.ANTHROPIC_API_KEY = 'isolated-dummy'
process.env.ENABLE_TOOL_SEARCH = 'true'
;(globalThis as any).MACRO = { VERSION: '1.17.0', DISPLAY_VERSION: '1.17.0', BUILD_TIME: '' }
process.chdir(artifacts)
const requests: any[] = []
let context: any, calls = 0, stage = 'initial', exit = 1, selected = false
const passed: string[] = []
// Nonempty synthetic signature exercises preservation, not server-side thinking binding.
const thinking = { type: 'thinking' as const, thinking: 'Synthetic local fixture.', signature: Buffer.from('local-fixture-signature').toString('base64') }
const fixture = join(artifacts, 'fixture.txt')
writeFileSync(fixture, 'DEFERRED_PIPELINE_READ_OK\n')
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  assert.equal(new URL(request.url).pathname, '/v1/messages')
  const body = await request.json() as any
  requests.push({ stage, body })
  calls++
  const read = stage === 'initial' && calls === 1
  if (read) context.options.tools = [FileReadTool, ToolSearchTool, toolA, toolB]
  const search = !read && !selected && ['initial', 'remove-A'].includes(stage)
  if (search) selected = true
  const content: (TextBlockParam | ThinkingBlockParam | ToolUseBlockParam)[] = read ? [{ type: 'tool_use', id: 'read_fixture', name: 'Read', input: { file_path: fixture } }] : search ? [{ type: 'tool_use', id: `search_${calls}`, name: 'ToolSearch', input: { query: 'select:DeferredA,DeferredB' } }] : [thinking, { type: 'text', text: 'DONE' }]
  const message = { id: `fixture_${calls}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } }
  const events: any[] = [{ type: 'message_start', message }]
  for (const [index, block] of content.entries()) {
    const start = block.type === 'tool_use' ? { ...block, input: {} } : block.type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' }
    events.push({ type: 'content_block_start', index, content_block: start })
    if (block.type === 'tool_use') events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    else if (block.type === 'thinking') events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } }, { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } })
    else events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    events.push({ type: 'content_block_stop', index })
  }
  events.push({ type: 'message_delta', delta: { stop_reason: read || search ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }, { type: 'message_stop' })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`
// Block every fetch except the fixture, including incidental background requests.
const fetchOriginal = globalThis.fetch
const fixtureOrigin = process.env.ANTHROPIC_BASE_URL
const guardedFetch = ((input: any, init: any) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  assert.equal(url.origin, fixtureOrigin, `Unexpected network request: ${url.origin}`)
  return fetchOriginal(input, init)
}) as typeof fetch
Object.assign(guardedFetch, { preconnect: () => {} })
globalThis.fetch = guardedFetch
const { enableConfigs } = await import('../src/utils/config.js'); enableConfigs()
const { query } = await import('../src/query.js')
const { createUserMessage, handleMessageFromStream } = await import('../src/utils/messages.js')
const { FileReadTool } = await import('../src/tools/FileReadTool/FileReadTool.js')
const { ToolSearchTool } = await import('../src/tools/ToolSearchTool/ToolSearchTool.js')
const { FileStateCache } = await import('../src/utils/fileStateCache.js')
const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
const { asSystemPrompt } = await import('../src/utils/systemPromptType.js')
const toolA = { ...FileReadTool, name: 'DeferredA', shouldDefer: true }
const toolB = { ...FileReadTool, name: 'DeferredB', shouldDefer: true }
let history: any[] = []
const state: any = { tasks: {}, toolPermissionContext: getEmptyToolPermissionContext(), agentNameRegistry: new Map(), agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] }, sessionHooks: new Map(), mcp: { tools: [], clients: [] } }
context = { options: { commands: [], debug: false, mainLoopModel: 'claude-sonnet-4-6', tools: [FileReadTool, ToolSearchTool, toolA], verbose: false, thinkingConfig: { type: 'adaptive' }, mcpClients: [], mcpResources: {}, isNonInteractiveSession: true, agentDefinitions: state.agentDefinitions }, abortController: new AbortController(), readFileState: new FileStateCache(100, 100000), getAppState: () => state, setAppState: (f: any) => Object.assign(state, f(state)), setInProgressToolUseIDs: () => {}, setResponseLength: () => {}, updateFileHistoryState: () => {}, updateAttributionState: () => {}, messages: history }
const deltas = () => history.filter(m => m.type === 'attachment' && m.attachment.type === 'deferred_tools_delta').map(m => m.attachment)
const turn = async (name: string, querySource = 'repl_main_thread') => {
  stage = name
  selected = false
  history.push(createUserMessage({ content: `Fixture turn: ${name}` }))
  context.messages = history
  const deps = { uuid: () => crypto.randomUUID(), microcompact: async (messages: any[]) => ({ messages }), autocompact: async () => ({ wasCompacted: false }), stopHooks: async function* () { return { blockingErrors: [], preventContinuation: false } } }
  for await (const event of query({ messages: [...history], systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {}, canUseTool: async (_tool: any, input: any) => ({ behavior: 'allow', updatedInput: input }), toolUseContext: context, querySource, deps, maxTurns: 3 })) {
    handleMessageFromStream(event, m => history.push(m), () => {}, () => {}, () => {}, () => {})
  }
}
const text = (body: any) => JSON.stringify(body.messages)
try {
  await turn('initial')
  assert.equal(requests.length, 3, 'Read and ToolSearch must each cause a follow-up API request')
  assert.deepEqual(deltas().map(d => [d.addedNames, d.removedNames]), [[['DeferredA'], []], [['DeferredB'], []]])
  assert.ok(text(requests[0].body).includes('DeferredA'))
  assert.ok(!text(requests[0].body).includes('DeferredB'))
  assert.ok(text(requests[1].body).includes('DeferredB'))
  assert.ok(text(requests[1].body).includes('DEFERRED_PIPELINE_READ_OK'))
  const searchResult = (body: any) => body.messages.flatMap((m: any) => m.content).filter((b: any) => b.type === 'tool_result').at(-1)
  assert.deepEqual(searchResult(requests[2].body).content.filter((b: any) => b.type === 'tool_reference').map((b: any) => b.tool_name), ['DeferredA', 'DeferredB'])
  passed.push('initial-A-and-mid-query-add-B')
  const initialHistory = JSON.stringify(history)
  context.options.tools = [FileReadTool, ToolSearchTool, toolB]
  await turn('remove-A')
  assert.deepEqual(deltas().at(-1).removedNames, ['DeferredA'])
  assert.equal(JSON.stringify(history.slice(0, JSON.parse(initialHistory).length)), initialHistory, 'Pool changes rewrote historical messages')
  assert.deepEqual(searchResult(requests[4].body).content.filter((b: any) => b.type === 'tool_reference').map((b: any) => b.tool_name), ['DeferredB'])
  passed.push('remove-A-without-history-rewrite-and-select-current-pool')
  writeFileSync(join(artifacts, 'history.json'), JSON.stringify(history, null, 2))
  history = JSON.parse(readFileSync(join(artifacts, 'history.json'), 'utf8'))
  await turn('restored-B')
  assert.equal(deltas().length, 3, 'Restored history must suppress repeated B announcements')
  passed.push('restored-history-does-not-reannounce')
  // Every historical announcement remains byte-identical in later API bodies.
  const announcements = (body: any) => body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((b: any) => b.type === 'text' && /The following deferred tools/.test(b.text)).map((b: any) => b.text)
  const first = announcements(requests[0].body)[0]
  for (const { body } of requests.slice(1)) assert.equal(announcements(body).filter((s: string) => s === first).length, 1)
  assert.deepEqual(announcements(requests[5].body), announcements(requests[4].body), 'Restore changed historical announcement text')
  for (const { body } of requests) assert.ok(!text(body).includes('<available-deferred-tools>'), 'Legacy transport prepend returned')
  const replayedThinking = requests[3].body.messages.flatMap((m: any) => m.content).find((b: any) => b.type === 'thinking')
  assert.deepEqual(replayedThinking, thinking)
  passed.push('API-history-and-synthetic-thinking-preserved')
  process.env.ENABLE_TOOL_SEARCH = 'false'
  context.options.tools = [FileReadTool, ToolSearchTool, toolA, toolB]
  await turn('toolsearch-off')
  assert.equal(deltas().length, 3, 'Disabled ToolSearch emitted an announcement')
  assert.deepEqual(announcements(requests.at(-1).body), announcements(requests[5].body))
  passed.push('toolsearch-off-no-new-announcement')
  writeFileSync(join(artifacts, 'lifecycle-history.json'), JSON.stringify(history, null, 2))
  process.env.ENABLE_TOOL_SEARCH = 'true'
  // These exercise direct query callers, not runAgent or its transcript writer.
  for (const scenario of [
    { name: 'attachments-disabled', querySource: 'repl_main_thread', agentId: undefined, disableAttachments: true },
    { name: 'direct-agent-query', querySource: 'agent:general-purpose', agentId: 'deferred-fixture-agent', disableAttachments: false },
    { name: 'direct-fork-query', querySource: 'agent:builtin:fork', agentId: 'deferred-fixture-fork', disableAttachments: false },
  ]) {
    if (scenario.disableAttachments) process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = '1'
    else delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
    history = []
    context.agentId = scenario.agentId
    context.options.querySource = scenario.querySource
    context.options.tools = [FileReadTool, ToolSearchTool, toolA, toolB]
    const requestStart: number = requests.length
    await turn(scenario.name, scenario.querySource)
    assert.equal(requests.length, requestStart + 1, `${scenario.name}: expected one API request`)
    assert.deepEqual(deltas().map(d => [d.addedNames, d.removedNames]), [[['DeferredA', 'DeferredB'], []]], `${scenario.name}: query must persist its first announcement`)
    const firstAnnouncements = announcements(requests[requestStart].body)
    assert.equal(firstAnnouncements.length, 1, `${scenario.name}: first request must announce deferred tools`)
    assert.ok(firstAnnouncements[0].includes('DeferredA') && firstAnnouncements[0].includes('DeferredB'))
    const serialized = JSON.stringify(history)
    history = JSON.parse(serialized)
    await turn(`${scenario.name}-restored`, scenario.querySource)
    assert.equal(requests.length, requestStart + 2, `${scenario.name}: expected one restored API request`)
    assert.equal(deltas().length, 1, `${scenario.name}: restored history repeated its announcement`)
    assert.equal(JSON.stringify(history.slice(0, JSON.parse(serialized).length)), serialized, `${scenario.name}: query changed historical messages`)
    assert.deepEqual(announcements(requests[requestStart + 1].body), firstAnnouncements, `${scenario.name}: restored API announcement changed`)
    writeFileSync(join(artifacts, `${scenario.name}-history.json`), JSON.stringify(history, null, 2))
    passed.push(`${scenario.name}-first-request-and-restored-history`)
  }
  for (const { body } of requests) assert.ok(!text(body).includes('<available-deferred-tools>'), 'Legacy transport prepend returned')
  console.log('PASS ' + passed.join(', '))
  exit = 0
} catch (error) { console.error(error) } finally {
  server.stop(true)
  globalThis.fetch = fetchOriginal
  writeFileSync(join(artifacts, 'requests.json'), JSON.stringify(requests, null, 2))
  writeFileSync(join(artifacts, 'final-history.json'), JSON.stringify(history, null, 2))
  const repo = resolve(import.meta.dir, '..')
  const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() + (execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim() ? '-dirty' : '')
  writeFileSync(join(artifacts, 'source.diff'), execFileSync('git', ['-C', repo, 'diff'], { encoding: 'utf8' }))
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: ['NODE_ENV=development', 'bun', import.meta.path, '--artifacts', artifacts], revision, script_sha256: createHash('sha256').update(readFileSync(import.meta.path)).digest('hex'), inputs: ['A → A+B during real Read → B → JSON-restored B → ToolSearch disabled'], transport: 'Actual query/input attachments/API normalization, local scripted SSE only; isolated dummy key and config', thinking: 'Synthetic nonempty signature; no claim of real server binding', passed, request_count: requests.length, exit_code: exit }, null, 2))
  console.log(`Artifacts: ${artifacts}; exit=${exit}`)
}
process.exit(exit)
