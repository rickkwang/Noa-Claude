// Exercise the real source request pipeline with scripted responses and no network.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dir, '..')
const artifacts = resolve(process.argv.includes('--artifacts') ? process.argv[process.argv.indexOf('--artifacts') + 1]! : mkdtempSync(join(tmpdir(), 'noa-thinking-binding-e2e-')))
mkdirSync(artifacts, { recursive: true })
for (const name of Object.keys(process.env)) if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_|USER_TYPE$|.*GROWTHBOOK.*)/.test(name)) delete process.env[name]
assert.notEqual(process.env.NODE_ENV, 'test', 'Use NODE_ENV=development for real transport')
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
process.env.CLAUDE_CODE_PRODUCT_DIR = process.env.CLAUDE_CONFIG_DIR
process.env.ANTHROPIC_API_KEY = 'isolated-dummy'
process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
;(globalThis as any).MACRO = { VERSION: '1.17.0', DISPLAY_VERSION: '1.17.0', BUILD_TIME: '' }
process.chdir(artifacts)

const inputs = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-opus-5'].map(model => ({ model, thinkingConfig: { type: 'disabled' as const } }))
const requests: any[] = []
const observed: any[] = []
let exit = 1
let recoveryStage = false
let recoveryCalls = 0
let microcompactStage = false
let microcompactCalls = 0
const preservedWriteContent = 'abc  \n'.repeat(10_000)
const legacyWriteContent = 'abc\n'.repeat(10_000)
const microcompactObserved: any[] = []
const oldSignature = Buffer.from('old-local-signature').toString('base64')
const freshSignature = Buffer.from('fresh-local-signature').toString('base64')
const recoveryEvents: any[] = []
const controlsBeta = 'thinking-binding-controls-2026-08-01'
// Never delegate to the original fetch: even allowed URLs are answered in memory.
const guardedFetch = (async (input: any, init: any) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  assert.equal(url.origin, 'https://api.anthropic.com', `Unexpected request origin: ${url.origin}`)
  assert.equal(url.pathname, '/v1/messages', `Unexpected request path: ${url.pathname}`)
  assert.equal(request.method, 'POST')
  const body = await request.json() as any
  requests.push({ url: request.url, beta: request.headers.get('anthropic-beta'), body })
  const message = { id: `fixture_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } }
  if (!body.stream) return Response.json({ ...message, content: [{ type: 'text', text: 'DONE' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 1 } })
  if (recoveryStage) recoveryCalls++
  if (recoveryStage && recoveryCalls === 2) {
    return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid signature in thinking block' } }, { status: 400 })
  }
  if (microcompactStage) microcompactCalls++
  const toolTurn = microcompactStage ? microcompactCalls <= 2 : recoveryStage && [1, 3].includes(recoveryCalls)
  const content: any[] = microcompactStage && microcompactCalls === 1 ? [
    { type: 'tool_use', id: 'preserved_write', name: 'Write', input: { file_path: join(artifacts, 'preserved.txt'), content: preservedWriteContent } },
    { type: 'tool_use', id: 'legacy_write', name: 'Write', input: { file_path: join(artifacts, 'legacy.txt'), content: legacyWriteContent } },
  ] : microcompactStage && microcompactCalls === 2 ? [
    { type: 'tool_use', id: 'recent_read', name: 'Read', input: { file_path: join(artifacts, 'fixture.txt') } },
  ] : toolTurn ? [
    { type: 'thinking', thinking: recoveryCalls === 1 ? 'Old fixture reasoning.' : '', signature: recoveryCalls === 1 ? oldSignature : freshSignature },
    { type: 'tool_use', id: `fixture_read_${recoveryCalls}`, name: 'Read', input: { file_path: join(artifacts, 'fixture.txt') } },
  ] : [{ type: 'text', text: 'DONE' }]
  const events: any[] = [{ type: 'message_start', message }]
  for (const [index, block] of content.entries()) {
    const start = block.type === 'tool_use' ? { ...block, input: {} } : block.type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' }
    events.push({ type: 'content_block_start', index, content_block: start })
    if (block.type === 'tool_use') events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    else if (block.type === 'thinking') {
      if (block.thinking) events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } })
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } })
    } else events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    events.push({ type: 'content_block_stop', index })
  }
  events.push({ type: 'message_delta', delta: { stop_reason: toolTurn ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}) as typeof fetch
Object.assign(guardedFetch, { preconnect: () => {} })
globalThis.fetch = guardedFetch

try {
  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { queryModelWithStreaming } = await import('../src/services/api/claude.js')
  const { createUserMessage } = await import('../src/utils/messages.js')
  const { asSystemPrompt } = await import('../src/utils/systemPromptType.js')
  const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
  for (const scenario of inputs) {
    const requestStart = requests.length
    const outputs: any[] = []
    for await (const event of queryModelWithStreaming({
      messages: [createUserMessage({ content: 'Local thinking binding fixture; respond DONE.' })],
      systemPrompt: asSystemPrompt([]),
      thinkingConfig: scenario.thinkingConfig,
      tools: [],
      signal: new AbortController().signal,
      options: {
        model: scenario.model,
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        isNonInteractiveSession: true,
        querySource: 'repl_main_thread',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
        fetchOverride: guardedFetch,
        effortValue: 'high',
        maxOutputTokensOverride: 1024,
      },
    })) outputs.push(event)
    assert.equal(requests.length, requestStart + 1, `${scenario.model}: expected one request without retry`)
    assert.ok(outputs.some(event => event.type === 'assistant' && event.message.content.some((block: any) => block.type === 'text' && block.text === 'DONE')), `${scenario.model}: missing scripted assistant response`)
    const { body, beta } = requests[requestStart]
    assert.equal(body.model, scenario.model)
    if (scenario.model === 'claude-opus-5') {
      assert.deepEqual(body.thinking, { type: 'disabled' })
      assert.equal(body.thinking.block_binding, undefined)
    } else {
      assert.ok(beta?.split(',').map((value: string) => value.trim()).includes(controlsBeta), `${scenario.model}: missing controls beta`)
      assert.deepEqual(body.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } })
    }
    observed.push({ model: body.model, input_thinking: scenario.thinkingConfig, thinking: body.thinking, beta, assistant: 'DONE', request_count: 1 })
  }
  const { query } = await import('../src/query.js')
  const { handleMessageFromStream } = await import('../src/utils/messages.js')
  const { FileReadTool } = await import('../src/tools/FileReadTool/FileReadTool.js')
  const { FileStateCache } = await import('../src/utils/fileStateCache.js')
  writeFileSync(join(artifacts, 'fixture.txt'), 'THINKING_RECOVERY_READ_OK\n')
  let history: any[] = [createUserMessage({ content: 'Read the local fixture and respond DONE.' })]
  const state: any = { tasks: {}, toolPermissionContext: getEmptyToolPermissionContext(), agentNameRegistry: new Map(), agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] }, sessionHooks: new Map(), mcp: { tools: [], clients: [] } }
  const context: any = { options: { commands: [], debug: false, mainLoopModel: 'claude-opus-5-5', tools: [FileReadTool], verbose: false, thinkingConfig: { type: 'adaptive' }, mcpClients: [], mcpResources: {}, isNonInteractiveSession: true, agentDefinitions: state.agentDefinitions }, abortController: new AbortController(), readFileState: new FileStateCache(100, 100000), getAppState: () => state, setAppState: (f: any) => Object.assign(state, f(state)), setInProgressToolUseIDs: () => {}, setResponseLength: () => {}, updateFileHistoryState: () => {}, updateAttributionState: () => {}, messages: history }
  const turn = async () => {
    context.messages = history
    const deps = { uuid: () => crypto.randomUUID(), microcompact: async (messages: any[]) => ({ messages }), autocompact: async () => ({ wasCompacted: false }), stopHooks: async function* () { return { blockingErrors: [], preventContinuation: false } } }
    for await (const event of query({ messages: [...history], systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {}, canUseTool: async (_tool: any, input: any) => ({ behavior: 'allow', updatedInput: input }), toolUseContext: context, querySource: 'repl_main_thread', deps, maxTurns: 6 })) {
      recoveryEvents.push(event)
      handleMessageFromStream(event, message => history.push(message), () => {}, () => {}, () => {}, () => {}, () => {})
    }
  }
  recoveryStage = true
  const recoveryStart = requests.length
  await turn()
  assert.equal(recoveryCalls, 4, 'Expected tool use, signature error, fresh tool use, then final')
  const marker = history.find(message => message.type === 'system' && message.subtype === 'thinking_signature_recovery')
  assert.ok(marker, 'Recovery marker must be emitted into external history')
  const oldMessage = history.find(message => message.type === 'assistant' && message.message.content.some((block: any) => block.type === 'thinking' && block.signature === oldSignature))
  assert.ok(oldMessage, 'External history must retain the old signature to exercise marker filtering')
  assert.ok(marker.signatureStripMessageUuids.includes(oldMessage.uuid), 'Marker must name the old assistant UUID')
  const signatures = (body: any) => body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []).filter((block: any) => block.type === 'thinking').map((block: any) => block.signature)
  assert.ok(signatures(requests[recoveryStart + 1].body).includes(oldSignature), 'The rejected request must carry the old signature')
  assert.ok(!signatures(requests[recoveryStart + 2].body).includes(oldSignature), 'Recovery retry must strip old signature')
  assert.ok(signatures(requests[recoveryStart + 3].body).includes(freshSignature), 'Empty-text fresh signature must survive the tool follow-up')
  const serialized = JSON.stringify(history)
  writeFileSync(join(artifacts, 'recovery-history.json'), serialized)
  history = JSON.parse(serialized)
  history.push(createUserMessage({ content: 'Continue after restoring this history; respond DONE.' }))
  await turn()
  assert.equal(recoveryCalls, 5)
  const restoredSignatures = signatures(requests.at(-1).body)
  assert.ok(!restoredSignatures.includes(oldSignature), 'JSON-restored query must not replay the old signature')
  assert.ok(restoredSignatures.includes(freshSignature), 'JSON-restored query must preserve the fresh signature')
  observed.push({ scenario: 'source-query-signature-recovery-json-roundtrip', request_count: recoveryCalls, marker, old_signature_retained_in_external_history: true, fresh_empty_text_signature_replayed: true, restored_signatures: restoredSignatures })
  recoveryStage = false
  microcompactStage = true
  process.env.CLAUDE_CODE_SIZE_MICROCOMPACT = '1'
  process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_KEEP = '1'
  process.env.CLAUDE_CODE_SIZE_MICROCOMPACT_PCT = '1'
  const { FileWriteTool } = await import('../src/tools/FileWriteTool/FileWriteTool.js')
  const { microcompactMessages, estimateMessageTokens } = await import('../src/services/compact/microCompact.js')
  const { roughTokenCountEstimationForMessages } = await import('../src/services/tokenEstimation.js')
  const { normalizeMessagesForAPI } = await import('../src/utils/messages.js')
  context.options.tools = [FileReadTool, FileWriteTool]
  history = [createUserMessage({ content: 'Write both local fixtures, read fixture.txt, and respond DONE.' })]
  context.messages = history
  const microcompactStart = requests.length
  const writeBlock = (messages: any[], id: string) => messages.flatMap(message => message.message?.content ?? []).find(block => block.type === 'tool_use' && block.id === id)
  for await (const event of query({
    messages: [...history], systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {},
    canUseTool: async (_tool: any, input: any) => ({ behavior: 'allow', updatedInput: input }),
    toolUseContext: context, querySource: 'repl_main_thread', maxTurns: 4,
    deps: {
      uuid: () => crypto.randomUUID(),
      microcompact: async (messages: any[], toolContext: any, source: any) => {
        const result = await microcompactMessages(messages, toolContext, source)
        const preserved = writeBlock(result.messages, 'preserved_write')
        const legacy = writeBlock(result.messages, 'legacy_write')
        if (preserved && legacy && legacy.input.content !== legacyWriteContent) {
          assert.equal(preserved.originalInput.content, preservedWriteContent)
          assert.equal('originalInput' in legacy, false, 'Unchanged Write must retain legacy clearing behavior')
          assert.equal(preserved.input.content, 'abc\n'.repeat(10_000), 'Preserved execution input must not be cleared')
          assert.ok(legacy.input.content.length < 1000, 'Legacy input must still be cleared')
          const wire = normalizeMessagesForAPI(result.messages, context.options.tools)
          assert.equal(estimateMessageTokens(result.messages), estimateMessageTokens(wire), 'Size estimate must count the input actually sent')
          assert.equal(roughTokenCountEstimationForMessages(result.messages), roughTokenCountEstimationForMessages(wire), 'Context savings must count the input actually sent')
          microcompactObserved.push({ preserved_input_chars: preserved.originalInput.content.length, legacy_input_chars: legacy.input.content.length, local_estimate: estimateMessageTokens(result.messages), wire_estimate: estimateMessageTokens(wire) })
        }
        return result
      },
      autocompact: async () => ({ wasCompacted: false }),
      stopHooks: async function* () { return { blockingErrors: [], preventContinuation: false } },
    },
  })) handleMessageFromStream(event, message => history.push(message), () => {}, () => {}, () => {}, () => {}, () => {})
  assert.equal(microcompactCalls, 3, 'Expected Write, Read, then final transport request')
  assert.ok(microcompactObserved.length > 0, 'Real size microcompact did not clear the old inputs')
  const finalBlocks = requests.at(-1).body.messages.flatMap((message: any) => message.content)
  assert.equal(finalBlocks.find((block: any) => block.id === 'preserved_write').input.content, preservedWriteContent)
  assert.ok(finalBlocks.find((block: any) => block.id === 'legacy_write').input.content.length < 1000)
  assert.equal(readFileSync(join(artifacts, 'preserved.txt'), 'utf8'), 'abc\n'.repeat(10_000))
  assert.equal(readFileSync(join(artifacts, 'legacy.txt'), 'utf8'), legacyWriteContent)
  observed.push({ scenario: 'source-query-original-input-size-microcompact', request_count: requests.length - microcompactStart, checks: microcompactObserved })
  exit = 0
  console.log(`PASS ${inputs.map(input => input.model).join(', ')}, source-query-signature-recovery-json-roundtrip, source-query-original-input-size-microcompact`)
} catch (error) {
  console.error(error)
} finally {
  const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() + (execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim() ? '-dirty' : '')
  writeFileSync(join(artifacts, 'requests.json'), JSON.stringify(requests, null, 2))
  writeFileSync(join(artifacts, 'recovery-events.json'), JSON.stringify(recoveryEvents, null, 2))
  writeFileSync(join(artifacts, 'source.diff'), execFileSync('git', ['-C', repo, 'diff', '--', 'src/services/api/claude.ts', 'src/services/compact/microCompact.ts', 'src/services/tokenEstimation.ts'], { encoding: 'utf8' }))
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({
    command: ['NODE_ENV=development', 'bun', import.meta.path, '--artifacts', artifacts],
    revision,
    script_sha256: createHash('sha256').update(readFileSync(import.meta.path)).digest('hex'),
    inputs: { binding: inputs, recovery: 'thinking+tool_use → 400 invalid signature → fresh empty-text thinking+tool_use → final; external old-signature history + recovery marker + fresh outputs → JSON roundtrip → query again', microcompact: { preserved_write: 'abc  \\n repeated 10000 times', legacy_write: 'abc\\n repeated 10000 times', keep_recent: 1, trigger_percent: 1, sequence: 'real Write x2 → real Read → final; actual size microcompact, SDK serialization and in-memory HTTP capture' } },
    transport: 'Actual queryModelWithStreaming/query and SDK request serialization; api.anthropic.com URL for first-party gate, all fetches answered in memory; isolated dummy key/config; no live API or resume stripping',
    observed,
    request_count: requests.length,
    exit_code: exit,
  }, null, 2))
  console.log(`Artifacts: ${artifacts}; exit=${exit}`)
}
// Keep the guard installed until termination so late background fetches cannot escape.
process.exit(exit)
